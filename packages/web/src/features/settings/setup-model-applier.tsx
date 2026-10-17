/**
 * Applies the installer's model choice as soon as there is a Project to apply it to.
 *
 * Rendered inside ProjectProvider (see router.tsx) rather than from App, because the choice is
 * project-scoped: there is nothing to apply it to until a Project exists, and the Project id is
 * only known inside that tree. Rendering it higher up would need the store reached around the
 * context, which is the coupling this avoids.
 *
 * Mounted once for the session. It holds no state: it reads the handover, and applies it if it has
 * not been applied already. The dependency is the Project id and nothing else — the effect must not
 * re-run on every render, or a Project switch would re-apply the installer's choice and undo
 * whatever the user configured since (the latch in lib/setup-model.ts is what makes that safe, and
 * depending on it alone would hide a bug here).
 */
import { useEffect, useRef } from "react";
import { putDefaultModel } from "../../api/endpoints";
import { useProject } from "../../state/project";
import { applySetupModel, readSetupModel } from "../../lib/setup-model";

export function SetupModelApplier() {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  /** Guards against StrictMode's double-effect, which would otherwise issue the PUT twice. */
  const started = useRef(false);

  useEffect(() => {
    if (projectId === null) return;
    if (started.current) return;
    started.current = true;

    const choice = readSetupModel();
    // Nothing handed over: an ordinary launch, or the user chose to configure it later.
    if (choice === null) return;
    void applySetupModel(projectId, choice, putDefaultModel);
  }, [projectId]);

  return null;
}