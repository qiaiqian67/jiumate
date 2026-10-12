/**
 * The credential section of the plugin detail Modal: the API keys a plugin's Skills declare in
 * their `required_env`, and one input per variable to fill them in.
 *
 * **The card's key glyph is a status marker, not an editor.** It answers "is this plugin
 * configured", and a marker with no way to act on it leaves the only answer to "where do I put
 * the key" somewhere else entirely — the Agent settings page, reached by a gear icon on another
 * page, for a user who is looking at the thing that wants the key. So the input lives where the
 * marker is.
 *
 * **Writes go to the selected Agent's vault, not to a per-plugin store.** A `required_env` name is
 * a shell environment variable, and the vault is already the mechanism that makes one reach an
 * Agent's `exec_command` subprocess (the Agent settings Vault tab is the same write). Writing
 * anywhere else would create a second, invisible copy of a credential that the runtime does not
 * read — the Firecrawl skill's own `curl` calls `$FIRECRAWL_API_KEY` from the shell.
 *
 * **Which Agent is stated, not assumed.** A key set on one Agent does not reach another, and the
 * detail Modal can be opened with no Agent selected at all, so the section names the Agent it
 * writes to and refuses rather than guessing. A credential written to the wrong Agent is a
 * silent failure: the key reads as configured on the card that was filled in, and the skill that
 * needs it still reports a missing credential.
 *
 * **Values are never read back.** The vault answers with a masked value per entry and plaintext
 * never crosses the wire, so a configured key shows as already-set with a way to replace it —
 * resending only the key name keeps the stored value, which is what makes the PUT full-table
 * replace safe to use here.
 */
import { useCallback, useEffect, useState } from "react";
import type { VaultEntryInfo, VaultUpdateRequest } from "@prismshadow/jiumate-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { agentDisplayName, useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { PasswordInput } from "../../components/ui/password-input";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";

/**
 * The environment variables a plugin's Skills declare, deduplicated and in a stable order.
 *
 * Two Skills in one plugin can declare the same variable (the plugin ships a set that share one
 * provider's key), and the section asks for it once — two inputs bound to one key name would let
 * the second save silently overwrite the first.
 */
export function pluginEnvNames(
  skills: readonly { requiredEnv?: readonly string[]; requiredEnvReady?: boolean }[],
): string[] {
  const names = new Set<string>();
  for (const skill of skills) for (const name of skill.requiredEnv ?? []) names.add(name);
  return [...names].sort();
}

export function PluginCredentials({
  names,
  onChanged,
}: {
  /** The declared variables, deduplicated (see `pluginEnvNames`). */
  names: readonly string[];
  /** Called after a successful save, so the caller can re-read the key glyph's state. */
  onChanged?: () => void;
}) {
  const { currentProject, currentAgent } = useProject();
  const projectId = currentProject?.projectId;
  const agentId = currentAgent?.agentId;
  // Vault writes are owner-only server-side (members get 403), so the inputs are disabled rather
  // than hidden: a member looking at this card needs to know the key exists and that someone with
  // the right role has to set it.
  const canEdit = currentProject?.role === "owner";

  const [entries, setEntries] = useState<VaultEntryInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Draft value per variable name; absent means "untouched", which keeps the existing value. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** The variable currently being written, so one save disables only its own input. */
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !agentId) {
      setEntries([]);
      return;
    }
    setEntries(null);
    setError(null);
    try {
      const res = await api.getVault(projectId, agentId);
      setEntries(res.entries);
    } catch (e) {
      setError(apiErrorText(e));
      setEntries([]);
    }
  }, [projectId, agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const configured = new Set((entries ?? []).map((e) => e.key));

  /**
   * Upsert one variable, keeping every other entry.
   *
   * PUT replaces the whole table, so an absent key is a deletion — every other entry has to be
   * resent, carrying only its key name, which the server treats as "keep the stored value". Sending
   * only the changed key would wipe the Agent's other credentials.
   */
  const save = async (name: string) => {
    if (!projectId || !agentId) return;
    const value = drafts[name]?.trim();
    if (!value) return;
    setSaving(name);
    try {
      const body: VaultUpdateRequest = {
        entries: [
          // Everything except the key being written, by key name alone (keeps its value).
          ...(entries ?? []).filter((e) => e.key !== name).map((e) => ({ key: e.key })),
          { key: name, value },
        ],
      };
      const res = await api.putVault(projectId, agentId, body);
      setEntries(res.entries);
      // The draft is dropped rather than kept: the stored value is masked and never comes back, so
      // a retained draft would sit in a field that looks editable but can no longer be submitted.
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      toastSuccess(`${name} ${S.common.saved}`);
      onChanged?.();
    } catch (e) {
      toastError(`${name}: ${apiErrorText(e)}`);
    } finally {
      setSaving(null);
    }
  };

  if (names.length === 0) return null;

  return (
    <section className="mt-4 rounded-md border border-gray-200 p-3 dark:border-gray-800">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {S.plugins.credentialsTitle}
        </h3>
        <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400 dark:text-gray-500">
          {S.plugins.credentialsSubtitle}
        </span>
      </div>

      {agentId === undefined ? (
        // No Agent selected: there is no vault to write to, and guessing one would configure a
        // credential where nobody would find it.
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {S.plugins.credentialsNeedsAgent}
        </p>
      ) : (
        <>
          {/* Names the Agent, because the key lands in that Agent's vault and nowhere else. */}
          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            {S.plugins.credentialsForAgent(agentDisplayName(currentAgent!))}
          </p>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          {entries === null && <SkeletonList rows={names.length} />}
          <div className="mt-2 space-y-2">
            {names.map((name) => {
              const isSet = configured.has(name);
              const draft = drafts[name] ?? "";
              const dirty = draft.trim() !== "";
              return (
                <div key={name} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <PasswordInput
                      size="sm"
                      label={name}
                      // A configured key has a value the server will not send back, so the field
                      // starts empty and the placeholder says so — a filled field the user cannot
                      // verify would be a claim we cannot support.
                      placeholder={isSet ? S.plugins.credentialsAlreadySet : name}
                      value={draft}
                      disabled={!canEdit}
                      autoComplete="off"
                      className="font-mono"
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [name]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && dirty && saving === null && canEdit)
                          void save(name);
                      }}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    className="mt-6 shrink-0"
                    disabled={!canEdit || !dirty || saving !== null}
                    onClick={() => void save(name)}
                  >
                    {saving === name ? S.common.saving : S.common.save}
                  </Button>
                </div>
              );
            })}
          </div>
          {!canEdit && <p className="mt-2 text-[11px] text-gray-400">{S.vault.readOnlyHint}</p>}
        </>
      )}
    </section>
  );
}
