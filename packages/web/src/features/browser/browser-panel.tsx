/**
 * The agent browser's dock panel: the pages the agent drives, and the ones the user opened.
 *
 * The panel is a VIEWPORT, not the host. The guests — the `<webview>` elements — live in
 * the app-wide runtime (browser-runtime.tsx), because a `<webview>` reloads its page
 * whenever it is moved in the DOM, and the dock's bodies move all the time. So this panel
 * provides the slot the guest on screen is portaled into, plus the controls that drive it.
 *
 * What the panel owns:
 *
 * - the toolbar: back, forward, reload, and the address bar;
 * - the tab strip: one entry per page, with its favicon, its state, and its ×;
 * - the slot the runtime portals the active guest into.
 *
 * What it does not own: the guests, and the state. The state comes from the server by
 * PUSH (`browser_state` on the user channel), so the strip does not lag behind the agent's
 * page by a poll interval.
 *
 * The address bar's rules are the agent's rules: a bare host gets a scheme and words
 * become a search, in both places, so the two can never disagree (core/browser/address.ts).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { BrowserStatus, BrowserTab } from "@prismshadow/jiumate-core/interfaces";
import { displayAddress, resolveAddress, tabLabel } from "@prismshadow/jiumate-core/browser";
import { S } from "../../lib/strings";
import { EmptyState } from "../../components/ui/empty-state";
import { apiFetch } from "../../api/client";
import {
  browserAvailable,
  browserStateVersion,
  currentTabId,
  liveTabs,
  pendingOpenRequests,
  subscribeBrowserState,
} from "./browser-list";
import { BROWSER_VIEWPORT_ATTR, webviewForTab } from "./browser-viewport";
import { ImportDialog } from "./browser-import-dialog";
import { ClearDataDialog } from "./browser-clear-dialog";

/** Whether this window can host guests at all: Electron defines `<webview>` only in the
 *  desktop app's main window. Everywhere else the browser is not offered. */
export function webviewSupported(): boolean {
  return typeof customElements !== "undefined" && customElements.get("webview") !== undefined;
}

/** The state the panel draws, as a snapshot for useSyncExternalStore. */
function useBrowserState(): {
  tabs: ReturnType<typeof liveTabs>;
  activeTabId: number | null;
  requests: NonNullable<BrowserStatus["openRequests"]>;
  available: boolean;
} {
  useSyncExternalStore(subscribeBrowserState, browserStateVersion, () => 0);
  return {
    tabs: liveTabs(),
    activeTabId: currentTabId(),
    requests: pendingOpenRequests(),
    available: browserAvailable(),
  };
}

/**
 * Opens a page in a new tab, and tells the server about it.
 *
 * The server's `/api/browser/tabs` is what makes the tab real; the element is created by
 * the runtime, because only a page can. The order matters: the request is made first, so
 * the server records it as an open request, and the element then answers it with the claim.
 */
async function openTab(url: string): Promise<void> {
  try {
    await apiFetch<{ openRequests?: unknown[] }>("/api/browser/tabs", {
      method: "POST",
      body: { url: resolveAddress(url), activate: true },
    });
  } catch {
    // The failure surfaces in the panel's own state: no request, no tab, nothing to show.
  }
}

/** One page's favicon, or null when it has none. */
function faviconSrc(favicon: string | undefined): string | null {
  if (favicon === undefined || favicon === "") return null;
  if (favicon.startsWith("data:") || favicon.startsWith("http")) return favicon;
  return null;
}
/** One entry in the tab strip. */
function TabEntry({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: BrowserTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const favicon = faviconSrc(tab.favicon);
  const label = tabLabel(tab.title, tab.url);
  return (
    <div
      className={
        active
          ? "group flex max-w-[12rem] shrink-0 items-center gap-1.5 rounded-t border-b-2 border-blue-500 bg-white px-2 py-1 text-xs text-gray-900 dark:bg-gray-950 dark:text-gray-100"
          : "group flex max-w-[12rem] shrink-0 items-center gap-1.5 rounded-t px-2 py-1 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
      }
    >
      {tab.crashed !== undefined ? (
        <span aria-label={S.browser.crashed} className="shrink-0 text-red-500">
          !
        </span>
      ) : favicon === null ? (
        <span aria-hidden className="shrink-0 text-gray-400">
          ○
        </span>
      ) : (
        <img
          src={favicon}
          alt=""
          width={12}
          height={12}
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
          className="shrink-0 rounded-sm"
        />
      )}
      <button
        type="button"
        onClick={onSelect}
        title={tab.url}
        className="min-w-0 flex-1 truncate text-left"
      >
        {label === "" ? S.browser.untitled : label}
      </button>
      <button
        type="button"
        aria-label={S.browser.closeTab}
        onClick={onClose}
        className="shrink-0 rounded px-0.5 text-gray-400 opacity-0 hover:text-gray-700 focus:opacity-100 group-hover:opacity-100 dark:hover:text-gray-200"
      >
        ×
      </button>
    </div>
  );
}

export function BrowserPanel({ active }: { active: boolean }) {
  const { tabs, activeTabId, available } = useBrowserState();
  const [address, setAddress] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  // The address bar shows the page on screen, until the user types something else. A person
  // expects the bar to follow the page; a model never sees it.
  const current = tabs.find((tab) => tab.id === activeTabId);
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? (current === undefined ? "" : displayAddress(current.url));
  useEffect(() => {
    setTyped(null);
  }, [activeTabId]);

  if (!webviewSupported()) {
    return <EmptyState title={S.browser.unavailable} description={S.browser.unavailableHint} />;
  }
  if (!available && tabs.length === 0) {
    return <EmptyState title={S.browser.unavailable} description={S.browser.unavailableHint} />;
  }

  const element = webviewForTab(activeTabId);
  const act = (action: "back" | "forward" | "reload"): void => {
    if (activeTabId === null) return;
    void apiFetch(`/api/browser/tabs/${activeTabId}/${action}`, { method: "POST", body: {} });
  };
  void element;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The toolbar: back, forward, reload, and the address bar. */}
      <div className="relative flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1.5 dark:border-gray-700">
        <button
          type="button"
          aria-label={S.browser.back}
          title={S.browser.back}
          disabled={!tabs.some((tab) => tab.canGoBack)}
          onClick={() => act("back")}
          className="rounded px-1.5 text-xs text-gray-500 disabled:opacity-40 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ←
        </button>
        <button
          type="button"
          aria-label={S.browser.forward}
          title={S.browser.forward}
          disabled={!tabs.some((tab) => tab.canGoForward)}
          onClick={() => act("forward")}
          className="rounded px-1.5 text-xs text-gray-500 disabled:opacity-40 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          →
        </button>
        <button
          type="button"
          aria-label={S.browser.reload}
          title={S.browser.reload}
          onClick={() => act("reload")}
          className="rounded px-1.5 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ⟳
        </button>
        <input
          value={shown}
          placeholder={S.browser.addressPlaceholder}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const text = shown.trim();
            if (text === "") return;
            void openTab(text);
            setTyped(null);
          }}
          className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
        />
        <button
          type="button"
          onClick={() => {
            const text = shown.trim();
            if (text === "") return;
            void openTab(text);
            setTyped(null);
          }}
          disabled={shown.trim() === ""}
          className="rounded px-2 py-1 text-xs text-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {S.browser.go}
        </button>
        <button
          type="button"
          aria-label={S.browser.more}
          title={S.browser.more}
          onClick={() => setMenuOpen((open) => !open)}
          className="rounded px-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="absolute right-2 top-9 z-30 w-48 rounded border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setImportOpen(true);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {S.browser.import}
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setClearOpen(true);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {S.browser.clearData}
            </button>
          </div>
        )}
      </div>

      {/* The tab strip: one entry per page, and a + for a new one. */}
      <div className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-gray-200 px-1 py-1 dark:border-gray-700">
        {tabs.map((tab) => (
          <TabEntry
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onSelect={() => {
              void apiFetch(`/api/browser/tabs/${tab.id}/activate`, { method: "POST", body: {} });
            }}
            onClose={() => {
              void apiFetch(`/api/browser/tabs/${tab.id}`, { method: "DELETE" });
            }}
          />
        ))}
        <button
          type="button"
          aria-label={S.browser.newTab}
          title={S.browser.newTab}
          onClick={() => void openTab("about:blank")}
          className="shrink-0 self-center rounded px-1.5 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          +
        </button>
      </div>

      {/* The slot the guest on screen is portaled into. It is always mounted — the runtime
          finds it by its attribute, and a slot that appears only when a guest does would
          make the portal's target move. */}
      <div className="relative min-h-0 flex-1">
        {tabs.length === 0 ? (
          <EmptyState title={S.browser.empty} description={S.browser.emptyHint} />
        ) : (
          <div {...{ [BROWSER_VIEWPORT_ATTR]: "true" }} className="absolute inset-0" />
        )}
      </div>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <ClearDataDialog open={clearOpen} onClose={() => setClearOpen(false)} />
    </div>
  );
}
