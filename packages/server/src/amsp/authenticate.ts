/**
 * Authenticating an Agent API key, and refusing the request when the Agent is not exposed.
 *
 * A `jiumate_` key proves which Agent the caller means — it is stored as a sha256 digest and
 * looked up by that digest, so this is a single indexed read whose cost does not depend on how
 * much of a guess was right (see db/repos/agent-api.ts). What the key does *not* prove is that the
 * Agent is currently willing to be called, which is what the rest of this file checks. Those are
 * separate questions on purpose: a key outlives the switch being turned off, and turning the switch
 * off must take effect on the next request without anyone having to delete the keys.
 *
 * Four things can refuse a call, and they are kept apart because the caller acts differently on
 * each:
 *
 *   1. No key, or a key that matches nothing — 401. Retry with the same key will not help.
 *   2. The admin has turned the whole API off — 503, not 404. Every exposed Agent is unreachable,
 *      and a 404 would read as "no such Agent", sending the caller to check a name that is fine.
 *   3. This Agent's switch is off — 404. It is indistinguishable from a wrong Agent id on purpose:
 *      otherwise this endpoint becomes an oracle for probing which Agents exist.
 *   4. Every slot is busy — 429, with `Retry-After`. The one refusal that is expected to clear.
 *
 * A missing `Authorization` header entirely is treated as keyless access rather than as a bad
 * key, because `open` is exactly that: the owner decided a key is not required. When `open` is off
 * and no key is presented, the answer is the same 404 as case 3 — again so the endpoint does not
 * disclose which Agents are exposed.
 */
import type { Context } from "hono";
import { HttpError } from "../http/errors.js";
import type { ApprovalMode } from "../api/types.js";
import { hashAgentApiKey, AGENT_API_KEY_PREFIX } from "./keys.js";
import type { AgentApiRepo } from "../db/repos/agent-api.js";
import type { ServerSettingsRepo } from "../db/repos/server-settings.js";

/** Where the key may appear. Both are accepted because CLI clients differ in which they send. */
export interface PresentedAgentApiKey {
  keyId: string;
  projectId: string;
  agentId: string;
}

/**
 * The key a request presented, from the header or the query parameter.
 *
 * The query form exists for `EventSource`, which cannot set headers: a streaming caller in a
 * browser has no way to attach one. It is read only for GET, because a secret in a URL leaks into
 * logs, proxies and Referer headers, and a POST that accepts it would be an invitation to put keys
 * in URLs everywhere.
 */
export function presentedKey(c: Context, opts: { allowQuery: boolean }): string | null {
  const header = c.req.header("authorization");
  if (header !== undefined) {
    // Only the Agent API scheme is claimed here. A `Bearer <local api token>` reaches this
    // middleware too, and must be told so by the auth middleware rather than silently treated as
    // a bad Agent key — the caller would otherwise be told to rotate a key it never had.
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (m !== null) {
      const token = m[1]!.trim();
      return token.startsWith(AGENT_API_KEY_PREFIX) ? token : null;
    }
    return null;
  }
  if (!opts.allowQuery) return null;
  const q = c.req.query("key");
  if (q === undefined || q === "") return null;
  return q.startsWith(AGENT_API_KEY_PREFIX) ? q : null;
}

/** What an authenticated caller is allowed to do, resolved from the settings row. */
export interface AgentApiGrant {
  projectId: string;
  agentId: string;
  /** Keyless callers get `null`: no key to touch, and nothing to attribute later. */
  keyId: string | null;
  approvalMode: ApprovalMode;
  /** `null` means "follow the Project default model". */
  model: { provider: string; modelId: string } | null;
  thinkingLevel: string | null;
  /** `null` means "make a temporary Workspace per run". */
  workspace: string | null;
}

/**
 * Resolves the grant for this request, or throws the refusal that applies.
 *
 * Takes the repo rather than the settings row so the checks happen against storage, not against
 * something a caller could have assembled.
 */
export function authorizeAgentApiCall(
  c: Context,
  deps: { agentApiRepo: AgentApiRepo; serverSettingsRepo: ServerSettingsRepo },
  agentIdFromPath: string,
): AgentApiGrant {
  const presented = presentedKey(c, { allowQuery: c.req.method === "GET" });

  let projectId: string | null = null;
  let agentId: string | null = null;
  let keyId: string | null = null;

  if (presented !== null) {
    const row = deps.agentApiRepo.findKeyByHash(hashAgentApiKey(presented));
    if (row === null) {
      throw new HttpError(401, "unauthorized", "Invalid Agent API key.");
    }
    projectId = row.projectId;
    agentId = row.agentId;
    keyId = row.keyId;
  }

  // The Agent id in the path is only trusted when it agrees with the key. Without a key it is the
  // caller's word for which Agent it means, and that is what `open` consents to.
  const pathAgentId = agentIdFromPath;
  if (agentId !== null && agentId !== pathAgentId) {
    throw new HttpError(404, "not_found", "No such Agent.");
  }

  const resolvedAgentId = agentId ?? pathAgentId;
  // Without a key and without a project id there is nothing to look the settings up by, so the
  // request cannot be attributed to a Project at all. This is the one case where keyless access
  // cannot work, and it is why `open` still requires the Project to be named in the path.
  if (projectId === null) {
    throw new HttpError(
      400,
      "bad_request",
      "An Agent API key or a project id in the path is required.",
    );
  }

  if (!deps.serverSettingsRepo.getAgentApiEnabled()) {
    throw new HttpError(
      503,
      "api_disabled",
      "The Agent API is turned off on this server.",
    );
  }

  const settings = deps.agentApiRepo.get(projectId, resolvedAgentId);
  // Keyed but the switch is off, and keyless with `open` off: both 404. Deliberately the same
  // answer as an unknown Agent, so this endpoint cannot be used to enumerate what exists.
  if (settings === null || !settings.enabled) {
    throw new HttpError(404, "not_found", "No such Agent.");
  }
  if (keyId === null && !settings.open) {
    throw new HttpError(404, "not_found", "No such Agent.");
  }

  // Recorded per request rather than per session: the list shows when a key was last used, and a
  // key used once a week should not look idle for six days.
  if (keyId !== null) {
    deps.agentApiRepo.touchKey(keyId, new Date().toISOString());
  }

  return {
    projectId,
    agentId: resolvedAgentId,
    keyId,
    approvalMode: settings.approvalMode,
    model: settings.model,
    thinkingLevel: settings.thinkingLevel,
    workspace: settings.workspace,
  };
}