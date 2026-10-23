# Add skills three ways, and give the skill switch something to switch

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `core`, `server`, `web`

[中文版](2026-10-12-skill-add-and-machine-switch.zh.md)

Adding a skill was one sentence of description, and the switch on the card moved nothing. Both are
fixed here.

## That switch was not doing anything

The skills tab's enable toggle lived in **localStorage**, and not one byte of it reached the server.
So after turning a skill off, the Agent still read it off disk and still injected it into the prompt.
The plugin switch has been real since the last change; this one was **a decoration sitting beside it**.

It is real now. The machine half goes in `<root>/skills-state.json`, the per-Agent half on the
Skill's own `.installs.json` record, and `listInstalledSkills` skips a Skill when **either** is off —
the same two-level shape plugins have.

The per-Agent flag lives in `.installs.json` rather than as a marker file inside `skills/<name>/`, so
the Skill directory keeps holding exactly the files the Skill ships: anything extra there would be
swept into the next "export as zip", which reads that directory verbatim.

Missing, unreadable and corrupt all read as enabled. The dangerous direction is the other one —
defaulting to off would switch off every skill on every existing machine the moment this shipped, and
a capability that vanishes without anyone deciding it is the one failure mode a switch must not have.

## Three ways in, one place they land

Everything ends up in the same place: `<root>/skills/<name>/`. The three sources have nothing in
common as *fetches*, and are identical afterwards — so routing them all into one store keeps every
downstream action (mounting, enabling, filing, deleting) from having to ask where a given skill came
from, which is both cheaper and less likely to miss a branch.

  URL       every shape a person pastes resolves to the same branch archive — the bare repo, `.git`,
            `/tree/main`, a deep link into a file. And `/tree/main` is the one they are *most* likely
            to paste, because that is what copying from a browser gives; fed to a downloader it
            returns an HTML page rather than a zip.

  archive   its own route rather than a content-type branch on the URL route: the two carry their
            parameters differently and a raw body has nowhere to put JSON.

  directory resolved through realpath before anything is read. Only the server can say whether a
            path exists, and not resolving it first is how a symlink pulls a read somewhere it should
            not reach.

**Adding never installs.** All three put the skill in the machine store; mounting it into an Agent and
enabling it are separate acts. The archive and directory sources especially need saying so — one press
can bring in a dozen skills, and if "add" also meant "every Agent starts calling these now", that
would be a dozen runtime changes from one click.

**A directory may be a skill itself** rather than a folder holding skills. Pointing at
`.../my-skill` is what a person naturally does, and a reader that only understands "a container"
answers "no skills here" about the very directory they picked — which reads as a broken scan rather
than as the wrong reading.

## Two layouts, and why guessing is worse than failing

`<name>/SKILL.md` at the root, or under `.agents/skills/` / `.claude/skills/`. Recognising only the
second misses the most obvious kind of repository, and the wrong guess shows up as **"added 0 skills"
with no error at all** — so the user believes it worked.

Names always come from the directory (except when the directory *is* the one skill, where the
frontmatter wins), matching every other listing: the runtime addresses a Skill by directory name
everywhere, and letting frontmatter decide yields a name pointing at a path that is not there.

## The scan is grouped, because what gets added is a directory

Grouped by agent, not flattened: one Agent's set of skills goes in together, so making the user tick
them one by one asks them a question they did not have. Flattened, they either tick each one or are
forced to import every skill on the machine at once.

Agents holding nothing are listed too — "scanned, it has none" has to stay distinguishable from "never
scanned", or both are the same blank. **Skills already in the store are marked and left unticked**:
overwriting one has consequences (the existing copy may have been edited), so ticking it is the
moment the user makes that decision.

## Upgrade goes back to where it came from

`.source.json` records the source, because an archive is not on the machine after unpacking and there
is no second place to look. Both of those cases report **"nowhere to check"** rather than claiming
"already up to date" — which would tell the user a skill is maintained when nothing here supports it.

Versions are `YYYY-MM-DD.N` and compare field by field rather than as strings: a string compare gets
the two fields backwards (`2026-09-02.1` sorts below `2026-08-04.1`, because `0` < `1` at the tenth
character), and offering a downgrade as an upgrade overwrites a version that worked.

## The card's controls

**The machine switch is drawn first**, because it is the wider one: turning it off disables the Skill
for every Agent at once, which is the button a user reaches for when they want it out of their
machine's behaviour. The existing per-Agent switch sits beside it — different scopes, so side by side
rather than replacing each other.

**Upgrade appears only where a source was recorded.** An archive source *does* get the button (the
route can answer, and its answer is "nowhere to check", which is an honest result); a hand-copied
Skill has no record and nowhere to look, so it gets no button at all — the tooltip of a button that
only ever apologises is not read twice, and its absence is the explanation.

**Built-in and plugin-bundled Skills have no machine switch**: they are not in the machine store, and
one hung on them would write a value nothing reads.

The add dialog can also file into a category, so a skill lands where you chose instead of needing a
second trip round every card.

core 1268, server 1919, web 2019 green (+8, +25, +6); typecheck and lint clean.

**Still not looked at in a browser**: the browser tooling does not work in this session, so the three
tabs' layout, how the grouped scan reads, and the spacing of the two switches side by side still need
one look at http://localhost:7365 on real hardware.