import fs from "node:fs";
import path from "node:path";

/**
 * What the installer collected, handed to the app on first launch.
 *
 * The installer writes `%APPDATA%\JiuMate\setup.ini` (see packages/installer) and this module is
 * the reader. It exists because the answers were previously written and then dropped: the installer
 * reported success while nothing consumed the file, so a language, a theme and a model chosen during
 * setup had no effect on the app that opened afterwards.
 *
 * Consuming it from the main process rather than the renderer is deliberate. Two of the three
 * answers are read by the web app out of `localStorage` (`jiumate.lang`, `jiumate.mode`,
 * `jiumate.theme`), and the renderer cannot write localStorage before its first script runs — so
 * seeding it after `did-finish-load` would arrive after the page had already painted the default
 * appearance, and the flash would be visible on every launch.
 *
 * The file is read once. Deleting it after a successful read is what keeps a user's later choices
 * in the settings UI from being reverted by the installer on a re-run.
 */
export interface SetupAnswers {
  /** "zh" | "en" | "system" — the values the app's locale store accepts. */
  lang?: string;
  /** "light" | "dark" | "system". */
  mode?: string;
  /** A builtin theme id from the skins package, or "system". */
  theme?: string;
  /** Catalog provider id, e.g. "deepseek". */
  provider?: string;
  /** Catalog model id. */
  model?: string;
  /** Endpoint override, when the chosen provider pins one. */
  baseUrl?: string;
  /** The user chose to configure a model inside the app instead. */
  skipModel?: boolean;
  /** The API key the user typed. Optional: it is only present if they chose not to skip. */
  apiKey?: string;
  /** Installer version that wrote this, for diagnostics. */
  installerVersion?: string;
}

const ALLOWED_LANG = new Set(["zh", "en", "system"]);
const ALLOWED_MODE = new Set(["light", "dark", "system"]);

/**
 * Parse the ini the installer wrote.
 *
 * Tolerant by design: this file sits in the user's profile and may have been hand-edited, truncated
 * by a bad shutdown, or written by an older installer with fewer keys. Anything unrecognised is
 * dropped and the rest is still used — refusing to start the app over a malformed preference would
 * be a far worse outcome than starting it with a default.
 */
export function parseSetupIni(text: string): SetupAnswers {
  const out: Record<string, string> = {};
  let inSection = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[")) {
      inSection = line.toLowerCase() === "[setup]";
      continue;
    }
    if (!inSection) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }

  const answers: SetupAnswers = {};
  if (ALLOWED_LANG.has(out.lang ?? "")) answers.lang = out.lang;
  if (ALLOWED_MODE.has(out.mode ?? "")) answers.mode = out.mode;
  if (out.theme) answers.theme = out.theme;
  if (out.provider) answers.provider = out.provider;
  if (out.model) answers.model = out.model;
  if (out.baseUrl) answers.baseUrl = out.baseUrl;
  if (out.skipModel === "1") answers.skipModel = true;
  if (out.apiKey) answers.apiKey = out.apiKey;
  if (out.installerVersion) answers.installerVersion = out.installerVersion;
  return answers;
}

/** Read the installer's answers from the app's own userData directory, or null when absent. */
export function readSetupAnswers(userDataDir: string): SetupAnswers | null {
  const file = path.join(userDataDir, "setup.ini");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const answers = parseSetupIni(text);
  return Object.keys(answers).length ? answers : null;
}

/**
 * The localStorage seed, as the plain pairs the app's own stores expect.
 *
 * The app already implements all three of these; this only fills them in early, so the answers made
 * during setup are in force the first time the app opens. The keys are the app's own — `jiumate.lang`
 * (state/locale.tsx), `jiumate.mode` and `jiumate.theme` (state/theme.tsx) — so nothing here has to
 * be kept in step with how the app reads them later.
 *
 * `jiumate.theme` holds the theme id, or nothing at all for "follow the system": theme.tsx's
 * `initialSkin` treats an absent or empty value as null, which is its built-in appearance, and
 * `cacheSkin` removes the key rather than writing an empty string. Writing "system" into that key
 * would be an id no theme matches, so the app would fall back to its own default and the choice
 * would silently not apply.
 *
 * `jiumate.mode` is the appearance (light/dark), and is seeded independently of the theme: a theme is
 * a skin, the mode is light or dark, and choosing "follow the system" for one says nothing about the
 * other.
 */
export function seedStorage(answers: SetupAnswers): Record<string, string> {
  const seed: Record<string, string> = {};
  if (answers.lang) seed["jiumate.lang"] = answers.lang;
  // The theme id, only when it is a real one. "system" means the built-in appearance, and
  // theme.tsx's `initialSkin` treats an absent key as exactly that — writing "system" would store an id
  // no theme matches.
  if (answers.theme && answers.theme !== "system") seed["jiumate.theme"] = answers.theme;
  // The appearance mode is seeded on its own, NOT inside the theme branch above.
  //
  // It used to be nested there, which silently discarded the appearance whenever the theme was
  // "follow the system" — the two are separate questions on the installer's own pages, and picking
  // dark plus the default theme is the most ordinary combination there is. That combination stored no
  // mode at all, so the app came up light and the installer's answer appeared not to apply.
  //
  // "system" is deliberately not written: the app defaults to it when the key is absent, so storing it
  // would change nothing while pinning an appearance that would otherwise follow the device.
  if (answers.mode && answers.mode !== "system") seed["jiumate.mode"] = answers.mode;
  return seed;
}
