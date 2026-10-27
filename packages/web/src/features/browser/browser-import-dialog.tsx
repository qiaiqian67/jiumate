/**
 * The import dialog: bring a system browser's sign-ins over, so the agent can open the
 * pages the user is signed in to.
 *
 * The interface is the user's, and so is the decision. An import reads a browser's private
 * state, so the user picks the profile, what it brings, and which sites' cookies come
 * along. The agent never makes any of those choices — it cannot, and should not.
 *
 * What the user gets for it is the difference between a browser that can only read public
 * pages and one that can do the work: the sign-in is what opens the back office, the order
 * page, the ticket system.
 */
import { useEffect, useState } from "react";
import type { BrowserImportResult, BrowserImportSource } from "@jadelau/core/interfaces";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { S } from "../../lib/strings";
import { apiFetch } from "../../api/client";

/** A source as the dialog groups it: one browser, its profiles under it. */
interface SourceGroup {
  browserName: string;
  sources: BrowserImportSource[];
}

/** The sources grouped under their browser, in the order the server listed them. */
function groupSources(sources: readonly BrowserImportSource[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const source of sources) {
    const group = groups.find((g) => g.browserName === source.browserName);
    if (group !== undefined) group.sources.push(source);
    else groups.push({ browserName: source.browserName, sources: [source] });
  }
  return groups;
}

/**
 * The "only these sites" field as the request's list, or undefined for every site.
 *
 * A pasted address keeps only its host, and a leading `www.` goes: a site's sign-in
 * cookies usually sit on the bare domain, so a filter of `www.amazon.com` would leave out
 * the `.amazon.com` cookies the user is after.
 */
function parseDomainFilter(text: string): string[] | undefined {
  const domains: string[] = [];
  for (const raw of text.split(/[\s,;，；]+/)) {
    const host = raw
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
      .replace(/[/?#].*$/, "")
      .replace(/:\d+$/, "")
      .replace(/^\*?\./, "")
      .replace(/^www\./, "")
      .replace(/\.$/, "");
    if (host !== "" && !domains.includes(host)) domains.push(host);
  }
  return domains.length > 0 ? domains : undefined;
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sources, setSources] = useState<BrowserImportSource[] | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [cookies, setCookies] = useState(true);
  const [history, setHistory] = useState(false);
  const [domains, setDomains] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BrowserImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Every opening starts over and re-reads the list: a browser installed or signed into
  // since the last look should show up.
  useEffect(() => {
    if (!open) return;
    setSources(null);
    setSourceId(null);
    setCookies(true);
    setHistory(false);
    setDomains("");
    setResult(null);
    setError(null);
    void apiFetch<{ sources: BrowserImportSource[] }>("/api/browser/import/sources")
      .then((data) => {
        setSources(data.sources);
        const first = data.sources.find((s) => s.hasCookies);
        setSourceId(first?.id ?? data.sources[0]?.id ?? null);
      })
      .catch(() => setError(S.browser.importFailed));
  }, [open]);

  const chosen = sources?.find((s) => s.id === sourceId) ?? null;
  const groups = sources === null ? [] : groupSources(sources);
  const nothingToDo = !cookies && !history;

  const run = async (): Promise<void> => {
    if (sourceId === null || nothingToDo) return;
    setRunning(true);
    setError(null);
    try {
      const parsed = parseDomainFilter(domains);
      const outcome = await apiFetch<BrowserImportResult>("/api/browser/import", {
        method: "POST",
        body: {
          sourceId,
          cookies,
          history,
          ...(parsed !== undefined ? { domains: parsed } : {}),
        },
      });
      setResult(outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : S.browser.importFailed);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal open={open} title={S.browser.importTitle} onClose={onClose} widthClass="sm:max-w-lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.browser.importHint}</p>

        {error !== null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {result !== null ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-gray-800 dark:text-gray-100">
              {S.browser.importDone
                .replace("{cookies}", String(result.cookies))
                .replace("{history}", String(result.history))}
            </p>
            {result.skipped > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {S.browser.importSkipped.replace("{count}", String(result.skipped))}
              </p>
            )}
            {result.warnings.map((warning) => (
              <p key={warning} className="text-xs text-amber-600 dark:text-amber-400">
                {warning}
              </p>
            ))}
          </div>
        ) : (
          <>
            {sources === null ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">…</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{S.browser.importNone}</p>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {S.browser.importTitle}
                </span>
                {groups.map((group) => (
                  <div key={group.browserName} className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                      {group.browserName}
                    </span>
                    {group.sources.map((source) => (
                      <label
                        key={source.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <input
                          type="radio"
                          name="browser-import-source"
                          checked={sourceId === source.id}
                          onChange={() => setSourceId(source.id)}
                          className="accent-blue-500"
                        />
                        <span className="text-gray-800 dark:text-gray-100">
                          {source.profileName}
                        </span>
                        {source.hasCookies && <span className="text-xs text-gray-400">Cookie</span>}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {chosen !== null && (
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                  <input
                    type="checkbox"
                    checked={cookies}
                    onChange={(e) => setCookies(e.target.checked)}
                    disabled={!chosen.hasCookies}
                    className="accent-blue-500"
                  />
                  {S.browser.importCookies}
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                  <input
                    type="checkbox"
                    checked={history}
                    onChange={(e) => setHistory(e.target.checked)}
                    disabled={!chosen.hasHistory}
                    className="accent-blue-500"
                  />
                  {S.browser.importHistory}
                </label>
                {cookies && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {S.browser.importDomains}
                    </span>
                    <Input
                      value={domains}
                      placeholder={S.browser.importDomainsPlaceholder}
                      onChange={(e) => setDomains(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <Button size="sm" onClick={onClose} disabled={running}>
            {result !== null ? S.common.close : S.common.cancel}
          </Button>
          {result === null && (
            <Button
              size="sm"
              onClick={() => void run()}
              disabled={running || sourceId === null || nothingToDo}
            >
              {S.browser.import}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
