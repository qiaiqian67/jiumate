/**
 * The id rule every project/agent/skill identifier is held to, and the assertion that enforces it.
 *
 * Lives in `internal/` because `agent-state.ts` and `plugin-store.ts` both need it and agent-state
 * already imports the store — a private copy in each would be two rules that drift, and this one
 * decides which directory names a caller is allowed to touch.
 */

/** project_id / agent_id / skill_name only allow letters, digits, underscore `_`, and hyphen `-` (prevents path traversal). */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type IdKind = "project_id" | "agent_id" | "skill_name";

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function assertValidId(kind: IdKind, id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid ${kind} ${JSON.stringify(id)}: only letters, digits, "_" and "-" are allowed.`,
    );
  }
}
