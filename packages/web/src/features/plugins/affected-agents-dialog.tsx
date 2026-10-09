/**
 * Confirmation dialog for a change that would reach other Agents — uninstalling or disabling a
 * plugin or skill (features/plugins/affected-agents-dialog.tsx).
 *
 * **Why this exists.** Removing an extension looks local: you click uninstall on one card and the
 * card disappears. It is not local — the Agents holding it lose it, and if an Agent had it
 * *selected* its behaviour changes on the next turn with nothing else on screen saying so. The
 * requirement is a warning, and the requirement is specific: not a toast, but a list the user can
 * read before committing. So this names each Agent and says *why* it is affected, because
 * 「已安装」 and 「已选用」 mean very different things to someone deciding whether to proceed.
 *
 * **The list is capped, and the cap is stated.** Twenty-odd Agents is a realistic number in a
 * shared Project, and a dialog that grows to fit them pushes its own confirm button off a short
 * screen. The overflow line is shown rather than left implicit, so "20 shown, 4 more" is never
 * mistaken for "that was all of them".
 *
 * **A bundled skill warns about its plugin's Agents.** It cannot be uninstalled on its own, so
 * this dialog is reached from disabling it — and the impact of switching off something a plugin
 * shipped is exactly that plugin's install list, which is what the caller passes in.
 */
import { useMemo } from "react";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { S } from "../../lib/strings";
import type { AffectedAgent } from "./extension-model";

/** Rows shown before the overflow line takes over. Chosen to fit a short viewport with the buttons. */
const MAX_ROWS = 8;

export interface AffectedAgentsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Performs the change. The dialog owns no async state — the caller's own pending flag owns the button. */
  onConfirm: () => void;
  /** Dialog title, e.g. 「卸载插件」. */
  title: string;
  /** One line naming what is about to happen and to what. */
  description: string;
  /** Extra warning shown above the list (a bundled skill names its plugin here). */
  note?: string;
  affected: readonly AffectedAgent[];
  /** Label for the commit button; defaults to the neutral 「确认」. */
  confirmLabel?: string;
  /** In-progress on the confirm button (the caller's own request). */
  busy?: boolean;
}

export function AffectedAgentsDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  note,
  affected,
  confirmLabel,
  busy = false,
}: AffectedAgentsDialogProps) {
  // Sorted upstream by affectedAgents, but re-sorted here so the dialog is safe to call with a
  // list from anywhere — a dialog that reshuffles between opens reads as a glitch.
  const rows = useMemo(() => [...affected].sort((a, b) => a.agentId.localeCompare(b.agentId)), [affected]);
  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      headerless
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {S.common.cancel}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {confirmLabel ?? S.common.confirm}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-gray-700 dark:text-gray-200">{description}</p>
      {note && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{note}</p>}

      {rows.length > 0 ? (
        <>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {S.plugins.affectedAgentsCount(rows.length)}
          </p>
          <ul className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
            {shown.map((a) => (
              <li key={a.agentId} className="flex items-center gap-2 px-2.5 py-2">
                <AgentAvatar id={a.agentId} name={a.displayName ?? a.agentId} size={20} className="shrink-0 rounded" />
                <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-100">
                  {a.displayName ?? a.agentId}
                </span>
                {/* The reason is the load-bearing part: 「已安装」 is a fact, 「已选用」 means the
                    Agent is actively pointing at this, which is what makes it urgent. */}
                <span
                  className={
                    a.reason === "selected"
                      ? "shrink-0 text-xs text-amber-600 dark:text-amber-400"
                      : "shrink-0 text-xs text-gray-400 dark:text-gray-500"
                  }
                >
                  {a.reason === "selected" ? S.plugins.agentReasonSelected : S.plugins.agentReasonInstalled}
                </span>
              </li>
            ))}
          </ul>
          {/* Never leave the truncation implicit — "these were all of them" is a wrong belief the
              user would act on. */}
          {hidden > 0 && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {S.plugins.affectedAgentsMore(hidden)}
            </p>
          )}
        </>
      ) : (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{S.plugins.noAffectedAgents}</p>
      )}
    </Modal>
  );
}