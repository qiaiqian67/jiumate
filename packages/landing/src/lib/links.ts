/** External links and language-independent constants used across the landing page. */

export const REPO_URL = "https://github.com/qiaiqian67/jiumate";
export const REPO_API_URL = "https://api.github.com/repos/qiaiqian67/jiumate";
export const RELEASES_URL = `${REPO_URL}/releases`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

/**
 * The address this site is served from.
 *
 * It is read from the build rather than written here, so the same source builds the site
 * for a custom domain or at the repository's GitHub Pages address without being edited.
 * `VITE_SITE_ORIGIN` is a Vite environment variable, which means the build injects it
 * and the test runner sees it too — a `define` would only be replaced in the build, and
 * a module that imported this one would throw in the test.
 */
export const SITE_ORIGIN =
  import.meta.env.VITE_SITE_ORIGIN ?? "https://qiaiqian67.github.io/jiumate";

/**
 * Docs site: a sibling SPA deployed under the landing page's own base ("/<repo>/docs/",
 * see scripts/build-site.mjs). A plain href — it is a separate app, not a router route.
 * In local dev this resolves to "/docs/", which only exists in the assembled build.
 */
export const DOCS_URL = `${import.meta.env.BASE_URL}docs/`;

/**
 * One-line installer (Linux / macOS, x64 / arm64, bundled Node runtime).
 * <origin>/install.sh is this site's own public/install.sh — a thin forwarder
 * to the latest GitHub release installer (Pages cannot serve real redirects).
 *
 * The origin is the address the site is actually served from. It is read from the
 * build, not written here, so the same source builds the site at a custom domain or
 * at the repository's GitHub Pages address without being edited.
 */
export const INSTALL_CMD = `curl -fsSL ${SITE_ORIGIN}/install.sh | sh`;

/**
 * One-line installer for Windows (PowerShell 5.1+, x64, bundled Node runtime).
 * <origin>/install.ps1 is public/install.ps1 — the same thin-forwarder design.
 */
export const INSTALL_CMD_WINDOWS = `irm ${SITE_ORIGIN}/install.ps1 | iex`;

/**
 * Offline install commands, per OS tab of the install switcher. Each Release attaches one
 * installer bundle per target (see scripts/package-release-bundles.sh) and the same file
 * serves online and offline installation; the commands show the most common architecture —
 * the localized hint strings name the alternative archive. Language-neutral, like the
 * one-liners above.
 */
export const OFFLINE_INSTALL_CMDS: Record<"linux" | "macos" | "windows", string> = {
  linux: `mkdir jiumate-install
tar -xzf jiumate-linux-x64.tar.gz -C jiumate-install
./jiumate-install/install.sh`,
  macos: `mkdir jiumate-install
tar -xzf jiumate-darwin-arm64.tar.gz -C jiumate-install
./jiumate-install/install.sh`,
  windows: `Expand-Archive jiumate-win32-x64.zip -DestinationPath jiumate-install
cd jiumate-install
.\\install.cmd`,
};

export interface CliInstaller {
  /** Stable Release asset file name used by both online and offline installation. */
  file: string;
  /** Language-neutral architecture label rendered on the direct download link. */
  variant: string;
}

/** Direct offline-install downloads shown under the selected command-line platform. */
export const CLI_INSTALLERS: Record<"linux" | "macos" | "windows", CliInstaller[]> = {
  linux: [
    { file: "jiumate-linux-x64.tar.gz", variant: "x64" },
    { file: "jiumate-linux-arm64.tar.gz", variant: "arm64" },
  ],
  macos: [
    { file: "jiumate-darwin-arm64.tar.gz", variant: "Apple Silicon" },
    { file: "jiumate-darwin-x64.tar.gz", variant: "Intel" },
  ],
  windows: [{ file: "jiumate-win32-x64.zip", variant: "x64" }],
};

/** API key consoles (same URLs the in-app Models page links to). */
export const DEEPSEEK_KEYS_URL = "https://platform.deepseek.com/api_keys";
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/workspaces/default/keys";

/**
 * Desktop app downloads. The installers carry version-less names (see
 * packages/desktop/electron-builder.yml), which is what makes static links possible on a
 * Pages-hosted site: GitHub's `releases/latest/download/<name>` always serves the newest
 * release, no client-side resolution needed. The OSS mirror stores immutable per-tag
 * directories instead, so mirror links DO need the current tag — the download page reads
 * it from the bucket's `latest.json` pointer (the same file install.sh resolves) and
 * falls back to the GitHub links when that fetch fails (e.g. CORS not configured, or the
 * mirror unreachable).
 */
export const OSS_ORIGIN = "https://jiumate-releases.oss-cn-beijing.aliyuncs.com";
export const OSS_LATEST_JSON_URL = `${OSS_ORIGIN}/latest.json`;
export const GITHUB_LATEST_DOWNLOAD = `${REPO_URL}/releases/latest/download`;

export interface DesktopInstaller {
  /** Stable asset file name, identical on GitHub Releases and the OSS mirror. */
  file: string;
  /** Language-neutral variant tag rendered on the button (arch / package format). */
  variant: string;
}

/** Named separately: the first-launch FAQ's chmod command quotes this exact file name. */
const LINUX_APPIMAGE: DesktopInstaller = {
  file: "jiumate-desktop-linux-x86_64.AppImage",
  variant: "AppImage",
};

/** Installers per platform card, in display order. */
export const DESKTOP_INSTALLERS: Record<"mac" | "windows" | "linux", DesktopInstaller[]> = {
  mac: [
    { file: "jiumate-desktop-darwin-arm64.dmg", variant: "Apple Silicon" },
    { file: "jiumate-desktop-darwin-x64.dmg", variant: "Intel" },
  ],
  windows: [{ file: "jiumate-desktop-win32-x64.exe", variant: "x64" }],
  linux: [LINUX_APPIMAGE, { file: "jiumate-desktop-linux-amd64.deb", variant: "deb" }],
};

/** Checksum list covering every desktop installer of a release. */
export const DESKTOP_SHA256SUMS = "SHA256SUMS.desktop";

/**
 * The one first-launch fix the desktop builds still need (the download page FAQ):
 * restoring the execute bit browsers strip from a downloaded AppImage. macOS is
 * Developer ID signed and notarized and Windows is Authenticode signed, so neither
 * has anything to unblock. Language-neutral, like the install commands above.
 */
export const LINUX_APPIMAGE_CHMOD_CMD = `chmod +x ${LINUX_APPIMAGE.file}`;
