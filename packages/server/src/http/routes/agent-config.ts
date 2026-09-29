/**
 * Agent config routes (reads/writes system_config.yaml and AGENTS.md):
 * GET|PUT /api/projects/:p/agents/:a/config, plus POST …/config/reset to adopt the
 * current default config (keeps only name/description/version — the config-side
 * analogue of a skill update), POST …/config/kernel-update to smart-merge up to the
 * current defaults generation (customizations kept), and POST …/config/mcp-test to
 * probe one MCP Server entry's reachability. Members can read and write (unrestricted).
 */
import { Hono } from "hono";
import type { MCPServerConfig } from "@prismshadow/jiumate-core";
import type {
  AgentConfigResponse,
  AgentConfigUpdateRequest,
  AgentKernelUpdateResponse,
  McpServerTestResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, optionalString, readJson, requireValidId } from "../validate.js";
import { McpProbeInvalidEntryError, probeMcpServer } from "../../services/mcp-probe.js";
import type { AppDeps } from "../../app.js";

export function agentConfigRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Id validation happens before any path construction: prevents agentId path traversal for cross-Project privilege escalation.
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const view = await deps.agentConfigService.getConfig(projectId, agentId);
    return c.json({
      ...view,
      activeSessionCount: deps.manager.activeCountForAgent(projectId, agentId),
    } satisfies AgentConfigResponse);
  });

  app.put("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    const req: AgentConfigUpdateRequest = {};
    const agentsMd = optionalString(body, "agentsMd", { label: "agentsMd" });
    if (agentsMd !== undefined) req.agentsMd = agentsMd;
    if (body.config !== undefined) {
      if (body.config === null || typeof body.config !== "object" || Array.isArray(body.config)) {
        throw badRequest("config must be an object.");
      }
      req.config = body.config as AgentConfigUpdateRequest["config"];
    }
    // Fine-grained validation (numeric ranges / enums) is done inside agent-config-service.
    await deps.agentConfigService.updateConfig(projectId, agentId, req);
    const view = await deps.agentConfigService.getConfig(projectId, agentId);
    return c.json({
      ...view,
      activeSessionCount: deps.manager.activeCountForAgent(projectId, agentId),
    } satisfies AgentConfigResponse);
  });

  // Probe one MCP Server entry: connect + discover tools with the entry's own
  // connectTimeoutMs, then close. See services/mcp-probe.ts for why this runs server-side.
  // A malformed entry is a 400 (same resolver as PUT validation); an unreachable server is
  // a normal `{ ok: false }` result. Nothing is written to the Agent State.
  app.post("/mcp-test", async (c) => {
    const projectId = requireValidId(c, "projectId");
    requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    if (typeof body.name !== "string" || body.name.length === 0) {
      throw badRequest("name must be a non-empty string.");
    }
    if (body.config === null || typeof body.config !== "object" || Array.isArray(body.config)) {
      throw badRequest("config must be an object.");
    }
    const entry = { name: body.name, config: body.config } as MCPServerConfig;
    try {
      return c.json((await probeMcpServer(entry)) satisfies McpServerTestResponse);
    } catch (err) {
      if (err instanceof McpProbeInvalidEntryError) throw badRequest(err.message);
      throw err;
    }
  });

  // Smart-merge the config up to the current defaults generation (see
  // AgentConfigService.kernelUpdate): non-destructive sibling of /reset, same member-level
  // authorization as /reset and PUT. Responds with the merge report (advanced / kept tabs +
  // the new stamp); the client re-GETs the config for the fresh values.
  app.post("/kernel-update", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const result = await deps.agentConfigService.kernelUpdate(projectId, agentId);
    return c.json(result satisfies AgentKernelUpdateResponse);
  });

  // Overwrite system_config.yaml with the current defaults (see AgentConfigService.resetConfig
  // for the exact semantics); same authorization as PUT, and responds like GET/PUT with the
  // fresh config so the client can refresh in place.
  app.post("/reset", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.resetConfig(projectId, agentId);
    const view = await deps.agentConfigService.getConfig(projectId, agentId);
    return c.json({
      ...view,
      activeSessionCount: deps.manager.activeCountForAgent(projectId, agentId),
    } satisfies AgentConfigResponse);
  });

  return app;
}
