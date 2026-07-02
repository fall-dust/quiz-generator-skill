// ═══════════════════════════════════════════════════════════════
// 题库编辑器 v2 — Quill 富文本编辑器 + 运行时覆盖 + 导出
//
// 从第一性原理重构：
//   - 题目 → Quill WYSIWYG 编辑器（粗体/斜体/列表/代码/公式）
//   - 答案 → Quill 编辑器（大题）或选项选择器（选择题）
//   - 覆盖存储不变 → 但内容可为 HTML（Quill 输出）
//   - 显示层 → app.js 的 renderMarkdown() 自动识别 HTML/Markdown
//
// Quill 初始化是昂贵的 → 每次打开编辑器时创建，关闭时销毁
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var LS_KEY = 'net_editor_overrides';
  var LS = localStorage;
  var EDIT_MODE = false;

  // ── 工具 ──
  function loadJ(k, def) {
    try { return JSON.parse(LS.getItem(k) || def); } catch (e) { return JSON.parse(def); }
  }
  function saveJ(k, v) {
    try { LS.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  //  覆盖层（与旧版兼容，但 field 值现在可以为 HTML）
  // ═══════════════════════════════════════════════════════════

  var Overrides = {
    _data: loadJ(LS_KEY, '{}'),
    _originals: {},

    get: function (qId) { return this._data[qId] || null; },
    has: function (qId) { return !!this._data[qId]; },
    count: function () { return Object.keys(this._data).length; },
    getAll: function () { return JSON.parse(JSON.stringify(this._data)); },

    set: function (qId, patch, q) {
      if (!this._originals[qId] && q) {
        this._originals[qId] = {
          question: q.question,
          options: q.options ? q.options.map(function (o) { return { label: o.label, text: o.text }; }) : undefined,
          answer: JSON.parse(JSON.stringify(q.answer))
        };
      }
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
            if (q.options && q.options[i]) q.options[i].text = patch.options[i].text;
          }
        }
        if (patch.answer !== undefined) q.answer = JSON.parse(JSON.stringify(patch.answer));
        q._overridden = this.has(qId);
      }
    },

    remove: function (qId, q) {
      var orig = this._originals[qId];
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
      delete this._data[qId];
      delete this._originals[qId];
      saveJ(LS_KEY, this._data);
    },

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

  // ── 启动时应用覆盖 ──
  function applyAllOverrides() {
    var allQs = getAllQuestions();
    allQs.forEach(function (q) {
      var ov = Overrides.get(q.id);
      if (!ov) return;
      Overrides._originals[q.id] = {
        question: q.question,
        options: q.options ? q.options.map(function (o) { return { label: o.label, text: o.text }; }) : undefined,
        answer: JSON.parse(JSON.stringify(q.answer))
      };
      if (ov.question !== undefined) q.question = ov.question;
      if (ov.options !== undefined) {
        for (var i = 0; i < ov.options.length; i++) {
          if (q.options && q.options[i]) q.options[i].text = ov.options[i].text;
        }
      }
      if (ov.answer !== undefined) q.answer = JSON.parse(JSON.stringify(ov.answer));
      q._overridden = true;
    });
  }

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

  function findQ(qId) { return findQInArray(getAllQuestions(), qId); }

  function isMCQ(q) { return q && q.options && q.options.length > 0; }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function stripHtml(html) {
    if (!html) return '';
    var div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || div.innerText || '').trim();
  }

  function truncateText(text, maxLen) {
    if (!text) return '(空)';
    text = stripHtml(String(text));
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '…';
  }

  function chName(ch) {
    if (typeof CHAPTER_NAMES !== 'undefined' && CHAPTER_NAMES[ch]) return CHAPTER_NAMES[ch];
    var n = parseInt((ch || '').replace('ch', ''), 10);
    return n ? '第' + n + '章' : (ch || '');
  }

  // ═══════════════════════════════════════════════════════════
  //  Quill 编辑器管理（单例：每次只开一个编辑弹窗）
  // ═══════════════════════════════════════════════════════════

  var _activeQuills = {};   // { question: Quill, answer: Quill }
  var _editingQ = null;     // 正在编辑的题目对象
  var _editingQId = null;
  var _openTimeout = null;  // openEditor 的 setTimeout 句柄，防止竞态

  function getQuillToolbar() {
    return [
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      ['blockquote', 'code-block'],
      [{ 'header': [1, 2, 3, false] }],
      [{ 'color': [] }, { 'background': [] }],
      ['image'],   // 图片按钮
      ['clean']
    ];
  }

  // 在 Quill 光标位置插入图片
  function _insertImage(quill, url) {
    var range = quill.getSelection(true);
    var index = range ? range.index : quill.getLength() - 1;
    // 插入带 class 的图片，CSS 提供缩放手柄
    quill.insertEmbed(index, 'image', url, 'user');
    quill.setSelection(index + 1, 0);
  }

  // ── 本地图片上传 (隐藏 file input 单例) ──
  var _imageFileInput = null;
  function getImageFileInput() {
    if (_imageFileInput) return _imageFileInput;
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', function () {
      var file = input.files[0];
      if (!file) return;
      var quill = _activeQuills.question || _activeQuills.answer;
      if (!quill) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        _insertImage(quill, e.target.result);
      };
      reader.readAsDataURL(file);
      input.value = ''; // 重置，允许重复选择同一文件
    });
    document.body.appendChild(input);
    _imageFileInput = input;
    return input;
  }

  // ═══════════════════════════════════════════════════════════
  //  图片拖拽缩放 — CSS resize 在 contenteditable 内无效，用 JS 实现四角缩放
  // ═══════════════════════════════════════════════════════════

  function setupImageResize(quill) {
    var root = quill.root;
    var HANDLE = 10;       // 角落检测半径 (px)
    var MIN_W = 30;        // 最小宽度
    var MIN_H = 20;        // 最小高度
    var currentImg = null; // 当前鼠标悬停的图片
    var rs = null;         // { img, handle, startX, startY, startW, startH, ratio }

    function detectHandle(mx, my, rect) {
      var t = HANDLE;
      var nearL = mx >= rect.left - t && mx <= rect.left + t;
      var nearR = mx >= rect.right - t && mx <= rect.right + t;
      var nearT = my >= rect.top - t && my <= rect.top + t;
      var nearB = my >= rect.bottom - t && my <= rect.bottom + t;
      if (nearR && nearB) return 'se';
      if (nearL && nearB) return 'sw';
      if (nearR && nearT) return 'ne';
      if (nearL && nearT) return 'nw';
      if (nearR && my > rect.top + t && my < rect.bottom - t) return 'e';
      if (nearB && mx > rect.left + t && mx < rect.right - t) return 's';
      return null;
    }

    var CURSOR_MAP = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', e: 'ew-resize', s: 'ns-resize' };

    // ── 光标检测 (root → 只在编辑器内生效) ──
    root.addEventListener('mousemove', function (e) {
      if (rs) return; // 拖拽中由 document 级 handler 接管

      var target = e.target;
      if (target.tagName !== 'IMG' || !root.contains(target)) {
        if (currentImg) { currentImg.classList.remove('qimg-resizable'); currentImg = null; root.style.cursor = ''; }
        return;
      }

      if (currentImg && currentImg !== target) {
        currentImg.classList.remove('qimg-resizable');
        currentImg = null;
      }
      currentImg = target;

      var handle = detectHandle(e.clientX, e.clientY, target.getBoundingClientRect());
      if (handle) {
        target.classList.add('qimg-resizable');
        root.style.cursor = CURSOR_MAP[handle] || '';
      } else {
        target.classList.remove('qimg-resizable');
        root.style.cursor = '';
      }
    });

    // ── 开始拖拽 ──
    root.addEventListener('mousedown', function (e) {
      if (e.target.tagName !== 'IMG') return;
      var img = e.target;
      var handle = detectHandle(e.clientX, e.clientY, img.getBoundingClientRect());
      if (!handle) return;

      e.preventDefault();
      e.stopPropagation();

      rs = {
        img: img,
        handle: handle,
        startX: e.clientX,
        startY: e.clientY,
        startW: img.offsetWidth,
        startH: img.offsetHeight,
        ratio: img.offsetWidth / Math.max(1, img.offsetHeight)
      };
    });

    // ── 拖拽中 (document 级 → 鼠标移出编辑器仍可继续缩放) ──
    document.addEventListener('mousemove', function (e) {
      if (!rs) return;
      var dx = e.clientX - rs.startX;
      var dy = e.clientY - rs.startY;
      var newW, newH;

      switch (rs.handle) {
        case 'se': newW = Math.max(MIN_W, rs.startW + dx); newH = Math.round(newW / rs.ratio); break;
        case 'sw': newW = Math.max(MIN_W, rs.startW - dx); newH = Math.round(newW / rs.ratio); break;
        case 'ne': newH = Math.max(MIN_H, rs.startH - dy); newW = Math.round(newH * rs.ratio); break;
        case 'nw': newW = Math.max(MIN_W, rs.startW - dx); newH = Math.round(newW / rs.ratio); break;
        case 'e':  newW = Math.max(MIN_W, rs.startW + dx); newH = Math.round(newW / rs.ratio); break;
        case 's':  newH = Math.max(MIN_H, rs.startH + dy); newW = Math.round(newH * rs.ratio); break;
        default: return;
      }
      rs.img.style.width = newW + 'px';
      rs.img.style.height = newH + 'px';
    });

    // ── 结束拖拽 ──
    document.addEventListener('mouseup', function () {
      if (!rs) return;
      rs.img.classList.remove('qimg-resizable');
      root.style.cursor = '';
      rs = null;
    });
  }

  function initQuill(containerId, content) {
    var el = document.getElementById(containerId);
    if (!el) return null;

    // 1. 彻底销毁旧实例
    _destroyQuillDOM(el);

    // 2. 构建工具栏配置（含图片按钮 + 自定义 handler）
    var toolbarCfg = {
      container: getQuillToolbar(),
      handlers: {
        image: function () {
          var q = this.quill ? this.quill : (_activeQuills.question || _activeQuills.answer);
          if (!q) return;
          // 双模式：「确定」→ 本地文件，「取消」→ 输入链接
          if (confirm('📷 插入图片\n\n点击「确定」从本地选择文件\n点击「取消」输入图片链接')) {
            getImageFileInput().click();
          } else {
            var url = prompt('请输入图片链接（支持 http/https/data:）：', 'https://');
            if (!url) return;
            var range = q.getSelection(true);
            q.insertEmbed(range ? range.index : q.getLength() - 1, 'image', url, 'user');
            q.setSelection((range ? range.index : q.getLength() - 1) + 1, 0);
          }
        }
      }
    };

    // 3. 创建 Quill 实例
    try {
      var quill = new Quill(el, {
        theme: 'snow',
        modules: { toolbar: toolbarCfg },
        placeholder: containerId === 'quillEditorAnswer' ? '输入答案...' : '输入题目内容...'
      });

      // 3. 设置初始内容
      if (content) {
        if (/<[^>]+>/.test(content)) {
          if (quill.clipboard && typeof quill.clipboard.dangerouslyPasteHTML === 'function') {
            quill.clipboard.dangerouslyPasteHTML(content);
          } else {
            quill.root.innerHTML = content;
          }
        } else {
          quill.setText(content);
        }
      }

      // 4. 粘贴事件：支持图片粘贴
      quill.root.addEventListener('paste', function (e) {
        var items = (e.clipboardData || window.clipboardData).items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            e.preventDefault();
            var blob = items[i].getAsFile();
            var reader = new FileReader();
            reader.onload = function (ev) {
              _insertImage(quill, ev.target.result);
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
      });

      // 5. 安装图片四角拖拽缩放（CSS resize 在 contenteditable 内无效，JS 驱动）
      setupImageResize(quill);

      return quill;
    } catch (e) {
      console.error('Quill init failed:', e);
      el.innerHTML = '<div contenteditable="true" style="min-height:120px;padding:12px;border:1px solid #ccc;border-radius:4px;font-family:inherit">' + (content || '') + '</div>';
      return null;
    }
  }

  // 彻底清理容器内及周围所有 Quill 产生的 DOM
  function _destroyQuillDOM(el) {
    // 1. 仅移除紧邻容器的前置兄弟工具栏（snow 主题把它插在容器正前面）
    //    不能用 while 遍历全部前置兄弟 → 大题场景 answer 容器会误删 question 的 toolbar
    var prev = el.previousElementSibling;
    if (prev && prev.classList.contains('ql-toolbar')) {
      try { prev.parentNode.removeChild(prev); } catch (e) {}
    }

    // 2. 移除 Quill 在容器内创建的子元素（clipboard 等）
    var toRemove = el.querySelectorAll('.ql-toolbar, .ql-container, .ql-clipboard');
    for (var i = 0; i < toRemove.length; i++) {
      try { toRemove[i].parentNode.removeChild(toRemove[i]); } catch (e) {}
    }

    // 3. 清除 Quill 实例引用，防止 new Quill() 时残留引用导致初始化异常
    try { delete el.__quill; } catch (e) {}

    // 4. 移除 quill 添加的 class，恢复容器初始状态
    el.className = el.className.replace(/\bql-container\b/g, '').replace(/\bql-snow\b/g, '').trim();
    el.innerHTML = '';
  }

  function destroyAllQuills() {
    // 取消待执行的 openEditor setTimeout
    if (_openTimeout) { clearTimeout(_openTimeout); _openTimeout = null; }

    // 禁用/清理 Quill 实例
    Object.keys(_activeQuills).forEach(function (key) {
      var q = _activeQuills[key];
      if (!q) return;
      try { q.enable(false); } catch (e) {}
      // 移除 Quill 的键盘绑定
      try {
        if (q.keyboard && q.keyboard.detach) q.keyboard.detach();
      } catch (e) {}
      // 清除 Quill 对容器元素的 __quill 引用
      try { delete q.container.__quill; } catch (e) {}
      _activeQuills[key] = null;
    });
    _activeQuills = {};

    // 清理容器 DOM（含前置兄弟 toolbar + 内部残留 + __quill）
    var containers = ['quillEditorQuestion', 'quillEditorAnswer'];
    containers.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) _destroyQuillDOM(el);
    });

    // 安全网：扫描整个编辑器覆层内所有残留工具栏（防止意外积累 + 旧版本残留）
    var overlay = document.getElementById('quillEditorContainer');
    if (overlay) {
      overlay.querySelectorAll('.ql-toolbar').forEach(function (t) {
        try { t.parentNode.removeChild(t); } catch (e) {}
      });
    }

    // 清理 Quill tooltip 等全局 DOM 残留（Quill 可能把它们挂到 body 上）
    document.querySelectorAll('.ql-tooltip').forEach(function (t) {
      try { t.parentNode.removeChild(t); } catch (e) {}
    });
  }

  function getQuillHTML(quill) {
    if (!quill) return '';
    var html = quill.root ? quill.root.innerHTML : '';
    // Quill 空内容会返回 <p><br></p>
    if (html === '<p><br></p>' || html === '<p></p>') return '';
    return html;
  }

  function getQuillText(quill) {
    if (!quill) return '';
    return quill.getText ? quill.getText().trim() : '';
  }

  // ═══════════════════════════════════════════════════════════
  //  编辑弹窗
  // ═══════════════════════════════════════════════════════════

  function openEditor(qId) {
    // 1. 先销毁上一个编辑器（取消待执行的 timeout + 清理 DOM）
    destroyAllQuills();

    var q = findQ(qId);
    if (!q) return;
    _editingQ = q;
    _editingQId = qId;

    var overlay = document.getElementById('quillEditorContainer');
    var titleEl = document.getElementById('quillEditorTitle');
    var answerField = document.getElementById('quillAnswerField');
    var optionsField = document.getElementById('quillOptionsField');
    var mcqAnswerField = document.getElementById('quillMcqAnswerField');
    var restoreBtn = document.getElementById('quillEditorRestore');

    // 设置标题
    var typeLabel = isMCQ(q) ? (q._origType === '判断' ? '判断题' : '选择题') : (q.type || '大题');
    titleEl.innerHTML = '✏️ 编辑题目 — ' + escapeHtml(qId) +
      ' <span class="tag tag-i" style="font-size:.72rem">' + escapeHtml(chName(q.chapter)) + '</span>' +
      (Overrides.has(qId) ? ' <span class="tag tag-w" style="font-size:.72rem">已修正</span>' : '') +
      ' <span class="tag tag-m" style="font-size:.7rem">' + typeLabel + '</span>';

    restoreBtn.style.display = Overrides.has(qId) ? '' : 'none';

    // 获取当前生效内容
    var ov = Overrides.get(qId);
    var currentQuestion = (ov && ov.question !== undefined) ? ov.question : q.question;
    var currentAnswer = '';
    if (isMCQ(q)) {
      currentAnswer = Array.isArray(q.answer) ? q.answer.join('') : String(q.answer || '');
    } else {
      currentAnswer = (ov && ov.answer !== undefined) ? String(ov.answer) : (Array.isArray(q.answer) ? q.answer.join(', ') : String(q.answer || ''));
    }

    // 显示/隐藏字段
    if (isMCQ(q)) {
      answerField.style.display = 'none';
      optionsField.style.display = 'none'; // 先隐藏，后面手动构建
      mcqAnswerField.style.display = 'none';
      // 构建选项编辑区 + 答案选择区
      buildMCQOptionsUI(q);
    } else {
      answerField.style.display = '';
      optionsField.style.display = 'none';
      mcqAnswerField.style.display = 'none';
    }

    // 显示 overlay
    overlay.style.display = 'flex';

    // 初始化 Quill（延迟以确保 DOM 已渲染）— 记录句柄防竞态
    _openTimeout = setTimeout(function () {
      _openTimeout = null;
      _activeQuills.question = initQuill('quillEditorQuestion', currentQuestion);
      if (!isMCQ(q)) {
        _activeQuills.answer = initQuill('quillEditorAnswer', currentAnswer);
      }
    }, 100);
  }

  function closeEditor() {
    // 取消尚未执行的 Quill 初始化 timeout，防止重复创建
    if (_openTimeout) { clearTimeout(_openTimeout); _openTimeout = null; }
    destroyAllQuills();
    var overlay = document.getElementById('quillEditorContainer');
    if (overlay) overlay.style.display = 'none';
    _editingQ = null;
    _editingQId = null;
  }

  // ── MCQ 选项编辑 UI ──
  function buildMCQOptionsUI(q) {
    var optionsField = document.getElementById('quillOptionsField');
    var mcqAnswerField = document.getElementById('quillMcqAnswerField');
    var optsContainer = document.getElementById('quillOptionsContainer');
    var ansSelect = document.getElementById('quillMcqAnswerSelect');

    var ov = Overrides.get(q.id);
    var opts = [];
    if (ov && ov.options) {
      opts = ov.options;
    } else if (q.options) {
      opts = q.options.map(function (o) { return { label: o.label, text: o.text }; });
    }

    var currentAns = Array.isArray(q.answer) ? q.answer.join('') : String(q.answer || '');
    var isMulti = (q._origType === 'choice' && q.type === 'multiple') || q.type === 'multiple';
    var inputType = isMulti ? 'checkbox' : 'radio';
    var inputName = 'quillMcqAns';

    // 构建选项编辑列表
    var optHtml = '<div class="quill-options-list">';
    for (var i = 0; i < opts.length; i++) {
      optHtml += '<div class="quill-opt-row">';
      optHtml += '<span class="quill-opt-label">' + escapeHtml(opts[i].label) + '.</span>';
      optHtml += '<input type="text" class="quill-opt-text-input" id="quillOptText-' + i + '" value="' + escapeHtml(opts[i].text) + '" placeholder="选项 ' + opts[i].label + ' 的内容">';
      optHtml += '</div>';
    }
    optHtml += '</div>';
    optsContainer.innerHTML = optHtml;

    // 构建答案选择区
    var ansHtml = '<div class="quill-mcq-answer-select">';
    for (var j = 0; j < opts.length; j++) {
      var isSel = currentAns.indexOf(opts[j].label) >= 0;
      ansHtml += '<label class="quill-mcq-ans-opt' + (isSel ? ' selected' : '') + '">';
      ansHtml += '<input type="' + inputType + '" name="' + inputName + '" value="' + escapeHtml(opts[j].label) + '"' + (isSel ? ' checked' : '') + ' onchange="Editor._onMcqAnsChange()">';
      ansHtml += '<span>' + escapeHtml(opts[j].label) + '. ' + escapeHtml(opts[j].text) + '</span>';
      ansHtml += '</label>';
    }
    ansHtml += '</div>';
    ansSelect.innerHTML = ansHtml;

    optionsField.style.display = '';
    mcqAnswerField.style.display = '';
  }

  function _onMcqAnsChange() {
    var ansSelect = document.getElementById('quillMcqAnswerSelect');
    if (!ansSelect) return;
    ansSelect.querySelectorAll('.quill-mcq-ans-opt').forEach(function (opt) {
      var cb = opt.querySelector('input');
      opt.classList.toggle('selected', cb && cb.checked);
    });
  }

  // ── 保存 ──
  function saveEdit() {
    var q = _editingQ;
    var qId = _editingQId;
    if (!q || !qId) return;

    // 获取 Quill 内容
    var quillQ = _activeQuills.question;
    var questionHTML = getQuillHTML(quillQ);
    var questionText = getQuillText(quillQ);

    if (!questionText) { alert('题目不能为空'); return; }

    var patch = { question: questionHTML || questionText };

    if (isMCQ(q)) {
      // 收集选项文本
      var newOpts = [];
      var opts = q.options || [];
      for (var i = 0; i < opts.length; i++) {
        var input = document.getElementById('quillOptText-' + i);
        newOpts.push({
          label: opts[i].label,
          text: input ? input.value.trim() : opts[i].text
        });
      }
      // 检查选项非空
      for (var k = 0; k < newOpts.length; k++) {
        if (!newOpts[k].text) { alert('选项 ' + newOpts[k].label + ' 不能为空'); return; }
      }
      patch.options = newOpts;

      // 收集答案
      var radios = document.getElementsByName('quillMcqAns');
      var selected = [];
      for (var j = 0; j < radios.length; j++) {
        if (radios[j].checked) selected.push(radios[j].value);
      }
      if (selected.length === 0) { alert('请至少选择一个正确答案'); return; }
      patch.answer = selected;
    } else {
      // 大题：答案从 Quill 获取
      var quillA = _activeQuills.answer;
      var answerHTML = getQuillHTML(quillA);
      var answerText = getQuillText(quillA);
      if (!answerText) { alert('答案不能为空'); return; }
      patch.answer = answerHTML || answerText;
    }

    Overrides.set(qId, patch, q);
    closeEditor();
    updateSidebarState();

    reEvalAndRender(qId);
    try { injectEditButtons(); } catch (e) {}
    toast('已保存修改 (' + qId + ')', 'success');
  }

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

  // ── 辅助函数 ──
  function reEvalAndRender(qId) {
    // 尝试重判答案（仅对已答的选择题/判断题有效）
    if (typeof App !== 'undefined' && typeof App.reevaluate === 'function') {
      try { App.reevaluate(qId); } catch (e) {}
    }
    // 无论如何都强制重渲染，确保富文本修改反映到卡片上
    tryRender();
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
  //  修改详情面板 — 查看所有 Override 的原始值 vs 修改值
  // ═══════════════════════════════════════════════════════════

  var _changesOverlay = null;

  function getChangesOverlay() {
    if (_changesOverlay) return _changesOverlay;

    var overlay = document.createElement('div');
    overlay.id = 'changesDetailOverlay';
    overlay.className = 'changes-detail-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML =
      '<div class="changes-detail-dialog">' +
      '<div class="changes-detail-header">' +
      '<h3>📋 修改详情</h3>' +
      '<button class="changes-detail-close" id="changesDetailClose">✕</button>' +
      '</div>' +
      '<div class="changes-detail-body" id="changesDetailBody"></div>' +
      '<div class="changes-detail-footer">' +
      '<button class="btn btn-o btn-sm" id="changesDetailClearAll">🗑 清除全部</button>' +
      '<button class="btn btn-p btn-sm" id="changesDetailExport">📋 导出清单 JSON</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // 点击遮罩关闭
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeChangesDetail();
    });
    document.getElementById('changesDetailClose').onclick = closeChangesDetail;
    document.getElementById('changesDetailClearAll').onclick = function () {
      var cnt = Overrides.count();
      if (cnt === 0) return;
      if (!confirm('确定清除全部 ' + cnt + ' 道题目的修改？此操作不可恢复。')) return;
      Overrides.clearAll();
      updateSidebarState();
      tryRender();
      closeChangesDetail();
      toast('已清除全部修改', 'warning');
    };
    document.getElementById('changesDetailExport').onclick = exportManifest;

    _changesOverlay = overlay;
    return overlay;
  }

  function openChangesDetail() {
    var overlay = getChangesOverlay();
    document.getElementById('changesDetailBody').innerHTML = buildChangesDetailHTML();
    overlay.style.display = 'flex';
  }

  function closeChangesDetail() {
    if (_changesOverlay) _changesOverlay.style.display = 'none';
  }

  function buildChangesDetailHTML() {
    var data = Overrides.getAll();
    var ids = Object.keys(data);
    if (ids.length === 0) {
      return '<div style="text-align:center;padding:48px 24px;color:var(--t3);font-size:.9rem">📭 暂无修改记录。<br><span style="font-size:.75rem">开启编辑模式后点击题目旁的 ✏️ 进行修改。</span></div>';
    }

    ids.sort();

    var html = '<div class="changes-list">';
    for (var i = 0; i < ids.length; i++) {
      var qId = ids[i];
      var ov = data[qId];
      var q = findQ(qId);
      var orig = Overrides._originals[qId] || {};

      var typeLabel = q ? (isMCQ(q) ? (q._origType === '判断' ? '判断题' : '选择题') : (q.type || '大题')) : '?';
      var chLabel = q ? chName(q.chapter) : '?';

      html += '<div class="changes-item">';
      // 标题行
      html += '<div class="changes-item-hd">';
      html += '<span class="changes-item-id">' + escapeHtml(qId) + '</span>';
      html += '<span class="changes-item-ch">' + escapeHtml(chLabel) + '</span>';
      html += '<span class="changes-item-type">' + escapeHtml(typeLabel) + '</span>';
      html += '<div class="changes-item-acts">';
      html += '<button class="changes-btn-edit" title="编辑此题" onclick="Editor.openEditor(\'' + qId + '\');Editor.closeChangesDetail()">✏️</button>';
      html += '<button class="changes-btn-restore" title="还原此题" onclick="Editor.restoreFromDetail(\'' + qId + '\')">↩</button>';
      html += '</div>';
      html += '</div>';

      // 变更字段
      html += '<div class="changes-fields">';

      if (ov.question !== undefined) {
        var origQ = orig.question !== undefined ? orig.question : (q ? q.question : '');
        html += '<div class="changes-field">';
        html += '<span class="changes-field-label">📝 题目</span>';
        html += '<div class="changes-diff">';
        html += '<div class="changes-old">' + escapeHtml(truncateText(origQ, 100)) + '</div>';
        html += '<div class="changes-arrow">→</div>';
        html += '<div class="changes-new">' + escapeHtml(truncateText(ov.question, 100)) + '</div>';
        html += '</div>';
        html += '</div>';
      }

      if (ov.options !== undefined) {
        for (var j = 0; j < ov.options.length; j++) {
          var origOpt = '';
          if (orig.options && orig.options[j]) origOpt = orig.options[j].text;
          else if (q && q.options && q.options[j]) origOpt = q.options[j].text;
          html += '<div class="changes-field">';
          html += '<span class="changes-field-label">📋 选项 ' + escapeHtml(ov.options[j].label) + '</span>';
          html += '<div class="changes-diff">';
          html += '<div class="changes-old">' + escapeHtml(truncateText(origOpt, 80)) + '</div>';
          html += '<div class="changes-arrow">→</div>';
          html += '<div class="changes-new">' + escapeHtml(truncateText(ov.options[j].text, 80)) + '</div>';
          html += '</div>';
          html += '</div>';
        }
      }

      if (ov.answer !== undefined) {
        var origAns = orig.answer !== undefined ? String(orig.answer) : '';
        if (!origAns && q) origAns = Array.isArray(q.answer) ? q.answer.join(', ') : String(q.answer || '');
        html += '<div class="changes-field">';
        html += '<span class="changes-field-label">✅ 答案</span>';
        html += '<div class="changes-diff">';
        html += '<div class="changes-old">' + escapeHtml(truncateText(origAns, 80)) + '</div>';
        html += '<div class="changes-arrow">→</div>';
        html += '<div class="changes-new">' + escapeHtml(truncateText(String(ov.answer), 80)) + '</div>';
        html += '</div>';
        html += '</div>';
      }

      html += '</div>'; // changes-fields
      html += '</div>'; // changes-item
    }
    html += '</div>';
    return html;
  }

  function restoreFromDetail(qId) {
    var q = findQ(qId);
    if (!q) return;
    if (!confirm('确定还原「' + qId + '」的原始题目、选项和答案？')) return;
    Overrides.remove(qId, q);
    updateSidebarState();
    tryRender();
    // 刷新详情面板
    document.getElementById('changesDetailBody').innerHTML = buildChangesDetailHTML();
    toast('已还原原始数据 (' + qId + ')', 'info');
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
        '<span>✏️ 富文本编辑</span> <span class="ae-toggle-state" id="aeToggleState">关</span>' +
      '</button>' +
      '<button class="ae-export-btn" id="aeExportJSBtn" onclick="Editor.exportJS()" title="导出完整 questions.js">' +
        '📥 导出新版 questions.js' +
      '</button>' +
      '<button class="ae-export-btn" id="aeExportManifestBtn" onclick="Editor.exportManifest()" title="导出编辑清单供 Python 应用">' +
        '📋 导出编辑清单 JSON' +
      '</button>' +
      '<div class="ae-count" id="aeCount" style="display:none">' +
        '已修改 <strong id="aeCountNum">0</strong> 题 · ' +
        '<a href="#" onclick="Editor.openChangesDetail();return false" style="color:var(--bl);font-size:.72rem">查看详情</a> · ' +
        '<a href="#" onclick="Editor.clearAllOverrides();return false" style="color:var(--rd);font-size:.72rem">清除全部</a>' +
      '</div>' +
      '<div class="ae-hint">' +
        '💡 点击题目旁的 ✏️ 打开富文本编辑器。<br>' +
        '支持：<b>粗体</b> <i>斜体</i> 列表 引用 代码块。<br>' +
        '导出 JS → 替换原文件 | 导出 JSON → Python 应用' +
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
  //  DOM 注入编辑按钮
  // ═══════════════════════════════════════════════════════════

  function injectEditButtons() {
    if (!EDIT_MODE) {
      document.querySelectorAll('.ae-edit-btn, .ae-overridden-badge').forEach(function (el) { el.remove(); });
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
      btn.title = '富文本编辑题目/选项/答案';
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
      btn.title = '富文本编辑题目/答案';
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

  var _observer = null;
  function startObserver() {
    if (_observer) return;
    var contentArea = document.getElementById('contentArea');
    if (!contentArea) return;
    _observer = new MutationObserver(function () { injectEditButtons(); });
    _observer.observe(contentArea, { childList: true, subtree: true });
  }

  // ═══════════════════════════════════════════════════════════
  //  第三层：持久化 — 导出
  // ═══════════════════════════════════════════════════════════

  function buildExportObj(q) {
    var obj = {};
    obj.id = q.id;
    obj.chapter = q.chapter;

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

    if (q.options && q.options.length > 0) {
      obj.answer = Array.isArray(q.answer) ? q.answer.join('') : String(q.answer);
    } else {
      obj.answer = Array.isArray(q.answer) ? q.answer.join(', ') : String(q.answer);
    }

    return obj;
  }

  function generateQuestionsJS() {
    var lines = [];
    var cnt = Overrides.count();
    var ts = new Date().toISOString().split('T')[0];

    lines.push('// 软件工程 — 选择题题库');
    lines.push('// 生成日期：' + ts + (cnt > 0 ? ' | 已应用 ' + cnt + ' 条富文本编辑修正' : ''));
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

      entry._chapter = q ? q.chapter : '?';
      entry._number = q ? q.number : 0;
      entry._origType = q ? (q._origType || q.type) : '?';

      manifest.edits[qId] = entry;
    });

    return JSON.stringify(manifest, null, 2);
  }

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

  function exportManifest() {
    var cnt = Overrides.count();
    if (cnt === 0) { alert('暂无修改，无需导出编辑清单。'); return; }
    var content = generateManifestJSON();
    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadFile(content, 'edit_manifest_' + ts + '.json', 'application/json;charset=utf-8');
    toast('已导出编辑清单 JSON（' + cnt + ' 条修改）。运行: python apply_edits.py --apply <此文件>', 'success');
  }

  function downloadFile(content, fname, mimeType) {
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
  //  事件绑定
  // ═══════════════════════════════════════════════════════════

  function bindEvents() {
    // 关闭按钮
    var closeBtn = document.getElementById('quillEditorClose');
    if (closeBtn) closeBtn.onclick = closeEditor;

    // 点击 overlay 背景关闭
    var overlay = document.getElementById('quillEditorContainer');
    if (overlay) {
      overlay.onclick = function (e) {
        if (e.target === overlay) closeEditor();
      };
    }

    // 取消按钮
    var cancelBtn = document.getElementById('quillEditorCancel');
    if (cancelBtn) cancelBtn.onclick = closeEditor;

    // 保存按钮
    var saveBtn = document.getElementById('quillEditorSave');
    if (saveBtn) saveBtn.onclick = saveEdit;

    // 还原按钮
    var restoreBtn = document.getElementById('quillEditorRestore');
    if (restoreBtn) restoreBtn.onclick = function () {
      if (_editingQId) restoreOriginal(_editingQId);
    };

    // ESC 关闭编辑器 / 详情面板
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      // 优先关闭编辑器（因为编辑器在上层）
      var editorOverlay = document.getElementById('quillEditorContainer');
      if (editorOverlay && editorOverlay.style.display === 'flex') {
        closeEditor();
        return;
      }
      // 其次关闭详情面板
      if (_changesOverlay && _changesOverlay.style.display === 'flex') {
        closeChangesDetail();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  对外接口
  // ═══════════════════════════════════════════════════════════

  var Editor = {
    toggleEditMode: function () {
      EDIT_MODE = !EDIT_MODE;
      updateSidebarState();
      injectEditButtons();
      toast(EDIT_MODE ? '富文本编辑模式已开启 — 点击 ✏️ 打开编辑器' : '编辑模式已关闭', 'info');
    },

    openEditor: function (qId) { openEditor(qId); },

    saveMCQEdit: function (qId) { saveEdit(); },
    saveBQEdit: function (qId) { saveEdit(); },
    cancelEdit: function (qId) { closeEditor(); },
    restoreOriginal: function (qId) { restoreOriginal(qId); },

    exportJS: function () { exportJS(); },
    exportManifest: function () { exportManifest(); },
    exportFile: function () { exportJS(); },

    clearAllOverrides: function () {
      var cnt = Overrides.count();
      if (cnt === 0) return;
      if (!confirm('确定清除全部 ' + cnt + ' 道题目的修改？此操作不可恢复。')) return;
      Overrides.clearAll();
      updateSidebarState();
      tryRender();
      toast('已清除全部 ' + cnt + ' 条修改', 'warning');
    },

    isEditMode: function () { return EDIT_MODE; },
    getOverrideCount: function () { return Overrides.count(); },
    hasOverride: function (qId) { return Overrides.has(qId); },

    // 修改详情面板
    openChangesDetail: function () { openChangesDetail(); },
    closeChangesDetail: function () { closeChangesDetail(); },
    restoreFromDetail: function (qId) { restoreFromDetail(qId); },

    // MCQ 选项变更回调（供 onclick 使用）
    _onMcqAnsChange: function () { _onMcqAnsChange(); },

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
        bindEvents();
        startObserver();
        injectEditButtons();
      });
    } else {
      createSidebarUI();
      bindEvents();
      startObserver();
      injectEditButtons();
    }
  }

  window.Editor = Editor;
  init();

})();
