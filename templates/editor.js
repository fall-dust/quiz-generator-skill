// ═══════════════════════════════════════════════════════════════
// 题库编辑器 — 全字段编辑 + 运行时覆盖 + 导出 + Python 本地写入
//
// 从第一性原理设计：
//   浏览器无法写文件 → 两条互补持久化路径：
//     A. 浏览器下载完整新版 questions.js（用户手动替换）
//     B. 导出编辑清单 JSON → python apply_edits.py 直接修改源文件
//
//  可编辑字段（全题型）：
//    - 题目文本 (question)
//    - 选项文本 (options[].text)  — 仅选择题
//    - 正确答案 (answer)
//
//  三层架构：
//    1. 运行时覆盖层：localStorage → 内存对象（对 app.js 透明）
//    2. 编辑 UI 层：侧边栏开关 + 弹窗编辑器 + DOM 注入控件
//    3. 持久化层：浏览器下载 / File System API / Python 脚本
//
// 依赖：QUESTIONS, BIG_QUESTIONS, CHAPTER_NAMES（questions.js 提供）
// 加载时机：app.js 之后，覆盖已规范化的数据
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var LS_KEY = 'net_editor_overrides';
  var LS = localStorage;

  // ── 工具 ──
  function loadJ(k, def) {
    try { return JSON.parse(LS.getItem(k) || def); } catch (e) { return JSON.parse(def); }
  }
  function saveJ(k, v) {
    try { LS.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  //  第一层：全字段运行时覆盖
  //
  //  覆盖结构：{ qId: { question?, options?, answer? } }
  //  只存储被修改的字段，未修改的字段从原始数据读取
  // ═══════════════════════════════════════════════════════════

  var Overrides = {
    _data: loadJ(LS_KEY, '{}'),
    _originals: {},  // qId → { question, options, answer } 原始值快照

    // 获取某题的覆盖数据，无覆盖返回 null
    get: function (qId) {
      return this._data[qId] || null;
    },

    // 是否有任何覆盖
    has: function (qId) {
      return !!this._data[qId];
    },

    // 是否有特定字段覆盖
    hasField: function (qId, field) {
      var ov = this._data[qId];
      return ov && ov[field] !== undefined;
    },

    // 获取覆盖数量
    count: function () {
      return Object.keys(this._data).length;
    },

    // 获取全部覆盖（用于导出）
    getAll: function () {
      return JSON.parse(JSON.stringify(this._data));
    },

    // 保存覆盖并立即应用到内存
    // patch: { question?, options?, answer? } — 只包含要修改的字段
    set: function (qId, patch, q) {
      // 首次覆盖时保存原始值快照
      if (!this._originals[qId] && q) {
        this._originals[qId] = {
          question: q.question,
          options: q.options ? q.options.map(function (o) { return { label: o.label, text: o.text }; }) : undefined,
          answer: JSON.parse(JSON.stringify(q.answer))
        };
      }

      // 合并覆盖（增量更新，不覆盖未修改字段）
      if (!this._data[qId]) this._data[qId] = {};
      for (var key in patch) {
        if (patch.hasOwnProperty(key) && patch[key] !== undefined) {
          this._data[qId][key] = patch[key];
        }
      }

      saveJ(LS_KEY, this._data);

      // 立即应用到内存对象
      if (q) {
        if (patch.question !== undefined) q.question = patch.question;
        if (patch.options !== undefined) {
          for (var i = 0; i < patch.options.length; i++) {
            if (q.options && q.options[i]) {
              q.options[i].text = patch.options[i].text;
            }
          }
        }
        if (patch.answer !== undefined) {
          q.answer = JSON.parse(JSON.stringify(patch.answer));
        }
        q._overridden = this.has(qId);
      }
    },

    // 移除某题的全部覆盖
    remove: function (qId, q) {
      var orig = this._originals[qId];
      if (orig && q) {
        if (orig.question !== undefined) q.question = orig.question;
        if (orig.options !== undefined) {
          for (var i = 0; i < orig.options.length; i++) {
            if (q.options && q.options[i]) {
              q.options[i].text = orig.options[i].text;
            }
          }
        }
        if (orig.answer !== undefined) {
          q.answer = JSON.parse(JSON.stringify(orig.answer));
        }
        q._overridden = false;
      }
      delete this._data[qId];
      delete this._originals[qId];
      saveJ(LS_KEY, this._data);
    },

    // 清空全部覆盖
    clearAll: function () {
      var self = this;
      var allQs = getAllQuestions();
      Object.keys(this._data).forEach(function (qId) {
        var q = findQInArray(allQs, qId);
        var orig = self._originals[qId];
        if (orig && q) {
          if (orig.question !== undefined) q.question = orig.question;
          if (orig.options !== undefined) {
            for (var i = 0; i < orig.options.length; i++) {
              if (q.options && q.options[i]) q.options[i].text = orig.options[i].text;
            }
          }
          if (orig.answer !== undefined) q.answer = JSON.parse(JSON.stringify(orig.answer));
          q._overridden = false;
        }
      });
      this._data = {};
      this._originals = {};
      saveJ(LS_KEY, {});
    }
  };

  // ── 启动时：将全部覆盖应用到内存对象 ──
  function applyAllOverrides() {
    var allQs = getAllQuestions();
    allQs.forEach(function (q) {
      var ov = Overrides.get(q.id);
      if (!ov) return;

      // 保存原始快照
      Overrides._originals[q.id] = {
        question: q.question,
        options: q.options ? q.options.map(function (o) { return { label: o.label, text: o.text }; }) : undefined,
        answer: JSON.parse(JSON.stringify(q.answer))
      };

      // 应用覆盖
      if (ov.question !== undefined) q.question = ov.question;
      if (ov.options !== undefined) {
        for (var i = 0; i < ov.options.length; i++) {
          if (q.options && q.options[i]) {
            q.options[i].text = ov.options[i].text;
          }
        }
      }
      if (ov.answer !== undefined) {
        q.answer = JSON.parse(JSON.stringify(ov.answer));
      }
      q._overridden = true;
    });
  }

  // 工具函数
  function getAllQuestions() {
    return [].concat(
      (typeof QUESTIONS !== 'undefined' ? QUESTIONS : []),
      (typeof BIG_QUESTIONS !== 'undefined' ? BIG_QUESTIONS : [])
    );
  }

  function findQInArray(arr, qId) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === qId) return arr[i];
    }
    return null;
  }

  function findQ(qId) {
    return findQInArray(getAllQuestions(), qId);
  }

  function isMCQ(q) {
    return q && q.options && q.options.length > 0;
  }

  function isMCQMulti(q) {
    if (q._origType === '判断') return false;
    if (q._origType === 'multiple') return true;
    return false;
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function chName(ch) {
    if (typeof CHAPTER_NAMES !== 'undefined' && CHAPTER_NAMES[ch]) return CHAPTER_NAMES[ch];
    var n = parseInt((ch || '').replace('ch', ''), 10);
    return n ? '第' + n + '章' : (ch || '');
  }

  // 获取题目当前生效的字段值（考虑覆盖）
  function effectiveQuestion(q) {
    var ov = Overrides.get(q.id);
    return (ov && ov.question !== undefined) ? ov.question : q.question;
  }
  function effectiveOptions(q) {
    var ov = Overrides.get(q.id);
    if (ov && ov.options) return ov.options;
    return q.options ? q.options.map(function (o) { return { label: o.label, text: o.text }; }) : [];
  }
  function effectiveAnswer(q) {
    if (Array.isArray(q.answer)) return q.answer.join('');
    return String(q.answer || '');
  }

  // ═══════════════════════════════════════════════════════════
  //  第二层：编辑 UI — 弹窗编辑器（支持全字段）
  // ═══════════════════════════════════════════════════════════

  var EDIT_MODE = false;

  function renderMCQEditor(q) {
    var opts = effectiveOptions(q);
    var ans = effectiveAnswer(q);
    var multi = isMCQMulti(q);
    var inputType = multi ? 'checkbox' : 'radio';

    var ov = Overrides.get(q.id);
    var hasOv = !!ov;

    var html = '<div class="ae-edit-panel" id="ae-panel-' + q.id + '">';
    html += '<div class="ae-edit-title">✏️ 编辑题目 — ' + escapeHtml(q.id);
    html += ' <span class="tag tag-i">' + escapeHtml(chName(q.chapter)) + '</span>';
    if (hasOv) html += ' <span class="tag tag-w">已修正</span>';
    html += '</div>';

    // ── 题目文本编辑 ──
    html += '<div class="ae-edit-field">';
    html += '<label class="ae-lbl">📝 题目：</label>';
    html += '<textarea class="ae-textarea" id="ae-question-' + q.id + '" rows="3">' + escapeHtml(effectiveQuestion(q)) + '</textarea>';
    html += '</div>';

    // ── 选项文本编辑 ──
    html += '<div class="ae-edit-field">';
    html += '<label class="ae-lbl">📋 选项：</label>';
    html += '<div class="ae-edit-opts-list">';
    for (var i = 0; i < opts.length; i++) {
      html += '<div class="ae-opt-row">';
      html += '<span class="ae-opt-label">' + opts[i].label + '.</span>';
      html += '<input type="text" class="ae-opt-text-input" id="ae-opt-' + q.id + '-' + i + '" value="' + escapeHtml(opts[i].text) + '">';
      html += '</div>';
    }
    html += '</div>';
    html += '</div>';

    // ── 正确答案 ──
    html += '<div class="ae-edit-field">';
    html += '<label class="ae-lbl">✅ 正确答案：</label>';
    html += '<div class="ae-edit-opts">';
    for (var j = 0; j < opts.length; j++) {
      var isSel = ans.indexOf(opts[j].label) >= 0;
      html += '<label class="ae-opt' + (isSel ? ' ae-sel' : '') + '">';
      html += '<input type="' + inputType + '" name="ae-ans-' + q.id + '" value="' + opts[j].label + '"' + (isSel ? ' checked' : '') + '>';
      html += '<span class="ae-opt-l">' + opts[j].label + '</span>';
      html += '</label>';
    }
    html += '</div>';
    html += '</div>';

    // ── 操作按钮 ──
    html += '<div class="ae-edit-acts">';
    html += '<button class="btn btn-sm btn-o" onclick="Editor.cancelEdit(\'' + q.id + '\')">取消</button>';
    html += '<button class="btn btn-sm btn-p" onclick="Editor.saveMCQEdit(\'' + q.id + '\')">💾 保存修改</button>';
    if (hasOv) {
      html += '<button class="btn btn-sm btn-d" onclick="Editor.restoreOriginal(\'' + q.id + '\')">↩ 还原原始</button>';
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderBQEditor(q) {
    var ov = Overrides.get(q.id);
    var hasOv = !!ov;

    var html = '<div class="ae-edit-panel" id="ae-panel-' + q.id + '">';
    html += '<div class="ae-edit-title">✏️ 编辑题目 — ' + escapeHtml(q.id);
    html += ' <span class="tag tag-i">' + escapeHtml(chName(q.chapter)) + '</span>';
    if (hasOv) html += ' <span class="tag tag-w">已修正</span>';
    html += '</div>';

    // ── 题目文本 ──
    html += '<div class="ae-edit-field">';
    html += '<label class="ae-lbl">📝 题目：</label>';
    html += '<textarea class="ae-textarea" id="ae-question-' + q.id + '" rows="4">' + escapeHtml(effectiveQuestion(q)) + '</textarea>';
    html += '</div>';

    // ── 答案文本 ──
    html += '<div class="ae-edit-field">';
    html += '<label class="ae-lbl">✅ 答案：</label>';
    html += '<textarea class="ae-textarea" id="ae-text-' + q.id + '" rows="5">' + escapeHtml(effectiveAnswer(q)) + '</textarea>';
    html += '</div>';

    html += '<div class="ae-edit-acts">';
    html += '<button class="btn btn-sm btn-o" onclick="Editor.cancelEdit(\'' + q.id + '\')">取消</button>';
    html += '<button class="btn btn-sm btn-p" onclick="Editor.saveBQEdit(\'' + q.id + '\')">💾 保存修改</button>';
    if (hasOv) {
      html += '<button class="btn btn-sm btn-d" onclick="Editor.restoreOriginal(\'' + q.id + '\')">↩ 还原原始</button>';
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ── DOM 注入编辑按钮（MCQ + BQ 题目卡片） ──
  function injectEditButtons() {
    if (!EDIT_MODE) {
      document.querySelectorAll('.ae-edit-panel, .ae-edit-btn, .ae-overridden-badge').forEach(function (el) { el.remove(); });
      return;
    }

    // MCQ 答题页
    document.querySelectorAll('.q-card').forEach(function (card) {
      if (card.querySelector('.ae-edit-btn')) return;
      var bmBtn = card.querySelector('.bm-btn');
      if (!bmBtn) return;
      var m = (bmBtn.getAttribute('onclick') || '').match(/App\.toggleBM\('([^']+)'\)/);
      if (!m) return;
      var qId = m[1], q = findQ(qId);
      if (!q) return;

      var hd = card.querySelector('.q-hd');
      var fb = card.querySelector('.fb');

      var btn = document.createElement('button');
      btn.className = 'ae-edit-btn';
      btn.innerHTML = Overrides.has(qId) ? '✏️🔶' : '✏️';
      btn.title = '编辑题目/选项/答案';
      btn.onclick = function (e) { e.stopPropagation(); Editor.openEditor(qId); };

      if (fb && !fb.querySelector('.ae-edit-btn')) {
        fb.appendChild(btn);
      } else if (hd && !hd.querySelector('.ae-edit-btn')) {
        var btn2 = btn.cloneNode(true);
        btn2.className = 'ae-edit-btn ae-edit-btn-hd';
        btn2.onclick = function (e) { e.stopPropagation(); Editor.openEditor(qId); };
        hd.appendChild(btn2);
      }

      if (Overrides.has(qId) && hd && !hd.querySelector('.ae-overridden-badge')) {
        var badge = document.createElement('span');
        badge.className = 'tag tag-w ae-overridden-badge';
        badge.textContent = '已修正';
        hd.appendChild(badge);
      }
    });

    // 大题列表页
    document.querySelectorAll('.bq-list-card').forEach(function (card) {
      if (card.querySelector('.ae-edit-btn')) return;
      var bmBtn = card.querySelector('.bm-btn');
      if (!bmBtn) return;
      var m = (bmBtn.getAttribute('onclick') || '').match(/App\.toggleBM\('([^']+)'\)/);
      if (!m) return;
      var qId = m[1], q = findQ(qId);
      if (!q) return;

      var hd = card.querySelector('.bq-list-hd');
      var ansArea = card.querySelector('.bq-list-a');

      var btn = document.createElement('button');
      btn.className = 'ae-edit-btn ae-edit-btn-bq';
      btn.innerHTML = Overrides.has(qId) ? '✏️ 编辑 🔶' : '✏️ 编辑';
      btn.title = '编辑题目/答案';
      btn.onclick = function (e) { e.stopPropagation(); Editor.openEditor(qId); };

      if (ansArea && !ansArea.querySelector('.ae-edit-btn')) {
        ansArea.appendChild(btn);
      } else if (hd && !hd.querySelector('.ae-edit-btn')) {
        btn.className = 'ae-edit-btn ae-edit-btn-hd';
        hd.appendChild(btn);
      }

      if (Overrides.has(qId) && hd && !hd.querySelector('.ae-overridden-badge')) {
        var badge = document.createElement('span');
        badge.className = 'tag tag-w ae-overridden-badge';
        badge.textContent = '已修正';
        hd.appendChild(badge);
      }
    });
  }

  // MutationObserver
  var _observer = null;
  function startObserver() {
    if (_observer) return;
    var contentArea = document.getElementById('contentArea');
    if (!contentArea) return;
    _observer = new MutationObserver(function () { injectEditButtons(); });
    _observer.observe(contentArea, { childList: true, subtree: true });
  }

  // ═══════════════════════════════════════════════════════════
  //  侧边栏 UI
  // ═══════════════════════════════════════════════════════════

  function createSidebarUI() {
    var sidebar = document.getElementById('sidebar');
    var themeToggle = sidebar ? sidebar.querySelector('.theme-toggle') : null;
    if (!sidebar || !themeToggle) { setTimeout(createSidebarUI, 200); return; }
    if (document.getElementById('aeSidebarSection')) return;

    var section = document.createElement('div');
    section.id = 'aeSidebarSection';
    section.className = 'ae-sidebar-section';
    section.innerHTML =
      '<div class="ae-sidebar-lbl">🔧 题库编辑</div>' +
      '<button class="ae-toggle-btn" id="aeToggleBtn" onclick="Editor.toggleEditMode()">' +
        '<span>✏️ 编辑题目/选项/答案</span> <span class="ae-toggle-state" id="aeToggleState">关</span>' +
      '</button>' +
      '<button class="ae-export-btn" id="aeExportJSBtn" onclick="Editor.exportJS()" title="导出完整 questions.js">' +
        '📥 导出新版 questions.js' +
      '</button>' +
      '<button class="ae-export-btn" id="aeExportManifestBtn" onclick="Editor.exportManifest()" title="导出编辑清单供 Python 应用">' +
        '📋 导出编辑清单 JSON' +
      '</button>' +
      '<div class="ae-count" id="aeCount" style="display:none">' +
        '已修改 <strong id="aeCountNum">0</strong> 题 · ' +
        '<a href="#" onclick="Editor.clearAllOverrides();return false" style="color:var(--rd);font-size:.72rem">清除全部</a>' +
      '</div>' +
      '<div class="ae-hint" style="font-size:.68rem;color:var(--t2);margin-top:4px;line-height:1.4">' +
        '💡 点击题目旁的 ✏️ 可编辑题目文本、选项内容和正确答案。<br>' +
        '导出 JS → 替换原文件 | 导出 JSON → Python 自动应用' +
      '</div>';

    sidebar.insertBefore(section, themeToggle);
    updateSidebarState();
  }

  function updateSidebarState() {
    var toggleBtn = document.getElementById('aeToggleBtn');
    var toggleState = document.getElementById('aeToggleState');
    var countEl = document.getElementById('aeCount');
    var countNum = document.getElementById('aeCountNum');

    if (toggleBtn) toggleBtn.classList.toggle('ae-active', EDIT_MODE);
    if (toggleState) {
      toggleState.textContent = EDIT_MODE ? '开' : '关';
      toggleState.style.color = EDIT_MODE ? 'var(--gr)' : 'var(--t2)';
    }
    var cnt = Overrides.count();
    if (countEl) countEl.style.display = cnt > 0 ? 'block' : 'none';
    if (countNum) countNum.textContent = cnt;
  }

  // ═══════════════════════════════════════════════════════════
  //  编辑弹窗
  // ═══════════════════════════════════════════════════════════

  function openEditor(qId) {
    var q = findQ(qId);
    if (!q) return;

    document.querySelectorAll('.ae-modal-overlay').forEach(function (el) { el.remove(); });
    document.querySelectorAll('.ae-edit-panel').forEach(function (el) { el.remove(); });

    var overlay = document.createElement('div');
    overlay.className = 'ae-modal-overlay';
    overlay.onclick = function (e) { if (e.target === overlay) closeEditor(); };

    var dlg = document.createElement('div');
    dlg.className = 'ae-modal-dlg';
    dlg.onclick = function (e) { e.stopPropagation(); };
    dlg.innerHTML = isMCQ(q) ? renderMCQEditor(q) : renderBQEditor(q);

    overlay.appendChild(dlg);
    document.body.appendChild(overlay);

    requestAnimationFrame(function () {
      overlay.classList.add('ae-show');
      dlg.classList.add('ae-show');
    });
  }

  function closeEditor() {
    document.querySelectorAll('.ae-modal-overlay').forEach(function (el) {
      el.classList.remove('ae-show');
      setTimeout(function () { el.remove(); }, 250);
    });
  }

  // ── 保存 MCQ 编辑 ──
  function saveMCQEdit(qId) {
    var q = findQ(qId);
    if (!q) return;

    // 收集题目文本
    var qTextEl = document.getElementById('ae-question-' + qId);
    var newQuestion = qTextEl ? qTextEl.value.trim() : '';

    // 收集选项文本
    var newOpts = [];
    var opts = effectiveOptions(q);
    for (var i = 0; i < opts.length; i++) {
      var optInput = document.getElementById('ae-opt-' + qId + '-' + i);
      newOpts.push({
        label: opts[i].label,
        text: optInput ? optInput.value.trim() : opts[i].text
      });
    }

    // 收集答案
    var radios = document.getElementsByName('ae-ans-' + qId);
    var selected = [];
    for (var j = 0; j < radios.length; j++) {
      if (radios[j].checked) selected.push(radios[j].value);
    }

    if (!newQuestion) { alert('题目不能为空'); return; }
    if (selected.length === 0) { alert('请至少选择一个正确答案'); return; }
    // 检查选项非空
    for (var k = 0; k < newOpts.length; k++) {
      if (!newOpts[k].text) { alert('选项 ' + newOpts[k].label + ' 不能为空'); return; }
    }

    var patch = { question: newQuestion, options: newOpts, answer: selected };
    Overrides.set(qId, patch, q);
    closeEditor();
    updateSidebarState();

    reEvalAndRender(qId);
    try { injectEditButtons(); } catch (e) {}
    toast('已保存：题目、选项和答案 (' + qId + ')', 'success');
  }

  // ── 保存大题编辑 ──
  function saveBQEdit(qId) {
    var q = findQ(qId);
    if (!q) return;

    var qTextEl = document.getElementById('ae-question-' + qId);
    var ansTextEl = document.getElementById('ae-text-' + qId);
    var newQuestion = qTextEl ? qTextEl.value.trim() : '';
    var newAnswer = ansTextEl ? ansTextEl.value.trim() : '';

    if (!newQuestion) { alert('题目不能为空'); return; }
    if (!newAnswer) { alert('答案不能为空'); return; }

    var patch = { question: newQuestion, answer: newAnswer };
    Overrides.set(qId, patch, q);
    closeEditor();
    updateSidebarState();

    // 大题无自动判分，仅触发渲染
    tryRender();
    try { injectEditButtons(); } catch (e) {}
    toast('已保存：题目和答案 (' + qId + ')', 'success');
  }

  function cancelEdit(qId) { closeEditor(); }

  function restoreOriginal(qId) {
    var q = findQ(qId);
    if (!q) return;
    if (!confirm('确定还原「' + q.id + '」的原始题目、选项和答案？此操作不可恢复。')) return;
    Overrides.remove(qId, q);
    closeEditor();
    updateSidebarState();

    reEvalAndRender(qId);
    toast('已还原原始数据 (' + qId + ')', 'info');
  }

  function clearAllOverrides() {
    var cnt = Overrides.count();
    if (cnt === 0) return;
    if (!confirm('确定清除全部 ' + cnt + ' 道题目的修改？此操作不可恢复。')) return;
    Overrides.clearAll();
    updateSidebarState();
    tryRender();
    toast('已清除全部 ' + cnt + ' 条修改', 'warning');
  }

  // 辅助：重判 + 重渲染
  function reEvalAndRender(qId) {
    if (typeof App !== 'undefined' && typeof App.reevaluate === 'function') {
      try { App.reevaluate(qId); } catch (e) { tryRender(); }
    } else if (typeof window.App !== 'undefined' && typeof window.App.reevaluate === 'function') {
      try { window.App.reevaluate(qId); } catch (e) { tryRender(); }
    } else {
      tryRender();
    }
  }

  function tryRender() {
    if (typeof App !== 'undefined' && typeof App.render === 'function') {
      try { App.render(); } catch (e) {}
    } else if (typeof window.App !== 'undefined' && typeof window.App.render === 'function') {
      try { window.App.render(); } catch (e) {}
    }
  }

  function toast(msg, type) {
    if (typeof App !== 'undefined' && typeof App.toast === 'function') {
      try { App.toast(msg, type || 'info'); } catch (e) {}
    } else if (typeof window.App !== 'undefined' && typeof window.App.toast === 'function') {
      try { window.App.toast(msg, type || 'info'); } catch (e) {}
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  第三层：持久化 — 导出
  // ═══════════════════════════════════════════════════════════

  // 构建导出对象（应用全部覆盖后的最终版本）
  function buildExportObj(q) {
    var obj = {};
    obj.id = q.id;
    obj.chapter = q.chapter;

    // type: MCQ 优先用 _origType
    if (q._origType && (q._origType === 'choice' || q._origType === '判断')) {
      obj.type = q._origType;
    } else {
      obj.type = q.type;
    }

    if (q.number !== undefined) obj.number = q.number;
    obj.question = q.question;  // 已应用覆盖

    if (q.options && q.options.length > 0) {
      obj.options = q.options.map(function (o) {
        return { label: o.label, text: o.text };
      });
    }

    // 答案：MCQ → 字符串，大题 → 字符串
    if (q.options && q.options.length > 0) {
      obj.answer = Array.isArray(q.answer) ? q.answer.join('') : String(q.answer);
    } else {
      obj.answer = Array.isArray(q.answer) ? q.answer.join(', ') : String(q.answer);
    }

    return obj;
  }

  // 生成完整 questions.js 内容
  function generateQuestionsJS() {
    var lines = [];
    var cnt = Overrides.count();
    var ts = new Date().toISOString().split('T')[0];

    lines.push('// 计算机组成原理 — 选择题题库');
    lines.push('// 生成日期：' + ts + (cnt > 0 ? ' | 已应用 ' + cnt + ' 条编辑修正' : ''));
    lines.push('');

    if (typeof CHAPTER_NAMES !== 'undefined') {
      lines.push('var CHAPTER_NAMES = ' + JSON.stringify(CHAPTER_NAMES, null, 2) + ';');
      lines.push('');
    }

    if (typeof QUESTIONS !== 'undefined' && QUESTIONS.length > 0) {
      lines.push('var QUESTIONS = [');
      QUESTIONS.forEach(function (q, i) {
        var obj = buildExportObj(q);
        var json = JSON.stringify(obj, null, 2);
        var indented = json.split('\n').map(function (line) { return '  ' + line; }).join('\n');
        lines.push(indented + (i < QUESTIONS.length - 1 ? ',' : ''));
      });
      lines.push('];');
      lines.push('');
    }

    return lines.join('\n');
  }

  // 生成编辑清单 JSON（供 Python 脚本使用）
  function generateManifestJSON() {
    var manifest = {
      _meta: {
        generated: new Date().toISOString(),
        sourceFile: 'js/questions.js',
        totalEdits: Overrides.count(),
        instructions: '将此文件放在 questions.js 同目录，运行: python apply_edits.py --apply edit_manifest.json'
      },
      edits: {}
    };

    var ids = Object.keys(Overrides._data);
    ids.forEach(function (qId) {
      var ov = Overrides._data[qId];
      var q = findQ(qId);
      var entry = {};

      if (ov.question !== undefined) entry.question = ov.question;
      if (ov.options !== undefined) entry.options = ov.options;
      if (ov.answer !== undefined) {
        entry.answer = Array.isArray(ov.answer) ? ov.answer : String(ov.answer);
      }

      // 附加元信息
      entry._chapter = q ? q.chapter : '?';
      entry._number = q ? q.number : 0;
      entry._origType = q ? (q._origType || q.type) : '?';

      manifest.edits[qId] = entry;
    });

    return JSON.stringify(manifest, null, 2);
  }

  // 导出完整 questions.js
  function exportJS() {
    var cnt = Overrides.count();
    var content = generateQuestionsJS();
    var fname = 'questions' + (cnt > 0 ? '_corrected' : '') + '.js';
    downloadFile(content, fname, 'application/javascript;charset=utf-8');
    if (cnt > 0) {
      toast('已导出新版 questions.js（含 ' + cnt + ' 条修改）。请用它替换 js/questions.js', 'success');
    } else {
      toast('已导出 questions.js（无修改）', 'info');
    }
  }

  // 导出编辑清单 JSON
  function exportManifest() {
    var cnt = Overrides.count();
    if (cnt === 0) { alert('暂无修改，无需导出编辑清单。'); return; }
    var content = generateManifestJSON();
    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadFile(content, 'edit_manifest_' + ts + '.json', 'application/json;charset=utf-8');
    toast('已导出编辑清单 JSON（' + cnt + ' 条修改）。运行: python apply_edits.py --apply <此文件>', 'success');
  }

  function downloadFile(content, fname, mimeType) {
    // 优先使用 File System Access API
    if (typeof window.showSaveFilePicker === 'function') {
      (async function () {
        try {
          var handle = await window.showSaveFilePicker({
            suggestedName: fname,
            types: [{ description: 'File', accept: { [mimeType]: ['.js', '.json'] } }]
          });
          var writable = await handle.createWritable();
          await writable.write(content);
          await writable.close();
          toast('✅ 文件已保存: ' + fname, 'success');
        } catch (e) {
          if (e.name !== 'AbortError') downloadViaAnchor(content, fname, mimeType);
        }
      })();
    } else {
      downloadViaAnchor(content, fname, mimeType);
    }
  }

  function downloadViaAnchor(content, fname, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ═══════════════════════════════════════════════════════════
  //  对外接口
  // ═══════════════════════════════════════════════════════════

  var Editor = {
    toggleEditMode: function () {
      EDIT_MODE = !EDIT_MODE;
      updateSidebarState();
      injectEditButtons();
      toast(EDIT_MODE ? '编辑模式已开启 — 点击 ✏️ 编辑题目/选项/答案' : '编辑模式已关闭', 'info');
    },

    openEditor: function (qId) { openEditor(qId); },
    saveMCQEdit: function (qId) { saveMCQEdit(qId); },
    saveBQEdit: function (qId) { saveBQEdit(qId); },
    cancelEdit: function (qId) { cancelEdit(qId); },
    restoreOriginal: function (qId) { restoreOriginal(qId); },

    // 导出
    exportJS: function () { exportJS(); },
    exportManifest: function () { exportManifest(); },
    // 兼容旧接口
    exportFile: function () { exportJS(); },

    clearAllOverrides: function () { clearAllOverrides(); },

    // 状态查询
    isEditMode: function () { return EDIT_MODE; },
    getOverrideCount: function () { return Overrides.count(); },
    hasOverride: function (qId) { return Overrides.has(qId); },

    _overrides: Overrides
  };

  // ═══════════════════════════════════════════════════════════
  //  启动
  // ═══════════════════════════════════════════════════════════

  function init() {
    applyAllOverrides();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        createSidebarUI();
        startObserver();
        injectEditButtons();
      });
    } else {
      createSidebarUI();
      startObserver();
      injectEditButtons();
    }
  }

  window.Editor = Editor;
  init();

})();
