/**
 * The agent browser's dock panel: the pages the agent drives, and the ones the user opened.
 *
 * The panel is the only thing that can create a `<webview>` — it is an element, so only a
 * page makes one — and it is also what claims the open requests the server is waiting on.
 * So the panel does two jobs, and they are the same job: it turns "a page was asked for"
 * into "a guest exists", and it draws the guests it has.
 *
 * The state comes from the server by PUSH (`browser_state` on the user channel), so the strip
 * does not lag behind the agent's page. The panel reads it from browser-list.ts, and the
 * open requests it finds there become guests here.
 *
 * The guests are mounted for as long as they exist and never re-mounted: a `<webview>` that
 * is moved in the DOM reloads its page, so the elements are only ever appended or removed.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import {
  claimGuest,
  createGuestForRequest,
  guestForTab,
  guestVersion,
  hostedGuests,
  removeGuest,
  subscribeGuests,
  watchGuestId,
  type Guest,
  type WebviewElement,
} from "./browser-guests";

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
  // The version is the snapshot: it changes exactly when the state did, and it is a number,
  // so the panel re-reads the values from the store on every change and on no other.
  useSyncExternalStore(subscribeBrowserState, browserStateVersion, () => 0);
  return {
    tabs: liveTabs(),
    activeTabId: currentTabId(),
    requests: pendingOpenRequests(),
    available: browserAvailable(),
  };
}

/** The guests the panel shows, as a snapshot. */
function useGuests(): Guest[] {
  useSyncExternalStore(subscribeGuests, guestVersion, () => 0);
  return hostedGuests();
}

/**
 * Opens a page in a new guest, and tells the server about it.
 *
 * The server's `/api/browser/tabs` is what makes the tab real; the element is created here
 * because only a page can. The order matters: the request is made first, so the server
 * records it as an open request, and the element then answers it with the claim.
 */
async function openTab(url: string): Promise<void> {
  const guest = createGuestForRequest({ requestId: `local-${Date.now()}`, url, activate: true });
  try {
    await apiFetch<{ openRequests?: { requestId: string }[] }>("/api/browser/tabs", {
      method: "POST",
      body: { url, activate: true },
    });
  } catch {
    removeGuest(guest.key, false);
  }
}

/** One guest's `<webview>`, wired to claim its request once it knows its id. */
function GuestView({ guest, active }: { guest: Guest; active: boolean }) {
  const ref = useRef<WebviewElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const stop = watchGuestId(element, (tabId) => {
      void claimGuest(guest, tabId);
    });
    return stop;
  }, [guest]);

  return (
    <div className={active ? "absolute inset-0" : "hidden"}>
      {/* The element itself is created by React as a custom element; Electron fills it in. */}
      <webview
        ref={ref as React.RefObject<never>}
        src={guest.src}
        partition="persist:jiumate-browser"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...({} as any)}
      />
    </div>
  );
}

export function BrowserPanel({ active }: { active: boolean }) {
  const { tabs, activeTabId, requests, available } = useBrowserState();
  const guests = useGuests();
  const [address, setAddress] = useState("");

  // The open requests become guests. Each request is answered once: a second window may
  // answer it too, and the server tells that one it made a duplicate.
  useEffect(() => {
    if (!active) return;
    for (const request of requests) {
      if (guestForRequest(guests, request.requestId) !== undefined) continue;
      createGuestForRequest({
        requestId: request.requestId,
        url: request.url,
        activate: request.activate,
      });
    }
  }, [active, requests, guests]);

  if (!webviewSupported()) {
    return <EmptyState title={S.browser.unavailable} description={S.browser.unavailableHint} />;
  }
  if (!available && tabs.length === 0) {
    return <EmptyState title={S.browser.unavailable} description={S.browser.unavailableHint} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The address bar and the page's controls. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1.5 dark:border-gray-700">
        <button
          type="button"
          aria-label={S.browser.back}
          disabled={!tabs.some((tab) => tab.canGoBack)}
          onClick={() => {
            const guest = guestForTab(activeTabId);
            guest?.element?.goBack();
          }}
          className="rounded px-1.5 text-xs text-gray-500 disabled:opacity-40 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ←
        </button>
        <button
          type="button"
          aria-label={S.browser.forward}
          disabled={!tabs.some((tab) => tab.canGoForward)}
          onClick={() => {
            const guest = guestForTab(activeTabId);
            guest?.element?.goForward();
          }}
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

      {/* The pages. Only the active one is shown; the others stay mounted so a page the
          agent left does not reload when the user comes back to it. */}
      <div className="relative min-h-0 flex-1">
        {guests.length === 0 ? (
          <EmptyState title={S.browser.empty} description={S.browser.emptyHint} />
        ) : (
          guests.map((guest) => (
            <GuestView key={guest.key} guest={guest} active={guest.tabId === activeTabId} />
          ))
        )}
      </div>
    </div>
  );
}

/** The guest answering a request, or undefined when this window has not answered it. */
function guestForRequest(guests: Guest[], requestId: string): Guest | undefined {
  return guests.find((guest) => guest.requestId === requestId);
}
