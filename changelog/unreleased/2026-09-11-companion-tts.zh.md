# AI 伴侣 — 悬浮宠物 TTS + 语音反应

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `server`, `web`

[English](2026-09-11-companion-tts.md)

悬浮桌面宠物现在能把反应气泡念出来——默认走 OS 的 TTS 引擎（Web Speech API）。Provider 是一个封闭枚举（`"off" | "webspeech"`），未来 ElevenLabs / OpenAI / 本地 Kokoro 都通过同一个 `CompanionTtsProvider` 接口接入，调用方零改动。不打开新设置行的用户听到的是沉默——默认 `"off"`，跟伴侣其它选项的 opt-in 模式一致。

## 本轮交付

伴侣专属设置页（`packages/web/src/features/settings/companion-section.tsx`）在主动聊天滑块下面再加两行：

- **语音输出**（`companionTtsProviderLabel`）：覆盖 `关闭 / 系统语音` 的 2 段 `Segmented<CompanionTtsProvider>`。`Info` 弹层解释契约（仅悬浮窗、走 OS TTS）。
- **嗓音**（`companionTtsVoiceLabel`）：一个原生 `<select>`，从 `speechSynthesis.getVoices()` 拿到列表后填入。首项是 `跟随系统`（空字符串覆盖）；列表长度差异巨大（macOS premium 上百条、headless 测试零条），所以这一行是 `<select>` 而不是 `Segmented`。

Provider 抽象放在 `packages/web/src/features/chat/companion-tts/`：

- `provider.ts` —— `CompanionTtsProvider` 接口（`listVoices / speak / cancel / id`）。`speak` 在 utterance **开始** 时 resolve，不在结束时，调用方可以放心链式。
- `webspeech.ts` —— Web Speech 实现。包 `window.speechSynthesis`，暴露 `readyVoices()` 异步 helper 给 picker（Chromium 的 `getVoices()` 在 `voiceschanged` 触发前返回空数组；hook 最多等 1.5 s 然后用已有的返回，保证 headless 环境不会卡死在「加载中」）。rate / pitch / volume 在包装层 clamp 到 API 实际生效的区间，避免设置滑块产生静默 no-op。
- `registry.ts` —— `createTtsProvider(id)`，封闭枚举 → 实例。`"off"` 返回 `null`（`useTts().speak` 短路 resolve，不会触碰 `speechSynthesis`）。
- `use-tts.ts` —— React hook。首次使用时构造一个 provider，切换 provider 时丢掉旧实例（Web Speech 是全局的够安全；付费 provider 一旦需要缓存 auth 会改成 `useRef`，但注册中心这个间接层不变）。

悬浮窗（`packages/web/src/features/chat/companion-page.tsx`）每次气泡出现就 `tts.speak(bubble.text, { lang })`。`lang` 复用 banner 已经在用的 `detectLang()`，provider 内部做 lang → voice 映射。Banner / widget 保持纯视觉——chat tab 是用户正在打字的主动交互面，浏览器 autoplay 政策会悄悄拦掉音频，而且突然开口会把正在输入的用户吓到。

## 服务端校验

`UiPrefs` 新增两个可选字段（`packages/server/src/api/types.ts`）：

```ts
companionTtsProvider?: CompanionTtsProvider;  // "off" | "webspeech"
companionTtsVoice?: string;                    // trim 过，≤ 64 字符
```

两者都由 `packages/server/src/services/companion-prefs.ts` 在写入时校验：`validateCompanionTtsProvider` 拒绝未知字符串（同 `validateCompanionPronoun` 的封闭枚举模式），`validateCompanionTtsVoice` trim + length-cap。拒绝的写入不存盘、返回 400——路由层契约与 `draftShortcuts`、`companionName` 校验器一致。`PUT /api/me/prefs` 的浅合并语义不变。

Web 端 `useCompanionStore` 新增 `ttsProvider / ttsVoice / setTtsProvider / setTtsVoice`，从 `GET /api/me/prefs` 经 `companionTtsFromPrefs` 加载（老 prefs 文件落到 `"off"` + 空字符串，与新用户默认值一致），通过 `PUT /api/me/prefs` fire-and-forget 写入。

## 兼容性

- **零数据迁移。** `companionTtsProvider` 与 `companionTtsVoice` 可选；老 prefs 文件加载后是 `ttsProvider = "off"`、`ttsVoice = ""`——与新用户默认值相同，与 L.4 之前的静默行为一致。
- **chat tab 故意保持沉默。** 气泡仍在 banner / widget 显示，但这两个面不调 `useTts`。音频路径只跑在 Electron 悬浮窗里，那里已经有独立且不受 autoplay 限制的 audio context。
- **Provider 枚举封闭。** 增加 ElevenLabs / OpenAI / Kokoro 是 server（`packages/server/src/api/types.ts`）+ web（`packages/web/src/features/chat/companion-store.tsx`）两侧 enum 扩展，再加一个 `registry.ts` 条目。所有调用方都走注册中心间接层，零改动。
- **`prefers-reduced-motion` 不会关掉音频。** reduced-motion 是视觉偏好；显式打开 TTS 的用户就是想让宠物说话。后续如果需要「失焦时静音伴侣」之类的无障碍选项，再独立做，不该混在 OS 偏好里。
- **主动聊天触发骨架（L.2）不受影响。** `useProactiveTrigger` 仍然只判断空闲；L.4 只为已有的气泡反应加音频。后续阶段会把 TTS 也接入主动消息，仍走同一个 `companionTtsFromPrefs` 加载。

## 测试

- `packages/server/test/companion-prefs.test.ts` —— 跨两个 describe 块 7 个新用例：每个 provider id 往返、一个未知 provider 被 400 拒绝（且失败的合并不污染已 seed 的无关字段）、voice 各路径往返、空格被 trim、空字符串合法、超长 voice 被拒绝且 seed 字段保留。
- `packages/web/test/companion-store.test.ts` —— 6 个新用例钉死 `companionTtsFromPrefs`（默认 `off`、`webspeech` 原样回写、未知 provider 回退、非字符串 voice 回退）与封闭枚举顺序。
- `packages/web/test/companion-tts/webspeech.test.ts` —— 11 个用例：`clampForTest`（NaN / 超界 / 范围内）、`mapVoicesForTest`（往返 + 空）、`pickVoiceForTest`（空列表、精确 voiceURI、回退 lang 匹配、空字符串 voiceId、空字符串 lang 让浏览器自己选）。
- `packages/web/test/companion-tts/registry.test.ts` —— 3 个用例：`createTtsProvider("off")` 为 `null`、`createTtsProvider("webspeech")` 返回 id 为 `"webspeech"` 的 Web Speech 实例、`TTS_PROVIDERS_WITH_VOICES` 含 `webspeech` 但不含 `off`（所以嗓音 picker 行只在真有 provider 时渲染）。