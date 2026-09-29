/**
 * Project MCP-registry routes: GET|PUT /api/projects/:p/mcp-servers (the `[[mcp_servers]]`
 * block of .project_config.toml).
 *
 * The registry is Project-owned: one list edited in one place, which each Agent's
 * `tools.mcpServers` selects from. Any member can read it (the connectors page and an
 * Agent's picker both show it); only the owner can replace it — a member who could rewrite
 * it would be handing every other Agent in the Project a server they never chose.
 *
 * A PUT carries the **full** list (declarative replace), and it is the materialization
 * point: an empty array is a deliberate "nothing registered", distinct from omitting the
 * field by mistake. Every entry is validated with the same resolver the Environment
 * connects with, so an entry the harness could never reach is rejected here instead of
 * being stored and silently skipped later.
 */
import { Hono } from "hono";
import { resolveMCPServer } from "@prismshadow/jiumate-core";
import type { MCPServerConfig } from "@prismshadow/jiumate-core/interfaces";
import type { McpServerTestResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { HttpError } from "../errors.js";
import { readJson, requireValidId } from "../validate.js";
import { McpProbeInvalidEntryError, probeMcpServer } from "../../services/mcp-probe.js";
import type { AppDeps } from "../../app.js";

/** A registry is edited by hand and copied into Agent configs, so it stays small and bounded. */
const MAX_SERVERS = 64;

/**
 * Validates the list: each entry must resolve through the shared transport resolver (which
 * is what makes "saved" equal to "connectable"), names must be unique because they scope the
 * tools as `mcp__<name>__<tool>`, and unknown `config` keys ride along untouched so a
 * hand-written field the form does not model survives an edit here.
 */
function validateServers(value: unknown): MCPServerConfig[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "invalid_mcp_servers", "mcp_servers must be an array.");
  }
  if (value.length > MAX_SERVERS) {
    throw new HttpError(400, "invalid_mcp_servers", `mcp_servers exceeds ${MAX_SERVERS} entries.`);
  }
  const servers: MCPServerConfig[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new HttpError(400, "invalid_mcp_servers", "Each MCP server must be an object.");
    }
    const { name, config } = entry as Record<string, unknown>;
    if (typeof name !== "string" || name.trim() === "") {
      throw new HttpError(400, "invalid_mcp_servers", "Each MCP server needs a non-empty name.");
    }
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      throw new HttpError(
        400,
        "invalid_mcp_servers",
        `MCP server "${name.trim()}" needs a config object.`,
      );
    }
    const trimmed: MCPServerConfig = {
      name: name.trim(),
      config: config as Record<string, unknown>,
    };
    try {
      resolveMCPServer(trimmed);
    } catch (err) {
      throw new HttpError(
        400,
        "invalid_mcp_server",
        `MCP server "${trimmed.name}" is invalid: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (seen.has(trimmed.name)) {
      throw new HttpError(
        400,
        "duplicate_mcp_server",
        `MCP server "${trimmed.name}" is listed twice; names must be unique.`,
      );
    }
    seen.add(trimmed.name);
    servers.push(trimmed);
  }
  return servers;
}

export function mcpServersRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await deps.projectConfigService.getMcpServers(projectId));
  });

  app.put("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const servers = validateServers(body.mcp_servers);
    return c.json(await deps.projectConfigService.setMcpServers(projectId, servers));
  });

  /**
   * Probe one registry entry before it is saved (the connectors tab's "test" button), the
   * same reachability question the Agent-side editor asks. Readable by any member: it only
   * talks to a server, and someone who can see the registry can already read the entry.
   */
  app.post("/test", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    if (body.config === null || typeof body.config !== "object" || Array.isArray(body.config)) {
      throw new HttpError(400, "invalid_mcp_server", "config must be an object.");
    }
    const entry = validateServers([{ name: body.name, config: body.config }])[0]!;
    try {
      return c.json((await probeMcpServer(entry)) satisfies McpServerTestResponse);
    } catch (err) {
      if (err instanceof McpProbeInvalidEntryError) {
        throw new HttpError(400, "invalid_mcp_server", err.message);
      }
      throw err;
    }
  });

  return app;
}
