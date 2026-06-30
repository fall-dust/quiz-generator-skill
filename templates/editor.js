// ═══════════════════════════════════════════════════════════════
// 答案编辑模块 — 运行时覆盖 + 编辑UI + 导出
// 从第一性原理设计：
//   1. 运行时层：localStorage 答案覆盖，对 app.js 透明
//   2. 编辑UI层：侧边栏开关 + 题目编辑控件
//   3. 持久化层：浏览器下载修正后的 questions.js
// 依赖：QUESTIONS, BIG_QUESTIONS, CHAPTER_NAMES（由 questions.js 提供）
// 加载时机：在 app.js 之后加载，覆盖已规范化的答案
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var LS_KEY = 'net_answer_overrides';
  var LS = localStorage;

  // ── 工具 ──
  function loadJ(k, def) {
    try { return JSON.parse(LS.getItem(k) || def); } catch (e) { return JSON.parse(def); }
  }
  function saveJ(k, v) {
    try { LS.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  //  第一层：运行时答案覆盖
  //  直接修改内存中 q.answer，对 app.js 完全透明
  // ═══════════════════════════════════════════════════════════

  var Overrides = {
    _data: loadJ(LS_KEY, '{}'),
    _originals: {},  // qId → original answer（用于还原）

    // 获取某题的覆盖答案，无覆盖返回 null
    get: function (qId) {
      return this._data[qId] !== undefined ? this._data[qId] : null;
    },

    // 是否有覆盖
    has: function (qId) {
      return this._data[qId] !== undefined;
    },

    // 设置覆盖并立即应用到内存对象
    set: function (qId, newAnswer, q) {
      // 保存原始答案
      if (!(qId in this._originals) && q) {
        this._originals[qId] = JSON.parse(JSON.stringify(q.answer));
      }
      this._data[qId] = newAnswer;
      saveJ(LS_KEY, this._data);
      // 立即应用到内存
      if (q) {
        q.answer = JSON.parse(JSON.stringify(newAnswer));
        q._overridden = true;
      }
    },

    // 移除覆盖
    remove: function (qId, q) {
      if (this._originals[qId] && q) {
        q.answer = JSON.parse(JSON.stringify(this._originals[qId]));
        q._overridden = false;
      }
      delete this._data[qId];
      delete this._originals[qId];
      saveJ(LS_KEY, this._data);
    },

    // 获取覆盖数量
    count: function () {
      return Object.keys(this._data).length;
    },

    // 获取所有覆盖（用于导出）
    getAll: function () {
      return JSON.parse(JSON.stringify(this._data));
    }
  };

  // ── 启动时：将覆盖应用到所有已加载的题目对象 ──
  function applyAllOverrides() {
    var allQs = [].concat(
      (typeof QUESTIONS !== 'undefined' ? QUESTIONS : []),
      (typeof BIG_QUESTIONS !== 'undefined' ? BIG_QUESTIONS : [])
    );
    allQs.forEach(function (q) {
      var ov = Overrides.get(q.id);
      if (ov !== null) {
        Overrides._originals[q.id] = JSON.parse(JSON.stringify(q.answer));
        q.answer = JSON.parse(JSON.stringify(ov));
        q._overridden = true;
      }
    });
  }

  // 找题工具
  function findQ(qId) {
    var q = (typeof QUESTIONS !== 'undefined' ? QUESTIONS : []).find(function (x) { return x.id === qId; });
    if (!q) {
      q = (typeof BIG_QUESTIONS !== 'undefined' ? BIG_QUESTIONS : []).find(function (x) { return x.id === qId; });
    }
    return q || null;
  }

  // ═══════════════════════════════════════════════════════════
  //  第二层：编辑 UI
  //  侧边栏开关 + MutationObserver 注入编辑控件
  // ═══════════════════════════════════════════════════════════

  var EDIT_MODE = false;

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 判断是否为 MCQ 类型（有 options 的）
  function isMCQ(q) {
    return q && q.options && q.options.length > 0;
  }

  // 生成 MCQ 答案编辑器的 HTML
  function renderMCQEditor(q) {
    var currentAns = Array.isArray(q.answer) ? q.answer.join('') : String(q.answer);
    var html = '<div class="ae-edit-panel" id="ae-panel-' + q.id + '">';
    html += '<div class="ae-edit-title">修改答案 — ' + escapeHtml(q.id) + '</div>';
    html += '<div class="ae-edit-q">' + escapeHtml(q.question) + '</div>';
    html += '<div class="ae-edit-opts">';
    q.options.forEach(function (opt) {
      var isSel = currentAns.indexOf(opt.label) >= 0;
      html += '<label class="ae-opt' + (isSel ? ' ae-sel' : '') + '">';
      html += '<input type="' + (isMCQMulti(q) ? 'checkbox' : 'radio') + '" name="ae-ans-' + q.id + '" value="' + opt.label + '"' + (isSel ? ' checked' : '') + '>';
      html += '<span class="ae-opt-l">' + opt.label + '</span>';
      html += '<span class="ae-opt-t">' + escapeHtml(opt.text) + '</span>';
      html += '</label>';
    });
    html += '</div>';
    html += '<div class="ae-edit-acts">';
    html += '<button class="btn btn-sm btn-o" onclick="Editor.cancelEdit(\'' + q.id + '\')">取消</button>';
    html += '<button class="btn btn-sm btn-p" onclick="Editor.saveMCQEdit(\'' + q.id + '\')">✅ 保存</button>';
    if (Overrides.has(q.id)) {
      html += '<button class="btn btn-sm btn-d" onclick="Editor.restoreOriginal(\'' + q.id + '\')">↩ 还原原始答案</button>';
    }
    html += '</div>';
    html += '</div>';
    return html;
  }

  function isMCQMulti(q) {
    // 判断题视为单选
    if (q._origType === '判断') return false;
    // 原始答案为多字母("AB")或有 type 为 multiple 的为多选
    if (q._origType === 'multiple') return true;
    // 如果原始 answer 是字符串且长度 > 1（说明是多选），如 "AB"
    if (Overrides._originals[q.id]) {
      var orig = Overrides._originals[q.id];
      if (Array.isArray(orig) && orig.length > 1) return true;
    }
    return false;
  }

  // 生成大题答案编辑器的 HTML（填空/简答/计算）
  function renderBQEditor(q) {
    var currentAns = Array.isArray(q.answer) ? q.answer.join(', ') : String(q.answer || '');
    var html = '<div class="ae-edit-panel" id="ae-panel-' + q.id + '">';
    html += '<div class="ae-edit-title">修改答案 — ' + escapeHtml(q.id) + ' <span class="tag tag-i">' + escapeHtml(chName(q.chapter)) + '</span></div>';
    html += '<div class="ae-edit-q">' + escapeHtml(q.question) + '</div>';
    html += '<div class="ae-edit-field">';
    html += '<label class="ae-lbl">正确答案：</label>';
    html += '<textarea class="ae-textarea" id="ae-text-' + q.id + '" rows="3">' + escapeHtml(currentAns) + '</textarea>';
    html += '</div>';
    html += '<div class="ae-edit-acts">';
    html += '<button class="btn btn-sm btn-o" onclick="Editor.cancelEdit(\'' + q.id + '\')">取消</button>';
    html += '<button class="btn btn-sm btn-p" onclick="Editor.saveBQEdit(\'' + q.id + '\')">✅ 保存</button>';
    if (Overrides.has(q.id)) {
      html += '<button class="btn btn-sm btn-d" onclick="Editor.restoreOriginal(\'' + q.id + '\')">↩ 还原原始答案</button>';
    }
    html += '</div>';
    html += '</div>';
    return html;
  }

  function chName(ch) {
    if (typeof CHAPTER_NAMES !== 'undefined' && CHAPTER_NAMES[ch]) return CHAPTER_NAMES[ch];
    var n = parseInt((ch || '').replace('ch', ''), 10);
    return n ? '第' + n + '章' : (ch || '');
  }

  // 在题目卡片中注入编辑按钮
  function injectEditButtons() {
    if (!EDIT_MODE) {
      // 移除所有编辑面板
      document.querySelectorAll('.ae-edit-panel, .ae-edit-btn').forEach(function (el) { el.remove(); });
      document.querySelectorAll('.ae-overridden-badge').forEach(function (el) { el.remove(); });
      return;
    }

    // MCQ 答题页 — 在反馈区/选项区注入编辑按钮
    var qCards = document.querySelectorAll('.q-card');
    qCards.forEach(function (card) {
      if (card.querySelector('.ae-edit-btn')) return; // 已注入

      // 从 DOM 中推断题目 ID（通过收藏按钮的 onclick）
      var bmBtn = card.querySelector('.bm-btn');
      if (!bmBtn) return;
      var onclick = bmBtn.getAttribute('onclick') || '';
      var match = onclick.match(/App\.toggleBM\('([^']+)'\)/);
      if (!match) return;
      var qId = match[1];
      var q = findQ(qId);
      if (!q) return;

      // 反馈区注入编辑按钮
      var fb = card.querySelector('.fb');
      if (fb && !fb.querySelector('.ae-edit-btn')) {
        var btn = document.createElement('button');
        btn.className = 'ae-edit-btn';
        btn.innerHTML = Overrides.has(qId) ? '✏️🔶' : '✏️';
        btn.title = '编辑答案';
        btn.onclick = function (e) { e.stopPropagation(); Editor.openEditor(qId); };
        fb.appendChild(btn);
      }

      // 若题目无反馈区（未作答），在题目头部注入
      var hd = card.querySelector('.q-hd');
      if (!fb && hd && !hd.querySelector('.ae-edit-btn')) {
        var btn2 = document.createElement('button');
        btn2.className = 'ae-edit-btn ae-edit-btn-hd';
        btn2.innerHTML = Overrides.has(qId) ? '✏️🔶' : '✏️';
        btn2.title = '编辑答案';
        btn2.onclick = function (e) { e.stopPropagation(); Editor.openEditor(qId); };
        hd.appendChild(btn2);
      }

      // 覆盖徽标
      if (Overrides.has(qId) && hd && !hd.querySelector('.ae-overridden-badge')) {
        var badge = document.createElement('span');
        badge.className = 'tag tag-w ae-overridden-badge';
        badge.textContent = '已修正';
        hd.appendChild(badge);
      }
    });

    // 大题列表页 — 在答案区注入编辑按钮
    var bqCards = document.querySelectorAll('.bq-list-card');
    bqCards.forEach(function (card) {
      if (card.querySelector('.ae-edit-btn')) return;

      var bmBtn = card.querySelector('.bm-btn');
      if (!bmBtn) return;
      var onclick = bmBtn.getAttribute('onclick') || '';
      var match = onclick.match(/App\.toggleBM\('([^']+)'\)/);
      if (!match) return;
      var qId = match[1];
      var q = findQ(qId);
      if (!q) return;

      var ansArea = card.querySelector('.bq-list-a');
      var hd = card.querySelector('.bq-list-hd');

      if (ansArea && !ansArea.querySelector('.ae-edit-btn')) {
        var btn = document.createElement('button');
        btn.className = 'ae-edit-btn ae-edit-btn-bq';
        btn.innerHTML = Overrides.has(qId) ? '✏️ 修改答案 🔶' : '✏️ 修改答案';
        btn.title = '编辑答案';
        btn.onclick = function (e) { e.stopPropagation(); Editor.openEditor(qId); };
        ansArea.appendChild(btn);
      } else if (!ansArea && hd && !hd.querySelector('.ae-edit-btn')) {
        var btn2 = document.createElement('button');
        btn2.className = 'ae-edit-btn ae-edit-btn-hd';
        btn2.innerHTML = Overrides.has(qId) ? '✏️🔶' : '✏️';
        btn2.title = '编辑答案';
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
  }

  // MutationObserver：监听内容区变化，自动注入编辑控件
  var _observer = null;
  function startObserver() {
    if (_observer) return;
    var contentArea = document.getElementById('contentArea');
    if (!contentArea) return;
    _observer = new MutationObserver(function () {
      injectEditButtons();
    });
    _observer.observe(contentArea, { childList: true, subtree: true });
  }

  // ═══════════════════════════════════════════════════════════
  //  侧边栏 UI
  // ═══════════════════════════════════════════════════════════

  function createSidebarUI() {
    // 在侧边栏底部（主题按钮之上）插入编辑模式区
    var sidebar = document.getElementById('sidebar');
    var themeToggle = sidebar ? sidebar.querySelector('.theme-toggle') : null;
    if (!sidebar || !themeToggle) {
      // 还没渲染好，等 DOM 加载后再试
      setTimeout(createSidebarUI, 200);
      return;
    }

    // 避免重复插入
    if (document.getElementById('aeSidebarSection')) return;

    var section = document.createElement('div');
    section.id = 'aeSidebarSection';
    section.className = 'ae-sidebar-section';
    section.innerHTML =
      '<div class="ae-sidebar-lbl">🔧 答案管理</div>' +
      '<button class="ae-toggle-btn" id="aeToggleBtn" onclick="Editor.toggleEditMode()">' +
        '<span>✏️</span> 编辑模式 <span class="ae-toggle-state" id="aeToggleState">关</span>' +
      '</button>' +
      '<button class="ae-export-btn" id="aeExportBtn" onclick="Editor.exportFile()" title="导出修正后的 questions.js">' +
        '📥 导出修正文件' +
      '</button>' +
      '<div class="ae-count" id="aeCount" style="display:none">' +
        '已修正 <strong id="aeCountNum">0</strong> 题 · ' +
        '<a href="#" onclick="Editor.clearAllOverrides();return false" style="color:var(--rd);font-size:.72rem">清除全部</a>' +
      '</div>';

    sidebar.insertBefore(section, themeToggle);
    updateSidebarState();
  }

  function updateSidebarState() {
    var toggleBtn = document.getElementById('aeToggleBtn');
    var toggleState = document.getElementById('aeToggleState');
    var countEl = document.getElementById('aeCount');
    var countNum = document.getElementById('aeCountNum');

    if (toggleBtn) {
      toggleBtn.classList.toggle('ae-active', EDIT_MODE);
    }
    if (toggleState) {
      toggleState.textContent = EDIT_MODE ? '开' : '关';
      toggleState.style.color = EDIT_MODE ? 'var(--gr)' : 'var(--t3)';
    }
    var cnt = Overrides.count();
    if (countEl) {
      countEl.style.display = cnt > 0 ? 'block' : 'none';
    }
    if (countNum) {
      countNum.textContent = cnt;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  编辑弹窗
  // ═══════════════════════════════════════════════════════════

  function openEditor(qId) {
    var q = findQ(qId);
    if (!q) return;

    // 移除已有弹窗
    document.querySelectorAll('.ae-modal-overlay').forEach(function (el) { el.remove(); });
    // 移除行内编辑面板
    document.querySelectorAll('.ae-edit-panel').forEach(function (el) { el.remove(); });

    var overlay = document.createElement('div');
    overlay.className = 'ae-modal-overlay';
    overlay.onclick = function (e) {
      if (e.target === overlay) closeEditor();
    };

    var dlg = document.createElement('div');
    dlg.className = 'ae-modal-dlg';
    dlg.onclick = function (e) { e.stopPropagation(); };

    if (isMCQ(q)) {
      dlg.innerHTML = renderMCQEditor(q);
    } else {
      dlg.innerHTML = renderBQEditor(q);
    }

    overlay.appendChild(dlg);
    document.body.appendChild(overlay);

    // 动画
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

  // 保存 MCQ 答案
  function saveMCQEdit(qId) {
    var q = findQ(qId);
    if (!q) return;

    var radios = document.getElementsByName('ae-ans-' + qId);
    var selected = [];
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].checked) selected.push(radios[i].value);
    }
    if (selected.length === 0) {
      alert('请至少选择一个答案');
      return;
    }

    Overrides.set(qId, selected, q);
    closeEditor();
    updateSidebarState();

    // 重新判定用户回答：如果答案修正后用户原回答变正确/错误，自动更新错题本
    if (typeof App !== 'undefined' && typeof App.reevaluate === 'function') {
      try { App.reevaluate(qId); } catch (e) {}
    } else if (typeof window.App !== 'undefined' && typeof window.App.reevaluate === 'function') {
      try { window.App.reevaluate(qId); } catch (e) {}
    } else {
      // 回退：仅触发渲染
      if (typeof App !== 'undefined' && typeof App.render === 'function') {
        try { App.render(); } catch (e) {}
      } else if (typeof window.App !== 'undefined' && typeof window.App.render === 'function') {
        try { window.App.render(); } catch (e) {}
      }
    }

    try { injectEditButtons(); } catch (e) {}
  }

  // 保存大题答案
  function saveBQEdit(qId) {
    var q = findQ(qId);
    if (!q) return;

    var textarea = document.getElementById('ae-text-' + qId);
    if (!textarea) return;

    var newAns = textarea.value.trim();
    if (!newAns) {
      alert('答案不能为空');
      return;
    }

    Overrides.set(qId, newAns, q);
    closeEditor();
    updateSidebarState();

    // 大题无自动判分，仅触发渲染刷新显示
    if (typeof App !== 'undefined' && typeof App.render === 'function') {
      try { App.render(); } catch (e) {}
    } else if (typeof window.App !== 'undefined' && typeof window.App.render === 'function') {
      try { window.App.render(); } catch (e) {}
    }

    try { injectEditButtons(); } catch (e) {}
  }

  function cancelEdit(qId) {
    closeEditor();
  }

  function restoreOriginal(qId) {
    var q = findQ(qId);
    if (!q) return;
    if (!confirm('确定还原「' + q.id + '」的原始答案？')) return;
    Overrides.remove(qId, q);
    closeEditor();
    updateSidebarState();

    // 重判用户回答（答案还原后可能需要更新错题本）
    if (typeof App !== 'undefined' && typeof App.reevaluate === 'function') {
      try { App.reevaluate(qId); } catch (e) {}
    } else if (typeof window.App !== 'undefined' && typeof window.App.reevaluate === 'function') {
      try { window.App.reevaluate(qId); } catch (e) {}
    } else {
      if (typeof App !== 'undefined' && typeof App.render === 'function') {
        try { App.render(); } catch (e) {}
      } else if (typeof window.App !== 'undefined' && typeof window.App.render === 'function') {
        try { window.App.render(); } catch (e) {}
      }
    }
  }

  function clearAllOverrides() {
    if (!confirm('确定清除全部 ' + Overrides.count() + ' 条答案修正？此操作不可恢复。')) return;

    var allQs = [].concat(
      (typeof QUESTIONS !== 'undefined' ? QUESTIONS : []),
      (typeof BIG_QUESTIONS !== 'undefined' ? BIG_QUESTIONS : [])
    );
    var ids = Object.keys(Overrides._data);
    ids.forEach(function (qId) {
      var q = allQs.find(function (x) { return x.id === qId; });
      if (q && Overrides._originals[qId]) {
        q.answer = JSON.parse(JSON.stringify(Overrides._originals[qId]));
        q._overridden = false;
      }
    });
    Overrides._data = {};
    Overrides._originals = {};
    saveJ(LS_KEY, {});
    updateSidebarState();

    if (typeof App !== 'undefined' && typeof App.render === 'function') {
      try { App.render(); } catch (e) {}
    } else if (typeof window.App !== 'undefined' && typeof window.App.render === 'function') {
      try { window.App.render(); } catch (e) {}
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  第三层：导出 / 下载修正后的 questions.js
  // ═══════════════════════════════════════════════════════════

  function exportFile() {
    var cnt = Overrides.count();
    if (cnt === 0) {
      alert('暂无答案修正，无需导出。');
      return;
    }

    // 尝试使用 File System Access API（Chrome/Edge 支持）
    if (typeof window.showSaveFilePicker === 'function') {
      exportViaFileSystemAPI(cnt);
    } else {
      exportViaDownload(cnt);
    }
  }

  function generateCorrectedJS() {
    var lines = [];

    // 文件头
    lines.push('// Auto-generated quiz data - OS Exam Questions');
    lines.push('// ⚠️ 已应用 ' + Overrides.count() + ' 条答案修正');
    lines.push('// 修正日期：' + new Date().toISOString().split('T')[0]);
    lines.push('');

    // CHAPTER_NAMES
    if (typeof CHAPTER_NAMES !== 'undefined') {
      lines.push('var CHAPTER_NAMES = ' + JSON.stringify(CHAPTER_NAMES, null, 2) + ';');
      lines.push('');
    }

    // QUESTIONS
    if (typeof QUESTIONS !== 'undefined' && QUESTIONS.length > 0) {
      lines.push('var QUESTIONS = [');
      QUESTIONS.forEach(function (q, i) {
        var obj = buildExportObj(q);
        var json = JSON.stringify(obj, null, 2);
        // 将每行增加 2 空格缩进
        var indented = json.split('\n').map(function (line) { return '  ' + line; }).join('\n');
        var comma = (i < QUESTIONS.length - 1) ? ',' : '';
        lines.push(indented + comma);
      });
      lines.push('];');
      lines.push('');
    }

    // BIG_QUESTIONS
    if (typeof BIG_QUESTIONS !== 'undefined' && BIG_QUESTIONS.length > 0) {
      lines.push('var BIG_QUESTIONS = [');
      BIG_QUESTIONS.forEach(function (q, i) {
        var obj = buildExportObj(q);
        var json = JSON.stringify(obj, null, 2);
        var indented = json.split('\n').map(function (line) { return '  ' + line; }).join('\n');
        var comma = (i < BIG_QUESTIONS.length - 1) ? ',' : '';
        lines.push(indented + comma);
      });
      lines.push('];');
      lines.push('');
    }

    return lines.join('\n');
  }

  function buildExportObj(q) {
    var obj = {};

    // 保持与原始格式一致的字段顺序和内容
    obj.id = q.id;
    obj.chapter = q.chapter;

    // type: 对于 MCQ 用 _origType，判断题也用 _origType
    if (q._origType && (q._origType === 'choice' || q._origType === '判断')) {
      obj.type = q._origType;
    } else {
      obj.type = q.type;
    }

    if (q.number !== undefined) obj.number = q.number;
    obj.question = q.question;

    if (q.options && q.options.length > 0) {
      obj.options = q.options.map(function (o) {
        return { label: o.label, text: o.text };
      });
    }

    // 答案：MCQ 转回字符串格式，大题保持字符串
    if (q.options && q.options.length > 0) {
      // MCQ：数组 → 字符串（如 ["C"] → "C", ["A","B"] → "AB"）
      obj.answer = Array.isArray(q.answer) ? q.answer.join('') : String(q.answer);
    } else {
      // 大题：保持字符串
      obj.answer = Array.isArray(q.answer) ? q.answer.join(', ') : String(q.answer);
    }

    return obj;
  }

  // 方式 A：通过浏览器下载
  function exportViaDownload(cnt) {
    var content = generateCorrectedJS();
    var blob = new Blob([content], { type: 'application/javascript;charset=utf-8' });
    var url = URL.createObjectURL(blob);

    var a = document.createElement('a');
    a.href = url;
    // 使用时间戳防止覆盖
    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = 'questions_corrected_' + ts + '.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // 显示提示
    var toastMsg = '已下载修正文件（' + cnt + ' 条修改）。请用该文件替换 js/questions.js';
    if (typeof App !== 'undefined' && typeof App.toast === 'function') {
      App.toast(toastMsg, 'success');
    } else {
      alert(toastMsg);
    }
  }

  // 方式 B：通过 File System Access API 直接写入
  async function exportViaFileSystemAPI(cnt) {
    try {
      var content = generateCorrectedJS();

      // 让用户选择保存路径（默认指向 questions.js）
      var handle = await window.showSaveFilePicker({
        suggestedName: 'questions.js',
        types: [{
          description: 'JavaScript Files',
          accept: { 'application/javascript': ['.js'] }
        }]
      });

      var writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();

      var msg = '✅ 已成功写入文件（' + cnt + ' 条修改）';
      if (typeof App !== 'undefined' && typeof App.toast === 'function') {
        App.toast(msg, 'success');
      } else {
        alert(msg);
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        // 用户取消不算错误，其他错误回退到下载方式
        console.error('File System API failed:', e);
        exportViaDownload(cnt);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  对外接口
  // ═══════════════════════════════════════════════════════════

  var Editor = {
    // 开关编辑模式
    toggleEditMode: function () {
      EDIT_MODE = !EDIT_MODE;
      updateSidebarState();
      injectEditButtons();

      var msg = EDIT_MODE ? '编辑模式已开启 — 点击 ✏️ 按钮修改答案' : '编辑模式已关闭';
      if (typeof App !== 'undefined' && typeof App.toast === 'function') {
        App.toast(msg, 'info');
      }
    },

    // 开启编辑器
    openEditor: function (qId) {
      openEditor(qId);
    },

    // 保存（由 DOM 按钮调用）
    saveMCQEdit: function (qId) {
      saveMCQEdit(qId);
    },
    saveBQEdit: function (qId) {
      saveBQEdit(qId);
    },
    cancelEdit: function (qId) {
      cancelEdit(qId);
    },
    restoreOriginal: function (qId) {
      restoreOriginal(qId);
    },

    // 导出
    exportFile: function () {
      exportFile();
    },

    // 清除全部
    clearAllOverrides: function () {
      clearAllOverrides();
    },

    // 状态查询
    isEditMode: function () {
      return EDIT_MODE;
    },
    getOverrideCount: function () {
      return Overrides.count();
    },
    hasOverride: function (qId) {
      return Overrides.has(qId);
    },

    // 调试
    _overrides: Overrides
  };

  // ═══════════════════════════════════════════════════════════
  //  启动
  // ═══════════════════════════════════════════════════════════

  function init() {
    // 第一层：应用覆盖到内存（在 app.js 的 IIFE 执行之后、render 之前）
    applyAllOverrides();

    // 第二层：设置 UI
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

  // 挂载全局
  window.Editor = Editor;

  // 启动
  init();

})();
