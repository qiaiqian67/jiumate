# AI 伴侣 — 麦克风输入 + ASR

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `server`, `web`

[English](2026-09-11-companion-asr.md)

聊天 composer 多了一颗麦克风按钮。点按录音，再点按停止。最终文本落到 composer 里由用户确认后再发送——语音是听写通道，不是回车键。Provider 是封闭枚举（`"off" | "webspeech"`），未来 Whisper 云服务 / AWS Transcribe / 本地 Whisper.cpp 都通过同一个 `CompanionAsrProvider` 接口接入，composer 零改动。不打开新设置行的用户看不到麦克风——默认 `"off"`，跟伴侣其它选项的 opt-in 模式一致。

## 本轮交付

伴侣专属设置页（`packages/web/src/features/settings/companion-section.tsx`）在 TTS 嗓音选择下面再加一行：

- **语音输入**（`companionAsrProviderLabel`）：覆盖 `关闭 / 系统识别` 的 2 段 `Segmented<CompanionAsrProvider>`。`Info` 弹层解释契约（仅 composer 旁、走 OS 识别引擎、转写文本进 composer 由用户确认）。

Provider 抽象放在 `packages/web/src/features/chat/companion-asr/`：

- `provider.ts` —— `CompanionAsrProvider` 接口（`available / start / stop / id`）加判别式 `AsrError` 联合（`permission-denied | no-speech | audio-capture | network | aborted | other`）。`start` 在识别器报告「开始」时 resolve；转写文本通过 `onInterim`（实时预览，本轮不消费）和 `onFinal`（每段话一次）流式回传。
- `webspeech.ts` —— Web Speech 实现。包 `window.SpeechRecognition || window.webkitSpeechRecognition`。`available()` 在构造函数不存在 **或** 页面不在 secure context 时返回 false（Chromium 在普通 HTTP 上不暴露 API——非 secure 页能 TTS 但不能 ASR）；composer 用这个探测隐藏按钮，而不是放一颗永远失败 `not-allowed` 的按钮。错误通过 `mapErrorForTest` 从 Web Speech event 的自由格式 `error` 字符串映射到 `AsrError` 联合，让 UI 显示对应的提示（「麦克风权限被拒绝」和「没听到声音」是两件不同的事）。双重 start 通过 abort 旧识别器、重新开始——用户连续点按时比抛错友好。
- `registry.ts` —— `createAsrProvider(id)`，封闭枚举 → 实例。`"off"` 返回 `null`；`useAsr` 短路 `start`，不触碰 SpeechRecognition 构造函数。
- `use-asr.ts` —— 镜像 `use-tts.ts` 的 React hook。provider id 变化时重建 provider；暴露 `listening / error / available / start / stop`。composer 把 `available` 接到按钮可见性、`listening` 接到按下态；识别器自己的 `onend` 触发最终转写回调，所以用户主动停止也能拿到部分文本。

## Composer 接入

聊天输入（`packages/web/src/features/chat/chat-input.tsx`）在模型徽标和既有的 send/stop 按钮之间渲染一颗 `<button>`，条件 `asrProvider !== "off" && useAsr().available`。点按切换 `start`/`stop`；最终转写文本走 `onTextChange?.(next)`——跟键盘输入同一条路径——draft 自动缓存、slash 菜单 caret 跟踪、历史导航、recall round-trip 都保持不变。监听中麦克风图标翻转成实心圆 + Tailwind `animate-ping` 光晕，`aria-pressed` 反映状态。`recognition.start` 的 `lang` 参数沿用 TTS 已经用的 `detectLang()`（中文 UI 传 `zh-CN`、英文传 `en-US`），双语 OS 选对引擎。

ASR 错误通过现有 `toastError` 通道弹出，按 `AsrError.kind` 走单条 `asrErrorMessage(err)` helper（这样测试能在不渲染 React 的前提下钉住映射）：`permission-denied → "麦克风权限被拒绝…"`，`no-speech → "没有听到声音…"`，`audio-capture → "麦克风不可用…"`，`network → "语音识别服务暂时不可用…"`，`aborted → 静默`（用户主动取消，不是错误），`other → 识别器自带消息或通用兜底`。

## 服务端校验

`UiPrefs` 新增一个可选字段（`packages/server/src/api/types.ts`）：

```ts
companionAsrProvider?: CompanionAsrProvider;  // "off" | "webspeech"
```

写入时由 `packages/server/src/services/companion-prefs.ts` 校验：`validateCompanionAsrProvider` 拒绝未知字符串（跟 `validateCompanionTtsProvider`、`validateCompanionPronoun` 同一种封闭枚举 pattern）。被拒绝的写入什么也不存，返回 400——路由级契约与现有 `draftShortcuts`、`companionName` validator 一致。浅合并 `PUT /api/me/prefs` 语义不变。

`useCompanionStore` 在现有 identity / TTS 字段旁边暴露 `asrProvider / setAsrProvider`，从 `GET /api/me/prefs` 经 `companionAsrFromPrefs` 水合（旧 prefs 文件默认 `"off"`），写入走 fire-and-forget 的 `PUT /api/me/prefs`。

## 兼容性

- **零数据迁移**。`companionAsrProvider` 是可选字段。旧 prefs 文件水合为 `asrProvider = "off"`——跟新用户默认一致，等价于本轮之前「没有麦克风按钮」的行为。
- **麦克风按钮 opt-in**。`companionAsrProvider === "off"`（默认）的用户看不到按钮。选了 `"webspeech"` 但页面里没有 `SpeechRecognition`（Firefox / 旧版 Electron renderer）的用户也看不到按钮——`available()` 探测就是闸门。
- **没有显式用户动作就不会触发音频采集**。`not-allowed` Web Speech 错误以 toast 形式告知用户在浏览器 / OS 设置里允许麦克风访问；composer 绝不会回退到「静默用上一段录音」。
- **封闭 provider 枚举**跟 L.4 的 TTS provider list 同一套扩展面——加 Whisper / AWS Transcribe / 本地 Whisper.cpp 是 server（`packages/server/src/api/types.ts`）+ web（`packages/web/src/features/chat/companion-store.tsx`）各一处枚举扩展，加 `registry.ts` 一个新条目。所有调用方走注册中心间接层，零改动。
- **键盘用户的 composer 行为不变**。所有既有流程（粘贴、拖拽、slash 命令、历史导航、recall）原样工作——麦克风是额外输入，不是替代。

## 测试

- `packages/server/test/companion-prefs.test.ts` —— `ui_prefs companionAsrProvider` 块新增 3 个 case：每个 provider id 经 `PUT /api/me/prefs` round-trip；未知 provider 被 400 拒绝（被拒绝的合并不会清掉之前 seed 的无关字段，跟 L.4 的 TTS provider 块同形）。
- `packages/web/test/companion-store.test.ts` —— 新增 5 个 case 钉住 `companionAsrFromPrefs` 与 `COMPANION_ASR_PROVIDERS` 顺序（`off` 在前，安全的默认）。未知 provider 字符串水合为 `"off"` 而不是抛错或回显未知值。
- `packages/web/test/companion-asr/webspeech.test.ts` —— 新增 8 个 case 钉住 `mapError` 映射：每个 Web Speech error code（包括 `not-allowed` / `service-not-allowed` 两个权限变体）映射到正确的 `AsrError` kind；fallback 走 `other`，带上识别器自带消息。
- `packages/web/test/companion-asr/registry.test.ts` —— 新增 2 个 case 钉住封闭枚举 → 实例映射：`"off"` → `null`，`"webspeech"` → 一个 `id === "webspeech"` 的 `WebSpeechAsrProvider` 实例。
- `packages/web/test/companion-asr/webspeech-lifecycle.test.ts` —— 新增 8 个 case 用 stub 构造函数跑完整生命周期：`available()` 在构造函数 + secure-context 两个分支上正确；`start()` 在 `onstart` 上 resolve；finals 走 `onFinal` 流回，inters 走 `onInterim` 流回；错误映射到 `AsrError` 并清空活动 session，使后续 `start()` 工作；双重 start abort 旧 session；`stop()` 空闲时是 no-op、有 session 时委托给底层识别器。
