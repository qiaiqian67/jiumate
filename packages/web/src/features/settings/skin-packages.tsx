/**
 * Theme import: how a user gets more themes, and how a theme they made elsewhere gets in.
 *
 * Lives on the Appearance page rather than beside the pet packages on the Application page,
 * because that is where themes are *selected*: an import control next to the gallery that uses
 * it is the whole point, and a user looking for "how do I get more themes" starts there.
 *
 * Import only — selecting and removing both happen on the gallery cards above. Listing the
 * installed themes here as well would make this a second, redundant picker, and put a theme's
 * name in two places on one page.
 *
 * Import takes a **path**, and a **native folder dialog** when one is available.
 *
 * `window.theme.pickFolder` is the desktop shell's own picker, named and titled for themes —
 * see `theme-picker.ts` on the desktop side. It is optional on purpose: the web app also runs in
 * a plain browser, where no picker exists, and the server and the person importing share a
 * filesystem either way. So the path field stays the primary control and the button is an
 * accelerator, rather than the button being the only way in.
 */
import { useRef, useState } from "react";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { ApiError } from "../../api/client";
import { useTheme } from "../../state/theme";
import {
  importTheme,
  importThemeArchive,
  type ImportThemeResult,
  type ThemeDescriptor,
} from "../skin/skin-service";

export function SkinPackagesSection() {
  const { setTheme, refreshSkins } = useTheme();
  const [path, setPath] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const picker = window.theme?.pickFolder;

  /**
   * Apply an imported theme. Shared by all three routes in, because an import the user cannot
   * see the effect of reads as a failure — so selecting what arrived is part of importing it,
   * not a separate step the caller might forget.
   */
  const applyImported = async (theme: ThemeDescriptor, warnings: readonly string[]) => {
    await refreshSkins();
    setTheme(theme.id);
    toastSuccess(S.settings.themeImported(theme.name));
    if (warnings.length > 0) {
      // A Codex-Dream-Skin theme carries copy and framing for a shell we are not, so a silent
      // import would leave the user comparing against a screenshot that never matched.
      toastInfo(`${S.settings.themeImportWarnings} ${warnings.join(" ")}`);
    }
  };

  const runImport = async (run: () => Promise<ImportThemeResult>) => {
    setImporting(true);
    try {
      const { theme, warnings } = await run();
      await applyImported(theme, warnings);
      setPath("");
    } catch (err) {
      toastError(err instanceof ApiError ? apiErrorText(err) : S.settings.themeImportFailed);
    } finally {
      setImporting(false);
    }
  };

  const handleImportPath = async (source = path.trim()) => {
    if (source === "") return;
    await runImport(() => importTheme(source));
  };

  /**
   * Open the dialog, then import in the same gesture. Cancelling is not an error and must not
   * clear a path the user typed — so the picker's `null` returns before anything is touched.
   */
  const handlePick = async () => {
    if (picker === undefined) return;
    const chosen = await picker();
    if (chosen === null) return;
    setPath(chosen);
    await handleImportPath(chosen);
  };

  /**
   * Upload a `.zip`. The input is cleared before the request rather than after, so a second
   * upload of the same file still fires a `change` event — browsers do not fire one when the
   * value is unchanged.
   */
  const handleArchive = async (file: File | undefined) => {
    if (file === undefined) return;
    const input = fileInput.current;
    if (input !== null) input.value = "";
    await runImport(() => importThemeArchive(file));
  };

  return (
    <section className="space-y-3 py-3.5">
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {S.settings.themePackagesTitle}
        </h3>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {S.settings.themePackagesInfo}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleImportPath();
          }}
          placeholder={S.settings.themeImportPlaceholder}
          aria-label={S.settings.themeImportPlaceholder}
          className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:hover:border-gray-600 dark:focus:border-gray-400 dark:focus:ring-gray-500/30"
        />
        {picker !== undefined && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={importing}
            onClick={() => void handlePick()}
          >
            {S.settings.themeImportPick}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={importing || path.trim() === ""}
          onClick={() => void handleImportPath()}
        >
          {importing ? S.settings.themeImporting : S.settings.themeImportAction}
        </Button>
        {/*
          The archive route is the only one that works in a plain browser and the only one that
          accepts a theme downloaded from elsewhere, so it gets its own control rather than
          being folded into the path field.
        */}
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip,application/octet-stream"
          className="hidden"
          onChange={(e) => void handleArchive(e.target.files?.[0])}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={importing}
          onClick={() => fileInput.current?.click()}
        >
          {S.settings.themeImportArchive}
        </Button>
      </div>
    </section>
  );
}
