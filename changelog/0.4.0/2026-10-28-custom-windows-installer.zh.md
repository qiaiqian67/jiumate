## Windows 改发自定义安装器，不再发 NSIS

Windows 以前发的是 `jiumate-desktop-win32-x64.exe` —— electron-builder 的 NSIS 安装器。自定义安装器
`@jadelau/installer`（一个小 Electron app，**它的 UI 就是安装器**：圆角无边框窗口、步骤条、语言/模型/主题页）
早就存在，但**从没被 CI 构建过、也从没进过 Release**，它自己的配置就写着“手工构建、手工测试”。所以每次
Windows 下载到的都是 NSIS 那个。

现在改掉了：

- **`packages/desktop` 的 Windows target 改成 `dir`** —— 只产出 `out/win-unpacked`，不再出 NSIS。`nsis:` 块删掉。
- **`@jadelau/installer` 在 CI 里真正打包** —— Windows job 跑 `pnpm --dir packages/installer run pack`，
  产出 `jiumate-installer-<version>-portable.exe`。（旧步骤跑的是 `pnpm ... pack`，pnpm 当成了它自己的
  打 tarball 命令、根本没进脚本 —— 这就是自定义安装器从来没产出过的原因。）
- **Release 挂 `jiumate-installer-*-portable.exe`**，不再是 `jiumate-desktop-*.exe`；校验和条目跟着改。
- **portable 安装器用同一张 EVSign 证书签名**，不会成为签名发行里唯一没签的那一个字节。
- **Windows 自动更新改走安装器**。`electron-updater` 只能替换它自己装的 NSIS，替换不了 portable 自定义安装，
  所以 `updater.ts` 加了 Windows 路径：查 GitHub Releases 的最新 tag → 下载对应版本的 portable 安装器 → 运行它
  （覆盖安装到原目录，保留 `%APPDATA%\JiuMate` 和 `~/.jiumate` 数据）。macOS（dmg/zip）、Linux（AppImage）
  仍走原来的 electron-updater。

**还欠的验证**：这次动了配置、CI、Release 收集和更新器，已通过类型检查、单测（281 个全过）、本地构建
（手上的 `jiumate-installer-0.4.0-portable.exe` 234.7 MB，本地无证书所以未签名），但真正上线要跑一次
**Desktop packages** 的 `workflow_dispatch` 干跑 + 一次签名 Windows 构建上的端到端更新测试。在那之前
先不并入 `main`。
