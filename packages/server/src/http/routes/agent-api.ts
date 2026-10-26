/**
 * Agent API management (`/api/projects/:projectId/agents/:agentId/api`): the API tab and
 * `jiumate agent api` read and change one Agent's exposure here.
 *
 *   GET    /               member   the switch, keyless access, the approval mode, the keys
 *   PUT    /               owner    change the switch, keyless access and/or the approval mode
 *   POST   /keys           owner    create a key: the secret is in this response and nowhere else
 *   DELETE /keys/:keyId    owner    delete a key: its next request is refused
 *
 * Owner means the Project owner, the rule Agent deletion uses: exposing an Agent to programs
 * outside the Web App is a Project-level decision, and so is the approval mode those programs'
 * conversations start with. The settings live in this server's web.db (see AgentApiRepo), never in
 * the Agent State the Agent itself can rewrite. And the writes take the owner's sign-in, never the
 * local API token every tool subprocess holds (403 `human_required`, see requireHuman): an Agent
 * must not switch on its own exposure from its shell. The reads stay open to the token, for
 * `jiumate agent api status` and `keys ls`.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { THINKING_LEVEL_NAMES, resolveModelRef } from "@jiumate/core";
import type { AppDeps } from "../../app.js";
import type { ApprovalMode, ModelRefDto } from "../../api/types.js";
import { requireHuman } from "../../auth/middleware.js";
import type { AppEnv } from "../../auth/middleware.js";
import { mintAgentApiKey, DEFAULT_API_CONCURRENT_RUNS } from "../../amsp/keys.js";
import type { AgentApiKeyRow, AgentApiRepo } from "../../db/repos/agent-api.js";
import { HttpError } from "../errors.js";
import { assertWorkspaceAllowed } from "../../services/workspace-guard.js";
import {
  badRequest,
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  optionalString,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";
import { APPROVAL_MODES } from "./sessions.js";

// Re-exported rather than redefined: the Web App imports these from @jiumate/server/api,
// so a second copy here would be a type the frontend's DTO is not assignable to — the mismatch
// shows up as a compile error in the tab, pointing at this file rather than at the duplication.
export type { AgentApiKeyInfo, AgentApiResponse, AgentApiSettings } from "../../api/types.js";
import type { AgentApiKeyInfo, AgentApiResponse, AgentApiSettings } from "../../api/types.js";

function keyInfo(row: AgentApiKeyRow): AgentApiKeyInfo {
  return {
    keyId: row.keyId,
    name: row.name,
    prefix: row.prefix,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export function agentApiRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const agentApi: AgentApiRepo = deps.agentApiRepo;

  /** The Agent's settings as the tab reads them; a never-configured Agent reads as off, keyed, allow-all. */
  const settings = (projectId: string, agentId: string): AgentApiResponse => {
    const row = agentApi.get(projectId, agentId);
    return {
      api: {
        enabled: row?.enabled ?? false,
        open: row?.open ?? false,
        approvalMode: row?.approvalMode ?? "allow-all",
        model: row?.model ?? null,
        thinkingLevel: row?.thinkingLevel ?? null,
        workspace: row?.workspace ?? null,
        maxConcurrentRuns: row?.maxConcurrentRuns ?? DEFAULT_API_CONCURRENT_RUNS,
        keys: agentApi.listKeys(projectId, agentId).map(keyInfo),
      },
      // The tab says when the admin has the whole API off: only an admin can read that setting.
      serverEnabled: deps.serverSettingsRepo.getAgentApiEnabled(),
    };
  };

  /** The path's Agent, once the caller may reach it (`owner` for the writes) and it exists. */
  const agentOf = async (
    c: Context<AppEnv>,
    owner: boolean,
  ): Promise<{ projectId: string; agentId: string }> => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    if (owner) deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    else deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return { projectId, agentId };
  };

  app.get("/", async (c) => {
    const { projectId, agentId } = await agentOf(c, false);
    return c.json(settings(projectId, agentId));
  });

  app.put("/", async (c) => {
    requireHuman(c);
    const { projectId, agentId } = await agentOf(c, true);
    const body = await readJson(c);
    // Every field is checked before any is written.
    const enabled = optionalBoolean(body, "enabled");
    const open = optionalBoolean(body, "open");
    const approvalMode = optionalEnum(body, "approvalMode", APPROVAL_MODES);
    const maxConcurrentRuns = optionalNumber(body, "maxConcurrentRuns", { integer: true });
    if (
      maxConcurrentRuns !== undefined &&
      (!Number.isSafeInteger(maxConcurrentRuns) || maxConcurrentRuns < 1)
    ) {
      throw badRequest("maxConcurrentRuns must be a positive safe integer.");
    }
    let model: ModelRefDto | null | undefined;
    if (body.model === null) model = null;
    else if (body.model !== undefined) {
      if (typeof body.model !== "object" || Array.isArray(body.model)) {
        throw badRequest("model must be a model reference or null.");
      }
      const ref = body.model as Record<string, unknown>;
      model = {
        provider: requireString(ref, "provider", { minLen: 1, maxLen: 64 }),
        modelId: requireString(ref, "modelId", { minLen: 1, maxLen: 200 }),
      };
      const config = await deps.projectConfigService.loadConfig(projectId);
      try {
        resolveModelRef(config, model.modelId, model.provider);
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : String(e));
      }
    }
    const thinkingLevel =
      body.thinkingLevel === null
        ? null
        : optionalEnum(body, "thinkingLevel", THINKING_LEVEL_NAMES);
    let workspace =
      body.workspace === null
        ? null
        : optionalString(body, "workspace", { minLen: 1, maxLen: 4096 });
    if (workspace != null) workspace = await assertWorkspaceAllowed({ workspace });

    const current = agentApi.get(projectId, agentId);
    agentApi.upsert({
      projectId,
      agentId,
      enabled: enabled ?? current?.enabled ?? false,
      open: open ?? current?.open ?? false,
      approvalMode: approvalMode ?? current?.approvalMode ?? "allow-all",
      model: model === undefined ? (current?.model ?? null) : model,
      thinkingLevel: thinkingLevel === undefined ? (current?.thinkingLevel ?? null) : thinkingLevel,
      workspace: workspace === undefined ? (current?.workspace ?? null) : workspace,
      ...(maxConcurrentRuns !== undefined
        ? { maxConcurrentRuns }
        : current?.maxConcurrentRuns !== undefined
          ? { maxConcurrentRuns: current.maxConcurrentRuns }
          : {}),
      updatedAt: new Date().toISOString(),
    });
    // The answer comes from `settings()`, which reads the row back — the stored value, not the
    // value that was asked for. That is deliberate: a write that silently clamped or dropped
    // something (the repo forces `open` to 0 while `enabled` is 0) would otherwise read back as
    // what the caller sent, and the tab would show a setting the server does not hold.
    return c.json(settings(projectId, agentId));
  });

  app.post("/keys", async (c) => {
    requireHuman(c);
    const { projectId, agentId } = await agentOf(c, true);
    const body = await readJson(c);
    const name = requireString(body, "name", { maxLen: 64, label: "name" }).trim();
    if (name === "") throw new HttpError(400, "bad_request", "name must be 1-64 characters.");
    const minted = mintAgentApiKey();
    const row: AgentApiKeyRow = {
      keyId: minted.keyId,
      projectId,
      agentId,
      prefix: minted.prefix,
      name,
      createdBy: c.var.user.userId,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    agentApi.insertKey({ ...row, tokenHash: minted.tokenHash });
    return c.json({ key: keyInfo(row), secret: minted.secret }, 201);
  });

  app.delete("/keys/:keyId", async (c) => {
    requireHuman(c);
    const { projectId, agentId } = await agentOf(c, true);
    if (!agentApi.deleteKey(projectId, agentId, c.req.param("keyId"))) {
      throw new HttpError(404, "key_not_found", "This Agent has no key with that id.");
    }
    return c.body(null, 204);
  });

  return app;
}
