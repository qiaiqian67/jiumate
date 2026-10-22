/**
 * The clear-data dialog: empties the built-in browser's own store.
 *
 * It asks first, because what it throws away is the sign-ins the import brought — the pages
 * the agent could open signed in to. There is no agent-side verb for it: an agent that could
 * clear the store could clear the sign-in it depends on.
 */
import { useState } from "react";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { S } from "../../lib/strings";
import { apiFetch } from "../../api/client";

export function ClearDataDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);

  return (
    <ConfirmModal
      open={open}
      title={S.browser.clearData}
      tone="danger"
      confirmLabel={S.browser.clearData}
      busy={busy}
      onClose={onClose}
      onConfirm={() => {
        setBusy(true);
        void apiFetch("/api/browser/clear-data", { method: "POST", body: {} })
          .catch(() => undefined)
          .finally(() => {
            setBusy(false);
            onClose();
          });
      }}
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">{S.browser.clearDataHint}</p>
    </ConfirmModal>
  );
}
