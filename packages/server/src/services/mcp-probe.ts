/**
 * One-shot reachability probe for a single MCP server entry: connect, discover tools, close.
 *
 * Shared by the Agent config route (`…/agents/:a/config/mcp-test`, probing a value the user
 * is editing) and the Project registry route (`…/mcp-servers/test`, probing a registry entry
 * before it is saved). Both ask the identical question, and both must answer it the way a
 * Session will experience the server — so there is one implementation, not two that can
 * drift.
 *
 * Runs server-side on purpose: stdio servers spawn on this host, exactly where Sessions run
 * them, and a browser-origin HTTP probe would stumble over CORS. Callers own authorization;
 * this function only talks to the server and never writes anything.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpToolProvider, resolveMCPServer } from "@jadelau/core";
import type { MCPServerConfig } from "@jadelau/core";
import type { McpServerTestResponse } from "../api/types.js";

/** Ceiling on a single probe's connect budget (an entry may configure minutes; a request must not hang on it). */
export const MCP_TEST_TIMEOUT_CAP_MS = 30_000;

/** Thrown when the entry itself cannot be resolved — the caller maps it to a 400, never to `{ ok: false }`. */
export class McpProbeInvalidEntryError extends Error {}

/**
 * Connects to `entry` and lists its tools. A malformed entry throws
 * `McpProbeInvalidEntryError` (a caller error, not a reachability verdict); an unreachable
 * server returns `{ ok: false }` carrying the collected warning.
 */
export async function probeMcpServer(entry: MCPServerConfig): Promise<McpServerTestResponse> {
  let resolved;
  try {
    resolved = resolveMCPServer(entry);
  } catch (err) {
    throw new McpProbeInvalidEntryError(err instanceof Error ? err.message : String(err));
  }
  // The entry's own connect budget applies, capped for testing so a probe can't hold a
  // request open arbitrarily long (the bulk test walks every server sequentially).
  if (resolved.connectTimeoutMs > MCP_TEST_TIMEOUT_CAP_MS) {
    entry = { ...entry, config: { ...entry.config, connectTimeoutMs: MCP_TEST_TIMEOUT_CAP_MS } };
  }
  const warnings: string[] = [];
  // A fresh empty directory stands in for the Session Workspace (a new session's temporary
  // workspace is exactly that), so a stdio server that resolves relative paths behaves like
  // it will at runtime — not like the server process's own cwd.
  const workspaceDir = await mkdtemp(join(tmpdir(), "jiumate-mcp-test-"));
  const provider = new McpToolProvider([entry], {
    workspaceDir,
    warn: (m) => warnings.push(m),
  });
  const startedAt = Date.now();
  try {
    const tools = await provider.listTools();
    const latencyMs = Date.now() - startedAt;
    // The verdict comes from the connect outcome itself, not from the warning count: benign
    // warnings (a tool listed twice / an LLM-unusable tool name) must not report a healthy
    // server as failed.
    const outcome = provider.connectResults()[0];
    if (outcome === undefined || outcome.status !== "completed") {
      return {
        ok: false,
        error:
          outcome?.error_message ?? (warnings.length > 0 ? warnings.join("; ") : "connect failed"),
        latencyMs,
      };
    }
    return { ok: true, tools: tools.map((t) => t.name), latencyMs };
  } finally {
    await provider.close();
    void rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
