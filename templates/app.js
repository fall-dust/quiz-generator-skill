// ═══════════════════════════════════════════════════════════════
// 题库自测系统 — 原生 JS 应用层
// 零依赖，纯 DOM 操作。由 quiz-generator 模板生成。
// 四种题型独立：选择题 / 填空题 / 简答题 / 计算题
// 每种题型按章节组织、进度独立
// 依赖全局：QUESTIONS、BIG_QUESTIONS（由数据文件提供）
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  //  数据标准化：适配混合类型题库数据
  //  将 BIG_QUESTIONS 中的 判断 类型迁移到 QUESTIONS
  //  标准化 answer 为数组格式，为判断题型创建选项
  // ═══════════════════════════════════════════════════════════
  (function normalizeData() {
    // 处理 QUESTIONS：记录原始类型，标准化 answer 为数组
    if (typeof QUESTIONS !== 'undefined') {
      for (var i = 0; i < QUESTIONS.length; i++) {
        var q = QUESTIONS[i];
        q._origType = q.type || 'choice';
        if (q.answer !== undefined && !Array.isArray(q.answer)) {
          q.answer = String(q.answer).split('').filter(function (c) { return c.trim(); });
        }
        q.type = 'single';
      }
    }
    // 处理 BIG_QUESTIONS：将 判断 类型迁移到 QUESTIONS（带 √/× 选项）
    if (typeof BIG_QUESTIONS !== 'undefined') {
      var keepBQ = [];
      for (var i = 0; i < BIG_QUESTIONS.length; i++) {
        var q = BIG_QUESTIONS[i];
        if (q.type === '判断') {
          q._origType = '判断';
          if (q.answer !== undefined && !Array.isArray(q.answer)) {
            q.answer = String(q.answer).split('').filter(function (c) { return c.trim(); });
          }
          q.options = [
            { label: '√', text: '正确' },
            { label: '×', text: '错误' }
          ];
          q.type = 'single';
          QUESTIONS.push(q);
        } else {
          keepBQ.push(q);
        }
      }
      // 修改原数组而非重新赋值，确保引用一致
      BIG_QUESTIONS.splice(0, BIG_QUESTIONS.length);
      for (var i = 0; i < keepBQ.length; i++) {
        BIG_QUESTIONS.push(keepBQ[i]);
      }
    }
  })();

  var K = { ans: 'net_ans', res: 'net_res', bm: 'net_bm', wrong: 'net_wrong', bq: 'net_bq', theme: 'net_theme' };
  var LS = localStorage;

  function loadJ(k, def) {
    try { return JSON.parse(LS.getItem(k) || def); } catch (e) { return JSON.parse(def); }
  }

  // ── 状态 ──
  var S = {
    mode: 'dashboard',
    chapter: 'all',
    idx: 0,
    answers: loadJ(K.ans, '{}'),
    results: loadJ(K.res, '{}'),
    bookmarks: new Set(loadJ(K.bm, '[]')),
    wrongSet: new Set(loadJ(K.wrong, '[]')),
    bqProg: loadJ(K.bq, '{}'),
    showSheet: false,
    bqRevealed: false,
    bqFilter: false,
    _timer: null,
    _randomQs: [],
    _bqFilteredQs: null,
    showRandomDlg: false,
    showWrongDlg: false,
    _bmQs: null,
    wrongChapter: 'all',
    wrongOrder: 'seq',
    randomCount: 20,
    randomType: 'all',
    toastMsg: '',
    toastType: 'info'
  };

  var _wrongList = [];
  var _bmList = [];
  var _navStack = [];
  var _forwardStack = [];

  function navPush() {
    _navStack.push({ mode: S.mode, chapter: S.chapter, idx: S.idx, _bmQs: S._bmQs });
    if (_navStack.length > 50) _navStack.shift();
    _forwardStack = []; // 新导航清空前进栈
  }
  var _wrAns = {};
  var _wrRes = {};
  var _bmAns = {};
  var _bmRes = {};
  var _rdAns = {};
  var _rdRes = {};

  function isRetry() { return S.mode === 'wrong' || S.mode === 'bookmark'; }
  function rList() { return S.mode === 'wrong' ? _wrongList : _bmList; }
  function rSet() { return S.mode === 'wrong' ? S.wrongSet : S.bookmarks; }
  var _retryActive = false;

  function rAnsFor(q) {
    if (S.mode === 'wrong' && q && _wrAns[q.id] !== undefined) return _wrAns[q.id];
    if (S.mode === 'bookmark' && q && _bmAns[q.id] !== undefined) return _bmAns[q.id];
    if (_retryActive) return undefined;
    return S.answers[q.id];
  }
  function rResFor(q) {
    if (S.mode === 'wrong' && q && _wrAns[q.id] !== undefined) return _wrRes[q.id];
    if (S.mode === 'bookmark' && q && _bmAns[q.id] !== undefined) return _bmRes[q.id];
    if (_retryActive) return undefined;
    return S.results[q.id];
  }
  function rAnsObj() {
    if (_retryActive) {
      if (S.mode === 'wrong') return _wrAns;
      if (S.mode === 'bookmark') return _bmAns;
    }
    if (S.mode === 'wrong' && Object.keys(_wrAns).length) return _wrAns;
    if (S.mode === 'bookmark' && Object.keys(_bmAns).length) return _bmAns;
    return S.answers;
  }
  function rResObj() {
    if (_retryActive) {
      if (S.mode === 'wrong') return _wrRes;
      if (S.mode === 'bookmark') return _bmRes;
    }
    if (S.mode === 'wrong' && Object.keys(_wrAns).length) return _wrRes;
    if (S.mode === 'bookmark' && Object.keys(_bmAns).length) return _bmRes;
    return S.results;
  }

  // ── 进度追踪 ──
  var _progress = loadJ('net_progress', '{}');
  function saveProgress() { LS.setItem('net_progress', JSON.stringify(_progress)); }
  function updateProgress() {
    if (!isTypeMode(S.mode)) return;
    if (isViewingBM()) return;
    var key = S.mode + '_' + S.chapter;
    var qs = getQs(), next = 0;
    for (var i = 0; i < qs.length; i++) { if (!S.answers[qs[i].id]) { next = i; break; } }
    _progress[key] = next;
    saveProgress();
  }
  function getProgress() {
    var key = S.mode + '_' + S.chapter;
    if (_progress[key]) return _progress[key];
    if (S.chapter === 'all') {
      for (var ci = 1; ci <= 6; ci++) {
        var ck = S.mode + '_ch' + ci;
        if (_progress[ck]) return _progress[ck];
      }
    }
    return 0;
  }

  // 错题/收藏重做完成后同步回原答案
  function syncRetryToPerm() {
    Object.keys(_wrAns).forEach(function (id) {
      if (_wrRes[id] !== undefined) { S.answers[id] = _wrAns[id]; S.results[id] = _wrRes[id]; }
    });
    Object.keys(_bmAns).forEach(function (id) {
      if (_bmRes[id] !== undefined) { S.answers[id] = _bmAns[id]; S.results[id] = _bmRes[id]; }
    });
    save();
  }

  // ── 章节（自动发现） ──
  var CHAPTERS = (function () {
    var set = {};
    (QUESTIONS || []).forEach(function (q) { set[q.chapter] = true; });
    (BIG_QUESTIONS || []).forEach(function (q) { set[q.chapter] = true; });
    return Object.keys(set).sort();
  })();

  var CH_NAMES = (typeof CHAPTER_NAMES !== 'undefined' && CHAPTER_NAMES) || {};
  if (Object.keys(CH_NAMES).length === 0) {
    CHAPTERS.forEach(function (ch) {
      var n = parseInt(ch.replace('ch', ''), 10);
      CH_NAMES[ch] = n ? '第' + n + '章' : ch;
    });
  }

  // ── 题型配置 ──
  var TYPES = [
    { mode: 'mcq',   label: '选择题', icon: '✏️', bqType: null },
    { mode: 'fill',  label: '填空题', icon: '📝', bqType: '填空' },
    { mode: 'essay', label: '简答题', icon: '📄', bqType: '简答' },
    { mode: 'calc',  label: '计算题', icon: '🔢', bqType: '计算' }
  ];

  var MODE_LABELS = {
    mcq: '选择题', fill: '填空题', essay: '简答题', calc: '计算题',
    random: '随机抽题', wrong: '错题本'
  };

  var _typeMap = { mcq: null, fill: '填空', essay: '简答', calc: '计算' };

  // ── 工具 ──
  function getAll() { return QUESTIONS || []; }
  function getBQ() { return BIG_QUESTIONS || []; }

  function getBQByType(type) {
    return getBQ().filter(function (q) { return q.type === type; });
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function chName(ch) { return CH_NAMES[ch] || ch; }
  function chNum(ch) { return parseInt(ch.replace('ch', ''), 10) || 0; }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function save() {
    LS.setItem(K.ans, JSON.stringify(S.answers));
    LS.setItem(K.res, JSON.stringify(S.results));
    LS.setItem(K.bm, JSON.stringify(Array.from(S.bookmarks)));
    LS.setItem(K.wrong, JSON.stringify(Array.from(S.wrongSet)));
    LS.setItem(K.bq, JSON.stringify(S.bqProg));
  }

  function isTypeMode(m) {
    return m === 'mcq' || m === 'fill' || m === 'essay' || m === 'calc';
  }

  // ── 数据源 ──
  function getQs() {
    if (S._bmQs) return S._bmQs;
    if (S.mode === 'mcq') {
      if (!S.chapter || S.chapter === 'all') return getAll();
      return getAll().filter(function (q) { return q.chapter === S.chapter; });
    }
    if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') {
      var type = _typeMap[S.mode];
      var pool = getBQByType(type);
      if (S._bqFilteredQs) {
        var filtered = S._bqFilteredQs;
        if (S.chapter && S.chapter !== 'all') {
          filtered = filtered.filter(function (q) { return q.chapter === S.chapter; });
        }
        return filtered;
      }
      if (!S.chapter || S.chapter === 'all') return pool;
      return pool.filter(function (q) { return q.chapter === S.chapter; });
    }
    if (S.mode === 'random') return S._randomQs || [];
    if (isRetry()) return rList();
    return [];
  }

  function current() { var qs = getQs(); return qs[S.idx] || null; }
  function total() { return getQs().length; }

  function answerIsLetter() {
    var q = current();
    if (!q || !q.answer || !q.answer.length) return false;
    // 标准字母答案（A-Z）或 √/× 标记
    return /^[A-Z√×]$/.test(q.answer[0]);
  }

  function isAnsOptionLabel(q) {
    // 检查答案是否匹配某个选项的标签（而非文本内容）
    return q && q.options && q.answer && q.answer.length &&
      q.options.some(function (o) { return o.label === q.answer[0]; });
  }

  function getAnswerText(q) {
    if (!q) return '';
    if (q.answer && q.answer.length) {
      // 优先显示选项文本（如 "正确"、"数据库管理系统"）
      var firstOpt = q.options && q.options.find(function (o) { return o.label === q.answer[0]; });
      if (firstOpt) return firstOpt.text + ' (' + q.answer.join(', ') + ')';
      // 无匹配时直接显示答案标记
      return q.answer.join(', ');
    }
    return '';
  }

  

  // ── 进度统计（按题型+章节） ──
  function mcqStats(ch) {
    var qs = ch === 'all' ? getAll() : getAll().filter(function (q) { return q.chapter === ch; });
    var a = 0, c = 0;
    qs.forEach(function (q) {
      if (S.answers[q.id]) { a++; if (S.results[q.id]) c++; }
    });
    return { total: qs.length, answered: a, correct: c };
  }

  function bqTypeStats(type, ch) {
    var pool = getBQByType(type);
    if (ch && ch !== 'all') pool = pool.filter(function (q) { return q.chapter === ch; });
    var v = 0, m = 0;
    pool.forEach(function (q) {
      var p = S.bqProg[q.id] || {};
      if (p.viewed) v++;
      if (p.memorized) m++;
    });
    return { total: pool.length, viewed: v, memorized: m };
  }

  function chStats(ch) {
    if (S.mode === 'fill') return bqTypeStats('填空', ch);
    if (S.mode === 'essay') return bqTypeStats('简答', ch);
    if (S.mode === 'calc') return bqTypeStats('计算', ch);
    return mcqStats(ch);
  }

  function currentStats() {
    if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') {
      return bqTypeStats(_typeMap[S.mode], 'all');
    }
    var t = 0, a = 0, c = 0;
    CHAPTERS.forEach(function (id) {
      var s = mcqStats(id);
      t += s.total; a += s.answered; c += s.correct;
    });
    return { total: t, answered: a, correct: c, wrong: a - c };
  }

  function allStats() {
    var t = 0, a = 0, c = 0;
    CHAPTERS.forEach(function (id) {
      var s = mcqStats(id);
      t += s.total; a += s.answered; c += s.correct;
    });
    var f = bqTypeStats('填空', 'all');
    var e = bqTypeStats('简答', 'all');
    var cl = bqTypeStats('计算', 'all');
    return { total: t, answered: a, correct: c, wrong: a - c, bq: { fill: f, essay: e, calc: cl } };
  }

  function badgeText(ch) {
    var s = chStats(ch);
    if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') {
      return s.total === 0 ? '' : s.memorized === s.total ? '✓' : s.memorized + '/' + s.total;
    }
    return s.total === 0 ? '' : s.answered === s.total ? '✓' : s.answered + '/' + s.total;
  }

  function badgeDone(ch) {
    var s = chStats(ch);
    return s.total > 0 && (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc')
      ? s.memorized === s.total
      : s.answered === s.total;
  }

  function typeSummary(mode) {
    if (mode === 'mcq') {
      var s = mcqStats('all');
      return s.total + '题' + (s.answered ? ' · ' + s.answered + '/' + s.total : '');
    }
    var s = bqTypeStats(_typeMap[mode], 'all');
    return s.total + '题' + (s.memorized ? ' · ' + s.memorized + '/' + s.total : '');
  }

  // ── MCQ 查询 ──
  function isViewingBM() { return !!S._bmQs; }

  function isEphemeral() { return S.mode === 'random'; }

  function isAnswered(q) {
    if (isViewingBM()) return true;
    if (isEphemeral()) return _rdRes[q.id] !== undefined;
    if (isRetry()) return rResFor(q) !== undefined;
    // 多选题要点「确认选择」后才算已答，只选选项不算
    if (q && q.type === 'multiple') return S.results[q.id] !== undefined;
    return !!S.answers[q.id];
  }
  function isCorrect(q) {
    if (isViewingBM()) return true;
    if (isEphemeral()) return _rdRes[q.id] === true;
    if (isRetry()) return rResFor(q) === true;
    return S.results[q.id] === true;
  }
  function isBookmarked(q) { return S.bookmarks.has(q.id); }
  function selected(q, label) {
    if (isViewingBM()) return q.answer && q.answer.indexOf(label) >= 0;
    if (isEphemeral()) return _rdAns[q.id] && _rdAns[q.id].indexOf(label) >= 0;
    var a = rAnsFor(q);
    return a && a.indexOf(label) >= 0;
  }

  // ── Toast ──
  var _toastTimer = null;
  function toast(msg, type) {
    S.toastMsg = msg; S.toastType = type || 'info'; renderToast();
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { S.toastMsg = ''; renderToast(); }, 3000);
  }

  function renderToast() {
    var el = document.getElementById('toastContainer');
    if (!el) return;
    el.innerHTML = S.toastMsg
      ? '<div class="toast toast-' + S.toastType + '">' + escapeHtml(S.toastMsg) + '</div>' : '';
  }

  // ════════════════════════════════════════════════════════════
  //  视图
  // ════════════════════════════════════════════════════════════

  function renderDashboard() {
    var all = allStats();
    var hasBQ = getBQ().length > 0;
    var html = '<div class="dash">';

    html += '<div class="dash-hero">';
    html += '<div class="dash-hero-icon">📚</div><h2>题库自测系统</h2>';
    html += '<p>选择 ' + getAll().length + ' 道 · 填空 ' + getBQByType('填空').length + ' 道 · 简答 '
      + getBQByType('简答').length + ' 道 · 计算 ' + getBQByType('计算').length + ' 道</p>';
    html += '<div class="dash-hero-stats">';
    html += '<div class="dash-hero-s"><strong>' + all.total + '</strong><span>MCQ总题</span></div>';
    html += '<div class="dash-hero-s"><strong>' + all.answered + '</strong><span>已答</span></div>';
    html += '<div class="dash-hero-s"><strong>' + all.correct + '</strong><span>正确</span></div>';
    html += '<div class="dash-hero-s"><strong>' + S.wrongSet.size + '</strong><span>错题</span></div>';
    html += '</div></div>';

    html += '<h3 class="sec-title">📖 按题型练习</h3><div class="dash-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">';
    TYPES.forEach(function (t) {
      var s = t.mode === 'mcq' ? mcqStats('all') : bqTypeStats(t.bqType, 'all');
      var pct = t.mode === 'mcq' ? Math.round(s.answered / Math.max(s.total, 1) * 100) : Math.round(s.memorized / Math.max(s.total, 1) * 100);
      var label = t.mode === 'mcq' ? '已答 ' + s.answered + '/' + s.total : '已记 ' + s.memorized + '/' + s.total;
      html += '<div class="dash-card mode-card" onclick="App.startType(\'' + t.mode + '\')">';
      html += '<div style="font-size:2rem">' + t.icon + '</div><div>' + t.label + '</div>';
      html += '<div style="font-size:.75rem;color:var(--t2);margin-top:4px">' + s.total + ' 题</div>';
      html += '<div class="dash-bar" style="margin-top:8px"><div class="dash-fill" style="width:' + pct + '%;background:var(--p)"></div></div>';
      html += '<div style="font-size:.7rem;color:var(--t2)">' + label + '</div>';
      html += '</div>';
    });
    html += '</div>';

    if (S.wrongSet.size > 0) {
      html += '<div class="wrong-banner"><span>📝 有 <strong>' + S.wrongSet.size + '</strong> 道错题待复习</span>';
      html += '<button class="btn btn-p btn-sm" onclick="App.startWrong()">开始复习</button></div>';
    }

    html += '<h3 class="sec-title">🚀 快速开始</h3>';
    html += '<div class="dash-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">';
    TYPES.forEach(function (t) {
      html += '<div class="dash-card mode-card" onclick="App.startType(\'' + t.mode + '\')">'
        + '<div style="font-size:2rem">' + t.icon + '</div><div>' + t.label + '</div></div>';
    });
    html += '<div class="dash-card mode-card" onclick="App.setMode(\'random\')"><div style="font-size:2rem">🎲</div><div>随机抽题</div></div>';
    html += '<div class="dash-card mode-card" onclick="App.showBookmarks()"><div style="font-size:2rem">⭐</div><div>收藏</div></div>';
    html += '<div class="dash-card mode-card" onclick="App.startWrong()"><div style="font-size:2rem">❌</div><div>错题本</div></div>';
    html += '</div>';

    if (hasBQ) {
      html += '<h3 class="sec-title">📋 各题型进度</h3>';
      TYPES.forEach(function (t) {
        var s = t.mode === 'mcq' ? mcqStats('all') : bqTypeStats(t.bqType, 'all');
        if (s.total === 0) return;
        var pct = t.mode === 'mcq' ? Math.round(s.answered / Math.max(s.total, 1) * 100) : Math.round(s.memorized / Math.max(s.total, 1) * 100);
        html += '<div class="dash-card" style="cursor:default;margin-bottom:8px">';
        html += '<div class="dash-card-hd"><span>' + t.icon + ' ' + t.label + '</span></div>';
        html += '<div class="dash-card-stats">' + (t.mode === 'mcq' ? '已答 ' + s.answered + '/' + s.total : '已记住 ' + s.memorized + '/' + s.total) + '</div>';
        html += '<div class="dash-bar"><div class="dash-fill" style="width:' + pct + '%"></div></div>';
        html += '</div>';
      });
    }

    html += '</div>';
    return html;
  }

  // ── MCQ 答题 ──
  function renderQuestionView() {
    var q = current();
    if (!q) return '<div class="empty"><p>暂无题目</p></div>';

    var wasAns = false;
    var html = '';

    html += '<div class="q-card">';
    html += '<div class="q-hd">';
    var typeLabel = q._origType === '判断' ? '判断' : (q.type === 'single' ? '单选' : '多选');
    var typeTagCls = q._origType === '判断' ? 'tag-g' : (q.type === 'single' ? 'tag-p' : 'tag-w');
    html += '<span class="tag ' + typeTagCls + '">' + typeLabel + '</span>';
    html += '<span class="tag tag-i">' + chName(q.chapter) + '</span>';
    if (S.wrongSet.has(q.id)) html += '<span class="tag tag-d">错题</span>';
    html += '<span class="q-num">' + (S.idx + 1) + '/' + total() + '</span>';
    html += '<button class="bm-btn" onclick="App.toggleBM(\'' + q.id + '\')">';
    html += isBookmarked(q) ? '⭐' : '☆';
    html += '</button></div>';

    html += '<div class="q-txt">' + escapeHtml(q.question) + '</div>';
    if (q.image) {
      html += '<div class="q-img-wrap"><img class="q-img" src="' + escapeHtml(q.image) + '" alt="题目附图" loading="lazy" onerror="this.style.display='none'"></div>';
    }
    html += '<div class="opts">';
    q.options.forEach(function (opt) {
      var cls = 'opt';
      var sel = selected(q, opt.label);
      if (!wasAns && isAnswered(q)) wasAns = true;
      if (sel && !wasAns) cls += ' sel';
      if (wasAns) {
        cls += ' done';
        if (q.type === 'single') {
          if ((answerIsLetter() && q.answer[0] === opt.label) || (!answerIsLetter() && opt.text === q.answer[0])) cls += ' cor';
          else if (sel) cls += ' wrg';
        } else {
          if (q.answer.indexOf(opt.label) >= 0) cls += ' cor';
          else if (sel) cls += ' wrg';
        }
      }
      html += '<div class="' + cls + '" onclick="App.pick(\'' + opt.label + '\')">';
      html += '<span class="opt-l">' + opt.label + '</span>';
      html += '<span class="opt-t">' + escapeHtml(opt.text) + '</span>';
      if (sel && wasAns) html += '<span class="opt-ic">' + (isCorrect(q) ? '✓' : '✗') + '</span>';
      html += '</div>';
    });
    html += '</div>';

    if (q.type === 'multiple' && !isAnswered(q) && (S.answers[q.id] || []).length > 0) {
      html += '<button class="btn btn-p btn-sm" style="width:100%;margin-top:8px" onclick="App.confirmMC()">确认选择</button>';
    }
    if (isAnswered(q)) {
      html += '<div class="fb ' + (isCorrect(q) ? 'fb-cor' : 'fb-wrg') + '">';
      html += '<span>' + (isCorrect(q) ? '✅ 回答正确！' : '❌ 回答错误') + '</span>';
      html += '<span class="fb-ans">正确答案：<strong>' + escapeHtml(getAnswerText(q)) + '</strong></span></div>';
    }
    if (isRetry() && isAnswered(q) && isCorrect(q) && rSet().has(q.id)) {
      var label = S.mode === 'bookmark' ? '⭐ 取消收藏' : '✅ 移出错题本';
      html += '<button class="btn btn-sm btn-o" style="margin-top:8px" onclick="App.removeFromRetry(\'' + q.id + '\')">' + label + '</button>';
    }
    html += '</div>';

    html += '<div class="q-nav">';
    html += '<button class="nav-btn" onclick="App.back()" title="后退">↩️</button>';
    html += '<button class="nav-btn" onclick="App.forward()" title="前进">↪️</button>';
    html += '<button class="nav-btn" onclick="App.home()" title="首页">🏠</button>';
    html += '<button class="nav-btn" onclick="App.prev()">◀ 上一题</button>';
    html += '<button class="nav-btn" onclick="App.toggleSheet()" title="答题卡">📋 答题卡</button>';
    html += '<span class="tag tag-m">' + (MODE_LABELS[S.mode] || '') + '</span>';
    html += '<button class="nav-btn" onclick="App.next()">下一题 ▶</button>';
    html += '</div>';
    return html;
  }

  // ── 大题闪卡 ──
  function renderBQView() {
    var q = current();
    if (!q) return '<div class="empty"><p>暂无题目</p></div>';

    var icons = { '填空': '📝', '简答': '📄', '计算': '🔢' };
    var ic = icons[q.type] || '📄';
    var html = '<div class="bq">';

    html += '<div class="bq-hd">';
    html += '<span class="tag tag-i">' + chName(q.chapter) + '</span>';
    html += '<span class="tag tag-p">' + ic + ' ' + (q.type || '') + '</span>';
    html += '<span class="bq-pos">' + (S.idx + 1) + '/' + total() + '</span>';
    html += '</div>';

    html += '<div class="bq-card">';
    html += '<div class="bq-front"><div class="bq-label">📖 题目</div>';
    html += '<div class="bq-q">' + escapeHtml(q.question) + '</div>';
    if (q.image) {
      html += '<div class="q-img-wrap"><img class="q-img" src="' + escapeHtml(q.image) + '" alt="题目附图" loading="lazy" onerror="this.style.display='none'"></div>';
    }
    if (!S.bqRevealed) {
      html += '<div style="margin-top:24px;text-align:center"><button class="btn btn-p" onclick="App.revealBQ()">显示答案</button></div>';
    }
    html += '</div>';

    if (S.bqRevealed) {
      html += '<div class="bq-back"><div class="bq-label">✅ 参考答案</div>';
      html += '<div class="bq-a">' + q.answer + '</div></div>';
    }
    html += '</div>';

    var mem = S.bqProg[q.id] && S.bqProg[q.id].memorized;
    html += '<div class="bq-actions">';
    html += '<button class="nav-btn" onclick="App.back()" title="后退">↩️</button>';
    html += '<button class="nav-btn" onclick="App.forward()" title="前进">↪️</button>';
    html += '<button class="nav-btn" onclick="App.home()" title="首页">🏠</button>';
    html += '<button class="nav-btn" onclick="App.prev()">◀ 上一题</button>';
    if (S.bqRevealed) {
      html += '<button class="btn btn-sm ' + (mem ? 'btn-s' : 'btn-p') + '" onclick="App.markBQ()">';
      html += mem ? '✅ 已记住' : '标记已记住';
      html += '</button>';
    }
    html += '<button class="nav-btn" onclick="App.next()">下一题 ▶</button>';
    html += '</div>';

    html += '<label class="bq-filter"><input type="checkbox" onchange="App.toggleBQFilter()"' + (S.bqFilter ? ' checked' : '') + '> 仅看未记住</label>';
    html += '</div>';
    return html;
  }

  // ── 收藏概览（按题型→章节） ──
  function renderBookmarkOverview() {
    var ids = Array.from(S.bookmarks);
    if (!ids.length) return '<div class="empty"><p>暂无收藏 ⭐</p><button class="btn btn-p" onclick="App.home()" style="margin-top:12px">返回首页</button></div>';
    var byType = { mcq: [], fill: [], essay: [], calc: [] };
    ids.forEach(function (id) {
      var q = (QUESTIONS || []).find(function (x) { return x.id === id; });
      if (q) { byType.mcq.push(q); return; }
      q = (BIG_QUESTIONS || []).find(function (x) { return x.id === id; });
      if (q) {
        if (q.type === '填空') byType.fill.push(q);
        else if (q.type === '简答') byType.essay.push(q);
        else if (q.type === '计算') byType.calc.push(q);
      }
    });
    var html = '<div class="dash">';
    html += '<div class="dash-hero" style="background:linear-gradient(135deg,#f39c12,#e67e22)">';
    html += '<div class="dash-hero-icon">⭐</div><h2>收藏题目</h2><p>共 <strong>' + ids.length + '</strong> 道收藏</p></div>';
    TYPES.forEach(function (t) {
      var qs = byType[t.mode];
      if (!qs.length) return;
      var byCh = {};
      qs.forEach(function (q) { if (!byCh[q.chapter]) byCh[q.chapter] = []; byCh[q.chapter].push(q); });
      var chKeys = Object.keys(byCh).sort();
      html += '<h3 class="sec-title">' + t.icon + ' ' + t.label + ' (' + qs.length + ')</h3><div class="dash-grid">';
      chKeys.forEach(function (ch) {
        html += '<div class="dash-card" onclick="App.goBookmarkChapter(\'' + t.mode + '\',\'' + ch + '\')">';
        html += '<div class="dash-card-hd"><span class="dash-num">' + chNum(ch) + '</span>';
        html += '<span>' + chName(ch) + '</span><span class="ch-badge">' + byCh[ch].length + '</span></div>';
        html += '<div class="dash-bar"><div class="dash-fill" style="width:100%"></div></div>';
        html += '<div class="dash-card-stats">' + byCh[ch].length + ' 道收藏</div></div>';
      });
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // ── 错题本概览（按章节+类型分组）──
  function renderWrongOverview() {
    var ids = Array.from(rSet());
    if (!ids.length) {
      var msg = S.mode === 'wrong' ? '暂无错题 🎉' : '暂无收藏 ⭐';
      return '<div class="empty"><p>' + msg + '</p><button class="btn btn-p" onclick="App.home()" style="margin-top:12px">返回首页</button></div>';
    }
    // 按章节+类型分组
    var byChapterType = {};
    ids.forEach(function (id) {
      var q = (QUESTIONS || []).find(function (x) { return x.id === id; });
      if (!q) return;
      if (!byChapterType[q.chapter]) byChapterType[q.chapter] = { single: [], multiple: [] };
      var t = q.type === 'single' ? 'single' : 'multiple';
      byChapterType[q.chapter][t].push(q);
    });
    var chKeys = Object.keys(byChapterType).sort();
    var isBm = S.mode === 'bookmark';
    var bg = isBm ? 'linear-gradient(135deg,#f39c12,#e67e22)' : 'linear-gradient(135deg,var(--rd),#c0392b)';
    var icon = isBm ? '⭐' : '❌';
    var title = isBm ? '收藏题目' : '错题本';
    var suffix = isBm ? '道收藏' : '道错题';
    var html = '<div class="dash">';
    html += '<div class="dash-hero" style="background:' + bg + '">';
    html += '<div class="dash-hero-icon">' + icon + '</div><h2>' + title + '</h2><p>共 <strong>' + ids.length + '</strong> ' + suffix + '</p></div>';

    chKeys.forEach(function (ch) {
      var chData = byChapterType[ch];
      var singleQs = chData.single || [], multiQs = chData.multiple || [];
      var chTotal = singleQs.length + multiQs.length;
      html += '<h3 class="sec-title" style="margin-top:16px">' + chName(ch) + ' <span style="font-weight:normal;color:var(--t2);font-size:0.85rem">（' + chTotal + ' ' + suffix + '）</span></h3>';

      // 按类型分组显示
      var typeGroups = [
        { label: '📋 单选题', qs: singleQs, tag: '单选' },
        { label: '📋 多选题', qs: multiQs, tag: '多选' }
      ];
      typeGroups.forEach(function (group) {
        if (!group.qs.length) return;
        html += '<div style="margin:4px 0 2px 8px;font-size:0.8rem;color:var(--t2);font-weight:600">' + group.label + '（' + group.qs.length + '）</div>';
        html += '<div class="wrong-q-list">';
        group.qs.forEach(function (q) {
          var allInCh = getAll().filter(function (x) { return x.chapter === ch; });
          var qIdx = allInCh.indexOf(q);
          var qNum = qIdx >= 0 ? (qIdx + 1) : '?';
          var qShort = q.question.length > 50 ? q.question.substring(0, 50) + '…' : q.question;
          html += '<div class="wrong-q-item" onclick="App.goRetryChapterAndIdx(\'' + ch + '\',\'' + q.id + '\')">';
          html += '<span class="wrong-q-tag">' + group.tag + '</span>';
          html += '<span class="wrong-q-ch">' + chName(ch) + '</span>';
          html += '<span class="wrong-q-num">第' + qNum + '题</span>';
          html += '<span class="wrong-q-txt">' + escapeHtml(qShort) + '</span>';
          html += '</div>';
        });
        html += '</div>';
      });
    });

    html += '<div style="text-align:center;margin-top:20px">';
    html += '<button class="btn btn-p" onclick="App.openWrongDlg()" style="font-size:1rem;padding:12px 32px">🎯 开始自测</button>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  // ── 弹窗 ──
  function renderModals() {
    var html = '';
    if (S.showRandomDlg) {
      html += '<div class="modal-overlay" onclick="App.closeRandomDlg()"><div class="modal-dlg" onclick="event.stopPropagation()">';
      html += '<div class="modal-hd">随机抽题<span class="modal-x" onclick="App.closeRandomDlg()">✕</span></div>';
      html += '<div class="modal-bd"><div class="dlg-form">';
      html += '<label>抽取数量</label><select id="randomCount">';
      [10, 20, 30, 50].forEach(function (v) { html += '<option value="' + v + '">' + v + '</option>'; });
      html += '</select><label>题型</label><select id="randomType">';
      html += '<option value="all">全部</option><option value="single">单选</option><option value="multiple">多选</option>';
      html += '</select></div></div>';
      html += '<div class="modal-ft"><button class="btn btn-o" onclick="App.closeRandomDlg()">取消</button><button class="btn btn-p" onclick="App.startRandom()">开始</button></div></div></div>';
    }

    if (S.showWrongDlg) {
      var wrongChs = {}, wrongAll = getAll().filter(function (q) { return S.wrongSet.has(q.id); });
      wrongAll.forEach(function (q) { wrongChs[q.chapter] = (wrongChs[q.chapter]||0) + 1; });
      var chKeys = Object.keys(wrongChs).sort();
      html += '<div class="modal-overlay" onclick="App.closeWrongDlg()"><div class="modal-dlg" onclick="event.stopPropagation()">';
      html += '<div class="modal-hd">❌ 错题自测<span class="modal-x" onclick="App.closeWrongDlg()">✕</span></div>';
      html += '<div class="modal-bd"><div class="dlg-form">';
      html += '<label>选择章节</label><select id="wrongChapter">';
      html += '<option value="all">全部 (' + wrongAll.length + ' 题)</option>';
      chKeys.forEach(function (ch) { html += '<option value="' + ch + '">' + chName(ch) + ' (' + wrongChs[ch] + ' 题)</option>'; });
      html += '</select><label>题目顺序</label><select id="wrongOrder">';
      html += '<option value="seq">顺序</option><option value="shuffle">乱序</option>';
      html += '</select><p class="dlg-hint">答对后可手动移出错题本</p>';
      html += '</div></div>';
      html += '<div class="modal-ft"><button class="btn btn-o" onclick="App.closeWrongDlg()">取消</button>';
      html += '<button class="btn btn-p" onclick="App.startWrongTest()">开始自测</button></div></div></div>';
    }

    return html;
  }

  // ── 答题卡 ──
  function renderSheet() {
    var panel = document.getElementById('sheetPanel');
    if (!S.showSheet) { panel.classList.remove('open'); return; }
    var qs = getQs();
    if (!qs.length || S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') { panel.classList.remove('open'); return; }
    if (!(S.mode === 'mcq' || S.mode === 'random')) { panel.classList.remove('open'); return; }
    panel.classList.add('open');
    var html = '';
    qs.forEach(function (q, i) {
      var cls = 'sh-cell' + (i === S.idx ? ' cur' : '');
      var a = isEphemeral() ? _rdAns[q.id] : S.answers[q.id];
      var r = isEphemeral() ? _rdRes[q.id] : S.results[q.id];
      if (a) cls += r ? ' correct' : ' wrong';
      else cls += ' skip';
      html += '<div class="' + cls + '" onclick="App.sheetJump(' + i + ')">' + (i + 1) + '</div>';
    });
    document.getElementById('sheetGrid').innerHTML = html;
  }

  // ════════════════════════════════════════════════════════════
  //  主渲染
  // ════════════════════════════════════════════════════════════

  function render() {
    document.getElementById('sidebarTotal').textContent = getAll().length + ' 选择 + ' + getBQ().length + ' 大题';

    TYPES.forEach(function (t) {
      var btn = document.getElementById('typeBtn_' + t.mode);
      if (btn) {
        btn.classList.toggle('active', S.mode === t.mode);
        var badge = btn.querySelector('.type-badge');
        if (badge) badge.textContent = typeSummary(t.mode);
      }
    });

    // 侧边栏目录标签 & 色调
    var ctxLabels = {
      mcq: '✏️ 选择题目录', fill: '📝 填空题目录', essay: '📄 简答题目录',
      calc: '🔢 计算题目录', wrong: '❌ 错题本目录'
    };
    var contextEl = document.getElementById('contextLabel');
    if (isTypeMode(S.mode)) {
      var label = ctxLabels[S.mode] || '';
      if (S.chapter && S.chapter !== 'all' && S.chapter !== '_all') label += ' · ' + chName(S.chapter);
      contextEl.textContent = label;
    } else if (S.mode === 'wrong' || S.mode === 'bookmark') {
      contextEl.textContent = S.mode === 'wrong' ? ctxLabels.wrong : '⭐ 收藏题目目录';
    } else {
      contextEl.textContent = '';
    }

    var navEl = document.getElementById('sidebarNav');
    navEl.className = 'sidebar-nav';
    if (S.mode === 'mcq' || S.mode === 'random') navEl.classList.add('mcq-mode');
    else if (S.mode === 'fill') navEl.classList.add('fill-mode');
    else if (S.mode === 'essay') navEl.classList.add('essay-mode');
    else if (S.mode === 'calc') navEl.classList.add('calc-mode');
    else if (S.mode === 'wrong' || S.mode === 'bookmark') navEl.classList.add('wrong-mode');

    var chHtml = '';
    var showChBadge = isTypeMode(S.mode) || isRetry();
    CHAPTERS.forEach(function (ch) {
      var active = S.chapter === ch && (isTypeMode(S.mode) || isRetry());
      chHtml += '<button class="chapter-btn' + (active ? ' active' : '') + '" onclick="App.goChapter(\'' + ch + '\')">';
      chHtml += '<span class="ch-icon">●</span><span>' + chName(ch) + '</span>';
      if (showChBadge) {
        var badge = '';
        if (isRetry()) {
          var cnt = (QUESTIONS || []).filter(function (q) { return q.chapter === ch && rSet().has(q.id); }).length +
                     (BIG_QUESTIONS || []).filter(function (q) { return q.chapter === ch && rSet().has(q.id); }).length;
          badge = cnt > 0 ? '<span class="ch-badge">' + cnt + '</span>' : '';
        } else {
          badge = '<span class="ch-badge' + (badgeDone(ch) ? ' done' : '') + '">' + badgeText(ch) + '</span>';
        }
        chHtml += badge;
      }
      chHtml += '</button>';
    });
    document.getElementById('chapterList').innerHTML = chHtml;

    document.querySelectorAll('.mode-btn[data-mode]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === S.mode);
    });

    var st = isTypeMode(S.mode) ? currentStats() : mcqStats('all');
    if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') {
      document.getElementById('sidebarStats').innerHTML =
        '<div class="stat"><span>已查看</span><span>' + st.viewed + '/' + st.total + '</span></div>' +
        '<div class="stat"><span>已记住</span><span>' + st.memorized + '/' + st.total + '</span></div>';
    } else if (isRetry()) {
      var totalStr = S.mode === 'wrong' ? S.wrongSet.size : S.bookmarks.size;
      document.getElementById('sidebarStats').innerHTML =
        '<div class="stat"><span>' + (S.mode === 'wrong' ? '错题总数' : '收藏总数') + '</span><span>' + totalStr + '</span></div>' +
        '<div class="stat"><span>当前章节</span><span>' + (S.chapter === 'all' ? '全部' : (getQs().length + ' 题')) + '</span></div>';
    } else {
      document.getElementById('sidebarStats').innerHTML =
        '<div class="stat"><span>进度</span><span>' + st.answered + '/' + st.total + '</span></div>' +
        '<div class="stat"><span>错题</span><span>' + S.wrongSet.size + '</span></div>';
    }

    // 侧边栏操作按钮
    document.getElementById('sidebarActions').innerHTML =
      '<button class="action-btn" id="homeBtn">🏠 首页</button>' +
      '<button class="action-btn d-btn" id="clearDataBtn">🗑️ 清除</button>';

    var modeName = '';
    if (isTypeMode(S.mode)) {
      var found = TYPES.find(function (t) { return t.mode === S.mode; });
      modeName = (found ? found.icon + ' ' : '') + (MODE_LABELS[S.mode] || '');
    } else if (isRetry()) {
      if (S.mode === 'wrong') modeName = '❌ 错题本' + (S.chapter !== 'all' ? ' - ' + chName(S.chapter) : '');
      else modeName = '⭐ 收藏' + (S.chapter !== 'all' ? ' - ' + chName(S.chapter) : '');
    } else { modeName = MODE_LABELS[S.mode] || ''; }
    document.getElementById('topMode').textContent = modeName;

    var content = '';
    if (S.mode === 'dashboard') content = renderDashboard();
    else if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') content = renderBQView();
    else if (S.mode === 'bookmark') content = S.chapter === 'all' ? renderBookmarkOverview() : renderQuestionView();
    else if (S.mode === 'wrong') content = S.chapter === 'all' ? renderWrongOverview() : renderQuestionView();
    else if (S.mode === 'mcq' || S.mode === 'random') content = renderQuestionView();
    else content = '<div class="empty"><p>选择题型开始学习</p></div>';
    document.getElementById('contentArea').innerHTML = content;

    document.getElementById('contentFooter').innerHTML =
      '<span>第 ' + (S.idx + 1) + '/' + Math.max(total(), 1) + ' 题</span><span>' + modeName + '</span>';

    document.getElementById('modalContainer').innerHTML = renderModals();
    renderSheet();

    renderToast();

}

  // ════════════════════════════════════════════════════════════
  //  操作接口
  // ════════════════════════════════════════════════════════════

  var App = {};

  App.back = function () {
    if (!_navStack.length) { toast('没有上一页', 'warning'); return; }
    _forwardStack.push({ mode: S.mode, chapter: S.chapter, idx: S.idx, _bmQs: S._bmQs });
    if (_forwardStack.length > 50) _forwardStack.shift();
    var prev = _navStack.pop();
    syncRetryToPerm();
    _retryActive = false;
    _rdAns = {}; _rdRes = {};
    S.mode = prev.mode; S.chapter = prev.chapter; S.idx = prev.idx || 0;
    S._bmQs = prev._bmQs || null;
    S.showSheet = false; S.bqRevealed = false;
    render();
  };

  App.forward = function () {
    if (!_forwardStack.length) { toast('没有下一页', 'warning'); return; }
    _navStack.push({ mode: S.mode, chapter: S.chapter, idx: S.idx, _bmQs: S._bmQs });
    if (_navStack.length > 50) _navStack.shift();
    var next = _forwardStack.pop();
    syncRetryToPerm();
    _retryActive = false;
    _rdAns = {}; _rdRes = {};
    S.mode = next.mode; S.chapter = next.chapter; S.idx = next.idx || 0;
    S._bmQs = next._bmQs || null;
    S.showSheet = false; S.bqRevealed = false;
    render();
  };

  App.home = function () {
    navPush();
    syncRetryToPerm();
    _retryActive = false;
    _rdAns = {}; _rdRes = {};
    S._bmQs = null;
    S.mode = 'dashboard'; S.chapter = 'all'; S.idx = 0; S.showSheet = false; S.bqRevealed = false; render();
  };

  App.startType = function (mode) {
    navPush();
    syncRetryToPerm();
    _retryActive = false;
    _rdAns = {}; _rdRes = {};
    S._bmQs = null;
    S.mode = mode; S.chapter = 'all'; S.idx = getProgress(); S.showSheet = false; S.bqRevealed = false; S.bqFilter = false; S._bqFilteredQs = null; render();
  };

  App.goChapter = function (ch) {
    if (S._bmQs) S._bmQs = null;
    if (S.mode === 'wrong') { App.goRetryChapter(ch); return; }
    if (S.mode === 'bookmark') { App.showBookmarks(); return; }
    navPush();
    if (!isTypeMode(S.mode)) S.mode = 'mcq';
    S.chapter = ch;
    // 实时扫描第一个未做题，不依赖缓存
    var qs = getQs(); S.idx = 0;
    if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') {
      for (var i = 0; i < qs.length; i++) { var p = S.bqProg[qs[i].id] || {}; if (!p.memorized) { S.idx = i; break; } }
    } else {
      for (var i = 0; i < qs.length; i++) { if (!S.answers[qs[i].id]) { S.idx = i; break; } }
    }
    S.showSheet = false; S.bqRevealed = false; S._bqFilteredQs = null; S.bqFilter = false; render();
  };

  App.setMode = function (m) {
    S.showSheet = false; S.bqRevealed = false;
    syncRetryToPerm();
    _retryActive = false;
    if (m === 'wrong') { App.startWrong(); return; }
    if (m === 'random') { S.showRandomDlg = true; render(); return; }
    
    S.mode = m; S.idx = 0; render();
  };

  App.next = function () {
    var n = total(); if (!n) return;
    if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') { S.idx = (S.idx + 1) % n; S.bqRevealed = false; }
    else S.idx = (S.idx + 1) % n;
    updateProgress();
    render();
  };

  App.prev = function () {
    var n = total(); if (!n) return;
    if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') { S.idx = (S.idx - 1 + n) % n; S.bqRevealed = false; }
    else S.idx = (S.idx - 1 + n) % n;
    updateProgress();
    render();
  };

  App.pick = function (label) {
    var q = current(); if (!q) return;
    if (isViewingBM()) return;
    if (q.type === 'single' && isAnswered(q)) return;
    if (q.type === 'multiple' && (isRetry() ? rResFor(q) !== undefined : S.results[q.id] !== undefined)) return;
    if (q.type === 'multiple' && isEphemeral() && _rdRes[q.id] !== undefined) return;
    var isLetter = q.answer.length && /^[A-Z√×]$/.test(q.answer[0]);
    var ansIsLabel = isAnsOptionLabel(q);
    var isWr = isRetry();
    var isEph = isEphemeral();
    if (q.type === 'single') {
      var ans = [label], cor;
      if (isLetter || ansIsLabel) cor = q.answer[0] === label;
      else { var opt = q.options.find(function (o) { return o.label === label; }); cor = opt && opt.text === q.answer[0]; }
      if (isWr) {
        rAnsObj()[q.id] = ans; rResObj()[q.id] = cor;
        render(); return;
      } else if (isEph) {
        _rdAns[q.id] = ans; _rdRes[q.id] = cor;
        if (!cor) { S.wrongSet.add(q.id); save(); }
        render(); return;
      } else {
        S.answers[q.id] = ans; S.results[q.id] = cor;
        if (cor) S.wrongSet.delete(q.id); else S.wrongSet.add(q.id);
        save();
      }
      updateProgress();
      render();
    } else {
      var tgt = isEph ? _rdAns : rAnsObj();
      if (!tgt[q.id]) tgt[q.id] = [];
      var i = tgt[q.id].indexOf(label);
      if (i >= 0) tgt[q.id].splice(i, 1); else tgt[q.id].push(label);
      render();
    }
  };

  App.confirmMC = function () {
    var q = current(); if (!q) return;
    var isWr = isRetry();
    var isEph = isEphemeral();
    var tgtAns = isEph ? _rdAns : rAnsObj(), tgtRes = isEph ? _rdRes : rResObj();
    var u = (tgtAns[q.id] || []).slice().sort(), c = q.answer.slice().sort();
    var ok = u.length === c.length && u.every(function (v, i) { return v === c[i]; });
    tgtRes[q.id] = ok;
    if (!isWr && !isEph) { if (ok) S.wrongSet.delete(q.id); else S.wrongSet.add(q.id); save(); }
    if (isEph && !ok) { S.wrongSet.add(q.id); save(); }
    if (!isEph) updateProgress();
    render();
  };

  App.toggleBM = function (qId) { if (S.bookmarks.has(qId)) S.bookmarks.delete(qId); else S.bookmarks.add(qId); save(); render(); };

  App.showBookmarks = function () {
    if (!S.bookmarks.size) { toast('暂无收藏 ⭐', 'warning'); return; }
    navPush();
    S._bmQs = null; S.mode = 'bookmark'; S.chapter = 'all'; S.idx = 0; render();
  };

  App.startWrong = function () {
    var all = getAll().filter(function (q) { return S.wrongSet.has(q.id); });
    if (!all.length) { toast('暂无错题 🎉', 'warning'); return; }
    navPush();
    _wrongList = all;
    _retryActive = false;
    S.mode = 'wrong'; S.chapter = 'all'; S.idx = 0; render();
  };

  App.openWrongDlg = function () { S.showWrongDlg = true; S.wrongChapter = 'all'; S.wrongOrder = 'seq'; render(); };
  App.closeWrongDlg = function () { S.showWrongDlg = false; render(); };

  App.startWrongTest = function () {
    var chEl = document.getElementById('wrongChapter'), orderEl = document.getElementById('wrongOrder');
    var chapter = chEl ? chEl.value : 'all', order = orderEl ? orderEl.value : 'seq';
    var pool = getAll().filter(function (q) { return S.wrongSet.has(q.id); });
    if (chapter !== 'all') pool = pool.filter(function (q) { return q.chapter === chapter; });
    if (!pool.length) { toast('该范围没有错题', 'warning'); return; }
    navPush();
    if (order === 'shuffle') shuffle(pool);
    _wrongList = pool;
    _wrAns = {}; _wrRes = {};
    _retryActive = true;
    S.mode = 'wrong';
    S.chapter = chapter === 'all' ? '_all' : chapter;
    S.idx = 0; S.showWrongDlg = false; render();
  };

  App.removeFromRetry = function (qId) {
    if (_wrAns[qId] !== undefined) { S.answers[qId] = _wrAns[qId]; S.results[qId] = _wrRes[qId]; }
    if (_bmAns[qId] !== undefined) { S.answers[qId] = _bmAns[qId]; S.results[qId] = _bmRes[qId]; }
    rSet().delete(qId);
    delete _wrAns[qId]; delete _wrRes[qId];
    delete _bmAns[qId]; delete _bmRes[qId];
    if (S.mode === 'wrong') {
      _wrongList = _wrongList.filter(function (q) { return q.id !== qId; });
      if (!_wrongList.length) {
        var remaining = getAll().filter(function (q) { return S.wrongSet.has(q.id); });
        if (!remaining.length) { S.mode = 'dashboard'; render(); return; }
        S.chapter = 'all'; _wrongList = remaining;
      }
    } else {
      _bmList = _bmList.filter(function (q) { return q.id !== qId; });
      if (!_bmList.length) {
        var remaining = getAll().filter(function (q) { return S.bookmarks.has(q.id); });
        if (!remaining.length) { S.mode = 'dashboard'; render(); return; }
        S.chapter = 'all'; _bmList = remaining;
      }
    }
    save();
    render();
  };

  App.goRetryChapter = function (ch) {
    var wrongQs = getAll().filter(function (q) { return S.wrongSet.has(q.id) && q.chapter === ch; });
    if (!wrongQs.length) { toast('该章没有错题', 'warning'); return; }
    navPush();
    _wrongList = wrongQs;
    _retryActive = false;
    S.chapter = ch; S.idx = 0; render();
  };

  // 跳转到指定错题（从错题列表点击某条）
  App.goRetryChapterAndIdx = function (ch, qId) {
    var wrongQs = getAll().filter(function (q) { return S.wrongSet.has(q.id) && q.chapter === ch; });
    if (!wrongQs.length) { toast('该章没有错题', 'warning'); return; }
    navPush();
    _wrongList = wrongQs;
    _retryActive = false;
    var idx = wrongQs.findIndex(function (q) { return q.id === qId; });
    S.chapter = ch; S.idx = idx >= 0 ? idx : 0; render();
  };

  // 进入收藏的指定题型+章节
  App.goBookmarkChapter = function (typeMode, ch) {
    var type = _typeMap[typeMode];
    var qs;
    if (typeMode === 'mcq') {
      qs = getAll().filter(function (q) { return S.bookmarks.has(q.id) && q.chapter === ch; });
    } else {
      qs = getBQByType(type).filter(function (q) { return S.bookmarks.has(q.id) && q.chapter === ch; });
    }
    if (!qs.length) { toast('该章没有收藏', 'warning'); return; }
    navPush();
    S._bmQs = qs;
    S.mode = typeMode;
    S.chapter = ch;
    if (typeMode !== 'mcq') S.bqRevealed = true;
    S.idx = 0; render();
  };

  App.closeRandomDlg = function () { S.showRandomDlg = false; render(); };
  App.startRandom = function () {
    var countEl = document.getElementById('randomCount'), typeEl = document.getElementById('randomType');
    if (countEl) S.randomCount = parseInt(countEl.value, 10);
    if (typeEl) S.randomType = typeEl.value;
    var pool = S.randomType === 'all' ? getAll().slice() : getAll().filter(function (q) { return q.type === S.randomType; });
    shuffle(pool);
    S._randomQs = pool.slice(0, Math.min(S.randomCount, pool.length));
    _rdAns = {}; _rdRes = {};
    S.mode = 'random'; S.idx = 0; S.showRandomDlg = false; render();
  };

  App.revealBQ = function () {
    S.bqRevealed = true;
    var q = current();
    if (q) { S.bqProg[q.id] = S.bqProg[q.id] || {}; S.bqProg[q.id].viewed = true; save(); }
    render();
  };

  App.markBQ = function () {
    var q = current(); if (!q) return;
    S.bqProg[q.id] = S.bqProg[q.id] || {};
    S.bqProg[q.id].memorized = !S.bqProg[q.id].memorized; S.bqProg[q.id].viewed = true;
    save(); render();
  };

  App.toggleBQFilter = function () {
    S.bqFilter = !S.bqFilter;
    if (S.bqFilter) {
      var type = _typeMap[S.mode];
      var all = getBQByType(type);
      if (S.chapter && S.chapter !== 'all') all = all.filter(function (q) { return q.chapter === S.chapter; });
      var filtered = all.filter(function (q) { var p = S.bqProg[q.id] || {}; return !p.memorized; });
      if (!filtered.length) { toast('全部已记住！', 'success'); S.bqFilter = false; render(); return; }
      S._bqFilteredQs = filtered; S.idx = 0;
    } else { S._bqFilteredQs = null; S.idx = 0; }
    render();
  };

  App.toggleSheet = function () { S.showSheet = !S.showSheet; render(); };
  App.sheetJump = function (i) { S.idx = i; S.showSheet = false; render(); };

  App.toggleTheme = function () {
    var h = document.documentElement;
    var cur = h.getAttribute('data-theme') || 'light';
    var next = cur === 'dark' ? 'light' : 'dark';
    h.setAttribute('data-theme', next);
    LS.setItem(K.theme, next);
    document.getElementById('themeBtn').textContent = next === 'dark' ? '☀️' : '🌙';
  };

  App.clearData = function () {
    if (!confirm('确定清除所有记录？不可恢复！')) return;
    Object.values(K).forEach(function (k) { LS.removeItem(k); });
    S.answers = {}; S.results = {}; S.bookmarks = new Set(); S.wrongSet = new Set(); S.bqProg = {};
    toast('已清除', 'success'); render();
  };

  

  window.App = App;

  // ════════════════════════════════════════════════════════════
  //  初始化
  // ════════════════════════════════════════════════════════════

  document.addEventListener('DOMContentLoaded', function () {
    var initTheme = LS.getItem(K.theme);
    if (initTheme) { document.documentElement.setAttribute('data-theme', initTheme); document.getElementById('themeBtn').textContent = initTheme === 'dark' ? '☀️' : '🌙'; }

    document.getElementById('hamburger').addEventListener('click', function () { document.getElementById('sidebar').classList.toggle('open'); });
    document.getElementById('closeSheet').addEventListener('click', function () { S.showSheet = false; render(); });
    // 清除按钮通过事件代理（动态创建）
    document.getElementById('sidebarActions').addEventListener('click', function (e) {
      if (e.target.id === 'homeBtn') App.home();
      if (e.target.id === 'clearDataBtn') App.clearData();
    });
    document.getElementById('themeBtn').addEventListener('click', App.toggleTheme);

    TYPES.forEach(function (t) {
      var btn = document.getElementById('typeBtn_' + t.mode);
      if (btn) btn.addEventListener('click', function () { App.startType(t.mode); });
    });

    document.querySelectorAll('.mode-btn[data-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () { App.setMode(this.getAttribute('data-mode')); });
    });

    try { render(); } catch (e) { console.error('render error:', e); }
  });

})();
