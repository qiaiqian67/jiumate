/**
 * The system browsers an import reads, and where each keeps its data on each platform. A
 * Chromium-family browser keeps a user-data directory holding `Local State` and one directory
 * per profile; Firefox keeps a `profiles.ini` naming its profile directories. Paths only —
 * nothing here touches the filesystem.
 */
import path from "node:path";
import type { BrowserImportBrowser } from "@jiumate/core/interfaces";
import type { ImportEnv } from "./index.js";

export type ChromiumBrowserId = Exclude<BrowserImportBrowser, "firefox">;

export interface ChromiumBrowser {
  id: ChromiumBrowserId;
  name: string;
  /** macOS: the Keychain service whose password the cookie key derives from. */
  keychainService: string;
  /** Linux: the libsecret `application` attributes the v11 key's password may be filed under, most likely first. */
  keyringApplications: string[];
  /** User-data directories, as path segments below each platform's base directory. */
  dirs: { darwin?: string[][]; linux?: string[][]; win32?: string[][] };
}

/** In the order an import dialog lists them. */
export const CHROMIUM_BROWSERS: readonly ChromiumBrowser[] = [
  {
    id: "chrome",
    name: "Chrome",
    keychainService: "Chrome Safe Storage",
    keyringApplications: ["chrome"],
    dirs: {
      darwin: [["Google", "Chrome"]],
      linux: [["google-chrome"], ["flatpak:com.google.Chrome", "google-chrome"]],
      win32: [["Google", "Chrome", "User Data"]],
    },
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    keychainService: "Microsoft Edge Safe Storage",
    keyringApplications: ["chromium", "microsoft-edge"],
    dirs: {
      darwin: [["Microsoft Edge"]],
      linux: [["microsoft-edge"], ["flatpak:com.microsoft.Edge", "microsoft-edge"]],
      win32: [["Microsoft", "Edge", "User Data"]],
    },
  },
  {
    id: "brave",
    name: "Brave",
    keychainService: "Brave Safe Storage",
    keyringApplications: ["brave"],
    dirs: {
      darwin: [["BraveSoftware", "Brave-Browser"]],
      linux: [["brave-browser"], ["flatpak:com.brave.Browser", "brave-browser"]],
      win32: [["BraveSoftware", "Brave-Browser", "User Data"]],
    },
  },
  {
    id: "opera",
    name: "Opera",
    keychainService: "Opera Safe Storage",
    keyringApplications: ["opera"],
    dirs: {
      darwin: [["com.operasoftware.Opera"]],
      linux: [["opera"], ["flatpak:com.opera.Opera", "opera"]],
      win32: [["Opera Software", "Opera Stable"]],
    },
  },
  {
    id: "vivaldi",
    name: "Vivaldi",
    keychainService: "Vivaldi Safe Storage",
    keyringApplications: ["vivaldi"],
    dirs: {
      darwin: [["Vivaldi"]],
      linux: [["vivaldi"], ["flatpak:com.vivaldi.Vivaldi", "vivaldi"]],
      win32: [["Vivaldi", "User Data"]],
    },
  },
];

/** The browser by its id; undefined for one this build does not read. */
export function chromiumBrowser(id: BrowserImportBrowser): ChromiumBrowser | undefined {
  return CHROMIUM_BROWSERS.find((browser) => browser.id === id);
}

/**
 * The user-data directories of one Chromium-family browser on this platform.
 *
 * A segment may name a special place: `snap:`, `flatpak:` and `roaming:` are expanded here,
 * so a browser installed as a package is found beside the one installed normally.
 */
export function chromiumRoots(browser: ChromiumBrowser, env: ImportEnv): string[] {
  const platform = platformKey(env.platform);
  return (browser.dirs[platform] ?? []).flatMap((segments) => {
    const [first = "", ...rest] = segments;
    if (first.startsWith("snap:")) {
      return [path.join(env.homedir, "snap", first.slice(5), "common", ...rest)];
    }
    if (first.startsWith("flatpak:")) {
      return [path.join(env.homedir, ".var", "app", first.slice(8), "config", ...rest)];
    }
    if (first.startsWith("roaming:")) {
      const roaming = env.env.APPDATA;
      return roaming ? [path.join(roaming, first.slice(8), ...rest)] : [];
    }
    const base = platformBase(platform, env);
    return base === null ? [] : [path.join(base, ...segments)];
  });
}

/** The directories holding Firefox's `profiles.ini` on this platform. */
export function firefoxRoots(env: ImportEnv): string[] {
  const home = env.homedir;
  switch (platformKey(env.platform)) {
    case "darwin":
      return [path.join(home, "Library", "Application Support", "Firefox")];
    case "win32": {
      const roaming = env.env.APPDATA;
      return roaming ? [path.join(roaming, "Mozilla", "Firefox")] : [];
    }
    default:
      return [
        path.join(home, ".mozilla", "firefox"),
        path.join(home, "snap", "firefox", "common", ".mozilla", "firefox"),
        path.join(home, ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox"),
      ];
  }
}

/** Every other Unix reads as Linux: the XDG layout is what the BSDs' browser ports use too. */
function platformKey(platform: NodeJS.Platform): "darwin" | "linux" | "win32" {
  return platform === "darwin" || platform === "win32" ? platform : "linux";
}

/** Where user-data directories live: Application Support, %LOCALAPPDATA%, or the XDG config home. */
function platformBase(platform: "darwin" | "linux" | "win32", env: ImportEnv): string | null {
  if (platform === "darwin") return path.join(env.homedir, "Library", "Application Support");
  if (platform === "win32") return env.env.LOCALAPPDATA || null;
  return env.env.XDG_CONFIG_HOME || path.join(env.homedir, ".config");
}
