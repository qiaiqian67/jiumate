/**
 * Prompt-enhancement route: POST /api/projects/:p/prompt/enhance.
 *
 * Rewrites the user's draft message into a clearer instruction (core/internal/prompt-enhance.ts)
 * and hands it back for the composer to put **into the same text box**. It deliberately does not
 * send anything: the user reads the rewrite, edits it, and presses Send themselves. An
 * optimization nobody can check would silently change what they asked — the whole value of the
 * button is that they confirm it.
 *
 * Any member may call it (like the chat-defaults read): the result is the user's own words back
 * to them, and the call spends the project's default model a few hundred tokens.
 */
import { Hono } from "hono";
import type { PromptEnhanceRequest } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { requireString, requireValidId, readJson } from "../validate.js";
import type { AppDeps } from "../../app.js";

/**
 * Route-side bound on the submitted draft. Core caps what it splices into its Prompt too, but
 * this one rejects rather than silently truncates: a draft this long is pasted material, and
 * rewriting it against a truncated prefix would produce a result that looks complete and is not.
 * Well above any text a person types into a composer.
 */
const MAX_TEXT_CHARS = 20000;

export function promptEnhanceRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/enhance", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    const req: PromptEnhanceRequest = {
      text: requireString(body, "text", { minLen: 1, maxLen: MAX_TEXT_CHARS, label: "text" }),
    };
    // Every outcome is a 200 with a discriminated `ok` — "the rewrite failed" is a normal
    // result the composer renders as a message, not a transport error. A thrown error here
    // would be the one case with no UI: a 500 has nowhere to be shown.
    return c.json(await deps.projectConfigService.enhancePrompt(projectId, req));
  });

  return app;
}
