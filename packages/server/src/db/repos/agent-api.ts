/**
 * agent_api / agent_api_keys tables repo: each Agent's public API settings (the switch, keyless
 * access, the approval mode its API Sessions are created with) and its keys, stored as sha256
 * hashes — the caller alone holds a key. Neither table is rebuildable from files: dropping them
 * turns every exposed Agent off and invalidates every key.
 *
 * Constructor-injected like every other repo here, rather than the `@Component`/`@Use` fields the
 * upstream copy uses: this project's server wires services by hand (see http/app.ts), so the
 * decorator form would resolve nothing.
 */
import type { DatabaseSync } from "node:sqlite";
import type { ApprovalMode } from "../../api/types.js";

/** How many runs one exposed Agent admits at once, when the row does not say. */
export const DEFAULT_API_CONCURRENT_RUNS = 4;

/** One Agent's API settings, as the API tab reads and writes them. */
export interface AgentApiRow {
  projectId: string;
  agentId: string;
  enabled: boolean;
  open: boolean;
  approvalMode: ApprovalMode;
  /** NULL pair follows the Project default model. */
  model: { provider: string; modelId: string } | null;
  thinkingLevel: string | null;
  /** NULL creates a temporary Workspace per run. */
  workspace: string | null;
  maxConcurrentRuns: number;
  updatedAt: string;
}

/** A key, as the list shows it. The secret itself is never here — only the caller holds it. */
export interface AgentApiKeyRow {
  keyId: string;
  projectId: string;
  agentId: string;
  prefix: string;
  name: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The fields a PUT may change; absent means "leave as it is". */
export interface AgentApiPatch {
  enabled?: boolean;
  open?: boolean;
  approvalMode?: ApprovalMode;
  model?: { provider: string; modelId: string } | null;
  thinkingLevel?: string | null;
  workspace?: string | null;
  maxConcurrentRuns?: number;
}

type Row = Record<string, unknown>;

function settingsOf(r: Row): AgentApiRow {
  return {
    projectId: r.project_id as string,
    agentId: r.agent_id as string,
    enabled: Number(r.enabled) === 1,
    open: Number(r.open) === 1,
    approvalMode: r.approval_mode as ApprovalMode,
    model:
      r.provider === null ? null : { provider: r.provider as string, modelId: r.model_id as string },
    thinkingLevel: (r.thinking_level as string | null) ?? null,
    workspace: (r.workspace as string | null) ?? null,
    maxConcurrentRuns: Number(r.max_concurrent_runs),
    updatedAt: r.updated_at as string,
  };
}

function keyOf(r: Row): AgentApiKeyRow {
  return {
    keyId: r.key_id as string,
    projectId: r.project_id as string,
    agentId: r.agent_id as string,
    prefix: r.prefix as string,
    name: r.name as string,
    createdBy: r.created_by as string,
    createdAt: r.created_at as string,
    lastUsedAt: (r.last_used_at as string | null) ?? null,
  };
}

export class AgentApiRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(projectId: string, agentId: string): AgentApiRow | null {
    const r = this.db
      .prepare("SELECT * FROM agent_api WHERE project_id = ? AND agent_id = ?")
      .get(projectId, agentId);
    return r === undefined ? null : settingsOf(r as Row);
  }

  /**
   * Upserts the settings row, creating it on first write.
   *
   * `open` is forced to 0 while `enabled` is 0: keyless access to a disabled Agent would be a
   * switch that appears to do nothing, and a PUT that turned the API off while leaving keyless
   * access on would read back as a setting that survived being switched off.
   */
  upsert(
    row: Omit<AgentApiRow, "maxConcurrentRuns"> & { maxConcurrentRuns?: number },
  ): AgentApiRow {
    const maxRuns = row.maxConcurrentRuns ?? DEFAULT_API_CONCURRENT_RUNS;
    this.db
      .prepare(
        `INSERT INTO agent_api
           (project_id, agent_id, enabled, open, approval_mode, provider, model_id,
            thinking_level, workspace, max_concurrent_runs, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, agent_id) DO UPDATE SET
           enabled = excluded.enabled,
           open = excluded.open,
           approval_mode = excluded.approval_mode,
           provider = excluded.provider,
           model_id = excluded.model_id,
           thinking_level = excluded.thinking_level,
           workspace = excluded.workspace,
           max_concurrent_runs = excluded.max_concurrent_runs,
           updated_at = excluded.updated_at`,
      )
      .run(
        row.projectId,
        row.agentId,
        row.enabled ? 1 : 0,
        row.enabled && row.open ? 1 : 0,
        row.approvalMode,
        row.model?.provider ?? null,
        row.model?.modelId ?? null,
        row.thinkingLevel,
        row.workspace,
        maxRuns,
        row.updatedAt,
      );
    const stored = this.get(row.projectId, row.agentId);
    if (stored === null) throw new Error("agent_api upsert read back nothing");
    return stored;
  }

  deleteByAgent(projectId: string, agentId: string): void {
    // Keys first: they carry no foreign key to agent_api, and a key without its settings row would
    // authenticate into nothing.
    this.db
      .prepare("DELETE FROM agent_api_keys WHERE project_id = ? AND agent_id = ?")
      .run(projectId, agentId);
    this.db
      .prepare("DELETE FROM agent_api WHERE project_id = ? AND agent_id = ?")
      .run(projectId, agentId);
  }

  deleteByProject(projectId: string): void {
    this.db.prepare("DELETE FROM agent_api_keys WHERE project_id = ?").run(projectId);
    this.db.prepare("DELETE FROM agent_api WHERE project_id = ?").run(projectId);
  }

  // ── Keys ────────────────────────────────────────────────────────────────────────

  listKeys(projectId: string, agentId: string): AgentApiKeyRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_api_keys WHERE project_id = ? AND agent_id = ?
         ORDER BY created_at, key_id`,
      )
      .all(projectId, agentId) as Row[];
    return rows.map(keyOf);
  }

  insertKey(row: AgentApiKeyRow & { tokenHash: string }): void {
    this.db
      .prepare(
        `INSERT INTO agent_api_keys
           (key_id, project_id, agent_id, token_hash, prefix, name, created_by, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.keyId,
        row.projectId,
        row.agentId,
        row.tokenHash,
        row.prefix,
        row.name,
        row.createdBy,
        row.createdAt,
        row.lastUsedAt,
      );
  }

  /**
   * The key a presented secret belongs to.
   *
   * A lookup by digest rather than a comparison against a scanned set: the stored value is a
   * fixed-length hash, so the time this takes does not depend on how much of a guess was right.
   */
  findKeyByHash(tokenHash: string): AgentApiKeyRow | null {
    const r = this.db.prepare("SELECT * FROM agent_api_keys WHERE token_hash = ?").get(tokenHash);
    return r === undefined ? null : keyOf(r as Row);
  }

  touchKey(keyId: string, at: string): void {
    this.db.prepare("UPDATE agent_api_keys SET last_used_at = ? WHERE key_id = ?").run(at, keyId);
  }

  deleteKey(projectId: string, agentId: string, keyId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM agent_api_keys WHERE key_id = ? AND project_id = ? AND agent_id = ?")
      .run(keyId, projectId, agentId);
    return Number(result.changes) > 0;
  }
}