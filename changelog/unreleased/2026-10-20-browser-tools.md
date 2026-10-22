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
