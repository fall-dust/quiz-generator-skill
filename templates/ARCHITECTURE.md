# Quiz Generator — 原生 JS 架构参考

## 加载时序

### 默认（零依赖）

```
<script> 加载顺序:
  1. questions.js      → 定义 var QUESTIONS = [...]
  2. bigquestions.js   → 定义 var BIG_QUESTIONS = [...]
  3. app.js            → IIFE 立即执行, 注册 window.App, 绑定 DOMContentLoaded
  4. editor.js         → IIFE 立即执行, 应用答案覆盖, 注册 window.Editor

DOMContentLoaded 触发:
  1. app.js:   render() → innerHTML 填充各个容器
  2. editor.js: createSidebarUI() → 注入编辑管理区块
                startObserver()   → 监听内容变化注入编辑按钮

关键: 数据文件必须先加载, editor.js 在 app.js 之后加载以覆盖已规范化的答案。
```

### 引入第三方库（本地优先 + CDN 回退）

在 `index.html` 底部（`</body>` 前）插入 `<script>` 标签：

```html
<script src="js/questions.js"></script>
<script src="js/bigquestions.js"></script>

<!-- 第三方库：本地优先，不存在时自动从 CDN 回退 -->
<script src="js/lib/chart.umd.min.js"
        onerror="this.outerHTML='<script src=\'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js\'><\/script>'"></script>

<script src="js/app.js"></script>
<script src="js/editor.js"></script>
```

运行 `python js/lib/download-libs.py` 可将所有第三方库预下载到本地，离线可用。

## 应用状态 (S 对象)

```
├── mode, chapter, idx          — 视图状态 (mode: dashboard|mcq|fill|essay|calc|random|exam|wrong)
├── answers, results            — 选择题答题数据 (per ID)
├── bookmarks, wrongSet         — 集合类
├── bqRevealed, bqProg          — 大题状态 (per ID, {viewed, memorized})
├── showSheet, bqFilter         — UI 开关
├── examLeft, _timer            — 考试状态
├── _randomQs, _examQs          — 临时数据
├── _bqFilteredQs               — 大题"仅看未记住"过滤
├── showRandomDlg, showExamDlg  — 弹窗状态
└── randomCount, randomType     — 配置
```

## 四种题型独立设计

四种题型完全独立，数据隔离、进度隔离：

| 题型 | mode值 | 数据过滤 | 进度追踪 |
|------|--------|---------|---------|
| 选择题 | mcq | `QUESTIONS[chapter==ch]` | `answers[qid]` + `results[qid]` |
| 填空题 | fill | `BIG_QUESTIONS[type=='填空'][chapter==ch]` | `bqProg[qid].viewed/memorized` |
| 简答题 | essay | `BIG_QUESTIONS[type=='简答'][chapter==ch]` | `bqProg[qid].viewed/memorized` |
| 计算题 | calc | `BIG_QUESTIONS[type=='计算'][chapter==ch]` | `bqProg[qid].viewed/memorized` |

**核心函数 `getQs()`** 根据 `S.mode` 选择数据源：

```
mode=mcq  → getAll().filter(by chapter)
mode=fill → getBQByType('填空').filter(by chapter)
mode=essay→ getBQByType('简答').filter(by chapter)
mode=calc → getBQByType('计算').filter(by chapter)
```

**侧边栏交互：**
- 侧边栏题型按钮 (`typeBtn_mcq` / `typeBtn_fill` / `typeBtn_essay` / `typeBtn_calc`) 切换 mode
- 点击后章节按钮显示该题型的进度角标
- `chStats(ch)` 根据当前 mode 委派到 `mcqStats()` 或 `bqTypeStats()`
- `badgeText(ch)` 动态反映当前题型进度

## 模块划分

```
┌─ app.js ─────────────────────────────────────┐
│                                               │
│  IIFE 闭包区域:                                │
│  ├── 状态 S { ... }                           │
│  ├── 工具函数 getAll/getBQ/shuffle/chName     │
│  ├── 统计函数 chStats/allStats/bqStats       │
│  ├── 视图函数 → 返回 HTML 字符串               │
│  │   ├── renderDashboard()                   │
│  │   ├── renderQuestionView()                │
│  │   ├── renderBQView()                      │
│  │   ├── renderSheet()                       │
│  │   ├── renderModals()                      │
│  │   └── renderToast()                       │
│  ├── 主渲染 render() → innerHTML             │
│                                               │
│  window.App = { ... }  // 全局操作接口        │
│  ├── 导航: goChapter/setMode/next/prev        │
│  ├── 答题: pick/confirmMC/toggleBM            │
│  ├── 错题: startWrong/removeFromRetry         │
│  ├── 重判: reevaluate(qId)                   │
│  ├── 渲染: render()                           │
│  ├── 随机: startRandom                        │
│  ├── 大题: revealBQ/markBQ/toggleBQFilter     │
│  └── UI: toggleSheet/toggleTheme/clearData    │
│                                               │
│  DOMContentLoaded → 事件绑定 → render()       │
└───────────────────────────────────────────────┘

┌─ editor.js ──────────────────────────────────┐
│                                               │
│  IIFE 闭包区域:                                │
│  ├── Overrides — 答案覆盖层 (localStorage)    │
│  ├── applyAllOverrides() — 启动时注入         │
│  ├── Editor 对象 — 对外接口                   │
│  │   ├── toggleEditMode()                    │
│  │   ├── openEditor(qId)                     │
│  │   ├── saveMCQEdit / saveBQEdit             │
│  │   ├── restoreOriginal(qId)                │
│  │   ├── exportFile()                        │
│  │   └── clearAllOverrides()                 │
│  ├── MutationObserver — 自动注入编辑按钮      │
│  └── generateCorrectedJS() — 导出修正文件     │
│                                               │
│  DOMContentLoaded → 侧边栏 + Observer        │
└───────────────────────────────────────────────┘
```

## 渲染流程

```
用户操作 (click)
  → App.method()
    → 更新 S 状态
    → save() 写 localStorage
    → render()
      → 清空 #contentArea.innerHTML
      → 根据 S.mode 调用对应视图函数
      → 完整 HTML 字符串 → innerHTML
      → 更新侧边栏/页脚/答题卡/弹窗
```

注意：考试计时器通过 setInterval 每秒单独更新计时 DOM，不触发全量 render。

## 模板到在线方式的适配

模板中的 HTML 元素通过 `id` 被 app.js 引用，无需任何绑定库。数据文件生成后直接加载即可运行：

```
questions.js → 定义 QUESTIONS (选择题数组)
bigquestions.js → 定义 BIG_QUESTIONS (大题数组)
    ↓
app.js → 自动从数据中发现章节 → 构建 UI → 渲染

可选: 在 app.js 前定义 CHAPTER_NAMES 全局对象覆盖章节显示名
```

### 引入第三方库（本地优先 + CDN 回退）

如需额外功能（图表统计、数学公式渲染等），优先下载到本地 `js/lib/`，不存在时自动回退 CDN：

```html
<!-- 本地 + CDN 回退 -->
<script src="js/lib/chart.umd.min.js"
        onerror="this.outerHTML='<script src=\'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js\'><\/script>'"></script>
```

运行下载脚本确保离线可用：

```bash
python js/lib/download-libs.py
```

```python
# js/lib/download-libs.py
LIBS = {
    "chart.js": ("https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js", "chart.umd.min.js"),
}
import os, urllib.request
for name, (url, fname) in LIBS.items():
    path = os.path.join(os.path.dirname(__file__), fname)
    if not os.path.exists(path):
        urllib.request.urlretrieve(url, path)
```

**无需任何构建工具。**

## CSS 类名验证

生成后运行的验证脚本：

```python
import re

with open('index.html') as f:
    html = f.read()
with open('css/style.css') as f:
    css = f.read()

html_classes = set()
for m in re.finditer(r'class="([^"]+)"', html):
    for c in m.group(1).split():
        if re.match(r'^[a-zA-Z][\w-]*$', c):
            html_classes.add(c)

css_classes = set()
for m in re.finditer(r'\.([\w-]+)', css):
    if re.match(r'^[a-zA-Z]', m.group(1)):
        css_classes.add(m.group(1))

missing = [c for c in sorted(html_classes) if c not in css_classes]
if missing:
    print('MISSING:', missing)
else:
    print(f'All {len(html_classes)} classes verified ✓')
```

## 典型行数

| 文件 | 行数 |
|------|------|
| index.html | ~100 |
| style.css | ~530 |
| app.js | ~1850 |
| editor.js | ~770 |
| questions.js | ~2100 |
| bigquestions.js | ~680 |
| download-libs.py | ~80 |
| apply_edits.py | ~500 |
