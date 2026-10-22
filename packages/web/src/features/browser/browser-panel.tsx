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
 * - the address bar, the back/forward/reload controls and the tab strip;
 * - the slot the runtime portals the active guest into.
 *
 * What it does not own: the guests, and the state. The state comes from the server by
 * PUSH (`browser_state` on the user channel), so the strip does not lag behind the agent's
 * page by a poll interval.
 */
import { useState, useSyncExternalStore } from "react";
import type { BrowserStatus } from "@prismshadow/jiumate-core/interfaces";
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
import { BROWSER_VIEWPORT_ATTR } from "./browser-viewport";
import { webviewForTab } from "./browser-viewport";

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
 * Opens a page in a new guest, and tells the server about it.
 *
 * The server's `/api/browser/tabs` is what makes the tab real; the element is created by
 * the runtime, because only a page can. The order matters: the request is made first, so
 * the server records it as an open request, and the element then answers it with the claim.
 */
async function openTab(url: string): Promise<void> {
  try {
    await apiFetch<{ openRequests?: unknown[] }>("/api/browser/tabs", {
      method: "POST",
      body: { url, activate: true },
    });
  } catch {
    // The failure surfaces in the panel's own state: no request, no tab, nothing to show.
  }
}

export function BrowserPanel({ active }: { active: boolean }) {
  const { tabs, activeTabId, available } = useBrowserState();
  const [address, setAddress] = useState("");

  if (!webviewSupported()) {
    return <EmptyState title={S.browser.unavailable} description={S.browser.unavailableHint} />;
  }
  if (!available && tabs.length === 0) {
    return <EmptyState title={S.browser.unavailable} description={S.browser.unavailableHint} />;
  }

  const element = webviewForTab(activeTabId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The address bar and the page's controls. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1.5 dark:border-gray-700">
        <button
          type="button"
          aria-label={S.browser.back}
          disabled={!tabs.some((tab) => tab.canGoBack)}
          onClick={() => element?.goBack()}
          className="rounded px-1.5 text-xs text-gray-500 disabled:opacity-40 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ←
        </button>
        <button
          type="button"
          aria-label={S.browser.forward}
          disabled={!tabs.some((tab) => tab.canGoForward)}
          onClick={() => element?.goForward()}
          className="rounded px-1.5 text-xs text-gray-500 disabled:opacity-40 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          →
        </button>
        <input
          value={address}
          placeholder={S.browser.addressPlaceholder}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const url = address.trim();
            if (url === "") return;
            void openTab(url);
            setAddress("");
          }}
          className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
        />
        <button
          type="button"
          onClick={() => void openTab(address.trim())}
          disabled={address.trim() === ""}
          className="rounded px-2 py-1 text-xs text-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {S.browser.go}
        </button>
      </div>

      {/* The tab strip. */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-200 px-2 py-1 dark:border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              void apiFetch(`/api/browser/tabs/${tab.id}/activate`, { method: "POST", body: {} });
            }}
            className={
              tab.id === activeTabId
                ? "max-w-[12rem] truncate rounded-t border-b-2 border-blue-500 px-2 py-1 text-xs text-gray-800 dark:text-gray-100"
                : "max-w-[12rem] truncate rounded-t px-2 py-1 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
            }
          >
            {tab.title || S.browser.untitled}
          </button>
        ))}
        <button
          type="button"
          aria-label={S.browser.newTab}
          onClick={() => void openTab("about:blank")}
          className="rounded px-1.5 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
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
    </div>
  );
}
