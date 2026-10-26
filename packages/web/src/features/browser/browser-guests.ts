/**
 * The `<webview>` elements this window hosts, and the open requests they answer.
 *
 * Only a page can create a `<webview>` — it is an element — so this window, not the desktop
 * shell, is what makes a guest. The shell hosts it (its preferences are hardened there) and
 * runs its CDP; the page creates it and claims the open request with the guest's id.
 *
 * Two things this has to get right, and both were bugs in the design before this file:
 *
 * - **The id arrives late.** Electron usually reports the guest's first events
 *   (`did-attach`, `did-start-loading`) *before* the app's request to create the guest
 *   answers, and asked then, the element throws. So the id is asked for again on every
 *   later event, and while none has arrived the element is polled every few milliseconds.
 *   Without that, a new tab stayed off screen behind the previous one for seconds.
 *
 * - **A duplicate claim must undo its element.** Two windows may both answer the same open
 *   request; the first wins and the second is told it made a duplicate. The element it
 *   created is then removed, because a tab the server does not know about is a page the
 *   user cannot get back to.
 */
import type { BrowserTab } from "@jiumate/core/interfaces";
import { currentTabId, liveTabs, noteBrowserState } from "./browser-list";
import { apiFetch } from "../../api/client";

/** The part of Electron's `<webview>` element this window uses. */
export interface WebviewElement extends HTMLElement {
  getWebContentsId(): number;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  loadURL(url: string): Promise<void>;
}

/** How often an element that has attached but has no id yet is asked again (ms). */
const ID_RETRY_MS = 16;
/** How many times it is asked again at most: two seconds' worth. */
const ID_RETRIES = 125;
/** The element's events that may be the first to find the id. */
const ID_EVENTS = ["did-attach", "did-start-loading", "load-commit", "dom-ready"] as const;

/** One guest this window hosts. */
export interface Guest {
  /** Stable for the element's whole life: it is the React key, and a remount reloads the page. */
  key: string;
  /** The open request this guest answers. */
  requestId: string;
  /** The address the element was created with. It never changes, even as the page navigates. */
  src: string;
  /** The guest's webContents id, known once it attaches. */
  tabId: number | null;
  /** Whether it comes to the front once claimed. */
  activate: boolean;
  /** The element, once React has rendered it. */
  element: WebviewElement | null;
}

const guests = new Map<string, Guest>();
/** The guest showing a tab, by tab id. */
const byTabId = new Map<number, string>();
/** The request this window has already answered, so it does not answer it twice. */
const answered = new Set<string>();
let nextKey = 1;

const listeners = new Set<() => void>();
/** A counter that changes whenever the guest list did; the panel's snapshot. */
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** A counter that changes whenever the guest list did. */
export function guestVersion(): number {
  return version;
}

/** The guests this window hosts, in creation order. */
export function hostedGuests(): Guest[] {
  return [...guests.values()];
}

/** The guest showing a tab, or undefined. */
export function guestForTab(tabId: number | null): Guest | undefined {
  if (tabId === null) return undefined;
  const key = byTabId.get(tabId);
  return key === undefined ? undefined : guests.get(key);
}

/** Subscribes to the guest list changing. */
export function subscribeGuests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Asks the element for its id until it answers, and calls `onId` once.
 *
 * The element throws when it has attached but has not been told its id yet, so the ask is
 * repeated: on every later event, and on a short timer while none has arrived. The timer is
 * what keeps a slow page from sitting off screen — its `dom-ready` may be seconds away.
 */
export function watchGuestId(element: WebviewElement, onId: (tabId: number) => void): () => void {
  let done = false;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function stop(): void {
    done = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    for (const name of ID_EVENTS) element.removeEventListener(name, ask);
  }

  function ask(): void {
    if (done) return;
    let tabId: number;
    try {
      tabId = element.getWebContentsId();
    } catch {
      // Attached, but the element has not been told its id yet.
      if (timer === null && retries < ID_RETRIES) {
        retries += 1;
        timer = setTimeout(() => {
          timer = null;
          ask();
        }, ID_RETRY_MS);
      }
      return;
    }
    stop();
    onId(tabId);
  }

  for (const name of ID_EVENTS) element.addEventListener(name, ask);
  return stop;
}

/**
 * Creates a guest for an open request and claims it with the guest's id.
 *
 * The claim is what makes the tab real: the server learns the tab id, the request leaves the
 * pending list, and the tab becomes the active one. A claim that is refused — a duplicate
 * request, another window won it — removes the element again, so this window never shows a
 * page the server does not know about.
 */
export function createGuestForRequest(request: {
  requestId: string;
  url: string;
  activate: boolean;
}): Guest {
  const key = `guest-${nextKey++}`;
  const guest: Guest = {
    key,
    requestId: request.requestId,
    src: request.url,
    tabId: null,
    activate: request.activate,
    element: null,
  };
  guests.set(key, guest);
  answered.add(request.requestId);
  notify();
  return guest;
}

/**
 * Claims the request with the guest's id, once the element has told us what it is.
 *
 * The element is removed when the claim is refused. A refused claim is not an error the
 * user needs to hear about — another window showed the page first — but the element must not
 * stay: it would be a page the server does not know, and the user could neither close it
 * nor get back to it.
 */
export async function claimGuest(guest: Guest, tabId: number): Promise<boolean> {
  guest.tabId = tabId;
  try {
    await apiFetch<void>("/api/browser/tabs/claim", {
      method: "POST",
      body: { requestId: guest.requestId, tabId },
    });
  } catch {
    removeGuest(guest.key);
    return false;
  }
  byTabId.set(tabId, guest.key);
  notify();
  return true;
}

/** Removes a guest, and tells the server to close the tab it showed. */
export function removeGuest(key: string, closeTab = true): void {
  const guest = guests.get(key);
  if (guest === undefined) return;
  guests.delete(key);
  answered.delete(guest.requestId);
  if (guest.tabId !== null) {
    byTabId.delete(guest.tabId);
    if (closeTab) {
      void apiFetch<void>(`/api/browser/tabs/${guest.tabId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  }
  notify();
}

/**
 * The guest for a request this window has not answered yet, or undefined when it has
 * answered it already. The window that answers a request is the one that shows the page,
 * so a second window must not answer it too.
 */
export function unansweredGuest(requestId: string): Guest | undefined {
  if (answered.has(requestId)) return undefined;
  return [...guests.values()].find((guest) => guest.requestId === requestId);
}
