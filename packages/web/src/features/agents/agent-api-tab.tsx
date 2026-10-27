/**
 * Agent settings page "API" tab: this Agent's public API exposure — the switch, keyless access,
 * the approval mode its API sessions start under, the model and thinking level they use, the
 * Workspace runs in, the concurrency ceiling, and the keys.
 *
 * Every write takes the signed-in person, never the local API token an Agent's own tool subprocess
 * holds (403 `human_required`, see requireHuman): a shell that could turn on its own exposure, or
 * loosen the approval mode its future callers start under, would be a shell that could grant
 * itself more than its owner intended. So the tab does not retry a 403 — a token cannot become a
 * human by asking again — it says why instead.
 *
 * Settings and key list come from one GET, and the PUT answers with the stored row rather than the
 * requested values. `open` in particular is forced to 0 while `enabled` is 0, so writing `open:
 * true` then `enabled: false` reads back as `open: false`. Trusting what was sent would show a
 * setting the server does not hold; every render here comes from the response.
 *
 * The secret is shown once. That is not a UI choice — the server keeps only a sha256 of it — so
 * the reveal is a modal the user dismisses, and the row afterwards shows a prefix and a last-used
 * time that are all the server will ever give back.
 */
import { useCallback, useEffect, useState } from "react";
import type { AgentApiKeyInfo, AgentApiResponse, ApprovalMode } from "@jadelau/server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { HelpFold } from "../../components/ui/help-fold";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { SettingsEmpty } from "../../components/ui/empty-state";
import { SkeletonList } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { TRASH_ICON } from "./skills-tab";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { useProject } from "../../state/project";

/**
 * The four modes, in the order the server's APPROVAL_MODES lists them.
 *
 * Typed as ApprovalMode rather than string: an `<option value={someString}>` widens to string, and
 * a widened value would be accepted here and rejected by the server's PUT validation — turning a
 * type error into a runtime 400 on a control the user can only reach by clicking.
 */
const APPROVAL_LABELS: Record<ApprovalMode, string> = {
  "allow-all": S.agentApi.approvalAllowAll,
  "deny-all": S.agentApi.approvalDenyAll,
  "read-only": S.agentApi.approvalReadOnly,
  "always-ask": S.agentApi.approvalAlwaysAsk,
};

const THINKING_LABELS: Record<string, string> = {
  off: S.agentApi.thinkingDefault,
  low: "low",
  medium: "medium",
  high: "high",
};

export function AgentApiTab({ agentId }: { agentId: string }) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;

  const [data, setData] = useState<AgentApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  // The secret, held only until the reveal modal is dismissed. It exists nowhere else: the server
  // keeps a digest, so this string cannot be recovered by any later read.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [removingKey, setRemovingKey] = useState<AgentApiKeyInfo | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setData(null);
    setError(null);
    try {
      setData(await api.getAgentApi(projectId, agentId));
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Sends a partial patch and adopts whatever comes back.
   *
   * Written as a patch rather than a full object so two toggles flipped quickly cannot clobber each
   * other: each PUT carries only the field it changed, and the server leaves absent fields alone.
   */
  const patch = useCallback(
    async (body: Parameters<typeof api.updateAgentApi>[2]) => {
      if (!projectId) return;
      setBusy(true);
      try {
        setData(await api.updateAgentApi(projectId, agentId, body));
        toastSuccess(S.agentApi.saved);
      } catch (e) {
        toastError(apiErrorText(e));
        // The write did not land, so the switch has to go back to what the server holds. Re-reading
        // beats guessing: the server may have clamped or rejected part of the patch, and restoring
        // the previous local value would show a state the server never had.
        await load();
      } finally {
        setBusy(false);
      }
    },
    [projectId, agentId, load],
  );

  const createKey = useCallback(async () => {
    if (!projectId) return;
    const name = keyName.trim();
    if (name === "") {
      toastError(S.agentApi.keyName);
      return;
    }
    setCreating(true);
    try {
      const res = await api.createAgentApiKey(projectId, agentId, name);
      setRevealed(res.secret);
      setKeyName("");
      await load();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setCreating(false);
    }
  }, [projectId, agentId, keyName, load]);

  const confirmDeleteKey = useCallback(async () => {
    if (!projectId || removingKey === null) return;
    setBusy(true);
    try {
      await api.deleteAgentApiKey(projectId, agentId, removingKey.keyId);
      toastSuccess(S.agentApi.keyDeleted(removingKey.name));
      setRemovingKey(null);
      await load();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }, [projectId, agentId, removingKey, load]);

  if (!projectId) return null;
  if (error !== null) {
    return <p className="text-xs text-red-600 dark:text-red-400">{error}</p>;
  }
  if (data === null) return <SkeletonList rows={3} />;

  const a = data.api;
  // An admin who turned the whole API off makes every per-Agent switch meaningless. Saying so
  // here is the difference between "my settings do not save" and a clear reason.
  const serverOff = !data.serverEnabled;

  const row = (label: string, hint: string | undefined, control: React.ReactNode) => (
    <div className="flex items-start justify-between gap-4 border-t border-gray-100 px-4 py-3 first:border-t-0 dark:border-gray-800/60">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</p>
        {hint !== undefined && (
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <HelpFold label={S.agentApi.tabLabel}>{S.agentApi.tabDesc}</HelpFold>

      {serverOff && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {S.agentApi.serverOff}
        </p>
      )}

      {/* Exposure */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {row(
          S.agentApi.enable,
          S.agentApi.enableHint,
          <Switch
            checked={a.enabled}
            disabled={busy}
            onChange={(v) => void patch({ enabled: v })}
          />,
        )}
        {a.enabled &&
          row(
            S.agentApi.open,
            S.agentApi.openHint,
            <Switch
              checked={a.open}
              disabled={busy}
              onChange={(v) => void patch({ open: v })}
            />,
          )}
      </div>

      {/* How runs behave. Only meaningful once exposed: an Agent that admits nothing has no runs to
          configure, and showing the knobs would imply they do something. */}
      {a.enabled && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {row(
            S.agentApi.approvalMode,
            S.agentApi.approvalHint,
            <select
              value={a.approvalMode}
              disabled={busy}
              onChange={(e) => {
                // A `<select>` value is always a string, so it is checked against the mode set
                // rather than cast: a cast here would send whatever the option list happens to
                // hold and let the server reject it as a 400 the tab cannot explain.
                const next = e.target.value as ApprovalMode;
                if (next in APPROVAL_LABELS) void patch({ approvalMode: next });
              }}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
            >
              {Object.entries(APPROVAL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>,
          )}
          {row(
            S.agentApi.thinkingLevel,
            undefined,
            <select
              value={a.thinkingLevel ?? ""}
              disabled={busy}
              onChange={(e) =>
                void patch({ thinkingLevel: e.target.value === "" ? null : e.target.value })
              }
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
            >
              <option value="">{S.agentApi.thinkingDefault}</option>
              {Object.entries(THINKING_LABELS)
                .filter(([value]) => value !== "")
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>,
          )}
          {row(
            S.agentApi.workspace,
            S.agentApi.workspaceHint,
            <Input
              value={a.workspace ?? ""}
              placeholder={S.agentApi.workspacePlaceholder}
              disabled={busy}
              onChange={(e) => void patch({ workspace: e.target.value === "" ? null : e.target.value })}
              className="w-56 text-xs"
            />,
          )}
          {row(
            S.agentApi.maxConcurrentRuns,
            S.agentApi.maxConcurrentHint,
            <Input
              type="number"
              min={1}
              value={a.maxConcurrentRuns}
              disabled={busy}
              onChange={(e) => {
                const n = Number(e.target.value);
                // A partial edit ("1" while typing "16") would patch 1 and clamp every later
                // keystroke, so only a complete positive integer is sent.
                if (Number.isSafeInteger(n) && n >= 1) void patch({ maxConcurrentRuns: n });
              }}
              className="w-20 text-xs"
            />,
          )}
        </div>
      )}

      {/* Keys */}
      <section className="space-y-2.5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200">
          {S.agentApi.keysTitle}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.agentApi.keysDesc}</p>

        {!a.enabled ? (
          <SettingsEmpty>{S.agentApi.notExposedYet}</SettingsEmpty>
        ) : a.keys.length === 0 ? (
          <SettingsEmpty>{S.agentApi.keysEmpty}</SettingsEmpty>
        ) : (
          <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {a.keys.map((key) => (
              <div
                key={key.keyId}
                className="flex items-center gap-3 border-b border-gray-100 px-3 py-2.5 last:border-b-0 dark:border-gray-800/60"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-gray-800 dark:text-gray-200">
                    {key.name}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">
                    {key.prefix}…
                  </span>
                  <span className="mt-0.5 block text-[11px] text-gray-400 dark:text-gray-500">
                    {key.lastUsedAt === null
                      ? S.agentApi.keyNeverUsed
                      : S.agentApi.keyLastUsed(key.lastUsedAt)}
                  </span>
                </div>
                <Button
                  size="icon"
                  variant="danger"
                  title={S.agentApi.deleteKey}
                  aria-label={`${S.agentApi.deleteKey} ${key.name}`}
                  disabled={busy}
                  onClick={() => setRemovingKey(key)}
                >
                  <GlyphIcon d={TRASH_ICON} size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}

        {a.enabled && (
          <div className="flex items-center gap-2">
            <Input
              value={keyName}
              placeholder={S.agentApi.keyNamePlaceholder}
              disabled={creating}
              onChange={(e) => setKeyName(e.target.value)}
              className="w-56 text-xs"
            />
            <Button size="sm" disabled={creating || busy} onClick={() => void createKey()}>
              {S.agentApi.createKey}
            </Button>
          </div>
        )}
      </section>

      {/* The one-time reveal. Dismissal is the only exit: there is no "show again", because the
          server holds a digest and cannot reproduce it. */}
      <Modal open={revealed !== null} onClose={() => setRevealed(null)} title={S.agentApi.keySecretLabel}>
        <p className="text-xs text-amber-700 dark:text-amber-300">{S.agentApi.keySecretWarning}</p>
        <code className="mt-2 block break-all rounded-md bg-gray-100 px-3 py-2 font-mono text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200">
          {revealed}
        </code>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => setRevealed(null)}>
            {S.agentApi.keyCreated}
          </Button>
        </div>
      </Modal>

      <ConfirmModal
        open={removingKey !== null}
        title={
          removingKey !== null ? S.agentApi.deleteKeyConfirmTitle(removingKey.name) : ""
        }
        busy={busy}
        onClose={() => setRemovingKey(null)}
        onConfirm={() => void confirmDeleteKey()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {removingKey !== null ? S.agentApi.deleteKeyConfirmBody(removingKey.name) : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}