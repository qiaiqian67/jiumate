# 支持导入 Codex 桌面端内置的宠物

- **Date:** 2026-09-18
- **Type:** feature
- **Scope:** `server`, `web`

[English](2026-09-18-codex-pet-import.md)

Codex 桌面端把自带的 Petdex 宠物打包在它的 webpack chunk 里。本变更会定位该安装、把宠物从它的 `app.asar` 里读出来，并提供审核与导入——对齐 OpenBitFun 的 Codex 适配器能力。

## 发现

- 服务端会查找各平台的 Codex 与 ChatGPT 桌面端安装位置，以及从 Windows AppModel 注册表读出的应用商店/MSIX 包根目录。`reg.exe` 是尽力而为：它失败只损失 MSIX 路径，不影响功能，原因会作为诊断信息报出。
- bundle 是**当文本解析、绝不执行**的，归档是**当容器读取**的：在服务端里运行别的应用的 bundle 不在选项内。取值在运行时才拼出来的定义（`${…}`、转义、函数调用）、不是纯 slug 的 id、本宿主无法渲染的精灵版本、以及同一个 id 有两个内容不同的定义——一律拒绝，而不是猜。
- 精灵图通过 bundle 自己的 asset map 解析，因此当 bundle 里存在同一图集的多代文件时会命中当前那一代，而不是归档里最先列出的那个。
- 单个宠物读不出来只产生一条诊断，其余条目照常返回。

## 审核与导入

- `GET /api/pets/external` 列出候选，带上读取时的指纹、预览 URL，以及此前导入的状态：`imported`，外加 `copyModified`（已安装副本被改过）与 `sourceChanged`（来源已更新）。
- `GET /api/pets/external/:sourceKey/spritesheet` 直接从来源归档里下发图集。这样列表本身保持很小，而选择器用与宠物渲染同一套 sprite CSS 把图集裁到第一帧——服务端没有图像解码器，所以它给的是字节而不是缩略图。
- `POST /api/pets/import-external` 会重新读取来源，指纹对不上就拒绝。这里指纹是**必填**而不是可选：来源是别的应用的文件，可能在列清单和写入之间被替换。
- 设置 → 应用 新增「从 Codex 导入」列表，含重新扫描、每个候选的状态标签与导入按钮。

## asar 读取器

- 新增无依赖的读取器 `services/asar.ts`。`@electron/asar` 只是经由 electron-builder 出现在树里的构建工具；把它作为运行时依赖，等于为了做一次目录查询就把一个 CLI、一个 glob 库和一个 minimatch 拉进服务端。OpenBitFun 出于同样的理由自己实现了一份。
- Electron 会把 `fs` 换成一层包装，任何含 `.asar` 的路径都被当作“从归档里读”，所以把归档当文件打开在那边必然失败——文件存在时报一个光秃秃的 `ENOENT, not found in <path>`，不存在时报 `Invalid package <path>`，两者都没有说出真正的问题。读取器在读取期间通过 `process.noAsar` 关掉 asar 支持，并因为该开关是进程级的而把窗口串行化。

## 修复

- 刚导入的宠物会被下一个读取者判定为“被改过”。receipt 里的 `installedFingerprint` 是用内存记录算的，其 `spritesheetPath` 带的是本机分隔符，而回读时会规范化——两者永远对不上。现在 receipt 记录的是磁盘上的真实内容。
- 目录导入与仅字节的外部导入现在共用同一个指纹与同一条 publish 路径，因此外部目录列出的候选与随后的导入不会对“来源是否变化”产生分歧。

## 兼容性

- 没有新增偏好，也没有数据迁移。外部导入与目录导入落在同一个目录里，之后除了 receipt 的 `sourceKey` 指回它来自哪个归档之外，无法区分。
