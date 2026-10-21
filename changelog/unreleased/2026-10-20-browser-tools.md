# Give an Agent a browser it can read and act on

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `core`, `server`, `desktop`, `docs`

[中文版](2026-10-20-browser-tools.zh.md)

The agent browser existed only as a plugin skill that taught the model to shell out to
`penguin browser` — a verb this repository's CLI does not provide. So there was no browser
capability in the product at all, only instructions for using one somewhere else.

Two built-in tools now drive it. `browser_read` reports the backend and the open tabs, opens a
URL, closes a tab, scans a page as simplified HTML or plain text, and returns a screenshot as
image content. `browser_act` clicks, types, and runs JavaScript in the page's own origin.

## Reading and acting are separate tools

- `browser_read` is `r`: it changes nothing on the user's behalf.
- `browser_act` is `rw`, so a click, a typed line or a script is approved first. A click can
  submit an order and a script can read `document.cookie`.
- One tool with one permission would make the frequent read carry the weight of the rare
  write. Split, a model that only wants to look at a page never enters the approval flow,
  while a click still asks.

## The screenshot comes back as the image itself

It returns through `ToolResult.images`, so the model sees the page in the turn that asked for
it. A screenshot written to disk and read afterwards costs a second tool call and a round trip
for the same picture.

## The backend is the user's choice, and every call says which

The tools never pick a backend, and every call reports the one in use: a model that assumed it
was reading the built-in browser while reading another would draw the wrong conclusion from a
page that looks the same either way. Tabs are shared with the user, who can watch and take over.

## What a host provides, and what the code does not know

The tools own no state and touch no disk — they call the `BrowserPort` their host injected, and
a host with no browser surface reports that rather than failing. Under the server, one
implementation backs a `BrowserLink` whose far side may be the desktop shell or the user's own
Chrome: the difference is declared through `BrowserBackendCapabilities`, not discovered, so a
second backend changes nothing above it.

The desktop shell hosts the pages as `<webview>` guests in the main window and runs their CDP,
which only the main process can do. It rides the same utilityProcess message port the updater
and the PDF exporter use, each relay filtering its own frames by `type`.

## The exec guard

`exec` runs script in a page the user is signed into, so while a script runs the tab's requests
are intercepted and the ones leaving the page's origin are failed — enforced in the browser,
not by reading the script, since a call hidden behind `new Image().src` would pass a source
check and be stopped here all the same. A browser that cannot intercept is told so and refuses
the script rather than running it unguarded.

## Compatibility

- The built-in tool set gained two entries, so the kernel was advanced: `KERNEL_VERSION` is now
  `2026-10-20` and the tools tab's previous default hash moved into
  `KERNEL_SUPERSEDED_TAB_HASHES`.
- The main window's `webPreferences` gained `webviewTag: true`. It does not widen what the
  window can load — every `<webview>` still passes `will-attach-webview` and is refused outside
  this app's own browser partition — only where a guest may attach.
- The server gained one subpath export (`@prismshadow/jiumate-server/browser`), carrying the
  wire types between the shell and the runtime.
- No data was migrated and no existing behaviour changed.