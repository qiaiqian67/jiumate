/**
 * Finding a Chromium on this machine, and starting it with its debugger open.
 *
 * The headless browser is a real Chromium, not a bundled download: the machine already has
 * one (Chrome, Edge, Brave, or the Chromium that Electron ships), and using it means no
 * 150MB download and nothing to install. Which one is the user's choice — the settings say
 * which, and this file finds it.
 *
 * The browser is started with `--remote-debugging-port=0`, and it writes the port it took
 * into `DevToolsActivePort` in its user-data directory. Reading that file is how a client
 * finds the browser it launched without guessing a port and racing another process for it.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A browser this build can drive. */
export interface ChromiumBrowser {
  id: string;
  name: string;
  /** The executable, when it was found. */
  path: string | null;
}

/** The browsers looked for, in the order they are offered. */
const KNOWN: readonly { id: string; name: string; candidates: (env: Env) => string[] }[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    candidates: (env) => [
      path.join(env.programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(env.programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(env.localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(
        env.home,
        "Applications",
        "Google Chrome.app",
        "Contents",
        "MacOS",
        "Google Chrome",
      ),
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/opt/google/chrome/chrome",
    ],
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    candidates: (env) => [
      path.join(env.programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(env.programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(
        env.home,
        "Applications",
        "Microsoft Edge.app",
        "Contents",
        "MacOS",
        "Microsoft Edge",
      ),
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable",
    ],
  },
  {
    id: "brave",
    name: "Brave",
    candidates: (env) => [
      path.join(env.programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(env.programFilesX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(
        env.home,
        "Applications",
        "Brave Browser.app",
        "Contents",
        "MacOS",
        "Brave Browser",
      ),
      "/usr/bin/brave-browser",
    ],
  },
  {
    id: "chromium",
    name: "Chromium",
    candidates: (env) => [
      path.join(env.localAppData, "Chromium", "Application", "chrome.exe"),
      path.join(env.home, "Applications", "Chromium.app", "Contents", "MacOS", "Chromium"),
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ],
  },
];

/** The machine's paths, injectable for tests. */
export interface Env {
  home: string;
  programFiles: string;
  programFilesX86: string;
  localAppData: string;
  platform: NodeJS.Platform;
}

/** The machine's own paths. */
export function systemEnv(): Env {
  return {
    home: os.homedir(),
    programFiles: process.env["ProgramFiles"] ?? "C:\\Program Files",
    programFilesX86: process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    localAppData: process.env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local"),
    platform: process.platform,
  };
}

/** The browsers on this machine, whether or not they were found. */
export function listChromiums(env: Env = systemEnv()): ChromiumBrowser[] {
  return KNOWN.map((browser) => {
    const found = browser.candidates(env).find((candidate) => isFile(candidate));
    return { id: browser.id, name: browser.name, path: found ?? null };
  });
}

/** The browser to drive: the named one, or the first that is there. */
export function resolveChromium(
  preferred: string | undefined,
  env: Env = systemEnv(),
): ChromiumBrowser | null {
  const all = listChromiums(env);
  if (preferred !== undefined && preferred !== "") {
    const named = all.find((b) => b.id === preferred);
    if (named?.path != null) return named;
    // A named browser that is not here is not an error the caller can fix by trying
    // another: it is the setting that is wrong, and the user should hear about it.
    return null;
  }
  return all.find((b) => b.path !== null) ?? null;
}

/** Where a headless browser's profile lives: under the data root, so it persists. */
export function profileDir(root: string, browserId: string): string {
  return path.join(root, "browser", browserId);
}

/** How long the browser may take to write its port and answer. */
const LAUNCH_TIMEOUT_MS = 30_000;

/** A browser that was started and is listening. */
export interface LaunchedBrowser {
  process: ChildProcess;
  /** Resolves when the browser is gone. */
  exited: Promise<void>;
  /** The debugger's WebSocket endpoint. */
  endpoint: string;
  /** The port it took. */
  port: number;
  /** The profile directory it uses. */
  profile: string;
}

/**
 * Starts a browser with its debugger open and returns its endpoint.
 *
 * The user-data directory is ours, so the browser does not touch the user's own profile and
 * does not argue with a browser they already have running. That is also why the sign-ins an
 * import brought live here: the headless browser's own store.
 */
export async function launchChromium(
  executable: string,
  profile: string,
  options: { headless?: boolean; windowSize?: string } = {},
): Promise<LaunchedBrowser> {
  await fs.promises.mkdir(profile, { recursive: true });
  const portFile = path.join(profile, "DevToolsActivePort");
  // A stale port file from a previous run would send us to a browser that is not ours.
  await fs.promises.rm(portFile, { force: true });

  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--password-store=basic",
    "--use-mock-keychain",
    ...(options.headless === true ? ["--headless=new"] : []),
    ...(options.windowSize !== undefined ? [`--window-size=${options.windowSize}`] : []),
    "about:blank",
  ];

  const child = spawn(executable, args, {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
    detached: false,
    // The browser's own group: the renderers and utility processes it forks are killed
    // with it, and they hold the profile open.
    ...(process.platform === "win32" ? {} : { detached: true }),
  });
  if (process.platform !== "win32") {
    // The child is its own group leader, so a signal to the group reaches all of them.
    try {
      child.unref();
    } catch {
      // Not every platform allows it; the kill still works.
    }
  }
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-4000);
  });

  const port = await waitForPort(
    portFile,
    () => child.exitCode !== null,
    () => stderr,
  );
  return {
    process: child,
    exited: new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    }),
    endpoint: `ws://127.0.0.1:${port}/devtools/browser/${await browserId(port)}`,
    port,
    profile,
  };
}

/** The browser's own id, which its endpoint path carries. */
async function browserId(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  const body = (await res.json()) as { webSocketDebuggerUrl?: string };
  const url = body.webSocketDebuggerUrl ?? "";
  const match = /\/devtools\/browser\/([^/]+)/.exec(url);
  return match?.[1] ?? "";
}

/**
 * The port the browser took, read from the file it writes it into.
 *
 * The file holds the port on its first line and the browser's own path on the second — the
 * second line is what tells us the file belongs to a browser that just started.
 */
async function waitForPort(
  portFile: string,
  exited: () => boolean,
  stderr: () => string,
): Promise<number> {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited()) {
      throw new Error(`The browser stopped before it was ready: ${stderr().trim()}`);
    }
    try {
      const text = await fs.promises.readFile(portFile, "utf8");
      const port = Number(text.split(/\r?\n/)[0]);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // Not written yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The browser did not open its debugger in time: ${stderr().trim()}`);
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
