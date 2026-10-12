/**
 * The 添加插件 dialog: three ways to bring in a plugin that is not in the shipped library.
 *
 * **Why three tabs and not one form with a dropdown.** The three sources have nothing in common
 * except that each ends with files on disk. A URL is typed; a zip is picked and read in the
 * browser before it is sent; a local plugin is *found* — the user does not know it exists until the
 * scan shows them. A single form would have to render an upload box that is meaningless for one tab
 * and a result list that is meaningless for the others, and each user would see two controls that
 * do not apply to what they chose.
 *
 * **Each tab says what it will actually do, because "导入" alone is a promise the user cannot
 * check.** The URL tab names the address it will request; the local tab names the directory it will
 * copy *from* — and, more usefully, where the copy lands. A user importing a plugin is making a
 * decision about their machine, and the honest version of that dialog says which directories are
 * involved on both sides.
 *
 * **Adding is not installing.** These tabs add a plugin to the library; installing it into an Agent
 * is the separate, pre-existing action on the library card. Saying so on success keeps the two from
 * blurring — a user who adds a plugin and then finds it in no Agent has not been misled, because the
 * dialog said it adds rather than installs.
 *
 * **A file picker cannot read this machine.** `<input type="file">` gives the browser a File and
 * nothing about where it came from, so the local tab is a text path with the scanned candidates
 * beside it. The path is validated and resolved server-side, because only the server can say
 * whether it exists — a browser cannot, and pretending otherwise would make the check untestable.
 */
import { useCallback, useEffect, useState } from "react";
import {
  discoverLocalPlugins,
  importPluginFromArchive,
  importPluginFromLocal,
  importPluginsFromDirectory,
  importPluginFromUrl,
} from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { Tabs } from "../../components/ui/tabs";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";

type Source = "url" | "archive" | "local";

/** Ceiling on the uploaded archive, matching the server's own limit. */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

export function AddPluginDialog({
  projectId,
  onClose,
  onImported,
}: {
  projectId: string;
  onClose: () => void;
  /** Called with the imported plugin's name, so the page can refresh the library. */
  onImported: (name: string) => void;
}) {
  const [source, setSource] = useState<Source>("url");

  return (
    <Modal open title={S.plugins.addPlugin} onClose={onClose} widthClass="sm:max-w-2xl">
      <Tabs
        variant="pill"
        active={source}
        onChange={setSource}
        items={[
          { key: "url", label: S.plugins.addFromUrl },
          { key: "archive", label: S.plugins.addFromArchive },
          { key: "local", label: S.plugins.addFromLocal },
        ]}
      />
      <div className="mt-4">
        {source === "url" && <UrlSource projectId={projectId} onDone={onImported} />}
        {source === "archive" && <ArchiveSource projectId={projectId} onDone={onImported} />}
        {source === "local" && <LocalSource projectId={projectId} onDone={onImported} />}
      </div>
    </Modal>
  );
}

/** Shared end-of-import handling: report, hand the name up, and close. */
function useImporter(onDone: (name: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (action: () => Promise<{ name: string }>, successMessage: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        toastInfo(successMessage);
        onDone(result.name);
        return true;
      } catch (e) {
        // Shown inline rather than only as a toast: the failure is about what the user typed or
        // picked, and a toast that disappears leaves them looking at the same form again.
        setError(apiErrorText(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onDone],
  );
  return { busy, error, setError, run };
}

/** The failure line every source shows, in one place so the three tabs read identically. */
function ImportError({ error }: { error: string | null }) {
  if (error === null) return null;
  return (
    <p className="mt-2.5 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
      {error}
    </p>
  );
}

/**
 * ① From a URL.
 *
 * The address is validated as an http(s) URL in the browser too, not only server-side. That is not
 * security — it is so the button can be disabled on a `ftp://` paste before a request is made,
 * rather than the user waiting to learn it will be refused.
 */
function UrlSource({ projectId, onDone }: { projectId: string; onDone: (name: string) => void }) {
  const [url, setUrl] = useState("");
  const { busy, error, setError, run } = useImporter(onDone);

  const parsed = useCallback((): URL | null => {
    try {
      const parsedUrl = new URL(url.trim());
      return parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:" ? parsedUrl : null;
    } catch {
      return null;
    }
  }, [url]);

  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{S.plugins.addFromUrlHint}</p>
      <label className="mt-2.5 block text-xs font-medium text-gray-700 dark:text-gray-200">
        {S.plugins.addFromUrlLabel}
      </label>
      <Input
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setError(null);
        }}
        placeholder="https://github.com/owner/repo/archive/refs/heads/main.zip"
        className="mt-1"
      />
      {url.trim() !== "" && parsed() === null && (
        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
          {S.plugins.addFromUrlBadScheme}
        </p>
      )}
      <div className="mt-3.5 flex justify-end gap-2">
        <Button
          variant="primary"
          disabled={busy || url.trim() === "" || parsed() === null}
          onClick={() =>
            void run(() => importPluginFromUrl(projectId, url.trim()), S.plugins.pluginImported)
          }
        >
          {busy ? S.common.loading : S.plugins.addFromUrlAction}
        </Button>
      </div>
      <ImportError error={error} />
    </div>
  );
}

/**
 * ② From a zip, read in the browser before it is sent.
 *
 * **The size is checked before reading, not after.** `file.size` is known without touching the
 * bytes, so an oversized file is refused in a millisecond instead of after base64 has doubled its
 * size in memory — which on a 64MB file is the difference between a shrug and a tab that dies.
 */
function ArchiveSource({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: (name: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const { busy, error, setError, run } = useImporter(onDone);

  const pick = useCallback(
    (chosen: File | null) => {
      setError(null);
      if (chosen === null) {
        setFile(null);
        return;
      }
      if (chosen.size > MAX_ARCHIVE_BYTES) {
        setFile(null);
        setError(S.plugins.addFromArchiveTooLarge);
        return;
      }
      setFile(chosen);
    },
    [setError],
  );

  const submit = useCallback(async () => {
    if (file === null) return;
    const ok = await run(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      // Chunked so a large plugin does not build one enormous string argument and blow the call
      // stack; `String.fromCharCode` takes at most a few thousand arguments at a time.
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      return importPluginFromArchive(projectId, btoa(binary));
    }, S.plugins.pluginImported);
    if (ok) setFile(null);
  }, [file, projectId, run]);

  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{S.plugins.addFromArchiveHint}</p>
      <label className="mt-2.5 flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-4 py-7 text-center transition-colors hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-800/50">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {file === null ? S.plugins.addFromArchivePick : file.name}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {file === null
            ? S.plugins.addFromArchiveHint2
            : `${(file.size / 1024 / 1024).toFixed(1)} MB · ${S.plugins.addFromArchiveChange}`}
        </span>
        <input
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
      </label>
      <div className="mt-3.5 flex justify-end gap-2">
        <Button variant="primary" disabled={busy || file === null} onClick={() => void submit()}>
          {busy ? S.common.loading : S.plugins.addFromArchiveAction}
        </Button>
      </div>
      <ImportError error={error} />
    </div>
  );
}

/** One scanned plugin, as a row the user can apply or dismiss. */
function DiscoveredRow({
  plugin,
  busy,
  onApply,
}: {
  plugin: {
    name: string;
    path: string;
    origin: "known" | "manual";
    version: string;
    description: string;
    skills: { name: string }[];
    alreadyInstalled: boolean;
  };
  busy: boolean;
  onApply: () => void;
}) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-gray-200 px-3 py-2.5 dark:border-gray-700">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {plugin.name}
          </span>
          <span className="shrink-0 text-xs text-gray-400">{plugin.version}</span>
          {plugin.alreadyInstalled && (
            <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {S.plugins.pluginAlreadyAdded}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
          {plugin.description === "" ? plugin.path : plugin.description}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-gray-400 dark:text-gray-500">
          {plugin.path}
          {plugin.skills.length > 0 && ` · ${S.plugins.pluginSkills(plugin.skills.length)}`}
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        title={plugin.path}
        onClick={onApply}
        className="shrink-0"
      >
        {plugin.alreadyInstalled ? S.plugins.pluginReimport : S.plugins.pluginApply}
      </Button>
    </li>
  );
}

/**
 * ③ From a plugin already on this machine.
 *
 * **The scan runs on mount, and the probed directories come back with it.** A user who finds nothing
 * needs to know *where it looked* — otherwise an empty list is indistinguishable from a broken
 * feature, and they cannot tell whether to look harder or give up. So the tab lists every directory
 * checked, marking which existed.
 *
 * **A path the user types wins over the scan.** Their own pick is placed first and deduplicated by
 * resolved path, so pasting a directory the scan also found shows it once rather than twice.
 */
function LocalSource({ projectId, onDone }: { projectId: string; onDone: (name: string) => void }) {
  const [manualPath, setManualPath] = useState("");
  const [scan, setScan] = useState<{
    plugins: {
      name: string;
      path: string;
      origin: "known" | "manual";
      version: string;
      description: string;
      skills: { name: string }[];
      alreadyInstalled: boolean;
    }[];
    probes: { path: string; label: string; exists: boolean }[];
  } | null>(null);
  const [scanning, setScanning] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  /** In-flight 添加整个目录, so a double click cannot import the same folder twice. */
  const [addingDir, setAddingDir] = useState(false);
  const { error, setError, run } = useImporter(onDone);

  const scanFor = useCallback(
    async (path?: string) => {
      setScanning(true);
      setError(null);
      try {
        setScan(await discoverLocalPlugins(projectId, path));
      } catch (e) {
        setError(apiErrorText(e));
        setScan(null);
      } finally {
        setScanning(false);
      }
    },
    [projectId, setError],
  );

  useEffect(() => {
    void scanFor();
  }, [scanFor]);

  const apply = useCallback(
    async (pluginPath: string) => {
      setApplying(pluginPath);
      await run(() => importPluginFromLocal(projectId, pluginPath), S.plugins.pluginImported);
      setApplying(null);
      // Re-scan rather than patching the row: applying adds the plugin to the library, which is
      // exactly what makes it "already added" — and a row that still offered itself as new would
      // invite the user to import the same plugin twice.
      await scanFor(manualPath.trim() === "" ? undefined : manualPath.trim());
    },
    [projectId, run, scanFor, manualPath],
  );

  /**
   * Adds every plugin in the typed directory at once — 添加整个目录.
   *
   * **Reports per-plugin outcomes rather than one verdict.** A collection of ten with one bad
   * manifest imports nine; saying 「已添加 9 个，1 个失败」 is the truth, and a bare 「失败」 would make a
   * working import look broken. The names go in the toast because the user cannot see which nine —
   * they only pressed one button.
   *
   * **Everything added lands 待启用: on this machine, enabled for no Agent.** 启用 is a separate
   * press on purpose, so that adding a folder is a filesystem action and not a change to what the
   * Agents can currently do — those are very different things to do by accident.
   */
  const addWholeDirectory = useCallback(
    async (dir: string) => {
      setAddingDir(true);
      try {
        const res = await importPluginsFromDirectory(projectId, dir);
        if (res.added.length > 0) {
          toastSuccess(
            S.plugins.addedWholeDir(res.added.length, res.added.map((p) => p.name).join("、")),
          );
        }
        if (res.failed.length > 0) {
          toastError(
            S.plugins.addWholeDirPartial(
              res.failed.map((f) => `${f.name}（${f.reason}）`).join("；"),
            ),
          );
        }
        // Re-scan so the rows below reflect what is now in the library; a row still offering 应用
        // for something just added would invite the same plugin being added twice.
        await scanFor(dir === "" ? undefined : dir);
      } catch (e) {
        toastError(apiErrorText(e));
      } finally {
        setAddingDir(false);
      }
    },
    [projectId, scanFor],
  );

  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{S.plugins.addFromLocalHint}</p>

      <div className="mt-2.5 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
            {S.plugins.addFromLocalLabel}
          </label>
          <Input
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && manualPath.trim() !== "") {
                void scanFor(manualPath.trim());
              }
            }}
            placeholder="C:\Users\me\.claude\plugins"
            className="mt-1"
          />
        </div>
        <Button
          variant="secondary"
          disabled={scanning || manualPath.trim() === ""}
          onClick={() => void scanFor(manualPath.trim())}
        >
          {S.plugins.addFromLocalScan}
        </Button>
      </div>

      {/*
        添加整个目录. Sits under the scan row rather than beside 应用, because it is a different
        action with a different shape of result: 应用 takes one plugin, this takes the directory and
        reports what it managed. Listed after the scan because a user who points at a folder has
        usually not yet seen what is in it, and the scan is what tells them whether this is the
        button they meant to press.
      */}
      <div className="mt-2.5 flex items-center justify-between gap-2 rounded-md border border-dashed border-gray-300 px-2.5 py-2 dark:border-gray-700">
        <p className="min-w-0 text-xs text-gray-500 dark:text-gray-400">
          {S.plugins.addWholeDirHint}
        </p>
        <Button
          variant="primary"
          className="shrink-0"
          disabled={addingDir || scanning || manualPath.trim() === ""}
          onClick={() => void addWholeDirectory(manualPath.trim())}
        >
          {S.plugins.addWholeDir}
        </Button>
      </div>

      {scanning ? (
        <p className="py-6 text-center text-xs text-gray-400">{S.common.loading}</p>
      ) : (
        <>
          {scan !== null && scan.plugins.length > 0 && (
            <ul className="mt-3.5 space-y-1.5">
              {scan.plugins.map((plugin) => (
                <DiscoveredRow
                  key={plugin.path}
                  plugin={plugin}
                  busy={applying === plugin.path}
                  onApply={() => void apply(plugin.path)}
                />
              ))}
            </ul>
          )}

          {scan !== null && scan.plugins.length === 0 && (
            <p className="mt-3.5 rounded-md bg-gray-50 px-3 py-2.5 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
              {S.plugins.addFromLocalNone}
            </p>
          )}

          {/* Always shown, found or not — the list above is only meaningful next to the places it
              came from, and an empty result with no provenance is the one output a user cannot act
              on. */}
          {scan !== null && scan.probes.length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                {S.plugins.addFromLocalProbed}
              </summary>
              <ul className="mt-1.5 space-y-0.5 pl-1">
                {scan.probes.map((probe) => (
                  <li
                    key={probe.path}
                    className="flex items-center gap-2 font-mono text-[11px] text-gray-500 dark:text-gray-500"
                  >
                    <span className={probe.exists ? "text-emerald-600 dark:text-emerald-400" : ""}>
                      {probe.exists ? "●" : "○"}
                    </span>
                    <span className="w-28 shrink-0 font-sans">{probe.label}</span>
                    <span className="truncate">{probe.path}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <ImportError error={error} />
    </div>
  );
}
