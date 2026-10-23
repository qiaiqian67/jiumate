# 不再丢弃可用的 bash，并让 Windows 上的 POSIX shell 继承用户 PATH

- **日期：** 2026-09-20
- **类型：** fix
- **范围：** `core`

[English](2026-09-20-fix-shell-resolution-and-path-inheritance.md)

对一次真实会话的 trace 分析——安装版里一个智能体在构建 HTML 数据看板，47 分钟——发现它跑在
Windows PowerShell 5.1 上，而这台机器装着**两个可用的 bash**。仅这一条就解释了一连串问题：读不回来
的 GBK 输出、嵌套 `powershell -Command "$x = …"` 里被外层 shell 展开成空的变量，以及一段五轮弯路
——最终模型判定自己的 UTF-8 坏了，把整个看板重写了一遍。这里修掉 shell 解析，以及让第一处修复单独
存在时反而变成退化的 PATH 继承问题。

## 不再丢弃可用的 bash

- `resolveShell` 判断 bash 是否可用时**只看 `whichAll("bash")[0]`**。它会拒绝位于系统根目录下的
  bash，因为那是 WSL 启动器——在 Linux 发行版里执行命令、文件系统视图不同，且未配置发行版时直接失败。
  但 System32 几乎总在 PATH 靠前位置，所以在首个匹配就是启动器的机器上，这个判断失败后会**放弃整条
  链**，哪怕第 1、第 2 位就躺着可用的 Git for Windows 或 MSYS2 bash。
- 在发现此问题的机器上实测：第 0 位是 `C:\Windows\System32\bash.exe`（WSL 启动器），随后是
  `E:\msys64\usr\bin\bash.exe` 与 `D:\Program Files\Git\usr\bin\bash.exe`，后两者执行命令完全正常。
  而解析结果是 `powershell`。
- 现在会扫描**每一个** PATH 匹配，取第一个不是 WSL 启动器的。首个匹配即可用时仍返回裸名 `bash`，
  所以常见路径与改动前逐字节一致；取到靠后的匹配时用**绝对路径**，否则 `spawn("bash")` 会直接解析回
  刚被拒绝的那个启动器。
- 微软商店的「应用执行别名」（`…\Microsoft\WindowsApps\bash.exe`）是另一种 WSL 桩，同样跳过。两者都
  按**路径**识别而非探测：探测意味着在解析时执行 `bash -lc`，那会加载可能很慢甚至交互式的登录配置，
  而解析每进程只做一次，正是为了让不该付的子进程开销一分都不付。
- 这是**回归**而非一直如此：同一项目的 trace 显示 2026-09-08 有 17 个会话跑在 `bash` 上，到
  2026-09-20 有 9 个跑在 `powershell` 上。

## Windows 上的 POSIX shell 现在继承用户 PATH

- **只修上面那一处会让情况更糟**，测试套件当场抓到了：MSYS2 的 bash 不会继承 Windows PATH，除非它的
  `/etc/profile` 被明确告知——而那个 profile 只认 `MSYS2_PATH_TYPE`。同一个 bash 启动时只有 11 个
  PATH 项，**没有一个是用户的**，于是 `node`、`npm`、`python`、`git` 全部「command not found」。
  Git for Windows 在自己的 profile 里就写好了这个变量，这正是它的 bash 能用、而原版 MSYS2 不能用的
  原因。
- `ShellInvocation` 新增可选的 `env`，在 spawn 时合并到调用方环境之上。Windows 上的 POSIX shell 携带
  `MSYS2_PATH_TYPE=inherit`；PowerShell 与 `cmd` 不带，因为它们本就继承 PATH，这个变量对它们毫无意义。
- 实测：同一个 `E:\msys64\usr\bin\bash.exe` 在无此变量时有 11 个 PATH 项且找不到 `node`，有此变量时
  87 项，`node`、`npm`、`python`、`git` 全部解析成功。这是**能力增益而非取舍**——同一个 shell，用户的
  工具变得可达——所以它被无条件设置，而不是只在选中的 bash 看起来像 MSYS2 时才设置。
- 对会走到 PowerShell 的机器（没有内置 shell 的 npm 安装，或 PATH 里根本没有 bash）行为保持不变。

## 提示词把浏览器与 shell 的事说清楚

- 浏览器规则被改写，使其**提升**验证质量而不是拿它做交换。旧措辞把「`curl` 加读标记」说成检查自己写的
  页面同样好的办法，这会把模型劝得**根本不去看那个页面**。现在它要求先看机器上已有什么——系统 Chrome
  或 Edge，或已安装的 Playwright——用它把页面渲染出来看，因为那是唯一能看到用户所见的方式；读标记是
  没有浏览器时的退路。禁止安装这一条不变，并补上了理由。
- 新增一条工具使用规则：直接写 Environment 里那个 shell 的语法，而**不要再启动它的一份副本来跑一段
  代码**。嵌套会在内层 shell 看到之前重新解析命令，于是 `powershell -Command "$x = 1"` 到达内层时
  `$x` 已被外层展开成空——一段看起来正确的脚本死在一句模型无法解释的语法错误上。一行写不下就写成
  脚本文件再执行。

## 内核

- prompt 分页发生移动；版本号不变，因为它已经是今天的日期。被取代的 hash 记录带上了旧值，pre-toggles
  重构哈希一并重新锚定。

## 测试

- `packages/core` 覆盖各个解析分支：WSL 启动器遮蔽时使用真正的 bash（以绝对路径命名）、首个匹配即可用
  时保持裸名、跳过商店别名、以及全部匹配都是桩时退回 PowerShell。
- `packages/core` 从两个方向覆盖 PATH 继承：一条单测断言该变量只对 Windows 上的 POSIX shell 设置，
  以及一次真实 spawn 证明用户的工具确实可达——后者正是区分「能力增益」与「能力取舍」的那条断言。
