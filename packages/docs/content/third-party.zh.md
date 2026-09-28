---
title: 第三方与开源协议
description: 本仓库允许引入什么协议、由谁强制执行、以及历史上踩过的坑。
---

JiuMate 分发的是可执行产物——桌面应用、服务器包、CLI。第三方代码一旦被打进这些产物，它的协议就跟着一起分发出去，而协议义务不是"注意一下"就能满足的：它决定你能不能用某个库，以及能不能修改它。本页写清规则、执行方式，以及已经确认过的具体结论。

## 规则

**默认拒绝。** 白名单之外的协议一律让构建失败。之所以不用黑名单，是因为黑名单只能拦住有人已经想到的协议，而真正出事的那次，永远是没人想到的那个——依赖悄悄改了协议，或者某个没人主动选的传递依赖带了进来。

**允许打包的协议**（宽松型，可自由使用与修改）：MIT、ISC、Apache-2.0、BSD-2/3/4-Clause、0BSD、Unlicense、Zlib、CC0-1.0、BlueOak-1.0.0、MPL-2.0。

MPL-2.0 虽属 copyleft 但在名单内：它的义务按**文件**附着，所以打包未修改的依赖没有问题；**修改**它的文件则不行。这条是审查时的规则，脚本检测不到。

**不允许**：AGPL、SSPL、BUSL、Elastic License，以及 GPL / LGPL 系列的**打包**引入。非商业（CC-BY-NC）与相同方式共享（CC-BY-SA）同样不行——它们限制了使用场景，或把义务传染到你的产物上。

**`Unknown` 不算通过。** 元数据缺失时按拒绝处理，必须显式加入例外并写明理由。

## 谁来执行

`scripts/check-licenses.mjs`（`pnpm check:licenses`）读取 `pnpm licenses list --prod --json`，对**生产依赖**逐一判定，任何一项不被允许即退出码 1。CI 在 `style` job 里执行它——那里不需要构建，而"新增了一个依赖"恰恰是应该在最便宜的 job 上失败的事情。

只检查生产依赖，是因为只有它们会进入用户运行的产物。代价是：构建期工具若带 copyleft，理论上可能把代码带进输出——这属于审查问题，协议字段本身答不了。

判定 SPDX 表达式时，`OR` 取其一即可（`(MPL-2.0 OR Apache-2.0)` 选 Apache 分支是自由的），`AND` 则要求两侧同时满足。

## 例外

无法由规则本身裁决的情况记在脚本的 `EXCEPTIONS` 里，每条都要写明理由，且**每次运行都会打印出来**——包括通过的时候。只在出错时才出现的例外，是没人记得自己同意过的例外。

当前有一条：

- **`khroma`**——报告为 `Unknown`，因为它的 package.json 没有 license 字段，仓库实际声明 MIT。由 mermaid 传递引入（Web 端的图表渲染器），并非有人直接选择的依赖。

这道闸门产出的第一条记录是 `@jiumate/use-guizang-ppt`——一个 AGPL-3.0 的可选插件。它被记录在案而非静默放行，随后被移除：该协议是本项目明令排除的，而 `use-bento-slides`（MIT）覆盖了同样的演示文稿场景。

## 已经确认的结论

调研新模块时逐条核实过、值得记住的：

| 组件 | 协议 | 结论 |
| --- | --- | --- |
| Pandoc | GPL-2.0-or-later | 仅打包在桌面端，经子进程调用。属聚合分发，现状保留 |
| ONLYOFFICE DocumentServer | **AGPL-3.0** | 不采用。网络服务场景下 §13 要求向使用者提供完整源码 |
| Collabora Online | 见 Gerrit | GitHub 上的仓库只是 issue tracker，协议标为 Other；实际开发在 Gerrit |
| SheetJS（`xlsx`） | Apache-2.0 | **不要用 npm 版**：停在 0.18.5（2022 年）且带 CVE-2023-30533、CVE-2024-22363，官方已迁至自有 CDN |
| mammoth | BSD-2-Clause | 可用。docx → HTML |
| pdfjs-dist | Apache-2.0 | 可用。PDF 解析与渲染 |
| exceljs | MIT | 可用。xlsx 读写，SheetJS 的替代 |
| docx-preview | Apache-2.0 | 可用。docx 浏览器端渲染 |
| officeparser / word-extractor | MIT | 可用。pptx 抽取 / 旧版 .doc |
| turndown / html-to-docx | MIT | 可用。HTML ↔ Markdown / Markdown → docx |
| tesseract.js | Apache-2.0 | 可用。OCR |
| Bento（`use-bento-slides`） | MIT | 可用。自带运行时的单文件幻灯片，文档为 JSON，可原地编辑 |

选型时的顺序：先看能否用已有的宽松协议依赖解决；否则找宽松协议的替代品；只有在协议本身确实因**分发方式**而可接受时（独立可执行文件、用户自行安装的可选插件），才走例外并写明理由。

## 新增依赖时

1. 优先选 MIT / ISC / Apache-2.0 / BSD。
2. 跑 `pnpm check:licenses`。它失败就说明需要处理，而不是需要绕过。
3. 若元数据有误（实际是宽松协议但字段没写），加进 `EXCEPTIONS` 并写明。
4. 若协议因分发方式可接受，加进 `EXCEPTIONS` 并写明**为什么一年后读这段话的人也能认可**。AGPL 与 SSPL 不在此列。
