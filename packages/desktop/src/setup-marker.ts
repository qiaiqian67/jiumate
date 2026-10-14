/**
 * The completion marker: the one file that decides whether the setup wizard appears.
 *
 * Split out of setup-window.ts for the same reason app-identity.ts and cli-link.ts are their own
 * modules — this half is pure `node:fs` over a path, with no Electron import, so it unit-tests
 * against real temporary directories instead of mocks. The window half (frame, frameless title
 * bar, IPC channels) is untestable in this repo's harness and has nothing here worth mocking:
 * the question "does this machine still need onboarding?" has a real answer on disk, and that
 * answer should be checked directly.
 *
 * **The shell owns this file, and the renderer never writes it.** A page that could record its own
 * completion would be one bad keypress away from never being asked again — which is exactly the
 * bug this indirection exists to make impossible.
 */
import fs from "node:fs";
import path from "node:path";

/** The marker's filename under `userData`. */
export const SETUP_MARKER_FILE = "setup-complete.json";

/**
 * The marker's schema version.
 *
 * Bumping this re-runs the wizard for everyone who already installed, whatever their marker says.
 * That is the intended lever when a new step is added — the alternative (deleting every marker)
 * cannot be done from inside a running app.
 */
export const SETUP_MARKER_VERSION = 1;

export interface SetupMarker {
  version: number;
  /** ISO timestamp of when the wizard was completed. */
  at: string;
  /**
   * The language the user chose, kept for diagnostics only. The app reads its own preference from
   * `jiumate.lang` (state/locale.tsx); this is a record of what was picked at setup time, not a
   * second source of truth — two copies of a preference would be two copies that disagree.
   */
  lang?: string;
}

/** The marker's full path for a given userData directory. */
export function setupMarkerPath(userData: string): string {
  return path.join(userData, SETUP_MARKER_FILE);
}

/**
 * The recorded completion, or null when there is none — an unwritten marker, unreadable JSON, a
 * non-object payload, or a version this build does not recognize.
 *
 * A corrupt or absent file both read as "not set up yet", which is the safe direction: the cost
 * of a wrong answer is a wizard the user has seen before, and the cost of the other wrong answer
 * is never being offered setup again.
 */
export function readSetupMarker(userData: string): SetupMarker | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(setupMarkerPath(userData), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const marker = parsed as SetupMarker;
    return typeof marker.version === "number" && marker.version === SETUP_MARKER_VERSION
      ? marker
      : null;
  } catch {
    return null;
  }
}

/** Whether this machine has already been through the wizard. */
export function isSetupComplete(userData: string): boolean {
  return readSetupMarker(userData) !== null;
}

/**
 * Record completion. Returns whether the write landed, because a wizard that cannot record itself
 * will show again next launch and the user should be able to know that rather than find out.
 */
export function writeSetupMarker(userData: string, lang: string | undefined): boolean {
  const marker: SetupMarker = {
    version: SETUP_MARKER_VERSION,
    at: new Date().toISOString(),
    ...(lang !== undefined ? { lang } : {}),
  };
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(setupMarkerPath(userData), JSON.stringify(marker, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}
