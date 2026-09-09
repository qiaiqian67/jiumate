---
title: 决策表
description: 已经认定要做的空白清单的唯一权威记录。做出决定时更新;对应工作的 changelog 按行号反向引用此表。
---

下表是我们已经认定要做的空白清单的唯一权威记录。做出决定时更新它;对应工作的 changelog 条目按行号反向引用此表。

| # | 空白 | Owner | 目标版本 | 状态 | 备注 |
|---|---|---|---|---|---|
| 1 | | | | pending | |
| 2 | | | | pending | |
| 3 | | | | pending | |
| 4 | | | | pending | |
| 5 | | | | pending | |
| 6 | | | | pending | |
| 7 | | | | pending | |
| 8 | | | | pending | |
| 9 | | | | pending | |
| 10 | | | | pending | |

一行的 `Status` 走 `pending → accepted → in-progress → shipped`(或 `deferred` / `rejected`,附一行原因)。"目标版本"列是该工作提交到哪个发布分支;发布分支反向引用此表。