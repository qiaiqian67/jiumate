/**
 * The installer's model choice, applied once a Project exists.
 *
 * ## Why this file exists
 *
 * The shell hands the model answer over (see packages/desktop/src/preload.ts) and, historically,
 * wrote it to `setup-model.json` as well. Nothing read that file — not the settings page, not the
 * models page, nothing — so the file was the visible half of a bug in which the model chosen in
 * the installer had no effect at all. This is the consumer that was missing.
 *
 * ## Why it is applied rather than seeded
 *
 * The default model is project-scoped: it lives behind `PUT /api/projects/:id/models/default`, and
 * at first launch there is no Project, so there is nothing to write the choice onto. Writing a
 * localStorage key instead would have looked like it worked and then quietly done nothing, which is
 * the failure mode this whole feature is being fixed for.
 *
 * So the choice is *held* here and applied when a Project arrives. `main.tsx` renders this inside
 * the app, so it re-runs whenever the current Project changes — and `useEffect` with the Project id
 * as a dependency means the first Project to appear is the one that gets it.
 *
 * ## Why it only ever runs once
 *
 * The answers stay in the window's command line for the whole session, so without a latch every
 * Project switch would re-apply the installer's choice and overwrite whatever the user has since
 * configured. The latch is in localStorage rather than a module-level variable, because a reload
 * must not re-apply it either — a reload is not a new install.
 */

/** The shape the shell hands over, mirroring `SetupAnswers` in packages/desktop/src/setup-import.ts. */
export interface SetupModelChoice {
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
  /** The user chose to configure a model inside the app instead of during install. */
  skipModel: boolean;
  apiKey: string | null;
}

/** Marks the handover as spent. A key of its own, so it cannot collide with an app setting. */
const CONSUMED_KEY = "jiumate.setupModelConsumed";

/** The choice the shell passed, or null when this is an ordinary launch. */
export function readSetupModel(): SetupModelChoice | null {
  const raw = window.jiumateSetup;
  if (raw === null || raw === undefined) return null;
  // A browser run, or a desktop run without an install: no handover, nothing to apply.
  if (typeof raw !== "object" || typeof raw.provider !== "string") return null;
  // "Skip" means the user was asked and said "later", so there is deliberately nothing to apply.
  if (raw.skipModel === true) return null;
  if (typeof raw.model !== "string" || raw.model === "") return null;
  return raw;
}

/**
 * Whether this choice still needs applying.
 *
 * False once it has been applied, so a later Project switch (or a reload) cannot undo whatever the
 * user configured in the meantime.
 */
function notYetApplied(): boolean {
  try {
    return localStorage.getItem(CONSUMED_KEY) === null;
  } catch {
    // No storage access: treat the choice as spent. Re-applying on every Project switch would be
    // worse than applying it once too often.
    return false;
  }
}

function markApplied(): void {
  try {
    localStorage.setItem(CONSUMED_KEY, "1");
  } catch {
    // Nothing to do — see notYetApplied.
  }
}

/**
 * Apply the installer's model choice to `projectId`.
 *
 * Returns whether it applied, so the caller can log a refusal instead of silently doing nothing —
 * the difference between "the choice did not apply" and "the choice was never made" is the whole
 * thing that was broken before.
 */
export async function applySetupModel(
  projectId: string,
  choice: SetupModelChoice,
  put: (projectId: string, body: { provider: string; modelId: string }) => Promise<unknown>,
): Promise<boolean> {
  if (notYetApplied()) return false;
  try {
    await put(projectId, { provider: choice.provider as string, modelId: choice.model as string });
    markApplied();
    return true;
  } catch {
    // Leave the latch unset: the server may not have been ready yet, and a Project switch or a
    // reload will try again. Applying it exactly once matters, but never applying it is worse.
    return false;
  }
}
