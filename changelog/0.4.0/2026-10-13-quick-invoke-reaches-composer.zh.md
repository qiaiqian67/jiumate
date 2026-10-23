# 快捷调用现在能到达输入框

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `web`

[English](2026-10-13-quick-invoke-reaches-composer.md)

在技能卡片上点击**快捷调用**后，跳到新会话页时输入框是空的。技能确实写进
了草稿缓存，但约 300ms 后被覆盖——比输入框读到它更早。

## 原因

`persistNow` 用组件 state **重建整个** `DraftCache`：

```ts
const data: DraftCache = { text: textRef.current, workspace, approvalMode };
if (skillsRef.current.length > 0) data.skills = skillsRef.current;
```

它只建模了草稿的一部分。`skills` 是插件页在聊天页挂载**之前**写进去的，
所以挂载时那第一次 `persistNow()` 里对应的 ref 还是空的——这一次写入用一个
正确的值换来了一个空值。

两个写入方各自都是对的。bug 出在它们之间的竞态上，这也正是每一层单独看都
没有问题的原因。

现在改成先展开已存草稿，没建模的字段因此能活下来；之后赋值的键仍然优先，
所以它管的字段不会变旧。

## 是靠驱动真实应用找到的

此前先发了五个修复，每一个都是真 bug，每一个都带着通过的测试，但没有一个是
这一个：`PluginItem` 上缺 `agents` 字段、userId 到达前就读了草稿缓存、
`initialSkills` 只在挂载时读一次、剪枝守卫早用掉了一个 tick。

这五个全是靠读代码找到的。真正的缺陷在浏览器里一次就看见了——记录页面写入
了什么：

```
[0] {"agentId":"default_agent","text":"","skills":["data-analysis"]}
[1] {"text":"","workspace":"","approvalMode":"allow-all"}
```

有一个测试一直在断言 `persistNow` 应当从 state 重建——正好把缺陷编码了进去
——并且在功能明显坏着的情况下连续两个提交都是绿的。

`.agents/skills/jiumate-manual-test/SKILL.md` 现在记下了无需密码即可驱动应用
的 API token 路径、写入追踪的方法，以及那条规则：**UI 问题报告靠看来解决，
不是靠推断。**