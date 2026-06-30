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

  var K = { ans: 'net_ans', res: 'net_res', bm: 'net_bm', wrong: 'net_wrong', bq: 'net_bq', theme: 'net_theme', hist: 'net_hist', atest: 'net_atest' };
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
    showTestResult: false,
    showHistory: false,
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
  var _bqRevealedMap = {};
  var _history = loadJ(K.hist, '[]');
  var _activeTest = null;
  var _testTimerId = null;

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
    LS.setItem(K.hist, JSON.stringify(_history));
    if (_activeTest) { LS.setItem(K.atest, JSON.stringify(_activeTest)); }
    else { LS.removeItem(K.atest); }
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

  // ── 获取指定章节的题目（跨章节导航用）──
  function getQsForChapter(ch) {
    if (S.mode === 'mcq') {
      return getAll().filter(function (q) { return q.chapter === ch; });
    }
    if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') {
      var type = _typeMap[S.mode];
      return getBQByType(type).filter(function (q) { return q.chapter === ch; });
    }
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

  function getBQAnswerText(q) {
    if (!q || q.answer === undefined || q.answer === null) return '';
    if (Array.isArray(q.answer)) return q.answer.join(', ');
    return String(q.answer);
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
  //  自测历史记录
  // ════════════════════════════════════════════════════════════

  function createTestId() {
    var d = new Date();
    var ds = d.getFullYear() + ('0'+(d.getMonth()+1)).slice(-2) + ('0'+d.getDate()).slice(-2);
    var rs = Math.random().toString(36).substring(2,6);
    return 't_' + ds + '_' + rs;
  }

  function createTestRecord(pool, chapter, order) {
    var rec = {
      id: createTestId(),
      mode: 'wrong',
      chapter: chapter,
      order: order || 'seq',
      startedAt: Date.now(),
      completedAt: null,
      total: pool.length,
      answered: 0,
      correct: 0,
      qIds: pool.map(function(q) { return q.id; }),
      answers: {},
      results: {}
    };
    _activeTest = rec;
    _wrAns = {};
    _wrRes = {};
    LS.setItem(K.atest, JSON.stringify(rec));
    return rec;
  }

  function persistActiveTest() {
    if (!_activeTest) return;
    // 更新统计
    var answered = 0, correct = 0;
    _activeTest.qIds.forEach(function(id) {
      if (_wrRes[id] !== undefined) {
        answered++;
        if (_wrRes[id]) correct++;
      }
    });
    // 也同步wrAns/wrRes中的答案
    Object.keys(_wrAns).forEach(function(id) {
      _activeTest.answers[id] = _wrAns[id];
      _activeTest.results[id] = _wrRes[id];
    });
    _activeTest.answered = answered;
    _activeTest.correct = correct;
    LS.setItem(K.atest, JSON.stringify(_activeTest));
  }

  function finishActiveTest() {
    if (!_activeTest) return;
    persistActiveTest();
    _activeTest.completedAt = Date.now();
    // 移入历史
    _history.unshift({
      id: _activeTest.id,
      mode: _activeTest.mode,
      chapter: _activeTest.chapter,
      order: _activeTest.order,
      startedAt: _activeTest.startedAt,
      completedAt: _activeTest.completedAt,
      total: _activeTest.total,
      answered: _activeTest.answered,
      correct: _activeTest.correct,
      qIds: _activeTest.qIds,
      answers: JSON.parse(JSON.stringify(_wrAns)),
      results: JSON.parse(JSON.stringify(_wrRes))
    });
    if (_history.length > 50) _history = _history.slice(0, 50);
    _activeTest = null;
    LS.removeItem(K.atest);
    LS.setItem(K.hist, JSON.stringify(_history));
  }

  function checkTestCompletion() {
    if (!_activeTest || S.mode !== 'wrong') return false;
    var allDone = true;
    _activeTest.qIds.forEach(function(id) {
      if (_wrRes[id] === undefined) allDone = false;
    });
    if (allDone) {
      finishActiveTest();
      S.showTestResult = true;
      if (_testTimerId) { clearInterval(_testTimerId); _testTimerId = null; }
      render();
      return true;
    }
    persistActiveTest();
    return false;
  }

  function resumeActiveTest(rec) {
    if (!rec || !rec.qIds || !rec.qIds.length) return false;
    // 根据 qIds 重建题目列表
    var pool = [];
    rec.qIds.forEach(function(id) {
      var q = getAll().find(function(x) { return x.id === id; });
      if (q) pool.push(q);
    });
    if (!pool.length) { toast('自测记录中的题目已不存在', 'warning'); return false; }
    _wrongList = pool;
    _wrAns = JSON.parse(JSON.stringify(rec.answers || {}));
    _wrRes = JSON.parse(JSON.stringify(rec.results || {}));
    _retryActive = true;
    // 跳到第一道未答题
    S.idx = 0;
    for (var i = 0; i < pool.length; i++) {
      if (_wrRes[pool[i].id] === undefined) { S.idx = i; break; }
    }
    S.mode = 'wrong';
    S.chapter = rec.chapter === 'all' ? '_all' : rec.chapter;
    _activeTest = rec;
    if (_testTimerId) { clearInterval(_testTimerId); _testTimerId = null; }
    // 开启计时心跳
    _testTimerId = setInterval(function() {
      if (_activeTest) persistActiveTest();
    }, 10000);
    toast('已恢复上次未完成的自测', 'info');
    render();
    return true;
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

    // 未完成自测恢复提示
    var rawActive = LS.getItem(K.atest);
    if (rawActive) {
      try {
        var activeRec = JSON.parse(rawActive);
        if (activeRec && activeRec.qIds && activeRec.qIds.length) {
          html += '<div class="wrong-banner" style="background:var(--ywb);border-color:var(--yw)">';
          html += '<span>⏳ 有未完成的自测 (已完成 ' + activeRec.answered + '/' + activeRec.total + ' 题)</span>';
          html += '<button class="btn btn-sm" style="background:var(--yw);color:#fff" onclick="App.resumeTest()">继续自测</button></div>';
        }
      } catch(e) {}
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

    // 自测历史（最近5条）
    if (_history.length > 0) {
      html += '<h3 class="sec-title">📊 最近自测</h3>';
      html += '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">';
      var showCount = Math.min(_history.length, 5);
      for (var hi = 0; hi < showCount; hi++) {
        var rec = _history[hi];
        var pct = rec.total > 0 ? Math.round(rec.correct / rec.total * 100) : 0;
        var d = Math.round(((rec.completedAt || rec.startedAt) - rec.startedAt) / 1000);
        var m = Math.floor(d / 60), s = d % 60;
        var dt = new Date(rec.startedAt);
        var ds = ('0'+(dt.getMonth()+1)).slice(-2) + '-' + ('0'+dt.getDate()).slice(-2) + ' ' + ('0'+dt.getHours()).slice(-2) + ':' + ('0'+dt.getMinutes()).slice(-2);
        var status = rec.completedAt ? '' : ' (未完成)';
        var borderClr = pct >= 60 ? 'var(--gr)' : 'var(--rd)';
        html += '<div class="hist-item" onclick="App.viewTestHistory(\'' + rec.id + '\')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--cd);border:1px solid var(--bd);border-radius:var(--r);cursor:pointer;border-left:3px solid ' + borderClr + ';transition:all var(--tr)" onmouseover="this.style.boxShadow=\'var(--shd)\'" onmouseout="this.style.boxShadow=\'none\'">';
        html += '<div style="font-size:.78rem;color:var(--t3);min-width:6em">' + ds + status + '</div>';
        html += '<div style="flex:1;font-size:.85rem;font-weight:500">错题自测</div>';
        html += '<div style="font-size:.78rem;color:var(--t2)">' + rec.correct + '/' + rec.total + '</div>';
        html += '<div style="font-size:.85rem;font-weight:700;color:' + (pct >= 60 ? 'var(--gr)' : 'var(--rd)') + ';min-width:3em;text-align:right">' + pct + '%</div>';
        html += '<div style="font-size:.72rem;color:var(--t3)">' + m + '\'' + s + '"</div>';
        html += '</div>';
      }
      if (_history.length > 5) {
        html += '<button class="btn btn-o btn-sm" onclick="App.showTestHistory()" style="width:100%">查看全部 ' + _history.length + ' 条记录</button>';
      }
      html += '</div>';
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
      html += '<div class="q-img-wrap"><img class="q-img" src="' + escapeHtml(q.image) + '" alt="题目附图" loading="lazy" onerror="this.style.display=&quot;none&quot;"></div>';
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

  // ── 选择题章节网格卡片（mcq 下 chapter='all' 时展示）──
  function renderMCQChapterGrid() {
    var qs = getQs();
    if (!qs.length) return '<div class="empty"><p>暂无题目</p></div>';

    // 按章节分组
    var byCh = {};
    qs.forEach(function (q) {
      if (!byCh[q.chapter]) byCh[q.chapter] = [];
      byCh[q.chapter].push(q);
    });
    var chKeys = Object.keys(byCh).sort();

    var allTotal = qs.length, allAnswered = 0, allCorrect = 0;
    qs.forEach(function (q) {
      if (S.answers[q.id]) { allAnswered++; if (S.results[q.id]) allCorrect++; }
    });

    var html = '<div class="dash">';
    html += '<div class="dash-hero" style="background:linear-gradient(135deg,var(--p),var(--p2))">';
    html += '<div class="dash-hero-icon">✏️</div><h2>选择题</h2>';
    html += '<p>共 ' + allTotal + ' 题 · 已答 ' + allAnswered + '/' + allTotal + '</p>';
    html += '<div class="dash-hero-stats">';
    html += '<div class="dash-hero-s"><strong>' + allTotal + '</strong><span>总题</span></div>';
    html += '<div class="dash-hero-s"><strong>' + allAnswered + '</strong><span>已答</span></div>';
    html += '<div class="dash-hero-s"><strong>' + allCorrect + '</strong><span>正确</span></div>';
    html += '<div class="dash-hero-s"><strong>' + (allAnswered - allCorrect) + '</strong><span>错误</span></div>';
    html += '</div></div>';

    html += '<div class="wrong-ch-grid">';
    chKeys.forEach(function (ch) {
      var chQs = byCh[ch];
      var total = chQs.length, answered = 0, correct = 0;
      chQs.forEach(function (q) {
        if (S.answers[q.id]) { answered++; if (S.results[q.id]) correct++; }
      });
      var wrong = answered - correct;
      var pct = total > 0 ? Math.round(answered / total * 100) : 0;
      var done = answered === total;

      html += '<div class="wrong-ch-card" style="border-top-color:var(--p)" onclick="App.goChapter(\'' + ch + '\')">';
      html += '<div class="wrong-ch-hd">';
      html += '<span class="wrong-ch-icon">📖</span>';
      html += '<span class="wrong-ch-name">' + chName(ch) + '</span>';
      html += '<span class="ch-badge' + (done ? ' done' : '') + '">' + answered + '/' + total + '</span>';
      html += '</div>';
      html += '<div class="wrong-ch-stats">';
      html += '<div class="wrong-ch-stat"><span class="wrong-ch-stat-num">' + total + '</span><span class="wrong-ch-stat-lbl">总题</span></div>';
      html += '<div class="wrong-ch-stat"><span class="wrong-ch-stat-num">' + correct + '</span><span class="wrong-ch-stat-lbl">正确</span></div>';
      html += '<div class="wrong-ch-stat"><span class="wrong-ch-stat-num" style="color:' + (wrong > 0 ? 'var(--rd)' : 'var(--gr)') + '">' + wrong + '</span><span class="wrong-ch-stat-lbl">错误</span></div>';
      html += '</div>';
      html += '<div class="wrong-ch-bar-wrap"><div class="wrong-ch-bar">';
      html += '<div class="wrong-ch-bar-fill correct" style="width:' + pct + '%"></div>';
      html += '<div class="wrong-ch-bar-fill" style="width:' + (100 - pct) + '%;background:var(--bg2)"></div>';
      html += '</div></div>';
      html += '<div class="wrong-ch-ft"><span>已答 ' + answered + '/' + total + '</span>';
      if (correct > 0) html += '<span style="color:var(--gr)">正确 ' + correct + '</span>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div></div>';
    return html;
  }

  // ── 大题章节网格卡片（type mode 下 chapter='all' 时展示）──
  function renderBQChapterGrid() {
    var qs = getQs();
    if (!qs.length) return '<div class="empty"><p>暂无题目</p></div>';

    var modeIcon = '', modeLabel = '';
    TYPES.forEach(function (t) {
      if (S.mode === t.mode) { modeIcon = t.icon; modeLabel = t.label; }
    });

    // 按章节分组
    var byCh = {};
    qs.forEach(function (q) {
      if (!byCh[q.chapter]) byCh[q.chapter] = [];
      byCh[q.chapter].push(q);
    });
    var chKeys = Object.keys(byCh).sort();

    var allTotal = qs.length;
    var allMem = 0;
    qs.forEach(function (q) { if (S.bqProg[q.id] && S.bqProg[q.id].memorized) allMem++; });

    var html = '<div class="dash">';
    // Hero
    html += '<div class="dash-hero" style="background:linear-gradient(135deg,var(--p),var(--p2))">';
    html += '<div class="dash-hero-icon">' + modeIcon + '</div><h2>' + modeLabel + '</h2>';
    html += '<p>共 ' + allTotal + ' 题 · 已记住 ' + allMem + '/' + allTotal + '</p>';
    html += '</div>';

    // 过滤开关
    html += '<div style="text-align:right;margin-bottom:12px">';
    html += '<label class="bq-filter" style="display:inline-flex;align-items:center;gap:5px;font-size:.82rem;cursor:pointer;user-select:none">';
    html += '<input type="checkbox" onchange="App.toggleBQFilter()"' + (S.bqFilter ? ' checked' : '') + '> 仅看未记住';
    html += '</label></div>';

    // 网格卡片
    html += '<div class="wrong-ch-grid">';
    chKeys.forEach(function (ch) {
      var chQs = byCh[ch];
      var total = chQs.length;
      var memorized = 0;
      chQs.forEach(function (q) { if (S.bqProg[q.id] && S.bqProg[q.id].memorized) memorized++; });
      var pct = total > 0 ? Math.round(memorized / total * 100) : 0;
      var done = memorized === total;

      html += '<div class="wrong-ch-card" onclick="App.goChapter(\'' + ch + '\')">';
      html += '<div class="wrong-ch-hd">';
      html += '<span class="wrong-ch-icon">📖</span>';
      html += '<span class="wrong-ch-name">' + chName(ch) + '</span>';
      html += '<span class="ch-badge' + (done ? ' done' : '') + '">' + memorized + '/' + total + '</span>';
      html += '</div>';
      // 三列统计
      html += '<div class="wrong-ch-stats">';
      html += '<div class="wrong-ch-stat"><span class="wrong-ch-stat-num">' + total + '</span><span class="wrong-ch-stat-lbl">总题</span></div>';
      html += '<div class="wrong-ch-stat"><span class="wrong-ch-stat-num">' + memorized + '</span><span class="wrong-ch-stat-lbl">已记住</span></div>';
      html += '<div class="wrong-ch-stat"><span class="wrong-ch-stat-num" style="color:' + (pct >= 70 ? 'var(--gr)' : 'var(--yw)') + '">' + pct + '%</span><span class="wrong-ch-stat-lbl">记忆率</span></div>';
      html += '</div>';
      // 进度条
      html += '<div class="wrong-ch-bar-wrap"><div class="wrong-ch-bar">';
      html += '<div class="wrong-ch-bar-fill correct" style="width:' + pct + '%"></div>';
      html += '<div class="wrong-ch-bar-fill" style="width:' + (100 - pct) + '%;background:var(--bg2)"></div>';
      html += '</div></div>';
      html += '<div class="wrong-ch-ft"><span>已记住 ' + memorized + '/' + total + '</span></div>';
      html += '</div>';
    });
    html += '</div></div>';
    return html;
  }

  // ── 大题列表卡片（按章节展示全部题目，可滚动）──
  function renderBQListView() {
    var qs = getQs();
    if (!qs.length) return '<div class="empty"><p>暂无题目</p></div>';

    var typeLabel = '';
    var icons = { '填空': '📝', '简答': '📄', '计算': '🔢' };
    TYPES.forEach(function (t) {
      if (S.mode === t.mode) typeLabel = t.icon + ' ' + t.label;
    });

    var html = '<div class="bq-list">';
    // 顶栏：返回 + 过滤开关
    html += '<div class="bq-list-bar">';
    html += '<span>' + (S.chapter && S.chapter !== 'all' ? '<a href="#" class="bq-back-link" onclick="App.goBQOverview();return false">← 返回目录</a> · ' : '') + typeLabel + ' · 共 ' + qs.length + ' 题</span>';
    html += '<label class="bq-filter" style="display:inline-flex;align-items:center;gap:5px;font-size:.82rem;cursor:pointer;user-select:none">';
    html += '<input type="checkbox" onchange="App.toggleBQFilter()"' + (S.bqFilter ? ' checked' : '') + '> 仅看未记住';
    html += '</label>';
    html += '</div>';

    qs.forEach(function (q) {
      var ic = icons[q.type] || '📄';
      var revealed = _bqRevealedMap[q.id] || false;
      var mem = S.bqProg[q.id] && S.bqProg[q.id].memorized;

      html += '<div class="bq-list-card" id="bq-' + q.id + '">';
      // 卡片头：章节、题型、收藏、记忆状态
      html += '<div class="bq-list-hd">';
      html += '<span class="tag tag-i">' + chName(q.chapter) + '</span>';
      html += '<span class="tag tag-p">' + ic + ' ' + (q.type || '') + '</span>';
      if (S.wrongSet.has(q.id)) html += '<span class="tag tag-d">错题</span>';
      html += '<button class="bm-btn" onclick="App.toggleBM(\'' + q.id + '\')">';
      html += isBookmarked(q) ? '⭐' : '☆';
      html += '</button>';
      if (mem) html += '<span class="bq-list-mem">✅ 已记住</span>';
      html += '</div>';
      // 题目正文
      html += '<div class="bq-list-q">' + escapeHtml(q.question) + '</div>';
      if (q.image) {
        html += '<div class="q-img-wrap"><img class="q-img" src="' + escapeHtml(q.image) + '" alt="题目附图" loading="lazy" onerror="this.style.display=&quot;none&quot;"></div>';
      }
      // 答案区
      if (!revealed) {
        html += '<div style="text-align:center;margin-top:16px"><button class="btn btn-p" onclick="App.revealBQ(\'' + q.id + '\')">显示答案</button></div>';
      } else {
        html += '<div class="bq-list-a"><div class="bq-list-a-label">✅ 参考答案</div>';
        html += '<div class="bq-list-a-content">' + escapeHtml(getBQAnswerText(q)) + '</div></div>';
      }
      // 底部操作
      html += '<div class="bq-list-actions">';
      html += '<button class="btn btn-sm ' + (mem ? 'btn-s' : 'btn-p') + '" onclick="App.markBQ(\'' + q.id + '\')">';
      html += mem ? '✅ 已记住' : '📌 标记已记住';
      html += '</button>';
      html += '</div>';
      html += '</div>';
    });

    html += '</div>'; // close bq-list
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

  // ── 错题本概览（网格卡片，每章一张卡片）──
  function renderWrongOverview() {
    var ids = Array.from(rSet());
    if (!ids.length) {
      var msg = S.mode === 'wrong' ? '暂无错题 🎉' : '暂无收藏 ⭐';
      return '<div class="empty"><p>' + msg + '</p><button class="btn btn-p" onclick="App.home()" style="margin-top:12px">返回首页</button></div>';
    }
    // 按章节+类型分组（同时过滤已不存在的题目 ID）
    var byChapterType = {};
    var validCount = 0;
    ids.forEach(function (id) {
      var q = (QUESTIONS || []).find(function (x) { return x.id === id; });
      if (!q) return;
      validCount++;
      if (!byChapterType[q.chapter]) byChapterType[q.chapter] = { single: [], multiple: [] };
      var t = q.type === 'single' ? 'single' : 'multiple';
      byChapterType[q.chapter][t].push(q);
    });
    if (!validCount) {
      var msg = S.mode === 'wrong' ? '暂无错题 🎉' : '暂无收藏 ⭐';
      return '<div class="empty"><p>' + msg + '</p><button class="btn btn-p" onclick="App.home()" style="margin-top:12px">返回首页</button></div>';
    }
    var chKeys = Object.keys(byChapterType).sort();
    var isBm = S.mode === 'bookmark';
    var bg = isBm ? 'linear-gradient(135deg,#f39c12,#e67e22)' : 'linear-gradient(135deg,var(--rd),#c0392b)';
    var icon = isBm ? '⭐' : '❌';
    var title = isBm ? '收藏题目' : '错题本';
    var suffix = isBm ? '道收藏' : '道错题';
    var html = '<div class="dash">';
    html += '<div class="dash-hero" style="background:' + bg + '">';
    html += '<div class="dash-hero-icon">' + icon + '</div><h2>' + title + '</h2><p>共 <strong>' + validCount + '</strong> ' + suffix + '</p>';

    // 在 hero 区直接放自测按钮，保证始终可见
    html += '<div style="margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn" style="background:rgba(255,255,255,.2);color:#fff;font-size:.9rem;padding:10px 28px;border:1px solid rgba(255,255,255,.3)" onclick="event.stopPropagation();App.openWrongDlg()">🎯 开始自测</button>';
    html += '<button class="btn" style="background:rgba(255,255,255,.15);color:#fff;font-size:.9rem;padding:10px 28px;border:1px solid rgba(255,255,255,.3)" onclick="event.stopPropagation();App.showTestHistory()">📊 自测历史</button></div>';

    html += '</div>'; // close dash-hero

    // 网格卡片：每章一张
    html += '<div class="wrong-ch-grid">';
    chKeys.forEach(function (ch) {
      var chData = byChapterType[ch];
      var singleQs = chData.single || [], multiQs = chData.multiple || [];
      var chTotal = singleQs.length + multiQs.length;

      // 计算该章整体正确率（基于所有答题记录）
      var allChQs = getAll().filter(function (q) { return q.chapter === ch; });
      var answered = 0, correct = 0;
      allChQs.forEach(function (q) {
        if (S.answers[q.id]) { answered++; if (S.results[q.id]) correct++; }
      });
      var correctRate = answered > 0 ? Math.round(correct / answered * 100) : 0;
      var wrongRate = answered > 0 ? Math.round((answered - correct) / answered * 100) : 0;

      html += '<div class="wrong-ch-card" onclick="App.goRetryChapter(\'' + ch + '\')">';
      // 卡片头：章节名 + 错题数徽标
      html += '<div class="wrong-ch-hd">';
      html += '<span class="wrong-ch-icon">📖</span>';
      html += '<span class="wrong-ch-name">' + chName(ch) + '</span>';
      html += '<span class="wrong-ch-badge">' + chTotal + ' ' + suffix.replace('道','') + '</span>';
      html += '</div>';
      // 三列统计数据：单选错 / 多选错 / 章节正确率
      html += '<div class="wrong-ch-stats">';
      html += '<div class="wrong-ch-stat"><span class="wrong-ch-stat-num">' + singleQs.length + '</span><span class="wrong-ch-stat-lbl">单选错</span></div>';
      html += '<div class="wrong-ch-stat"><span class="wrong-ch-stat-num">' + multiQs.length + '</span><span class="wrong-ch-stat-lbl">多选错</span></div>';
      html += '<div class="wrong-ch-stat"><span class="wrong-ch-stat-num" style="color:' + (correctRate >= 70 ? 'var(--gr)' : 'var(--rd)') + '">' + correctRate + '%</span><span class="wrong-ch-stat-lbl">正确率</span></div>';
      html += '</div>';
      // 双进度条：绿色正确 / 红色错误
      html += '<div class="wrong-ch-bar-wrap">';
      html += '<div class="wrong-ch-bar"><div class="wrong-ch-bar-fill correct" style="width:' + correctRate + '%"></div><div class="wrong-ch-bar-fill wrong" style="width:' + wrongRate + '%"></div></div>';
      html += '</div>';
      // 卡片脚：章节总题数
      html += '<div class="wrong-ch-ft"><span>共 ' + allChQs.length + ' 题</span><span>错 ' + chTotal + ' 题</span></div>';
      html += '</div>';
    });
    html += '</div>'; // close wrong-ch-grid

    html += '</div>'; // close dash
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

    // 自测结果弹窗
    if (S.showTestResult && _activeTest === null && _history.length) {
      var last = _history[0];
      var pct = last.total > 0 ? Math.round(last.correct / last.total * 100) : 0;
      var duration = Math.round((last.completedAt - last.startedAt) / 1000);
      var min = Math.floor(duration / 60), sec = duration % 60;
      var grade = pct >= 90 ? 'A' : pct >= 75 ? 'B' : pct >= 60 ? 'C' : pct >= 40 ? 'D' : 'F';
      var gradeCls = 'grade-' + grade.toLowerCase();
      var gradeColors = {A:'var(--gr)',B:'var(--p)',C:'var(--yw)',D:'#e67e22',F:'var(--rd)'};
      var gradeText = pct >= 90 ? '优秀' : pct >= 75 ? '良好' : pct >= 60 ? '及格' : pct >= 40 ? '需努力' : '加油';
      html += '<div class="modal-overlay" onclick="App.closeTestResult()"><div class="modal-dlg test-rst" onclick="event.stopPropagation()">';
      html += '<div class="test-rst-hd" style="background:' + (gradeColors[grade] || 'var(--p)') + ';color:#fff;padding:24px 20px;text-align:center;border-radius:var(--rl) var(--rl) 0 0">';
      html += '<div class="test-rst-grade ' + gradeCls + '" style="font-size:3rem;font-weight:800">' + grade + '</div>';
      html += '<div style="font-size:.9rem;opacity:.9;margin-top:4px">' + gradeText + '</div>';
      html += '<div style="font-size:2rem;font-weight:700;margin-top:8px">' + pct + '%</div>';
      html += '</div>';
      html += '<div class="test-rst-body" style="padding:20px">';
      html += '<div class="test-rst-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">';
      html += '<div class="test-rst-item" style="text-align:center;padding:12px;background:var(--bg);border-radius:var(--r)"><div style="font-size:1.3rem;font-weight:700;color:var(--t)">' + last.total + '</div><div style="font-size:.72rem;color:var(--t3)">总题</div></div>';
      html += '<div class="test-rst-item" style="text-align:center;padding:12px;background:var(--grb);border-radius:var(--r)"><div style="font-size:1.3rem;font-weight:700;color:var(--gr)">' + last.correct + '</div><div style="font-size:.72rem;color:var(--t3)">正确</div></div>';
      html += '<div class="test-rst-item" style="text-align:center;padding:12px;background:var(--rdb);border-radius:var(--r)"><div style="font-size:1.3rem;font-weight:700;color:var(--rd)">' + (last.total - last.correct) + '</div><div style="font-size:.72rem;color:var(--t3)">错误</div></div>';
      html += '</div>';
      html += '<div class="test-rst-info" style="font-size:.82rem;color:var(--t2);text-align:center">用时：' + min + '分' + sec + '秒';
      html += ' · ' + (last.chapter === 'all' ? '全部章节' : chName(last.chapter));
      html += ' · ' + (last.order === 'shuffle' ? '乱序' : '顺序');
      html += '</div></div>';
      html += '<div class="modal-ft"><button class="btn btn-p" onclick="App.closeTestResult()">查看详情</button>';
      html += '<button class="btn btn-o" onclick="App.showTestHistory()">查看历史</button></div></div></div>';
    }

    // 自测历史弹窗
    if (S.showHistory && !S.showTestResult) {
      html += '<div class="modal-overlay" onclick="App.closeTestHistory()"><div class="modal-dlg test-hist" onclick="event.stopPropagation()" style="max-width:520px">';
      html += '<div class="modal-hd">📊 自测历史<span class="modal-x" onclick="App.closeTestHistory()">✕</span></div>';
      html += '<div class="modal-bd" style="max-height:60vh;overflow-y:auto;padding:12px 16px">';
      if (!_history.length) {
        html += '<div style="text-align:center;padding:30px;color:var(--t3)">暂无自测记录</div>';
      } else {
        html += '<table style="width:100%;border-collapse:collapse;font-size:.82rem">';
        html += '<thead><tr style="border-bottom:2px solid var(--bd);font-size:.72rem;color:var(--t3);text-transform:uppercase">';
        html += '<th style="padding:6px 8px;text-align:left">日期</th><th style="padding:6px 8px;text-align:center">总题</th><th style="padding:6px 8px;text-align:center">正确</th><th style="padding:6px 8px;text-align:center">正确率</th><th style="padding:6px 8px;text-align:center">用时</th></tr></thead><tbody>';
        _history.forEach(function(rec) {
          var p = rec.total > 0 ? Math.round(rec.correct / rec.total * 100) : 0;
          var d = Math.round(((rec.completedAt || rec.startedAt) - rec.startedAt) / 1000);
          var m = Math.floor(d / 60), s = d % 60;
          var dt = new Date(rec.startedAt);
          var ds = dt.getFullYear() + '-' + ('0'+(dt.getMonth()+1)).slice(-2) + '-' + ('0'+dt.getDate()).slice(-2) + ' ' + ('0'+dt.getHours()).slice(-2) + ':' + ('0'+dt.getMinutes()).slice(-2);
          var status = rec.completedAt ? '' : ' (未完成)';
          var clr = rec.completedAt ? '' : ';opacity:.6';
          html += '<tr style="border-bottom:1px solid var(--bd)' + clr + '" onclick="App.viewTestHistory(\'' + rec.id + '\')">';
          html += '<td style="padding:8px;text-align:left">' + ds + status + '</td>';
          html += '<td style="padding:8px;text-align:center">' + rec.total + '</td>';
          html += '<td style="padding:8px;text-align:center;color:var(--gr)">' + rec.correct + '</td>';
          html += '<td style="padding:8px;text-align:center;font-weight:600;color:' + (p >= 60 ? 'var(--gr)' : 'var(--rd)') + '">' + p + '%</td>';
          html += '<td style="padding:8px;text-align:center">' + m + '\' ' + s + '"</td>';
          html += '</tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';
      html += '<div class="modal-ft"><button class="btn btn-o" onclick="App.closeTestHistory()">关闭</button>';
      html += '<button class="btn btn-d btn-sm" onclick="App.clearTestHistory()">清空历史</button></div></div></div>';
    }

    return html;
  }

  // ── 答题卡 ──
  function renderSheet() {
    var panel = document.getElementById('sheetPanel');
    if (!S.showSheet) { panel.classList.remove('open'); return; }
    var qs = getQs();
    if (!qs.length || S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') { panel.classList.remove('open'); return; }
    if (!(S.mode === 'mcq' || S.mode === 'random' || S.mode === 'wrong' || S.mode === 'bookmark')) { panel.classList.remove('open'); return; }
    panel.classList.add('open');
    var html = '';
    qs.forEach(function (q, i) {
      var cls = 'sh-cell' + (i === S.idx ? ' cur' : '');
      var a, r;
      if (isRetry() && !_retryActive) {
        // 查看模式：用原始答案
        a = S.answers[q.id];
        r = S.results[q.id];
      } else if (isEphemeral()) {
        a = _rdAns[q.id];
        r = _rdRes[q.id];
      } else if (isRetry()) {
        // 自测模式：用临时答案
        a = rAnsObj()[q.id];
        r = rResObj()[q.id];
      } else {
        a = S.answers[q.id];
        r = S.results[q.id];
      }
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
    else if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') {
      content = (S.chapter === 'all' && !S._bmQs) ? renderBQChapterGrid() : renderBQListView();
    } else if (S.mode === 'bookmark') content = S.chapter === 'all' ? renderBookmarkOverview() : renderQuestionView();
    else if (S.mode === 'wrong') content = S.chapter === 'all' ? renderWrongOverview() : renderQuestionView();
    else if (S.mode === 'mcq') content = (S.chapter === 'all' && !S._bmQs) ? renderMCQChapterGrid() : renderQuestionView();
    else if (S.mode === 'random') content = renderQuestionView();
    else content = '<div class="empty"><p>选择题型开始学习</p></div>';
    document.getElementById('contentArea').innerHTML = content;

    document.getElementById('contentFooter').innerHTML =
      (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc' || (S.mode === 'mcq' && S.chapter === 'all' && !S._bmQs))
        ? '<span>共 ' + Math.max(total(), 1) + ' 题</span><span>' + modeName + '</span>'
        : '<span>第 ' + (S.idx + 1) + '/' + Math.max(total(), 1) + ' 题</span><span>' + modeName + '</span>';

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
    _bqRevealedMap = {};
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
    _bqRevealedMap = {};
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
    _bqRevealedMap = {};
    S._bmQs = null;
    S.mode = 'dashboard'; S.chapter = 'all'; S.idx = 0; S.showSheet = false; S.bqRevealed = false; render();
  };

  App.startType = function (mode) {
    navPush();
    syncRetryToPerm();
    _retryActive = false;
    _rdAns = {}; _rdRes = {};
    _bqRevealedMap = {};
    S._bmQs = null;
    S.mode = mode; S.chapter = 'all'; S.idx = 0; S.showSheet = false; S.bqFilter = false; S._bqFilteredQs = null; render();
  };

  App.goBQOverview = function () {
    navPush();
    _bqRevealedMap = {};
    S.chapter = 'all'; S.idx = 0; render();
  };

  App.goChapter = function (ch) {
    if (S._bmQs) S._bmQs = null;
    if (S.mode === 'wrong') { App.goRetryChapter(ch); return; }
    if (S.mode === 'bookmark') { App.showBookmarks(); return; }
    navPush();
    if (!isTypeMode(S.mode)) S.mode = 'mcq';
    S.chapter = ch;
    _bqRevealedMap = {};
    var qs = getQs(); S.idx = 0;
    if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') {
      // list view — idx unused
    } else {
      for (var i = 0; i < qs.length; i++) { if (!S.answers[qs[i].id]) { S.idx = i; break; } }
    }
    S.showSheet = false; S.bqRevealed = false; S._bqFilteredQs = null; S.bqFilter = false; render();
  };

  App.setMode = function (m) {
    S.showSheet = false; S.bqRevealed = false;
    syncRetryToPerm();
    _retryActive = false;
    _bqRevealedMap = {};
    if (m === 'wrong') { App.startWrong(); return; }
    if (m === 'random') { S.showRandomDlg = true; render(); return; }

    S.mode = m; S.idx = 0; render();
  };

  App.next = function () {
    var n = total(); if (!n) return;
    // 按章节模式：最后一题跳到下一章第一题
    if (S.chapter && S.chapter !== 'all' && S.chapter !== '_all' && isTypeMode(S.mode) && S.idx >= n - 1) {
      var chs = CHAPTERS, curIdx = chs.indexOf(S.chapter);
      if (curIdx >= 0) {
        for (var ci = curIdx + 1; ci < chs.length; ci++) {
          var nextQs = getQsForChapter(chs[ci]);
          if (nextQs.length > 0) { S.chapter = chs[ci]; S.idx = 0;
            if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') S.bqRevealed = false;
            updateProgress(); render(); return; }
        }
      }
    }
    if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') { S.idx = (S.idx + 1) % n; S.bqRevealed = false; }
    else S.idx = (S.idx + 1) % n;
    updateProgress();
    render();
  };

  App.prev = function () {
    var n = total(); if (!n) return;
    // 按章节模式：第一题跳到上一章最后一题
    if (S.chapter && S.chapter !== 'all' && S.chapter !== '_all' && isTypeMode(S.mode) && S.idx <= 0) {
      var chs = CHAPTERS, curIdx = chs.indexOf(S.chapter);
      if (curIdx >= 0) {
        for (var ci = curIdx - 1; ci >= 0; ci--) {
          var prevQs = getQsForChapter(chs[ci]);
          if (prevQs.length > 0) { S.chapter = chs[ci]; S.idx = prevQs.length - 1;
            if (S.mode === 'fill' || S.mode === 'essay' || S.mode === 'calc') S.bqRevealed = false;
            updateProgress(); render(); return; }
        }
      }
    }
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
        persistActiveTest();
        if (!checkTestCompletion()) render();
        return;
      } else if (isEph) {
        _rdAns[q.id] = ans; _rdRes[q.id] = cor;
        if (!cor) { S.wrongSet.add(q.id); save(); toast('❌ 已加入错题本', 'warning'); }
        render(); return;
      } else {
        S.answers[q.id] = ans; S.results[q.id] = cor;
        if (cor) { S.wrongSet.delete(q.id); toast('✅ 已从错题本移出', 'success'); }
        else { S.wrongSet.add(q.id); toast('❌ 已加入错题本', 'warning'); }
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
    if (!isWr && !isEph) { if (ok) { S.wrongSet.delete(q.id); toast('✅ 已从错题本移出', 'success'); } else { S.wrongSet.add(q.id); toast('❌ 已加入错题本', 'warning'); } save(); }
    if (isEph && !ok) { S.wrongSet.add(q.id); save(); toast('❌ 已加入错题本', 'warning'); }
    if (!isEph) updateProgress();
    if (isWr) {
      persistActiveTest();
      if (checkTestCompletion()) return;
    }
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
    // 创建自测记录
    createTestRecord(pool, chapter, order);
    // 开启计时心跳（每10秒持久化一次）
    if (_testTimerId) clearInterval(_testTimerId);
    _testTimerId = setInterval(function() {
      if (_activeTest) persistActiveTest();
    }, 10000);
    S.mode = 'wrong';
    S.chapter = chapter === 'all' ? '_all' : chapter;
    S.idx = 0; S.showWrongDlg = false; render();
  };

  App.removeFromRetry = function (qId) {
    if (_wrAns[qId] !== undefined) { S.answers[qId] = _wrAns[qId]; S.results[qId] = _wrRes[qId]; }
    if (_bmAns[qId] !== undefined) { S.answers[qId] = _bmAns[qId]; S.results[qId] = _bmRes[qId]; }
    rSet().delete(qId);
    var _removedFrom = S.mode === 'bookmark' ? '收藏' : '错题本';
    toast('✅ 已从' + _removedFrom + '移出', 'success');
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
    if (typeMode !== 'mcq') {
      // 收藏模式下默认所有题目答案展开
      qs.forEach(function (q) { _bqRevealedMap[q.id] = true; });
    }
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

  App.revealBQ = function (qId) {
    _bqRevealedMap[qId] = true;
    S.bqProg[qId] = S.bqProg[qId] || {};
    S.bqProg[qId].viewed = true;
    save();
    render();
  };

  App.markBQ = function (qId) {
    S.bqProg[qId] = S.bqProg[qId] || {};
    S.bqProg[qId].memorized = !S.bqProg[qId].memorized;
    S.bqProg[qId].viewed = true;
    save();
    render();
  };

  App.toggleBQFilter = function () {
    S.bqFilter = !S.bqFilter;
    if (S.bqFilter) {
      var type = _typeMap[S.mode];
      var all = getBQByType(type);
      if (S.chapter && S.chapter !== 'all') all = all.filter(function (q) { return q.chapter === S.chapter; });
      var filtered = all.filter(function (q) { var p = S.bqProg[q.id] || {}; return !p.memorized; });
      if (!filtered.length) { toast('全部已记住！', 'success'); S.bqFilter = false; render(); return; }
      S._bqFilteredQs = filtered;
    } else { S._bqFilteredQs = null; }
    render();
  };

  // ── 自测历史 ──
  App.closeTestResult = function () {
    S.showTestResult = false;
    render();
  };
  App.showTestHistory = function () {
    S.showTestResult = false;
    S.showHistory = true;
    render();
  };
  App.closeTestHistory = function () {
    S.showHistory = false;
    render();
  };
  App.viewTestHistory = function (recId) {
    var rec = _history.find(function(r) { return r.id === recId; });
    if (!rec) { toast('记录不存在', 'warning'); return; }
    // 显示单个自测记录结果
    S.showHistory = false;
    // 推送一个临时结果弹窗
    _history = _history.filter(function(r) { return r.id !== rec.id; });
    _history.unshift(rec);
    LS.setItem(K.hist, JSON.stringify(_history));
    S.showTestResult = true;
    render();
  };
  App.clearTestHistory = function () {
    if (!confirm('确定清空所有自测历史记录？')) return;
    _history = [];
    LS.setItem(K.hist, JSON.stringify([]));
    toast('已清空自测历史', 'success');
    S.showHistory = false;
    render();
  };
  App.resumeTest = function () {
    var raw = LS.getItem(K.atest);
    if (!raw) { toast('没有未完成的自测', 'warning'); return; }
    try {
      var rec = JSON.parse(raw);
      navPush();
      if (resumeActiveTest(rec)) {
        S.showSheet = false;
      }
    } catch(e) { toast('恢复失败', 'error'); }
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

  // ── 答案修正后重判：由 editor.js 调用 ──
  App.reevaluate = function (qId) {
    var q = getAll().find(function (x) { return x.id === qId; }) ||
            getBQ().find(function (x) { return x.id === qId; });
    if (!q) return null;

    var userAns = S.answers[qId];
    if (!userAns || !userAns.length) return null;

    var oldResult = S.results[qId];
    var newResult;

    if (q.options && q.options.length > 0) {
      var userSorted = (userAns || []).slice().sort();
      var ansRef = Array.isArray(q.answer) ? q.answer.slice() : String(q.answer).split('').filter(function (c) { return c.trim(); });
      var correctSorted = ansRef.sort();
      newResult = userSorted.length === correctSorted.length &&
                  userSorted.every(function (v, i) { return v === correctSorted[i]; });
    } else {
      return null; // 大题无自动判分
    }

    if (oldResult === newResult) return { oldResult: oldResult, newResult: newResult, changed: false };

    S.results[qId] = newResult;

    if (oldResult === false && newResult === true) {
      if (S.wrongSet.has(qId)) {
        S.wrongSet.delete(qId);
        toast('✅ 答案修正后回答变正确，已移出错题本', 'success');
      }
    } else if (oldResult === true && newResult === false) {
      if (!S.wrongSet.has(qId)) {
        S.wrongSet.add(qId);
        toast('⚠️ 答案修正后原回答变错误，已加入错题本', 'warning');
      }
    }

    save();
    render();
    return { oldResult: oldResult, newResult: newResult, changed: true };
  };

  App.render = render;
  window.App = App;

  // ════════════════════════════════════════════════════════════
  //  初始化
  // ════════════════════════════════════════════════════════════

  document.addEventListener('DOMContentLoaded', function () {
    // 启动时同步错题本：清理孤立 ID，并从已有答题结果中重建错题
    (function syncWrongSet() {
      var allIds = {};
      (QUESTIONS || []).forEach(function (q) { allIds[q.id] = true; });
      (BIG_QUESTIONS || []).forEach(function (q) { allIds[q.id] = true; });
      var dirty = false;
      // 1. 移除 wrongSet / bookmarks 中已不存在的题目 ID
      S.wrongSet.forEach(function (id) { if (!allIds[id]) { S.wrongSet.delete(id); dirty = true; } });
      S.bookmarks.forEach(function (id) { if (!allIds[id]) { S.bookmarks.delete(id); dirty = true; } });
      // 2. 扫描所有答题结果：答错的题目自动加入错题本
      Object.keys(S.results).forEach(function (id) {
        if (allIds[id] && S.results[id] === false && !S.wrongSet.has(id)) {
          S.wrongSet.add(id); dirty = true;
        }
      });
      // 3. 如果错题本中有 ID 在答题记录里显示已答对，则移除（用户后来答对了但未清除）
      S.wrongSet.forEach(function (id) {
        if (S.results[id] === true && allIds[id]) { S.wrongSet.delete(id); dirty = true; }
      });
      if (dirty) save();
    })();

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

    // 检查未完成的自测
    var rawAtest = LS.getItem(K.atest);
    if (rawAtest) {
      try {
        var savedTest = JSON.parse(rawAtest);
        if (savedTest && savedTest.qIds && savedTest.qIds.length && savedTest.answered < savedTest.total) {
          // 不自动恢复，但渲染时显示恢复横幅
        }
      } catch(e) {}
    }

    try { render(); } catch (e) { console.error('render error:', e); }
  });

})();
