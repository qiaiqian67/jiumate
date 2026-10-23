# 技能压缩包上限提高，并在被拒时说清是多少

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `server`

[English](2026-10-14-skill-archive-size.md)

从 URL 安装技能时失败，报错是：

> The downloaded archive exceeds the size limit.

总上限原本是 20MB，现在改为 200MB。

## 报错从来没说是哪个上限

同一个文件在两条路径上执行同一个上限，但只有一条告诉用户具体数字：

    /url     → "The downloaded archive exceeds the size limit."
    /archive → "压缩包超过 20MB 上限。"   （声明长度那条只说"压缩包太大。"）

于是超限的压缩包在上传路由上报出数字、在下载路由上报一句无从行动的话，
而失败信息里没有任何内容告诉用户该往哪个数字靠。两条现在都走同一个
`archiveTooLarge()` helper，并且数字由常量推导而非写死——上限从 20MB 挪走
之后，旁边的消息仍然在说 20MB，这正是两者一开始就走散的原因。

`skillTooLarge()` 有同样的问题：它把 "5MB per file, 20MB total" 直接写在
自己的字符串里。现在它读取常量。

## 一个把上限写成字面量的测试

`skills.test.ts` 用 `5 × 4200KB` 证明总上限生效，断言它被拒绝。到 64MB
时这个载荷已经稳稳地低于上限，到 200MB 更是远在其下，于是路由接受了它，
断言以 `expected 201 to be 400` 失败——而失败信息里没有任何东西指向那个
挪动的数字。

现在它由 `MAX_TOTAL_BYTES` 推导：单份大小取在 `MAX_FILE_BYTES` 之下，
份数多到足以超过总量。一个"刚好越过阈值"的手写载荷就是那份阈值的第二份
副本——而阈值一旦挪动，它就不再检验任何东西了。

## 仍未修的部分

`download()` 调用 `response.arrayBuffer()`，之后才比对长度，所以整个响应
先进内存、再谈上限。一个数 GB 的压缩包会被完整读入，然后才被拒绝。这个
上限目前拦住的是"下完之后发现太大"，不是"下到一半就炸"；改成流式并中断
是另一处改动，这次没有做。

`MAX_TOTAL_BYTES` 也不是仓库里唯一的压缩包上限——`routes/skills.ts` 和
`routes/agent-transfer.ts` 各自声明了自己的 14MB `MAX_ARCHIVE_BYTES`。
没有动：提高那两处是另一个决定。

server 的 skills 与 machine-skills 测试全绿（48）。