# 归一化工作树，让 CRLF 不再伪装成一次编辑

- **Date:** 2026-10-12
- **Type:** process
- **Scope:** `tooling`

[English](2026-10-12-crlf-normalize-working-tree.md)

`.gitattributes` 早已声明 `eol=lf`，索引里也早已是 LF，但有 33 个文件在磁盘上是 CRLF，于是 Git 在没人碰过的文件上报整文件 diff——而这些 diff 恰好就是会被误提交进去的东西。那些文件已就地归一化；Git 现在对它们任何一个都不再报改动。

`.gitattributes` 本身修不了这件事。它管的是 Git 存什么、检出什么，不管编辑器**保存**什么：一个设为 CRLF 的 Windows 编辑器会写出 CRLF，Git 察觉到，然后循环重来。所以这次也补上了原先缺的那一半——`.editorconfig` 为每个文件设置 `end_of_line = lf`，与 `.gitattributes` 和 Prettier 的 `endOfLine=lf` 一致，于是一次保存出来就已经是正确的。两个文件现在说的是同一句话，而一次与仓库相悖的保存不再是默认结果。

同一趟也对插件那批改动跑了 Prettier，那里有几行它本会重排。Web 的 `tsc` 干净，2009 个测试通过。
