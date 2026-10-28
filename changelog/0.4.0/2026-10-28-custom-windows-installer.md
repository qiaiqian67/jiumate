## Windows ships the custom installer, not the NSIS one

Windows used to ship `jiumate-desktop-win32-x64.exe` — electron-builder's stock NSIS installer. The
custom installer `@jadelau/installer` (a small Electron app whose UI *is* the installer: rounded
frameless window, step strip, language/model/theme pages) existed but was **never built by CI and
never put in the Release**; its own config said so ("built separately and tested by hand"). Every
Windows download was therefore the NSIS one.

This changes that:

- **`packages/desktop` Windows target is `dir`** — it emits only `out/win-unpacked`, no NSIS
  installer. The `nsis:` block is gone.
- **`@jadelau/installer` is packed in CI** — the Windows job runs `pnpm --dir packages/installer run
  pack`, producing `jiumate-installer-<version>-portable.exe`. (The old step ran `pnpm ... pack`,
  which pnpm treats as its own tarball command and never reaches the script — the custom installer
  was never actually produced.)
- **The Release ships `jiumate-installer-*-portable.exe`** instead of `jiumate-desktop-*.exe`; the
  Windows checksum entry follows it.
- **The portable installer is signed** with the same EVSign identity as the app, so it is not the
  only unsigned byte in a signed release.
- **Windows auto-update goes through the installer.** `electron-updater` can only replace the NSIS
  installer it installed, so it cannot update a portable custom install. `updater.ts` now has a
  Windows path: check the GitHub Releases API for the newest tag, download that release's portable
  installer, and run it (it extracts the new build over the old one, keeping `%APPDATA%\JiuMate` and
  `~/.jiumate` data). macOS (dmg/zip) and Linux (AppImage) still use electron-updater unchanged.

**Verification still owed:** this touching config, CI, Release collection and the updater has been
typechecked, unit-tested (281 pass) and built locally (the portable installer in hand is
`jiumate-installer-0.4.0-portable.exe`, 234.7 MB, unsigned because no cert is present here), but a
real path needs a `workflow_dispatch` dry-run of **Desktop packages** and one end-to-end update test
on a signed Windows build. Kept off `main` until that green run.
