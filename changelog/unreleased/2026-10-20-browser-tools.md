# Let an Agent read and act on a page in the browser

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `core`, `docs`

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

## Compatibility

- The built-in tool set gained two entries, so the kernel was advanced: `KERNEL_VERSION` is now
  `2026-10-20` and the tools tab's previous default hash moved into
  `KERNEL_SUPERSEDED_TAB_HASHES`. An Agent whose `tools.builtin` list is still the previous
  default advances to the new one; one the user edited keeps its own rows.
- An existing Agent's persisted `tools.builtin` list is otherwise frozen as written, as for every
  newly added built-in tool: an Agent created before this change needs the two entries
  hand-added to its `system_config.yaml` to get them.
- No data was migrated and no existing behaviour changed.
