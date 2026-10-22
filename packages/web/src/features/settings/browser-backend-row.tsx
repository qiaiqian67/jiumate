/**
 * The row that picks which browser the agent drives.
 *
 * The choice is the user's, and the row says what each one means — because the difference
 * is not obvious: one browser shows its pages and the other does not, and one of them is
 * the one whose sign-ins the import brought.
 */
import { useState } from "react";
import { Segmented } from "../../components/ui/segmented";
import { S } from "../../lib/strings";
import { useBrowserBackend } from "../../state/browser-backend";
import type { BrowserBackend } from "@prismshadow/jiumate-core/interfaces";
import { PrefRow } from "./setting-row";

/** What each backend means, in the user's terms. */
const HINTS: Record<BrowserBackend, string> = {
  builtin: S.settings.browserBuiltinHint,
  headless: S.settings.browserHeadlessHint,
  chrome: S.settings.browserChromeHint,
};

export function BrowserBackendRow() {
  const { backend, choice, set } = useBrowserBackend();
  const [busy, setBusy] = useState(false);
  const current = choice ?? backend ?? "builtin";

  const options: ReadonlyArray<{ value: BrowserBackend; label: string }> = [
    { value: "builtin", label: S.settings.browserBuiltin },
    { value: "headless", label: S.settings.browserHeadless },
    { value: "chrome", label: S.settings.browserChrome },
  ];

  return (
    <PrefRow label={S.settings.browserBackend} info={S.settings.browserBackendInfo}>
      <div className="flex flex-col items-end gap-1">
        <Segmented
          options={options}
          value={current}
          cols={3}
          onChange={(next) => {
            setBusy(true);
            void set(next).finally(() => setBusy(false));
          }}
        />
        <p className="max-w-[26rem] text-right text-xs text-gray-500 dark:text-gray-400">
          {HINTS[current]}
        </p>
        {busy && <p className="text-xs text-gray-400 dark:text-gray-500">{S.common.loading}</p>}
      </div>
    </PrefRow>
  );
}
