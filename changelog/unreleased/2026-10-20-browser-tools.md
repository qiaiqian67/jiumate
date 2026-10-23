# Let an Agent read and act on a page in the browser

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `core`, `server`, `desktop`, `docs`

[中文版](2026-10-20-browser-tools.zh.md)

Two built-in tools, `browser_read` and `browser_act`, drive the agent browser: the desktop app's
built-in browser, or the user's own Chrome, whichever the user chose. `browser_read` reports the
backend and the open tabs, opens a URL, closes a tab, scans a page as simplified HTML or as plain
text, and returns a screenshot as image content in the same turn. `browser_act` clicks, types, and
runs JavaScript in the page's own origin.

## Reading and acting are separate tools

- `browser_read` is `r`. It changes nothing on the user's behalf, so it rides the approval flow
  as a read.
- `browser_act` is `rw`, so a click, a typed line, or a script goes through approval. A click can
  submit an order and a script can read `document.cookie`.
- One tool with one permission would make the frequent read carry the weight of the rare write.
  The split keeps a model that only wants to look at a page out of the approval flow entirely,
  while a click still asks.

## The screenshot comes back as the image itself

`browser_read`'s `screenshot` returns through `ToolResult.images`, so the model sees the page in
the turn that asked for it. A screenshot written to disk and read afterwards would cost a second
tool call and a round trip for the same picture.

## The backend is the user's choice, and every call says which one

Which browser an agent drives is a user setting, and neither tool picks one. Every call reports
the backend, because a model that assumed it was reading the built-in browser when it was reading
Chrome would draw the wrong conclusion from a page that looks the same either way. Tabs are shared
with the user, who can watch and take over.

## What a host provides

The tools own no state and touch no disk. They call the `BrowserPort` their host injected
(`EnvironmentServices.browser`), and a host with no browser surface reports that rather than
failing with an errno. What differs between backends is declared through
`BrowserBackendCapabilities` rather than discovered, so the tools branch on it the same way the
runtime does, and a second backend needs no change here.

## The exec guard

`exec` runs script in a page the user is signed into, so while a script runs the tab's requests
are intercepted and the ones leaving the page's origin are failed. It is enforced in the browser,
not by reading the script: a call hidden behind `new Image().src` would pass a source check and
be stopped here all the same. A browser that cannot intercept refuses the script rather than
running it unguarded.

## The surface the Web App's panel talks to

The panel is a page in the app's window, and it is the only thing that can create a `<webview>`
— the desktop shell hosts the guests but does not create them. So the browser's HTTP surface
(`/api/browser`) is where an open request becomes a tab: the panel creates the element, learns the
guest's id, and claims the request with it. A host with no browser surface answers 503
`browser_unavailable` rather than 404: the browser is a feature of the host, not a missing path.

The state is pushed, not polled: a tab that appeared, closed or crashed — and a page that was
asked for and has no window to show it — reach the panel as a `browser_state` event on the user
channel, the moment they happen. A pull (`GET /api/browser/status`) is the catch-up for a
window that missed one. So the tab strip does not lag behind the agent's page by a poll
interval.

A claimed request leaves the pending list at once, and a second window claiming the same one is
told it made a duplicate — the element it made is removed, because a tab the server does not
know about is a page the user cannot get back to.

## One set of rules about addresses

The user typing in the address bar and the agent saying "open the dev server" mean the same
thing by the same string, so there is one set of rules and both go through it: a bare host gets
a scheme (https for a public name, http for a loopback or IP address), and words become a web
search. The agent does not have to spell out a URL, and the two can never disagree about what
a string means.

## The agent can do more than click and type

`browser_act` grew `scroll`, `press`, `select`, `navigate`, `back`, `forward` and `reload`. A
scroll answers with where the page ended up — whether it moved, whether it is at the bottom,
how tall it is — because a model told "scrolled to the bottom" when nothing moved would keep
asking. A key is dispatched as a person's keyboard would, so a form that only accepts trusted
events accepts it. A `<select>` is chosen by its value or by the text the user reads on it.

## The sign-ins survive a crash

Chrome writes its cookie store only when it closes, politely. Two minutes of running leave
the file untouched, and a browser that is killed — a crash, a power cut — writes nothing at
all. The sign-ins an import brought would be gone, and the sign-ins are the user's: they
took effort to bring over, and a server crash is no reason to lose them.

So the server keeps its own record of the cookies it handed to the browser, written the
moment they are set. The browser's store is the fast path; the record is the durable one,
and it is put back into the browser every time the browser starts. Clearing the browser's
data clears the record too — a sign-in the user asked to be gone must not come back from
nowhere.

## A browser of its own, for the server

The built-in browser needs the desktop app: a `<webview>` is created by the Web App and
hosted by the shell, so without the shell there is no browser at all. That is a poor answer
for a server that runs on its own — the agent can read public pages and nothing else.

So there is a third backend: a Chromium the **server** starts for itself, with its own
profile, driven over its own debugger. The browser is a real one — the machine already has
Chrome, Edge or Brave — so nothing is downloaded and nothing is installed. The profile
lives in the data root, so the sign-ins an import brought survive a restart.

What it is not: the built-in browser with the window taken away. The user cannot see its
pages and cannot take a tab over — that is the trade, and the panel says so when it draws
the list of pages the agent is working on.

The choice is the user's, per user, and the fallback is deliberate: **a browser that works
beats the one the user asked for not working.** A server with no shell falls back to the
headless one; a machine with no Chromium falls back to the built-in one. The router picks
per call, so the choice can change while the server runs.

The browser starts when the agent opens a page, not when the app asks about it: a server
that has never driven a page should not leave a browser running.

And it has the guard the built-in browser has. `exec` runs arbitrary script in a page the
user is signed into; the script runs in the page's own origin, so it cannot read another
origin's DOM — but it could *send* to one, carrying `document.cookie` away. So while a
script runs, the tab's requests are intercepted and the ones that leave the page's origin
are failed. That needs the browser to relay `Fetch.requestPaused`, and the first version of
the headless browser did not — so a script there could have walked the user's sign-ins off
the page. It relays now, and the guard is tested against a real browser.

Two things the implementation had to get right, and both were found by the tests:

- a browser killed outright does not write its cookie store out, so the sign-ins would be
  gone the next time it started. It is asked to close, and the kill is the fallback.
- the browser's children hold the profile open even after its parent is gone, so the whole
  tree is cleaned up — otherwise the profile cannot be removed and the next run cannot
  start.

## Bringing the sign-ins over

The built-in browser has a store of its own, and it starts empty. A user can bring the
sign-ins of a system browser into it: the Chromium family's (Chrome, Edge, Brave, Opera,
Vivaldi) and Firefox's.

The import reads a profile's cookie store and its history, and never writes to the system
browser — every store is read through a private copy, so a running browser that holds its
file open does not have to be closed to be read (though on Windows it does, and the import
says so). The cookies are decrypted with the platform's own key: the macOS Keychain, the
Linux keyring, or Windows' DPAPI. Chrome's app-bound encryption (`v20`) is not a key
anyone else holds, so those cookies stay behind and the import says how many.

What the user gets for it is the difference between a browser that can only read public
pages and one that can do the work: the sign-in is what opens the back office, the order
page, the ticket system. The interface is the user's, and so is the decision — which
profile, what it brings, which sites' cookies — because an import reads a browser's private
state. The agent never makes any of those choices.

The history lands in the browser's own file, and merges with what it already had: a
hot swap means two stores can write the same file, and neither loses the other's visits.

## Waiting, instead of scanning

`browser_act` grew `wait`: for an element to appear or vanish, for the page to stop
changing, for the load to finish. The page watches itself, so one call does the waiting and
ends the instant the condition holds.

This is the action that saves the model its budget. A scan of a real page costs thousands of
tokens, and a model that polls a loading page spends its whole budget on the polling. A wait
that times out says so, rather than leaving the model to wonder whether the element is there.

`hover` and `upload` came with it: many components only reveal themselves on a hover, and a
file input was something the agent could not fill at all.


## Compatibility

- The built-in tool set gained two entries, so the kernel was advanced: `KERNEL_VERSION` is now
  `2026-10-20` and the tools tab's previous default hash moved into
  `KERNEL_SUPERSEDED_TAB_HASHES`. An Agent whose `tools.builtin` list is still the previous
  default advances to the new one; one the user edited keeps its own rows.
- The browser's tools grew a second round (`scroll` / `press` / `select` / `navigate` / `back` /
  `forward` / `reload`, and the `url` argument learning the address bar's rules), reusing the
  same version the same day; the tools tab's previous default hash moved into
  `KERNEL_SUPERSEDED_TAB_HASHES` the same way.
- An existing Agent's persisted `tools.builtin` list is otherwise frozen as written, as for every
  newly added built-in tool: an Agent created before this change needs the two entries
  hand-added to its `system_config.yaml` to get them.
- The main window's `webPreferences` gained `webviewTag: true`. It does not widen what the
  window can load — every `<webview>` still passes `will-attach-webview` and is refused outside
  this app's own browser partition — only where a guest may attach.
- The server gained one subpath export (`@prismshadow/jiumate-server/browser`), carrying the
  wire types between the shell and the runtime.
- The user channel gained one event (`browser_state`), carrying the browser's state to the
  window that shows it.
- The Web App's dock gained a `browser` panel, offered only where Electron defines the
  `<webview>` element — the desktop app's main window.
- No data was migrated and no existing behaviour changed.
