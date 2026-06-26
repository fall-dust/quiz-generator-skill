# Quiz Generator — Claude Code Skill

从 Markdown 题库文件一键生成功能全面的**离线自测网页系统**，支持 5 种题型、答题卡、错题本、随机抽题等完整功能。

适用于：计算机等级考试、考研、期末复习、知识竞赛等各种场景。

## ✨ 功能特性

- **📖 自适应解析引擎** — 自动识别选择题/判断题/填空题/简答题/计算题
- **📋 答题卡** — 全局题目网格，点击跳转，绿/红/灰实时状态
- **❌ 错题本** — 自动收集错题，支持分类查看和重做自测
- **⭐ 收藏功能** — 跨题型收藏，按章节+类型分组浏览
- **🎲 随机抽题** — 自定义数量和题型，答错自动加入错题本
- **↩️ 前进后退** — 浏览器式历史栈导航，最多 50 步
- **📊 进度追踪** — 每题独立状态，自动持久化到 localStorage
- **🌙 深色模式** — CSS 变量驱动，一键切换
- **⚡ 纯静态** — 零构建步骤，零服务器，打开即用
- **📦 零依赖** — 核心功能纯 ES5，可选按需引入第三方库（Chart.js/KaTeX/Marked）

## 🚀 安装

将本仓库克隆到本地，然后在 Claude Code 配置中注册该 skill。

### 方法 1：全局安装（所有项目可用）

编辑 `~/.claude/settings.json`：

```json
{
  "skills": {
    "quiz-generator": "/path/to/quiz-generator"
  }
}
```

### 方法 2：项目级安装

将 `quiz-generator` 目录复制到你的项目下的 `.claude/skills/` 目录中：

```bash
cp -r /path/to/quiz-generator .claude/skills/
```

## 📝 用法

在 Claude Code 中直接输入：

```
/quiz-generator
```

或引用具体的题库文件：

```
/quiz-generator 题库是"计算机网络.md"，输出到 exam-output/
```

### 支持的题库格式

输入是一个 Markdown 文件，每道题的结构如下示例：

```markdown
1. 操作系统在计算机系统中位于（  ）之间。
A. CPU和用户
B. CPU和主存
C. 计算机硬件和用户
D. 计算机硬件和软件
答案：C

2. 操作系统的4大功能是（处理器管理）、存储器管理、设备管理、文件管理。
```

系统会自动检测题型结构并正确解析。

## 🏗️ 目录结构

```
quiz-generator/
├── SKILL.md              # 核心指令（Claude Code 读取）
├── README.md             # 本文件
├── LICENSE               # MIT 许可证
└── templates/            # 生成自测网页的模板
    ├── index.html        # HTML 容器
    ├── style.css         # 完整样式系统
    ├── app.js            # 原生 JS 应用层（状态管理 + 渲染 + 事件）
    ├── download-libs.py  # 第三方库下载脚本
    └── ARCHITECTURE.md   # 架构说明
```

### 生成输出结构

执行 skill 后，Claude 会在指定目录生成：

```
{输出目录}/
├── index.html            # 自测系统入口（可直接浏览器打开）
├── css/style.css         # 样式文件
├── js/
│   ├── app.js            # 应用逻辑
│   ├── questions.js      # 选择题数据（自动生成）
│   ├── bigquestions.js   # 大题数据（自动生成）
│   └── lib/              # 第三方库（可选）
│       └── download-libs.py
```

## ⚙️ 技术特点

| 特性 | 实现方式 |
|------|---------|
| 状态管理 | 纯 JS 对象 + 函数式更新 |
| 持久化 | localStorage（答案/进度/错题/收藏） |
| 渲染 | innerHTML 全量重建 |
| 题型隔离 | 4 套独立存储（mcq/fill/essay/calc） |
| 导航 | 历史栈数组（最多 50 条） |
| 依赖 | 零（可选 Chart.js/KaTeX/Marked） |
| 兼容性 | ES5，支持所有现代浏览器 |

## 📄 许可

[MIT License](LICENSE)

---

**Made with ❤️ for learners and educators.**
