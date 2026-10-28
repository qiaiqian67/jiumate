/**
 * The browser's layer: the pages the agent drives, and the ones the user opened.
 *
 * They live here, not in the dock panel, and that placement is the whole point:
 *
 * - **A `<webview>` reloads its page whenever it is moved in the DOM.** The dock's bodies
 *   move constantly — between the right and bottom docks, in and out of the narrow merged
 *   view, on every conversation switch. A guest inside a dock body would reload its page
 *   each time, and the page the agent was working in would be lost.
 * - **The browser is not the conversation's.** The agent opens a page for the user, who may
 *   be reading a different conversation, or a settings page, or nothing at all. A panel
 *   that only exists inside one conversation's dock would leave the agent's page with
 *   nowhere to appear.
 *
 * So the guests are created here, in one layer, in creation order, never re-parented. The
 * dock panel is a viewport: it says where the page on screen goes, and the layer is
 * placed over that spot by coordinates (browser-layer.ts).
 *
 * Every guest is mounted, all the time — a guest that waited to be on screen before it was
 * mounted would never learn its id, and would never be on screen. The ones that are not on
 * screen are parked far off-screen at a real size, so a page the agent works in while the
 * panel is closed keeps a desktop layout and keeps being composited, which is what lets
 * the agent take its screenshot.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  browserStateVersion,
  currentTabId,
  pendingOpenRequests,
  subscribeBrowserState,
} from "./browser-list";
import {
  claimGuest,
  createGuestForRequest,
  guestVersion,
  hostedGuests,
  subscribeGuests,
  watchGuestId,
  type Guest,
  type WebviewElement,
} from "./browser-guests";
import { DEFAULT_PARK_SIZE, placement, slotRect, type Rect } from "./browser-layer";
import { browserSlot } from "./browser-viewport";
import { revealBrowserPanel } from "./browser-reveal";
import { currentDockScope } from "../dock/dock-state";
import { apiFetch } from "../../api/client";

/** The layer the pages live in, created once and never re-parented. */
let layer: HTMLElement | null = null;

/** The layer, created on first use. */
function browserLayer(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (layer !== null && layer.isConnected) return layer;
  layer = document.createElement("div");
  layer.setAttribute("data-browser-layer", "true");
  layer.style.position = "fixed";
  layer.style.left = "0px";
  layer.style.top = "0px";
  layer.style.width = "0px";
  layer.style.height = "0px";
  // Above the app, so a page covers the dock slot it is shown in; and `pointer-events: none`
  // on the layer, so a parked page never eats a click meant for the app.
  layer.style.zIndex = "30";
  layer.style.pointerEvents = "none";
  document.body.appendChild(layer);
  return layer;
}

/** One guest's frame and view: the frame clips, the view is the slot's full size. */
function GuestFrame({
  guest,
  frame,
  view,
  shown,
}: {
  guest: Guest;
  frame: Rect;
  view: Rect;
  /** Whether this page is the one the user is looking at. */
  shown: boolean;
}) {
  const ref = useRef<WebviewElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    // The element's id arrives late: Electron usually reports the guest's first events
    // before the app's request to create the guest answers, and asked then, the element
    // throws. `watchGuestId` asks again on every later event and polls in between.
    const stop = watchGuestId(element, (tabId) => {
      // The shell finds this element by its guest id when it closes or focuses the tab, so
      // the attribute is set here — the only moment the id is known.
      element.setAttribute("data-guest-id", String(tabId));
      void claimGuest(guest, tabId);
    });
    return stop;
  }, [guest]);

  return (
    <div
      style={{
        position: "fixed",
        left: `${frame.left}px`,
        top: `${frame.top}px`,
        width: `${frame.width}px`,
        height: `${frame.height}px`,
        overflow: "hidden",
        // A parked page sits BEHIND the app: the user must not see it, but it has to stay
        // in the viewport so the browser keeps compositing it — a guest outside the viewport
        // is never composited, and the agent's screenshot of it would hang.
        zIndex: shown ? 30 : -1,
        pointerEvents: shown ? "auto" : "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: `${view.left}px`,
          top: `${view.top}px`,
          width: `${view.width}px`,
          height: `${view.height}px`,
        }}
      >
        <webview
          ref={ref as React.RefObject<never>}
          src={guest.src}
          partition="persist:jiumate-browser"
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}

/** The guests this window hosts, as a snapshot. */
function useGuests(): Guest[] {
  useSyncExternalStore(subscribeGuests, guestVersion, () => 0);
  return hostedGuests();
}

/** The state the layer draws, as a snapshot. */
function useBrowserState(): {
  activeTabId: number | null;
  requests: ReturnType<typeof pendingOpenRequests>;
} {
  useSyncExternalStore(subscribeBrowserState, browserStateVersion, () => 0);
  return { activeTabId: currentTabId(), requests: pendingOpenRequests() };
}

/**
 * The slot the panel leaves for the page, followed as it moves.
 *
 * The dock slides open, resizes and moves; nothing announces that, so the slot is measured
 * on a frame loop. It is the layer's whole position, and a stale one would show the page
 * over the wrong part of the app.
 */
function useSlot(): Rect | null {
  const [slot, setSlot] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const measure = (): void => {
      frame = requestAnimationFrame(measure);
      const next = slotRect(browserSlot());
      setSlot((current) => {
        if (current === null && next === null) return current;
        if (
          current !== null &&
          next !== null &&
          current.left === next.left &&
          current.top === next.top &&
          current.width === next.width &&
          current.height === next.height
        ) {
          return current;
        }
        return next;
      });
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, []);
  return slot;
}

/**
 * The app-wide browser layer. Mounted once, by AppLayout — beside the terminal views'
 * runtime, which solves the same problem for the same reason.
 */
export function BrowserRuntime() {
  const { requests, activeTabId } = useBrowserState();
  const guests = useGuests();
  const slot = useSlot();
  const target = browserLayer();

  // The open requests become guests. A request is answered once: a second window may
  // answer it too, and the server tells that one it made a duplicate.
  useEffect(() => {
    for (const request of requests) {
      if (guests.some((guest) => guest.requestId === request.requestId)) continue;
      createGuestForRequest({
        requestId: request.requestId,
        url: request.url,
        activate: request.activate,
      });
    }
  }, [requests, guests]);

  // A page the agent opened is the user-visible half of what it did, so the browser's tab
  // comes up — once per conversation, so hiding it again is respected.
  useEffect(() => {
    if (requests.length === 0) return;
    revealBrowserPanel(currentDockScope());
  }, [requests]);

  // Which page the user is looking at. The server keeps it, so a page that is not in front
  // is not mistaken for a closed one, and so the strip in every window shows the same.
  const onScreenTabId = guests.find((guest) => guest.tabId === activeTabId)?.tabId ?? null;
  useEffect(() => {
    void apiFetch<void>("/api/browser/tabs/on-screen", {
      method: "POST",
      body: { tabId: onScreenTabId },
    }).catch(() => undefined);
  }, [onScreenTabId]);

  if (target === null) return null;

  return (
    <>
      {createPortal(
        guests.map((guest) => {
          const onScreen = guest.tabId !== null && guest.tabId === activeTabId;
          // "On screen" is not enough: this window must also be SHOWING the page, i.e. the dock's
          // browser panel must have left a slot for it. When the panel is closed (or the tab lives
          // in another conversation's dock), `slot` is null while the tab is still the active one —
          // and drawing the guest then put the parked rectangle (0,0 at a full 1280×800 desktop
          // size, see browser-geometry) at z-index 30, pasting the page over the whole window
          // instead of the dock. `slot !== null` is exactly "there is a place to put it"; without
          // it the guest is parked BEHIND the app, which is where a page with no visible slot
          // belongs (still mounted and composited, so the agent's screenshot keeps working).
          const visible = onScreen && slot !== null;
          const { frame, view } = placement(visible ? slot : null, visible, DEFAULT_PARK_SIZE);
          return (
            <GuestFrame key={guest.key} guest={guest} frame={frame} view={view} shown={visible} />
          );
        }),
        target,
      )}
    </>
  );
}
