# Plugin cards get a real enable switch, and a place to type the API key

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `web`

[中文版](2026-10-12-plugin-card-switch-and-credentials.zh.md)

Two things on the plugin tab were asking a question without offering an answer. The card drew a key glyph whenever a plugin needed a credential, and it turned a power icon into the enable toggle — both markers, neither editable. This change makes the card carry a control you can read at a glance, and gives the key somewhere to go.

## The card's actions

- **Smaller buttons.** The corner group goes from five 32px squares to 28px with a tighter gap. On a three-column grid the card is a third of the page, so the group was competing with the plugin name for the same row and the name truncated inside about fifteen characters. The glyph keeps its size: at 15px inside a 28px button it still reads as a glyph rather than a speck, and adding an icon-scale rung for one card would put a size in the scale that nothing else shares.
- **Enable/disable is a `Switch`.** It replaces the power icon rather than joining the row, which is the whole point. Of the four glyphs, the power mark was the only one whose state lived in the glyph rather than in its shape — a filled-versus-outline difference nobody reads at a glance — while a knob at one end or the other states itself without a hover. It also stops the toggle from needing a fourth square in a row the others already fill.
- **`Switch` gains an `sm` size** (a 28×16 track with a 12px knob). The component's default 36×20 is tuned for a labelled form row and stands taller than the 28px buttons it now shares a row with. The knob and its travel scale together, so shrinking the box cannot leave the knob overhanging the track's end-cap — the clearance stays a uniform 1px all around at both sizes.

## API keys in the detail view

The card's key glyph answers "is this plugin configured" and nothing else, which left "where do I put the key" pointing at the Agent settings page — a gear icon on another screen, for a user looking at the thing that wants the key. The detail Modal now carries the input.

- **One password field per declared variable**, placed between the stats row and the file browser: everything else on that screen describes what the plugin ships, and a declared credential is the one thing on it the user sometimes has to *do*.
- **Variables are collected across the plugin's Skills, deduplicated and sorted.** Two Skills in one plugin can declare the same provider's key, and the section asks for it once — two inputs bound to one key name would let the second save silently overwrite the first.
- **Writes go to the selected Agent's vault**, which is already the mechanism that makes a shell variable reach that Agent's `exec_command` subprocess; the Agent settings Vault tab is the same write. A `required_env` name *is* a shell variable — the Firecrawl skill's own `curl` calls `$FIRECRAWL_API_KEY` from the shell — so writing anywhere else would create a second, invisible copy of a credential the runtime does not read.
- **Which Agent is named, not assumed.** A key set on one Agent does not reach another, and the Modal opens with no Agent selected as often as with one, so the section says which Agent it writes to and says so plainly when there is none. A credential on the wrong Agent fails silently: the card it was entered from reads as configured, and the skill that needs it still reports a missing key.
- **Values never come back**, so a configured key shows an empty field with a "configured — leave empty to keep it" placeholder, and saving one resends every other entry by key name alone. The vault's PUT replaces the whole table, so sending only the changed key would silently delete the Agent's other credentials.
- **Members get disabled inputs rather than hidden ones.** Vault writes are owner-only server-side, and a member looking at this card needs to know the key exists and that setting it takes a different role.
- **The key glyph refreshes from the server after a save**, because `requiredEnvReady` is resolved per request rather than cached and the card should turn green from that answer rather than from an assumption about what the write did.

A plugin that declares no variables renders no section at all — an empty "API keys" box on a plugin with nothing to key would imply something was left unconfigured.