/**
 * The built-in inspiration library: the categories and cases that ship with Linsight.
 *
 * These are the eleven examples the draft screen used to hard-code, moved here so that one
 * catalog serves every surface — the gallery page, the draft screen's picker, and the API. Their
 * copy used to live in the web app's two i18n dictionaries; it now lives beside the case it
 * belongs to, as the `title`/`titleZh` pair the rest of the app's bilingual data uses. That is
 * what lets an admin's own case and a built-in one be the same kind of thing.
 *
 * **This module is pure data and must stay that way.** It is the `/presets` entry point the web
 * app imports, so it may not reach for a Node built-in — the web bundle's `node-free-imports`
 * test fails the build if it does. Everything that touches the filesystem is in `io.ts`.
 *
 * A built-in case has no directory of its own, which is why every one of them uses a glyph cover:
 * there is nowhere for an image to be read from. `prompt` is the English text and `promptZh` the
 * Chinese; both are required, and each is what the corresponding UI fills the composer with.
 *
 * Ids are lowercase kebab-case because an id is also a directory name for an admin case: one
 * charset for both halves of the catalog means a case-insensitive filesystem cannot collide two
 * ids that differ only in case.
 */
import type { InspirationCase, InspirationCaseInput, InspirationCategory } from "./schema.js";

/** The three categories a fresh library is seeded with, in tab order. */
export const SEED_INSPIRATION_CATEGORIES: readonly InspirationCategory[] = [
  { id: "webapps", name: "Build web apps", nameZh: "搭建网页应用", order: 0 },
  { id: "agents", name: "Build and optimize agents", nameZh: "搭建和优化智能体", order: 1 },
  { id: "schedules", name: "Create scheduled tasks", nameZh: "创建定时任务", order: 2 },
];

/**
 * The built-in cases.
 *
 * The prompt is the whole request: a click fills the composer with it and sends nothing, so it is
 * written to be read and edited. That is why the shorter ones are a paragraph rather than a
 * specification — file layouts, field lists and self-test steps are what the Agent works out or
 * asks about, and they stay out.
 */
export const BUILTIN_INSPIRATION_CASES: readonly InspirationCaseInput[] = [
  {
    id: "game",
    kind: "app",
    categoryId: "webapps",
    title: "2D penguin sled game",
    titleZh: "2D 企鹅雪橇越野小游戏",
    description:
      "A cute Antarctic penguin sleds over rocks, easy start with a gentle difficulty ramp — a 2D pure-frontend mini game",
    descriptionZh: "可爱南极企鹅滑雪橇跳石头，难度由易到难的 2D 纯前端小游戏",
    prompt:
      "Build a cute Antarctic penguin sledding 2D game: press Space to jump over the rocks " +
      "coming up on the ice; start easy and forgiving, with sled speed and obstacle density " +
      "ramping up smoothly and gradually over time (no sudden spikes), live scoring, and " +
      "hitting a rock ending the run with one-click restart. " +
      "A 2D side-scroller with a cute cartoon look, pure frontend (a single HTML file is " +
      "fine), styled per the web-design skill. " +
      "When done, test it in a browser once, confirm the first few seconds are easy to " +
      "clear, and tell me how to open it and how to play.",
    promptZh:
      "做一个可爱的南极企鹅滑雪橇越野 2D 小游戏：按空格键起跳，跃过冰面上迎面而来的石头；" +
      "开局要足够简单、上手无压力，滑行速度与障碍密度随时间平滑、循序渐进地上升，避免突然变难，" +
      "实时计分，撞上石头即结束并可一键重新开始。" +
      "2D 横版画面、可爱卡通风，纯前端实现（单个 HTML 文件即可），界面遵循 web-design 技能。" +
      "完成后在浏览器里自测一次，确认开局能轻松玩过几秒，并告诉我怎么打开和怎么玩。",
    agentId: null,
    skills: ["web-design"],
    tools: [],
    cover: { kind: "glyph", glyph: "🎮" },
    previewFilename: null,
    featured: true,
    order: 0,
    enabled: true,
  },
  {
    id: "gamecenter",
    kind: "app",
    categoryId: "webapps",
    title: "A mini-game center built by multiple agents",
    titleZh: "多智能体搭建小游戏中心",
    description:
      "Ten pure-frontend games with no repeated mechanics, built in parallel behind one index page",
    descriptionZh: "并行产出 10 个玩法互不重复的纯前端小游戏，配一个统一风格的索引首页",
    prompt: `Build a web mini-game center with multiple agents working in parallel: 10 pure-frontend games with no two sharing the same mechanic, plus an index page.

## How to split the work
- First plan the 10 games (say snake, 2048, tetris, breakout, minesweeper, memory match, sokoban, space shooter, platform jumper, rhythm tap), confirm no two mechanics repeat, and fix a shared directory layout, palette and interaction spec.
- Then hand the 10 games to several subagents to implement in parallel — each subagent owns exactly one game, follows the agreed spec, and never edits another's files.

## Each game
- Its own \`games/<slug>/index.html\`: pure frontend, a single file that runs straight from file://, with no backend and no CDN assets.
- Start / restart, live score or timer, a lose-or-clear summary, both keyboard and touch controls, and the rules written on the page.
- A way back to the index page.

## Index page
- \`index.html\` at the root: a card grid listing all 10 games (name + one-line mechanic + controls), each card opening its game.
- One design language shared with every game, following the web-design skill.

## Wrap-up
- Review as a whole: the 10 mechanics really are distinct, the styling is consistent, and every index link resolves.
- Self-test each game in a browser — it starts, it ends, it restarts — then tell me how to open it.`,
    promptZh: `用多智能体并行搭建一个网页小游戏中心：10 个玩法互不重复的纯前端小游戏，外加一个索引首页。

## 分工方式
- 先规划这 10 个游戏（例如贪吃蛇、2048、俄罗斯方块、打砖块、扫雷、记忆翻牌、推箱子、太空射击、跳跃平台、节奏点击），确认玩法确实互不重复，并定好统一的目录结构、配色与交互规范。
- 再把 10 个游戏分派给多个子智能体并行实现，每个子智能体只负责自己的那一个游戏，严格按既定规范产出，互不改动他人的文件。

## 每个游戏
- 独立的 \`games/<slug>/index.html\`，纯前端单文件、file:// 直接打开即可运行，不依赖后端与任何 CDN 资源。
- 具备开始 / 重新开始、实时计分或计时、失败或通关结算，并同时支持键盘与触摸操作，页面内写明玩法说明。
- 提供返回索引首页的入口。

## 索引首页
- 根目录 \`index.html\`：卡片网格列出全部 10 个游戏（名称 + 一句话玩法 + 操作方式），点击进入对应游戏。
- 与所有游戏共用一套设计语言，遵循 web-design 技能。

## 收尾
- 统一验收：10 个游戏玩法确实不重复、风格一致，索引页的链接全部可达。
- 在浏览器里逐个自测，确认都能开始、能结束、能重开，然后告诉我怎么打开。`,
    agentId: null,
    skills: ["web-design"],
    tools: [],
    cover: { kind: "glyph", glyph: "🕹️" },
    previewFilename: null,
    featured: true,
    order: 1,
    enabled: true,
  },
  {
    id: "lol",
    kind: "app",
    categoryId: "webapps",
    title: "League of Legends music player",
    titleZh: "英雄联盟音乐播放器",
    description:
      "Worlds anthems on the SoundCloud Widget API — a single file that opens from file://",
    descriptionZh: "用 SoundCloud Widget API 播放历届 Worlds 主题曲，单文件即开即用",
    prompt: `Build a League of Legends Worlds anthem player with the SoundCloud Widget API (see https://developers.soundcloud.com/docs/api/html5-widget): a single index.html that works when opened from file://.

## Technical constraints
- Use the SC.Widget JS API (widget.load / widget.toggle / widget.setVolume / widget.seekTo), loading https://w.soundcloud.com/player/api.js
- The iframe must stay visible (180px tall), with visual=true color=f0b90b single_active=true
- Include ONLY these 8 tracks confirmed playable (oEmbed-verified); do not add tracks that are not oEmbed-verified:
  - Warriors (S4) — soundcloud.com/leagueoflegends/warriors
  - Worlds Collide (S5) — soundcloud.com/leagueoflegends/worlds-collide
  - Legends Never Die (S7) — soundcloud.com/leagueoflegends/legends-never-die
  - Phoenix (S9) — soundcloud.com/leagueoflegends/phoenix
  - Burn It All Down (S11) — soundcloud.com/leagueoflegends/burn-it-all-down
  - GODS (S13) — soundcloud.com/leagueoflegends/gods
  - Heavy Is The Crown (S14) — soundcloud.com/linkinpark/heavy-is-the-crown
  - Sacrifice (S15) — soundcloud.com/leagueoflegends/sacrifice

## Layout
- Left 260px sticky sidebar: the track list (S4/S5/… badge + emoji + title + year); clicking highlights with a gold border and switches tracks via SC.Widget.load() with auto_play
- Right main area: hero title + a desktop clock (80px monospace gold HH:MM:SS, refreshed every second, blinking colons) + a mood tag
- Player card: the SoundCloud iframe + a custom control bar (⏮ ▶/⏸ ⏭ + track info + a volume slider; clicking the speaker icon toggles mute)
- Mood-wave section: 15 gold animated bars, re-randomized on every track switch
- Keyboard shortcuts: Space play/pause, ← → previous/next, ↑ ↓ volume

## Design
Linsight visual style (see the web-design skill), dark by default. On phones the sidebar becomes a horizontally scrolling top bar.

When done, open index.html in a browser and self-test once.`,
    promptZh: `用 SoundCloud Widget API（见 https://developers.soundcloud.com/docs/api/html5-widget）做一个英雄联盟 Worlds 主题曲播放器，单文件 index.html，file:// 打开即用。

## 技术约束
- 使用 SC.Widget JS API（widget.load / widget.toggle / widget.setVolume / widget.seekTo），引入 https://w.soundcloud.com/player/api.js
- iframe 必须可见（180px 高），visual=true color=f0b90b single_active=true
- 仅包含以下 8 首已确认可播曲目（oEmbed 验证通过），不要添加未经 oEmbed 验证的曲目：
  - Warriors (S4) — soundcloud.com/leagueoflegends/warriors
  - Worlds Collide (S5) — soundcloud.com/leagueoflegends/worlds-collide
  - Legends Never Die (S7) — soundcloud.com/leagueoflegends/legends-never-die
  - Phoenix (S9) — soundcloud.com/leagueoflegends/phoenix
  - Burn It All Down (S11) — soundcloud.com/leagueoflegends/burn-it-all-down
  - GODS (S13) — soundcloud.com/leagueoflegends/gods
  - Heavy Is The Crown (S14) — soundcloud.com/linkinpark/heavy-is-the-crown
  - Sacrifice (S15) — soundcloud.com/leagueoflegends/sacrifice

## 布局
- 左侧 260px 粘性侧边栏：曲目列表（S4/S5/… 标签 + emoji + 曲名 + 年份），点击高亮金色边框，SC.Widget.load() 切歌 + auto_play
- 右侧主区域：Hero 标题 + 桌面时钟（80px 等宽金色 HH:MM:SS，每秒刷新，冒号闪烁）+ 心情标签
- 播放器卡片：SoundCloud iframe + 自定义控制栏（⏮ ▶/⏸ ⏭ + 曲目信息 + 音量滑块，点击喇叭图标静音切换）
- 心情波动区：15 根金色动画柱，切歌时重新随机生成
- 键盘快捷键：空格播放暂停、← → 切歌、↑ ↓ 调音量

## 设计
Linsight 视觉风格（见 web-design 技能），默认深色。手机端侧边栏变为顶部横向滚动。

完成后在浏览器打开 index.html 自测一次。`,
    agentId: null,
    skills: ["web-design"],
    tools: [],
    cover: { kind: "glyph", glyph: "⚔️" },
    previewFilename: null,
    featured: false,
    order: 2,
    enabled: true,
  },
  {
    id: "rhythm-runner",
    kind: "app",
    categoryId: "webapps",
    title: "Rhythm runner mini game",
    titleZh: "音乐节奏跑酷小游戏",
    description:
      "A Muse Dash-style rhythm runner: a penguin lead, notes locked to the beat, graded Perfect / Great / Miss",
    descriptionZh:
      "喵斯快跑式的音乐节奏跑酷：企鹅主角，音符踩着节拍飞来，判定分 Perfect / Great / Miss",
    prompt:
      "Build a Muse Dash-style rhythm runner: a penguin runs forward on its own, and notes — " +
      "drawn as music-note icons — fly in locked to the beat for me to hit. Show Perfect / " +
      "Great / Miss for each hit, score combos, and let the difficulty climb as the track goes " +
      "on. Pure front end, one file, playable straight from file://.",
    promptZh:
      "做一个喵斯快跑（Muse Dash）式的音乐节奏跑酷小游戏：主角是一只企鹅，自动向前跑；" +
      "音符画成音符图标，严格踩着节拍飞来，玩家按键击打，判定显示 Perfect / Great / Miss 三档，" +
      "连击计分，难度随曲子推进。纯前端单文件，file:// 直接打开即玩。",
    agentId: null,
    skills: ["web-design"],
    tools: [],
    cover: { kind: "glyph", glyph: "🎵" },
    previewFilename: null,
    featured: false,
    order: 3,
    enabled: true,
  },
  {
    id: "investment-copilot",
    kind: "app",
    categoryId: "agents",
    title: "Conversational investment analyst",
    titleZh: "对话式投资分析助理",
    description:
      "A conversational market Copilot on the Linsight SDK: the home page lists what is trending, with the market factors behind every call",
    descriptionZh:
      "用 Linsight SDK 做对话式看盘 Copilot：首页列出近期走势较好的股票，每个判断都说清市场因素",
    prompt:
      "Build a conversational stock-market Copilot on the Linsight SDK, along the lines of " +
      "perplexity.ai/finance: from startup it pulls live market data every 5 minutes, and the " +
      "home page lists the stocks trending strongest lately alongside how the sectors compare. " +
      "Every call has to name the market factors behind it — policy, sector news, fund flows, " +
      "earnings, macro data — rather than technical indicators. Analysis of public data, not " +
      "investment advice. Its stock-lookup tool has to handle questions like \"look up Zhipu's " +
      'stock for me": resolve a company name to its ticker itself, and when there is no match ' +
      "or the company is not listed, say so rather than inventing a quote.",
    promptZh:
      "用 Linsight SDK 做一个对话式的股市 Copilot，形态参考 perplexity.ai/finance：启动后每 5 分钟实时抓取大盘行情，" +
      "首页直接列出近期走势较好的股票和板块强弱，每个判断都要说清背后的市场因素——政策、行业消息、" +
      "资金流向、财报或宏观数据，而不是技术指标，" +
      "只做分析不是投资建议。它的查股工具要能答「帮我查一下智谱的股票」这类问题：" +
      "按公司名（中文也行）自己对应到股票代码，查不到或没上市就直说，不要编。",
    agentId: null,
    skills: ["linsight-sdk", "web-design"],
    tools: [],
    cover: { kind: "glyph", glyph: "📈" },
    previewFilename: null,
    featured: true,
    order: 0,
    enabled: true,
  },
  {
    id: "rag",
    kind: "app",
    categoryId: "agents",
    title: "Build a Claude Code docs RAG agent",
    titleZh: "构建 Claude Code 文档 RAG 智能体",
    description:
      "Collect the claude-code-docs repo into a conversational RAG knowledge app with source citations",
    descriptionZh: "收集 claude-code-docs 仓库，生成可对话、带来源引用的 RAG 知识应用",
    prompt:
      "Collect the docs from https://github.com/ericbuess/claude-code-docs and build a RAG knowledge app: " +
      "clone the repo and prepare the corpus, then build a retrieval index; " +
      "the app acts as a Claude Code configuration expert, answering Claude Code questions " +
      "with retrieval-augmented replies and clickable citations that reveal the matched " +
      "original text chunk and link to the real documents; " +
      "give it a beautiful web chat UI following the web-design skill. " +
      "When done, run the app and self-test one Chinese question and one English question, confirming both retrieve " +
      "the right English documents and stream their answers, then tell me how to access it.",
    promptZh:
      "收集 https://github.com/ericbuess/claude-code-docs 的文档，构建一个 RAG 知识应用：" +
      "克隆仓库并整理语料，建立检索索引；应用化身 Claude Code 配置专家，" +
      "检索增强回答 Claude Code 相关问题并标注可点击的来源引用——" +
      "引用要能展示命中的原文片段，并链接到真实文档；" +
      "按 web-design 技能提供美观的 Web 聊天界面。" +
      "完成后运行应用，用一个中文问题和一个英文问题各自测一次，" +
      "确认两者都检索到了正确的英文文档、流式回答正常，并告诉我访问方式。",
    agentId: null,
    skills: ["linsight-sdk", "web-design"],
    tools: [],
    cover: { kind: "glyph", glyph: "📚" },
    previewFilename: null,
    featured: true,
    order: 1,
    enabled: true,
  },
  {
    id: "agent-benchmark-build",
    kind: "agent",
    categoryId: "agents",
    title: "Build a general-purpose decision agent and its benchmark",
    titleZh: "构建通用决策智能体和评测基准",
    description:
      "Create a general decision Agent and test it on football, after-sales, and investment tasks",
    descriptionZh: "创建一个通用决策 Agent，并用足球、售后和投资任务检验它",
    prompt: `Use \`agent-initialization\` followed by \`benchmark-design\` to create a decision Agent and produce a frozen Benchmark with a Formal Baseline.

Agent:
- id: \`finite_choice_agent\`
- capability: make stable, explainable finite choices when public information is incomplete or conflicting
- installed_skills: \`[]\`

Benchmark:
- id: \`contextual-choice-adaptation\`
- capability: form and transfer a stable finite-choice decision process from public rules, historical examples, and current facts
- desired_baseline_score: \`<75\`
- pilot_iteration_limit: \`5\`

Scenarios:
1. Make football betting decisions from historical matches and current information.
2. Choose after-sales actions from policy and ticket facts.
3. Choose investment actions from a strategy, historical markets, and current indicators.`,
    promptZh: `请依次使用 \`agent-initialization\` 和 \`benchmark-design\`，创建决策 Agent，并产出 Frozen Benchmark 与 Formal Baseline。

Agent：
- id：\`finite_choice_agent\`
- 能力：面对有限选项，在公开信息不足或冲突时仍能给出稳定、可解释的选择
- installed_skills：\`[]\`

Benchmark：
- id：\`contextual-choice-adaptation\`
- capability：从公开规则、历史案例和当前事实中形成并迁移稳定的有限选择决策过程
- desired_baseline_score：\`<75\`
- pilot_iteration_limit：\`5\`

场景：
1. 根据历史比赛与当前信息进行足球投注决策。
2. 根据售后政策与工单事实选择处置动作。
3. 根据投资策略、历史市场与当前指标选择投资动作。`,
    agentId: null,
    skills: [],
    tools: [],
    cover: { kind: "glyph", glyph: "🧪" },
    previewFilename: null,
    featured: false,
    order: 2,
    enabled: true,
  },
  {
    id: "agent-optimization",
    kind: "agent",
    categoryId: "agents",
    title: "Improve the general-purpose decision agent's accuracy",
    titleZh: "优化通用决策智能体的准确率",
    description:
      "Improve an Agent from existing evaluation results and verify that the new version is better",
    descriptionZh: "根据已有评测结果改进 Agent，并验证新版本是否真正提升",
    prompt: `Use \`agent-optimization\` to optimize a decision Agent against its frozen Benchmark.

- test_agent_id: \`finite_choice_agent\`
- benchmark_id: \`contextual-choice-adaptation\`
- capability_direction: improve stability under incomplete information, conflicting rules, and finite choices
- runs: \`3\`
- desired_score: \`>=95\`
- candidate_round_limit: \`5\``,
    promptZh: `请使用 \`agent-optimization\`，根据 Frozen Benchmark 优化决策 Agent。

- test_agent_id：\`finite_choice_agent\`
- benchmark_id：\`contextual-choice-adaptation\`
- capability_direction：提高信息不完整、规则冲突和有限选项决策中的稳定性
- runs：\`3\`
- desired_score：\`>=95\`
- candidate_round_limit：\`5\``,
    agentId: null,
    skills: [],
    tools: [],
    cover: { kind: "glyph", glyph: "⚙️" },
    previewFilename: null,
    featured: false,
    order: 3,
    enabled: true,
  },
  {
    id: "daily-plan",
    kind: "prompt",
    categoryId: "schedules",
    title: "A 9am daily planning check-in",
    titleZh: "每天早 9 点的计划对话",
    description:
      "09:00 every day: talk through the day's plan in this same chat, and review yesterday's progress",
    descriptionZh: "每天 09:00 在同一个会话里聊当天计划，并回顾昨天的进展",
    prompt:
      "Set up a scheduled task: every day at 9am, in this same conversation, plan today's work " +
      "with me. Read back over the conversation first and say what yesterday's plan got done and " +
      "where it stuck, then offer an ordered shortlist for today with a line of reasoning each, " +
      "and write up what I confirm as a checklist.",
    promptZh:
      "建一个定时任务：每天早上 9 点在这个会话里和我聊今天的计划。" +
      "先回看上文说清昨天定的事做完了多少、哪些卡住，再给我一份排好序的今日候选、每条一句理由，" +
      "我确认后写成清单。",
    agentId: null,
    skills: [],
    tools: [],
    cover: { kind: "glyph", glyph: "📅" },
    previewFilename: null,
    featured: true,
    order: 0,
    enabled: true,
  },
  {
    id: "github-digest",
    kind: "prompt",
    categoryId: "schedules",
    title: "Daily GitHub project digest",
    titleZh: "每天汇总 GitHub 项目状态",
    description:
      "A daily pass over one repo's issues, PRs and CI, ending in prioritized recommendations",
    descriptionZh: "定时跑一遍仓库的 Issue、PR 与 CI，日报结尾给出按优先级排序的建议",
    prompt:
      "Set up a scheduled task: every morning, use gh to digest one GitHub repo's issues, PRs " +
      "and CI — surface what has stalled, what is waiting on review and what is failing — and " +
      "end with recommendations ranked by priority, each saying why it sits where it does.",
    promptZh:
      "建一个定时任务：每天早上用 gh 汇总一个 GitHub 仓库的 Issue、PR 与 CI 状态，" +
      "挑出停滞的、待评审的和挂掉的，结尾给出按优先级排序的建议，每条说清为什么排在这个位置。",
    agentId: null,
    skills: [],
    tools: [],
    cover: { kind: "glyph", glyph: "🐙" },
    previewFilename: null,
    featured: false,
    order: 1,
    enabled: true,
  },
  {
    id: "memory-review",
    kind: "prompt",
    categoryId: "schedules",
    title: "Friday memory review",
    titleZh: "每周五晚回顾并记录 Memory",
    description:
      "Friday evening: go through what is worth remembering from the week and write it into Memory",
    descriptionZh: "周五傍晚一起过一遍这周值得长期记住的事，确认后由你写进 Memory",
    prompt:
      "Set up a scheduled task: every Friday evening, in this same conversation, go through " +
      "what is worth remembering from the week with me. Check the existing memory index first so " +
      "nothing is duplicated, then take it item by item — what to record, what to revise — and " +
      "write what I confirm into Memory.",
    promptZh:
      "建一个定时任务：每周五傍晚在这个会话里和我过一遍这周值得长期记住的事。" +
      "先看已有记忆索引避免重复，再逐条问我该记什么、要不要改已有的，我确认后你写进 Memory。",
    agentId: null,
    skills: [],
    tools: [],
    cover: { kind: "glyph", glyph: "🧠" },
    previewFilename: null,
    featured: false,
    order: 2,
    enabled: true,
  },
];

/**
 * The built-in catalog in the shape every consumer wants: the categories to draw tabs from, and
 * the cases to file under them, each marked `builtin` with no directory of its own.
 *
 * The **categories here are seed data, not live catalog state** — the server writes them to a fresh
 * library once and the admin owns them from then on. The web app still reads them as its first
 * paint, which is why they are here rather than only in the seed call; a rename lands as soon as the
 * API answers.
 *
 * Returned fresh on every call rather than as a module-level constant, so a caller that sorts or
 * annotates the list cannot mutate what the next caller gets.
 */
export function builtinInspirationCatalog(): {
  categories: InspirationCategory[];
  cases: InspirationCase[];
} {
  return {
    categories: SEED_INSPIRATION_CATEGORIES.map((category) => ({ ...category })),
    cases: BUILTIN_INSPIRATION_CASES.map((one) => ({
      ...one,
      skills: [...one.skills],
      tools: [...one.tools],
      cover: { ...one.cover },
      source: "builtin" as const,
      packagePath: null,
      createdAt: null,
      updatedAt: null,
      createdBy: null,
    })),
  };
}
