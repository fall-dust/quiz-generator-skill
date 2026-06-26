---
name: quiz-generator
description: "从Markdown题库文件生成功能全面的离线自测网页系统，自适应多种题型（选择/判断/填空/简答/计算），支持答题卡、错题本、随机抽题、前进后退导航等完整功能"
---

# Quiz Generator — 自适应题库自测系统生成器

根据用户提供的题库 Markdown 文件，生成一个完整的离线自测 Web 应用（纯静态，可通过 CDN 按需引入第三方 JS 库）。

**核心特点：** 自适应解析引擎 → 精准提取数据 → **原生 JS 渲染架构** → 四种题型独立。

---

## 文件产出

| 文件 | 生成方式 | 说明 |
|------|---------|------|
| `index.html` | **静态模板** | 纯 HTML 容器结构；可选引入第三方库（本地 `js/lib/` + CDN 回退） |
| `css/style.css` | **静态模板** | CSS 变量驱动的完整样式系统 |
| `js/questions.js` | **自动生成** | 选择题数据 `var QUESTIONS = [...]` |
| `js/bigquestions.js` | **自动生成** | 大题数据 `var BIG_QUESTIONS = [...]` |
| `js/app.js` | **静态模板** | 原生 JS 应用层（状态管理 + 渲染 + 事件） |
| `js/lib/download-libs.py` | **静态模板** | Python 下载脚本：将第三方库下载到 `js/lib/`，确保离线可用 |

**依赖策略（灵活可选）：** 默认零依赖，可直接离线运行。需要额外功能（图表/数学公式/富文本等）时，优先使用本地 `js/lib/` 目录下的库；本地不存在时自动回退 CDN。

---

## 工作流程

```
用户提供 .md 题库 → 阶段1: 格式探测 → 阶段2: 解析引擎 → 阶段3: 文件生成
                                          │
                                  ┌───────┼───────────┐
                                  ↓       ↓           ↓
                             questions.js  bigquestions.js  3个模板文件
                                                              ├── index.html
                                                              ├── style.css
                                                              └── app.js
```

### 阶段1：格式探测

对 Markdown 文件进行扫描，探测其结构特征：

```
特征清单:
├── 是否有 `（A）` / `(B)` 这类答案括号            → 选择题
├── 是否有 `A、` / `A．` 选项行                    → 选择题格式确认
├── 是否有 `（        ）` 多空格空白               → 填空题
├── 是否有 `______` 下划线空白                     → 填空题
├── 是否有 "第一章" "第二章" 等章节标题            → 章节化内容
├── 是否有 `^数字.` 开头的行                       → 特殊标记题
└── 是否有数字后直接接中文（如"100交换机"）        → 缺失分隔符题
```

### 阶段2：自适应解析（6 阶段管道）

| 阶段 | 识别目标 | 正则/策略 | 产出 |
|------|---------|-----------|------|
| **1** | 带括号答案的标记行 | `/^(\d+)[.、．\s]*(.+?)[（(]\s*([A-Z]{1,8}\|[一-鿿]{2,8})\s*[）)](.*)$/` | 候选列表 |
| **1b** | 缺失分隔符题（如 q100） | `/^(\d+)([^\d].+?)[（(]\s*([A-Z]\|[一-鿿]+)\s*[）)]/` | 补录候选 |
| **2** | 选择题（有 A、B、C、D 选项） | 检查后续行是否出现 `[A-Z][、.．]` 模式 | `type: single/multiple` |
| **3** | 文字答案选择题 | 答案不是 `[A-Z]+` 而是中文词 | `answer: ["半双工"]` |
| **4** | 章节化简答/论述题 | 检测"第一章"等标题，在标题范围内匹配 `数字.` | 大题 |
| **5** | 无括号标记的论述题 | 题号在特定范围且未被前阶段处理 | 大题 |
| **6** | 文末填空题 | `/^(\d+)[、] (.+?)（(.+?)）/` 在 lines≥1370 区域 | `type: "填空"` |

**答案类型判定逻辑：**

```
答案文本 → 是否纯大写字母？
  ├── 是 → 长度==1 ? `type:"single"` : `type:"multiple"`
  └── 否 → `type:"single"`, answer=["中文答案文字"]
```

**章节分配策略（选择题）：**

选择题部分通常没有显式的章节标题。基于题目按章节顺序排列的规律，通过**内容关键词滑动窗口**自动检测章节边界：

```
1. 定义每章的关键词集（物理层→"带宽/双绞线/调制..."等）
2. 对每题计算各章关键词得分
3. 滑动窗口（窗口大小 10~15）平滑去噪
4. 取各窗口得分最高的章节
5. 若所有章得分均 < 阈值 → 归为 ch1（基本概念）

常见边界模式（301 题规模）：
  idx   0~59    → 基本概念与体系结构 (ch1)
  idx  60~86    → 物理层 (ch2)
  idx  87~144   → 数据链路层 (ch3)
  idx 145~205   → 网络层 (ch4)
  idx 206~221   → 传输层 (ch5)
  idx 222~end   → 应用层 (ch6)
```

### 阶段3：文件生成

生成器将解析好的数据注入静态模板：

```
templates/          →    {输出目录}/
├── index.html            ├── index.html        # 静态 HTML 容器（可引入第三方库）
├── style.css             ├── css/style.css
├── app.js                ├── js/app.js         # 原生 JS 应用层
├── download-libs.py      ├── js/questions.js   # 🔧 解析生成
                          ├── js/bigquestions.js # 🔧 解析生成
                          └── js/lib/download-libs.py  # 📥 下载第三方库（按需使用）
```

---

## 架构设计

### 应用架构（vanilla JS）

```
┌─────────────────────────────────────────────────┐
│                     index.html                   │
│  侧边栏(sidebar)  │  主内容区(contentArea)      │
│  答题卡面板(sh-panel)   │  弹窗容器              │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│                   js/app.js                      │
│                                                  │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │
│  │  状态 S   │  │  渲染     │  │  操作 App    │  │
│  │ (纯对象)  │→ │ (innerHTML│  │ (事件处理)   │  │
│  │           │  │  重新渲染)│  │              │  │
│  └──────────┘  └───────────┘  └──────────────┘  │
│       │              │               │           │
│       ▼              │               │           │
│  ┌──────────┐        │               │           │
│  │ save()   │        │               │           │
│  │ localStorage     │               │           │
│  └──────────┘        │               │           │
└──────────────────────┴───────────────┘───────────┘
```

### 数据流

```
用户操作 (click) → App.action() → 更新 S 状态
                                 → save() 写 localStorage
                                 → render() 重建 DOM
```

**核心循环：** 所有状态变更最终调用 `render()`，它销毁并重建 `#contentArea` 的 innerHTML，同时保持答题卡面板和弹窗容器的独立更新。

---

## 四种题型独立架构

应用将题目分为 **四种独立题型**，每种题型有独立数据源和进度追踪：

| 题型 | 模式 | 数据源 | 进度追踪 | 视图 |
|------|------|--------|---------|------|
| ✏️ 选择题 | `mcq` | `QUESTIONS[]` | `answers{}` + `results{}` | 选项点击 |
| 📝 填空题 | `fill` | `BIG_QUESTIONS[type='填空']` | `bqProg{}.viewed/memorized` | 闪卡 |
| 📄 简答题 | `essay` | `BIG_QUESTIONS[type='简答']` | `bqProg{}.viewed/memorized` | 闪卡 |
| 🔢 计算题 | `calc` | `BIG_QUESTIONS[type='计算']` | `bqProg{}.viewed/memorized` | 闪卡 |

每种题型：
- 独立按章节浏览：`mode=fill + chapter=ch1` → 只看第1章填空题
- 章节角标反映当前题型进度（选择题显示"已答/总数"，大题显示"已记住/总数"）
- 侧边栏统计随题型切换
- 仪表盘显示各题型独立的进度条

### 导航栏按钮

每题底部导航栏：

```
↩️ ↪️ 🏠 ◀ 上一题 📋 答题卡 <模式标记> 下一题 ▶
```

| 按钮 | 功能 |
|------|------|
| `↩️` | 后退到上一页（浏览器式历史栈，最多 50 条） |
| `↪️` | 前进到下一页（与后退对应，新导航清空前进栈） |
| `🏠` | 返回仪表盘首页 |
| `◀`/`▶` | 上/下一题（记录进度） |
| `📋 答题卡` | 打开答题卡面板（选择题/随机抽题/错题本/收藏查看模式，实时显示各题状态） |

**答题卡**显示所有题目的答题状态网格：
- 🟢 绿色 = 回答正确
- 🔴 红色 = 回答错误  
- ⚪ 灰色 = 未答
- 🔵 蓝色边框 = 当前题

点击格子可跳转到对应题目。

**答题卡数据源**根据当前模式从正确的存储读取：

| 模式 | 数据源 |
|------|--------|
| 章节练习 (`mcq`) | `S.answers` / `S.results` |
| 随机抽题 (`random`) | `_rdAns` / `_rdRes` |
| 错题重做 (`wrong`, `_retryActive=true`) | `_wrAns` / `_wrRes`（临时） |
| 错题查看 (`wrong`, 非自测) | `rAnsObj()` / `rResObj()` → 回退 `S.answers` |
| 收藏查看 (`bookmark`) | `rAnsObj()` / `rResObj()` → 原 `S.answers` |
| 大题模式 (`fill`/`essay`/`calc`) | ❌ 不显示（闪卡模式无需答题卡） |

---

## 错题本、收藏概览的详细列表

错题本和收藏概览页不再只显示章节卡片+题数，而是**按章节列出每道题的详情**：

```
第1章 计算机网络概述（5道错题）
├── [单选] 第1章 第3题 计算机网络中可以没有的是...
├── [单选] 第1章 第12题 以下哪个是TCP/IP协议...
└── [多选] 第1章 第7题 以下哪些是网络拓扑...

第3章 数据链路层（2道错题）
├── [单选] 第3章 第8题 CSMA/CD的退避算法...
└── [单选] 第3章 第15题 以太网的最小帧长...
```

每行显示 `[题型标签] 章名 第X题 题目摘要`，点击直接跳转到该题的查看模式（`App.goRetryChapterAndIdx`）。

### 按章节和类型分类（v2 增强）

错题本列表在章节内进一步按**题目类型（单选/多选）** 分组，方便针对性复习：

```
第1章（5道错题）
  ├── 📋 单选题（3）
  │   ├── [单选] 第3题 计算机网络中可以没有的是...
  │   └── [单选] 第12题 以下哪个是TCP/IP协议是...
  └── 📋 多选题（2）
      ├── [多选] 第7题 以下哪些是拓扑结构...
      └── [多选] 第15题 以下哪些是网络设备...
```

### 错题自测流程

```
进入错题本 → 查看错题列表（按章节+类型分组） → 点击"🎯 开始自测"
  → 选择章节/顺序 → 开始自测（_retryActive=true）
  → 答题（使用 _wrAns/_wrRes 临时存储）
  → 答对后出现"✅ 移出错题本"按钮
  → 退出自测时 syncRetryToPerm() 写回永久存储
```

- 自测模式下，答对的题目显示"✅ 移出错题本"按钮
- 用户点击后，该题从错题本移除，答案同步到主题库
- 自测结果（无论对错）通过 `syncRetryToPerm()` 同步回 `S.answers/S.results`

## 收藏功能

所有题型（选择题/填空题/简答题/计算题）均可收藏。

### 交互流程

```
仪表盘 → ⭐ 收藏 → 收藏概览页
  ├── ✏️ 选择题 (N)     ← 每题显示：题型标签 · 章名 · 第X题 · 题目摘要
  │   ├── 第1章 (5)
  │   │   ├── [单选] 第1章 第3题 计算机网络中可以没有的是...
  │   │   └── [多选] 第1章 第7题 以下哪些是网络拓扑...
  │   └── 第4章 (3)
  ├── 📝 填空题 (N)
  │   └── ...
```

### 交互入口

收藏/错题概览页每道题以可点击行展示，标注 `[题型标签] 章名 第X题 题目摘要`，点击直接跳转到该题的查看模式（`App.goRetryChapterAndIdx`）。

### 实现机制

| 属性 | 说明 |
|------|------|
| `isViewingBM()` | 检查 `S._bmQs` 是否非空 |
| `_bmQs` | 临时数据源，替换 `getQs()` 的返回值 |
| `App.pick` 守卫 | 查看模式直接 `return`，不写入 `S.answers` |
| `isAnswered()` | 查看模式始终返回 `true`（选项锁定） |
| `isCorrect()` | 查看模式始终返回 `true`（全绿） |
| `selected()` | 查看模式返回 `q.answer.indexOf(label)`（显示正确答案） |
| BQ 查看 | `S.bqRevealed = true`，自动显示答案 |

收藏不影响原题库数据。

---

## 错题本与重做

### 两种模式

| 模式 | `_retryActive` | 行为 |
|------|:---:|------|
| **查看模式**（点击概览章节） | `false` | 显示原错误答案（红/绿），不可修改 |
| **自测模式**（🎯 开始自测） | `true` | 空白待答，使用临时 `_wrAns`/`_wrRes` |

### 临时答案系统

```
_rAnsFor(q) / rResFor(q) ─ 按题判断：
  ├── 重做模式 + 有临时值 → 返回临时值
  ├── 查看模式 + 有临时值 → 返回临时值
  ├── 自测模式 + 无临时值 → undefined（未答）
  └── 默认 → S.answers / S.results（原答案）
```

**同步回写：** 退出重做（首页/切换题型）或手动移出时，调用 `syncRetryToPerm()` 将临时答案写回 `S.answers/S.results`。

### 随机抽题错题同步

随机抽题模式（`_rdAns/_rdRes` 临时存储）：

- 随机模式下答错的题目**同时加入 `S.wrongSet`** 并持久化到 localStorage
- 答对的题目不写入永久存储（不影响正常进度统计）
- 退出随机模式时 `_rdAns/_rdRes` 清空，但 `wrongSet` 保留
- 实现位置：`App.pick()` 和 `App.confirmMC()` 中 `isEphemeral()` 分支

---

## 临时答案系统

不同模式使用不同的答案存储，确保互不干扰：

| 模式 | 答案存储 | 持久化 | 说明 |
|------|---------|:-----:|------|
| **章节练习** (mcq/fill/essay/calc) | `S.answers` / `S.results` | ✅ | 永久保存进度 |
| **随机抽题** (random) | `_rdAns` / `_rdRes` | ❌ | 临时，退出即清 |
| **错题自测** (wrong, `_retryActive=true`) | `_wrAns` / `_wrRes` | ❌ | 退出时 `syncRetryToPerm()` 写回 |
| **查看模式** (wrong/bookmark, `_retryActive=false`) | 无临时 → 回退 `S.answers` | — | 显示原答案 |
| **收藏查看** (`isViewingBM()`) | 无临时 → `answer` 字段 | — | 显示正确答案 |

### 清除时机

| 存储 | 清除时机 |
|------|---------|
| `_rdAns` / `_rdRes` | `home()`、`back()`、`startType()`、`startRandom()` |
| `_wrAns` / `_wrRes` | `syncRetryToPerm()` 写回后 |
| `_bmAns` / `_bmRes` | `syncRetryToPerm()` 写回后 |

### 数据流隔离

```
App.pick(label)
  ├── isViewingBM()?       → return（收藏查看不可选）
  ├── isRetry()?           → 写入 _wrAns/_wrRes
  ├── isEphemeral()?       → 写入 _rdAns/_rdRes（不持久化）
  └── 默认                 → 写入 S.answers/S.results + save()
```

## 进度追踪

### 存储

- `_progress` 对象 → localStorage `net_progress`
- 键格式：`{mode}_{chapter}`，如 `mcq_ch1`、`fill_ch2`

### 更新时机

| 操作 | 函数 |
|------|------|
| 答题（单选/多选确认） | `pick()` / `confirmMC()` |
| 翻题 | `next()` / `prev()` |
| BQ 闪卡翻看 | `next()` / `prev()` |

### 跳转到未做题

- **进入题型**（`startType()`）：使用 `getProgress()` 读取缓存进度；`chapter='all'` 时回退到任意已做题章节的进度
- **进入章节**（`goChapter()`）：**实时扫描**当前章节题目列表，直接定位第一个未做题（选择题检查 `S.answers`，大题检查 `bqProg.memorized`），不依赖可能过期的缓存

---

## 导航历史栈（前进/后退）

`_navStack` 数组保存最近 50 次导航记录，`_forwardStack` 保存前进历史：

```
触发 navPush() 的 10 个入口点:
  home() | startType() | goChapter() | showBookmarks()
  goBookmarkChapter() | startWrong() | goRetryChapter()
  goRetryChapterAndIdx() | startWrongTest() | setMode() (弹窗)
```

`App.back()` 弹出 `_navStack` 栈顶，同时将当前状态推入 `_forwardStack`。
`App.forward()` 弹出 `_forwardStack`，将当前状态推回 `_navStack`。
任何新的导航操作（非前进/后退）会清空 `_forwardStack`，确保不会出现"分支"历史。

**前后导航按钮：** 在答题界面底部导航栏和 BQ 闪卡底部都提供 `↩️ 后退` 和 `↪️ 前进` 按钮。

---

## 随机抽题（自定义数量 + 错题同步）

### 弹窗配置

点击 🎲 随机抽题 弹出配置对话框：

```
┌─ 随机抽题 ─────────────────────┐
│  抽取数量  [10 ▼]               │
│  题型      [全部 ▼]             │
│         [取消]  [开始]           │
└─────────────────────────────────┘
```

- 可选数量：10 / 20 / 30 / 50
- 可选题型：全部 / 单选 / 多选
- 从全局题库乱序抽取

### 错题同步

```
随机抽题答题（isEphemeral() = true）
  ├── 答对 → _rdAns/_rdRes 记录临时答案（不持久化，不影响进度）
  └── 答错 → _rdAns/_rdRes 记录 + 同时 S.wrongSet.add(q.id) + save()
                  ↓
            错题本中出现该题（wrongSet 持久化）
```

**实现位置**：`App.pick()` 和 `App.confirmMC()` 的 `isEph` 分支末尾：
```js
if (isEph) {
  _rdAns[q.id] = ans; _rdRes[q.id] = cor;
  if (!cor) { S.wrongSet.add(q.id); save(); }   // ← 错题同步
  render(); return;
}
```

---

## 填空题/大题闪卡（不需输入文字）

填空题、简答题、计算题使用 **闪卡模式**，不需要键盘输入，方便背诵：

```
┌─ 📖 题目 ──────────────────────────┐
│                                      │
│  操作系统的4大功能是（  ）、存储器   │
│  管理、设备管理、文件管理。           │
│                                      │
│          [ 显示答案 ]                │
│                                      │
└──────────────────────────────────────┘

                        ↓ 点击"显示答案"

┌─ 📖 题目 ──────────────────────────┐
│  操作系统的4大功能是（  ）、...     │
├──────────────────────────────────────┤
│  ✅ 参考答案                        │
│  处理器管理                         │
└──────────────────────────────────────┘
      [✅ 已记住]  [仅看未记住] ☐
```

### 操作流程

| 操作 | 效果 |
|------|------|
| **显示答案** | 切换 `S.bqRevealed = true`，显示参考答案；记录 `viewed=true` |
| **标记已记住** | 切换 `memorized` 状态，永久保存到 `S.bqProg[q.id]` |
| **仅看未记住** | 过滤出 `!memorized` 题目子集，翻看时跳过已记住的 |
| **◀/▶ 翻题** | 自动关闭答案显示（`S.bqRevealed = false`），下一题重新隐藏 |

### 进度追踪

- 侧边栏章节角标显示：`已记住/总数`
- 仪表盘显示：`📝 填空题 已记 12/39`

---

## 错题标记

主题库（选择题列表）中，存在于错题本的题目会显示 **错题** 标签：

```
[单选] [第一章] [错题] 1/301  ☆
```

- 标签样式：`.tag-d` 红色背景（`var(--rdb)`/`var(--rd)`）
- 判断逻辑：`S.wrongSet.has(q.id)` → 显示 `<span class="tag tag-d">错题</span>`
- 答对后自动移除错题标签（`S.wrongSet.delete(q.id)`）
- 随机模式答错加入、主模式答对移除

---

## 数据标准化机制

`app.js` 启动时在 IIFE 头部自动执行 `normalizeData()`，无需手动干预：

```
QUESTIONS （原始：choice/判断/填空混合）
  │
  ├─ choice → 保持，answer: "C" → ["C"]，_origType = 'choice'
  ├─ 判断   → 保持，answer: "√" → ["√"]，自动添加 √/× 选项
  │
BIG_QUESTIONS（原始：判断/填空混合）
  │
  ├─ 判断   → 迁移到 QUESTIONS（带 √/× 选项），_origType = '判断'
  ├─ 填空   → 留在 BIG_QUESTIONS
  └─ 其他   → 留在 BIG_QUESTIONS（简答/计算等）

结果：
  QUESTIONS = [choice(270) + 判断(125)]  → 单选标签显示"判断"或"选择"
  BIG_QUESTIONS = [填空(214)]            → 闪卡模式
```

### bigquestions.js 占位保护

`bigquestions.js` 文件使用条件声明避免覆盖 `questions.js` 中的数据：

```js
var BIG_QUESTIONS = typeof BIG_QUESTIONS !== 'undefined' ? BIG_QUESTIONS : [];
```

---

## 侧边栏上下文标识

### 目录标签

切换到不同题型时，章节列表上方显示：

| 模式 | 顶标 | 背景色 |
|------|------|--------|
| ✏️ 选择题 | `✏️ 选择题目录` | 浅蓝底 |
| 📝 填空题 | `📝 填空题目录` | 浅橙底 |
| 📄 简答题 | `📄 简答题目录` | 浅绿底 |
| 🔢 计算题 | `🔢 计算题目录` | 浅红底 |
| ❌ 错题本 | `❌ 错题本目录` | 浅红底（更显眼） |
| ⭐ 收藏 | `⭐ 收藏题目目录` | 浅红底 |

选中章节按钮也按模式变色，右上角角标同步配色。

### 侧边栏布局

```
📚 题库自测

📖 章节（上下文感知的进度角标）
  ● 第1章   [60]      ← 当前题型该章的进度
  ● 第2章   [27]
  ...

🎯 题型练习（带进度摘要的按钮）
  ✏️ 选择题 301题 · 30/301
  📝 填空题 39题 · 12/39
  📄 简答题 27题 · 5/27
  🔢 计算题 13题 · 3/13

⚡ 快捷
  🎲 随机抽题  ❌ 错题本

📊 进度: 30/301 | 错题: 5

🏠 首页  🗑️ 清除
```

---

## app.js 内部模块

| 模块 | 职责 | 曝光 |
|------|------|------|
| **状态 S** | 应用全部运行时状态（mode/index/answers/results/bookmarks/wrongSet/bqProg 等） | IIFE 闭包 |
| **临时答案** | `_wrAns/_wrRes/_bmAns/_bmRes` — 错题/收藏重做临时状态 | IIFE 闭包 |
| **导航历史** | `_navStack` + `navPush()` | IIFE 闭包 |
| **进度追踪** | `_progress` + `updateProgress()/getProgress()` | IIFE 闭包 |
| **统计函数** | `chStats/allStats/bqStats/mcqStats/bqTypeStats/currentStats` | IIFE 闭包 |
| **数据源** | `getQs()` — 根据 mode 返回对应数据集 | IIFE 闭包 |
| **视图渲染** | `renderDashboard/renderQuestionView/renderBQView/renderBookmarkOverview/renderWrongOverview/renderSheet/renderModals` | 返回 HTML 字符串；`renderSheet()` 按不同模式（普通/随机/错题重做/收藏）从对应数据源读取答案状态 |
| **主渲染** | `render()` — 组装各区域 HTML → innerHTML | IIFE 闭包 |
| **操作接口** | `App.*` — 用户交互回调，更新状态后调用 `render()` | `window.App` |
| **持久化** | `save/loadJ/saveProgress/syncRetryToPerm` | IIFE 闭包 |

---

## 数据格式

### questions.js（原始格式——可能混合类型）

实际中提取程序可能产出一份合并的 `QUESTIONS` 数组，包含 `choice`/`判断`/`填空` 三种类型：

```js
var CHARACTERS = {
  ch1: '第1章', ch2: '第2章', // ...
};

var QUESTIONS = [
  // 选择题
  { id: 'q1_1', chapter: 'ch1', type: 'choice', number: 1,
    question: '操作系统在计算机系统中位于（  ）之间。',
    options: [
      { label: 'A', text: 'CPU和用户' },
      { label: 'B', text: 'CPU和主存' },
      { label: 'C', text: '计算机硬件和用户' },
      { label: 'D', text: '计算机硬件和软件' }
    ],
    answer: 'C'   // 源数据为字符串
  },
  // 判断题（无 options，依赖运行时自动创建 √/× 选项）
  { id: 'q1_14', chapter: 'ch1', type: '判断', number: 14,
    question: '操作系统是合理组织计算机工作流程的软件集合。',
    answer: '√'
  },
  // 填空题（归入 BIG_QUESTIONS 闪卡）
  { id: 'q1_10', chapter: 'ch1', type: '填空', number: 10,
    question: '操作系统的4大功能是（       ）、存储器管理、设备管理、文件管理。',
    answer: '处理器管理'
  }
];

var BIG_QUESTIONS = [
  // 简答/计算/填空等大题（与 QUESTIONS 中的填空不重复）
];
```

### 运行时标准化（app.js 启动时自动执行）

`normalizeData()` 在 `app.js` IIFE 开头自动执行，完成以下转换：

```js
1. QUESTIONS 中的 choice/判断 类型：
   - answer: "C"    →  ["C"]        （字符串→数组）
   - answer: "√"    →  ["√"]
   - type: "choice" → type: "single"（统一选择题类型）
   - 判断类型自动补全 options: [{label:'√',text:'正确'},{label:'×',text:'错误'}]

2. BIG_QUESTIONS 中的 判断 类型：
   - 全部迁移到 QUESTIONS（带 √/× 选项）
   - 从 BIG_QUESTIONS 移除

3. BIG_QUESTIONS 仅保留 填空/简答/计算 等非选择类型
```

### 标准化后的数据（运行时的 QUESTIONS）

```js
QUESTIONS = [
  {
    id: 'q1_1', chapter: 'ch1', type: 'single',
    _origType: 'choice',          // 保留原始类型，用于显示标签
    answer: ['C'],
    options: [
      { label: 'A', text: 'CPU和用户' },
      { label: 'B', text: 'CPU和主存' },
      { label: 'C', text: '计算机硬件和软件' },
      { label: 'D', text: '计算机硬件和软件' }
    ],
    question: '...'
  }
  // 判断题被标准化为同样的结构，多了 √/× 选项
]
```

### bigquestions.js（最终——仅保留非选择题）

```js
BIG_QUESTIONS = [
  {
    id: 'bq1', chapter: 'ch1',
    type: '填空',              // '填空' | '简答' | '计算'
    question: '操作系统的4大功能是...',
    answer: '处理器管理'       // 字符串形式，非数组
  }
]
```

### 章节名称全局变量（可选，由 questions.js 提供）

```js
var CHAPTER_NAMES = {
  ch1: '第1章 计算机网络概述',
  ch2: '第2章 物理层'
};
```

若未定义，系统自动从章节 ID 生成名称（`ch1` → `第1章`）。

---

## 关键设计约束

1. **依赖策略：灵活按需**：核心功能零依赖（纯 ES5）。需要第三方库时，优先下载到 `js/lib/` 本地目录，通过 `<script src="js/lib/...">` 引用，本地缺失时自动回退 CDN
2. **所有 App 方法暴露到 `window.App`**：模板中通过 `onclick="App.method()"` 调用
3. **`render()` 全量重建**：主内容区通过 `innerHTML` 全量替换
4. **数据隔离**：`_rdAns/_rdRes`（随机临时）、`_wrAns/_wrRes`（错题重做临时）、`S.answers`（永久）三套存储互不干扰
5. **分层回答锁定**：CSS `pointer-events:none` + JS guard `if (isAnswered(q)) return` 双层保障。多选题 `isAnswered()` 检查 `S.results`（确认后才设），而非 `S.answers`（临时选择状态），确保用户可先选多个选项再点「确认选择」提交
6. **持久化**：answers/results/bookmarks/wrongSet/bqProg/progress 通过 localStorage 保存
7. **错题/收藏查看**：`isViewingBM()/isRetry()+_retryActive` 控制临时答案回退逻辑
8. **CSS 类名验证**：生成后检查 `style.css` 覆盖 `index.html` 中所有 `class="..."` 引用
9. **弹窗独立容器**：弹窗通过 `#modalContainer` innerHTML 渲染
10. **章节自动发现**：从 QUESTIONS 和 BIG_QUESTIONS 数据中自动提取章节列表
11. **进入章节即定位未做题**：点击侧边栏章节按钮时，`goChapter()` 实时扫描该章节题目列表，直接跳转到第一个未答题（选择题查 `S.answers`，大题查 `bqProg.memorized`），而非依赖可能过期的缓存进度

---

## 引入第三方库（本地优先 + CDN 回退）

推荐策略：**将第三方库下载到本地 `js/lib/` 目录**，确保离线可用；本地文件不存在时自动回退到 CDN。无需任何构建工具或 npm。

### 工作目录结构

```
{输出目录}/
├── index.html
├── css/style.css
├── js/
│   ├── app.js                  # 应用逻辑
│   ├── questions.js            # 选择题数据（生成）
│   ├── bigquestions.js         # 大题数据（生成）
│   ├── lib/                    # 📁 第三方库存放目录
│   │   ├── chart.umd.min.js    #   已下载的库文件
│   │   ├── katex.mjs
│   │   ├── marked.min.js
│   │   └── download-libs.py    #   一键下载/更新脚本
│   └── ...
```

### 使用流程

```
1. 编辑 index.html → 取消注释需要的第三方库
2. 运行 python js/lib/download-libs.py → 自动下载到 js/lib/
3. 离线打开 index.html → 使用本地库（无需网络）
```

### 本地引用 + CDN 回退机制

在 `index.html` 底部用 `<script>` 标签优先加载本地库，失败时自动回退到 CDN：

```html
<!-- index.html — 在 </body> 前按需引入 -->
<script src="js/lib/chart.umd.min.js"
        onerror="this.outerHTML='<script src=\'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js\'><\/script>'"></script>
<script src="js/lib/katex.mjs"
        onerror="this.outerHTML='<script src=\'https://cdn.jsdelivr.net/npm/katex@0/dist/katex.mjs\'><\/script>'"></script>
<script src="js/lib/marked.min.js"
        onerror="this.outerHTML='<script src=\'https://cdn.jsdelivr.net/npm/marked@15/marked.min.js\'><\/script>'"></script>
```

当本地文件不存在时，浏览器触发 `onerror`，自动插入 CDN 版本的 `<script>` 标签。

### 下载脚本（download-libs.py）

每个第三方库对应的 `download-libs.py` 片段如下。在生成时，将所有需要的库合并为一个完整的 Python 脚本：

```python
#!/usr/bin/env python3
"""下载第三方 JS 库到 js/lib/ 目录"""
import os, urllib.request

LIBS = {
    # 库名 → (URL, 保存文件名)
    "chart.js": (
        "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js",
        "chart.umd.min.js",
    ),
    "katex": (
        "https://cdn.jsdelivr.net/npm/katex@0/dist/katex.mjs",
        "katex.mjs",
    ),
    "marked": (
        "https://cdn.jsdelivr.net/npm/marked@15/marked.min.js",
        "marked.min.js",
    ),
}

def download():
    dst = os.path.join(os.path.dirname(__file__))
    for name, (url, fname) in LIBS.items():
        path = os.path.join(dst, fname)
        if os.path.exists(path):
            print(f"✓ {name} 已存在，跳过")
            continue
        print(f"↓ 下载 {name}...")
        urllib.request.urlretrieve(url, path)
        print(f"  → {path}")

if __name__ == "__main__":
    download()
```

### 在 app.js 中使用

第三方库通过全局变量（`window.Chart`、`window.katex`、`window.marked`）访问，与原生代码无异：

```js
// js/app.js — 库已通过 <script> 加载，直接使用全局变量
var chart = new window.Chart(ctx, { /* ... */ });
var html = window.marked.parse(markdownText);
```

### 引入方式对照表

| 方式 | 适用场景 | 离线可用 | 加载顺序 |
|------|---------|:--------:|---------|
| **本地 `<script>` + onerror 回退**（推荐） | 需要离线运行的第三方库 | ✅ | 按标签顺序 |
| **普通 `<script>` CDN 直连** | 开发调试、始终联网 | ❌ | 按标签顺序 |
| **Import Map + ES Module** | 需要 `import` 语法的模块化库，不需离线 | ❌ | 异步并行 |

### 使用原则

1. **核心功能零依赖**：选择题答题、闪卡、进度存储等核心逻辑不依赖第三方库
2. **按需引入**：仅在需要额外功能时（图表统计、数学公式渲染、Markdown 渲染等）引入
3. **本地优先**：所有第三方库优先下载到 `js/lib/`，确保离线可用
4. **CDN 回退**：本地文件缺失时自动从 CDN 加载，不阻塞页面
5. **数据文件保持不变**：`questions.js` 和 `bigquestions.js` 始终使用 `var` 全局变量

---

### 变量系统

```css
:root {
  --p:#1a73e8; --gr:#27ae60; --rd:#e74c3c; --yw:#f39c12; --bl:#3498db;
  --bg:#f0f2f5; --cd:#fff; --bd:#e1e5eb; --t:#2c3e50; --t2:#6b7c93;
  --sb:#1e293b; --st:#cbd5e1;
  --sw:280px; --r:8px; --rl:12px; --rr:999px;
  --ff:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
}
[data-theme="dark"] { /* 覆盖 --bg, --cd, --bd, --t, --t2, --sb */ }
```

### 关键组件选择器

| 选择器 | 功能 | 状态变体 |
|--------|------|---------|
| `.opt` | 选项按钮 | `.sel` `.cor` `.wrg` `.done`（带 `pointer-events:none`）|
| `.dash-card` | 仪表盘卡片 | `:hover` 上移阴影 |
| `.q-card` | 题目卡片 | — |
| `.fb` | 答题反馈 | `.fb-cor` `.fb-wrg` |
| `.sh-cell` | 答题卡格子 | `.correct` `.wrong` `.skip` `.cur` |
| `.bq-card` | 大题闪卡 | `.bq-front` `.bq-back` |
| `.chapter-btn` | 侧边栏章节 | `.active` |
| `.ch-badge` | 章节角标 | `.done` |
| `.sidebar-nav.xxx-mode` | 题型色调 | `mcq-mode`/`fill-mode`/`essay-mode`/`calc-mode`/`wrong-mode` |
| `.sidebar-context-label` | 题型目录文字标识 | — |
| `.sheet-float-btn` | 右侧浮动答题卡 | `.hidden` |
| `.wrong-q-list` | 错题/收藏题列表容器 | — |
| `.wrong-q-item` | 错题/收藏题目行（可点击跳转） | `:hover` 高亮变底色 |
| `.wrong-q-tag` | 题型标签（单选/多选） | — |
| `.wrong-q-ch` | 章节名 | — |
| `.wrong-q-num` | 题号（第X题） | — |
| `.wrong-q-txt` | 题目摘要（截取前50字） | `text-overflow:ellipsis` |

---

## 编码规范

1. **安全**：用户输入用 `escapeHtml()` 转义后通过 `textContent` 或 `innerHTML` 插入
2. **CSS 变量简写**：`--p` 主色、`--t` 文本、`--cd` 卡片、`--t2` 次要文本
3. **输出路径**：默认在题库同目录创建 `{输出目录}/`
4. **交叉验证**：生成后提取 `index.html` 中所有 `class="..."` 值，逐个检查是否在 `style.css` 中有 `.xxx` 定义
5. **`window.App` 命名空间**：全部操作函数挂在 `App` 对象上，不污染全局
6. **数据文件只含数据**：`questions.js` 和 `bigquestions.js` 仅定义 `QUESTIONS` / `BIG_QUESTIONS` 变量，不含逻辑
7. **错题/收藏重做答案隔离**：使用 `_wrAns/_wrRes` 临时对象，退出时同步
8. **第三方库引入规范**：通过 `<script src="js/lib/xxx.js" onerror="...CDN回退...">` 引入，数据文件保持不变

---

## 用法

```
用户：/quiz-generator 题库是"xxx.md"，输出到 {输出目录}/ 目录
```
