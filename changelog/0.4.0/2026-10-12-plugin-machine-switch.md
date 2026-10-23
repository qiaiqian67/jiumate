# Plugins gain a machine-level switch, on every card

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `core`, `server`, `web`

[中文版](2026-10-12-plugin-machine-switch.zh.md)

A plugin's enable switch existed only for plugins installed on the Agent currently selected. `use-claude-code` is installed on `cc` and not on `default_agent`, so opening the page with `default_agent` selected showed no switch for it at all — as if it could not be turned off. This change adds the level that was missing: whether a plugin is switched on **for this machine**, answerable for every plugin in the library.

## Why a second flag

The existing switch lives in `agent_state/plugins/<id>/manifest.json`, so it answers "should *this Agent* call it" and can only exist for a plugin that Agent has installed. "Should this plugin be available on this computer" is a different act with a different scope, and it has to be expressible before anything is installed anywhere — which is exactly the state a new plugin is in when you first decide whether you want it.

Both are kept, and **both must be on** for a plugin's Skills to load. Switching the machine off disables the plugin for every Agent at once without touching any manifest, so the per-Agent state survives and comes back when the machine switch returns. Neither flag overwrites the other.

## The state

- **`<root>/plugin-state.json`**, a `{ disabled: [...] }` list of library names. Nothing else is recorded: a plugin that is on is simply absent, so the file carries only the exceptional case and "absent" keeps meaning "on".
- **Keyed by library name, not by plugin id.** An id carries an `@marketplace` suffix and the same name can resolve to either copy on a given machine; a switch that had to be re-keyed whenever that resolution differed would move itself out from under the user's setting.
- **Absent, unreadable and corrupt all read as enabled.** Defaulting the other way would switch off every plugin on every existing machine the moment the file appeared — a capability that vanishes without anyone deciding it is the one failure mode a switch must not have. The same rule the per-Agent manifest already used.
- **Written atomically**, because this file is the whole answer to "is this plugin on" and a half-written one would read as corrupt, and therefore as enabled.

## What it gates

- **Installing.** `POST …/agents/:a/plugins` answers **409 `plugin_disabled`** naming the plugins that are off. The whole batch is refused rather than filtered, so a request naming two plugins never half-succeeds and leaves the caller guessing which landed. Checked at the route rather than inside `installPlugin` because core is the SDK and also serves the CLI — the rule belongs to this product's two-level switch, and a caller writing the install tree directly is not going through the UI this guards.
- **Running.** `listInstalledSkills` skips a plugin when *either* flag is off, so a plugin already installed on an Agent stops entering its prompt the moment the machine switch flips. The machine-level set is read once per listing rather than per plugin directory.
- **Live Sessions.** `POST /api/plugins/enabled` invalidates **every cached runtime in every Project**, not one Agent's. The Skills are read from disk on each Session build, but a live Session already assembled its prompt — and this switch has no Project to scope the blast radius to, so leaving other Projects cached would mean the same plugin on for one Agent and off for another until each happened to be evicted. `SessionManager.invalidateAllRuntimes` is new; the existing per-Project variant cannot express this.

## The card

- **The machine switch is on every plugin card**, gated on nothing. It used to be gated on being installed on the selected Agent, which is what made a plugin installed elsewhere look like it had no switch at all. A plugin no Agent has yet gets one too — that is the state where the decision matters.
- **Both switches appear side by side** rather than one replacing the other. They are two different acts at two different scopes, and collapsing them would either lose the machine-wide kill switch or lose the per-Agent one.
- **An Agent's 安装 button is disabled while the machine switch is off**, with a tooltip naming the action that unblocks it. Disabled rather than hidden: a user who wants the plugin and finds no button cannot tell "switched off on purpose" from "this app cannot install it".
- **Uninstall stays available** on an Agent that already has the plugin. The machine switch stops a plugin being installed and stops it running; it does not stop files being removed.
- `PluginItem.enabled` is **required, not optional**. The card shows a switch for every plugin whether or not any Agent has it, so the listing cannot answer "unknown" by omitting the field.

## Compatibility

No existing data is rewritten and nothing breaks. The new file does not exist until a plugin is switched off, and until then every plugin reads as enabled — which is what all of them already were. A per-Agent `enabled: false` the user set earlier keeps working exactly as before; the machine-level flag is simply absent and adds nothing to the decision.

The one visible difference: a plugin that was disabled for one Agent and is being viewed with a *different* Agent selected now shows a machine switch that was previously not rendered at all. That is the fix, not a change in meaning.