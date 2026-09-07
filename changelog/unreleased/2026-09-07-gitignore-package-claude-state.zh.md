# 忽略每个 package 下的 Claude 会话状态

- **Date**: 2026-09-07
- **Type**: process
- **Scope**: repo
- **PR**: —
- **Issue**: —
- **Breaking**: no

当 Linsight 的开发流程在本仓库运行时，Claude Code（或类似的 agent）会在 `packages/<name>/.claude/auto-handoff-obs-<session-id>.jsonl` 写入每个会话的观察日志。这些文件是本机的——它们标识某一个会话，包含自动生成的转录文本——在每次 agent 运行后都会作为 untracked 出现，如果贡献者执行了 `git add .` 就有被误提交的风险。

本次改动在 `.gitignore` 中加一条规则：

```
# Per-package Claude Code session state (auto-handoff observation logs).
# These are emitted by a session and are not shareable across machines.
packages/*/.claude/
```

这条规则：

- 匹配任意直接位于 package 下、名为 `.claude` 的目录（深度 2）。
- 同时忽略目录和其中的内容（末尾的 `/` 把它限定为目录，但 git 的忽略语义会连带忽略内容）。
- **不影响**根目录下的 `.claude` 文本指针文件 `E:\MyProjects\linsight\.claude`，它是一行内容为 `.agents` 的文件，是被刻意 commit 上去的，这样 Claude Code 会话和其他 agent 会解析到同一个 `.agents/skills/` 目录。
- **不影响**已经独立忽略的 `.agents/settings.local.json` 与 `.agents/**/*.local.*`。

## 验证

```
$ git check-ignore -v packages/desktop/.claude/auto-handoff-obs-1c751abd.jsonl
.gitignore:34:packages/*/.claude/    packages/desktop/.claude/auto-handoff-obs-1c751abd.jsonl
```

`git status` 不再把每个 package 下的 `.claude/` 目录列为 untracked。