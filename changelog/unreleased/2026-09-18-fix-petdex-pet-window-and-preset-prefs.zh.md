# 修复 Petdex 桌宠窗口无法打开、以及预设偏好被重置

- **Date:** 2026-09-18
- **Type:** fix
- **Scope:** `desktop`, `server`

[English](2026-09-18-fix-petdex-pet-window-and-preset-prefs.md)

修复了 Petdex 桌宠的两个缺陷：悬浮宠物窗口从未被创建，以及选中的预设会在下次加载时回到默认。

## 悬浮窗口现在能打开了

- preload 桥被 `tsup` 打进了 ESM 产物，而它要交给一个 `sandbox: true` 的渲染进程，后者只接受 CommonJS 的 preload。Electron 直接丢弃它（`Cannot use import statement outside a module`），因此 `contextBridge.exposeInMainWorld("pet", …)` 从未执行，`window.pet` 始终是 `undefined`。chat 页那句 `window.pet.open()` 从未被执行，于是没有任何 `/pet` 请求，窗口也不会出现。
- preload 现在单独打成 CommonJS 的 `dist/preload.cjs`，由新增的 `tsup.preload.config.ts` 产出。包 `build` 脚本在 ESM 构建之后（`clean` 由它负责）以第二次 `tsup` 调用来构建它；`main.ts` 与 `pet-window.ts` 在主窗口和宠物窗口中都加载 `preload.cjs`。
- `scripts/build-assets.mjs` 现在会在 `dist/preload.cjs` 缺失或含 ESM 语法时让构建失败，避免这个入口被无声地并回 ESM 构建。

## 选中的预设不再被重置

- 服务端的 `validatePetPrefs` 会把不在已安装目录中的 `activePetId` 置为 `null`。13 个内置预设是以 web 资源形式随包发布的（`packages/web/public/pets/`），并不在服务端目录里，因此任何非默认预设都会被 `PUT /api/me/prefs` 改写成 `null`，下次加载时宠物退回 `blue-golden`。
- 现在只要 `activePetId` 是字符串且在长度限制内就原样保留；服务端不再强制校验其是否属于目录。

## 测试

- 新增了 server、web、desktop 的单元测试，覆盖宠物偏好校验、sprite 几何计算辅助函数，以及宠物窗口的 IPC 面。
