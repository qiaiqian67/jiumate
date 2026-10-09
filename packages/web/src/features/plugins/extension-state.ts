/**
 * Client-side persistence for extension state: on/off switches and user-defined categories.
 *
 * **Scope — user-level, deliberately.** Categories and switches follow the *person*, not the
 * Project: someone who has curated a category called 「常用」 on their work Project wants the same
 * grouping on their personal one, and per-Project copies would mean maintaining the same taxonomy
 * N times. The cost is that a switch is not per-Project either — acceptable, and it matches how
 * the underlying installs already read (the installed-skill lists are per-Project, so the switch
 * applies consistently to whichever Agent is acting).
 *
 * **Keys are namespaced per user.** The account id is part of the key, not just a namespace
 * prefix: a shared machine otherwise shows the previous account's switches and categories, which
 * looks exactly like the app having remembered the wrong choices. Every read is tolerant of a
 * parse failure — storage can be disabled outright (Safari private mode throws on write), and a
 * page that cannot save a category must still render its skills.
 *
 * **Disabled state is an override, not the default.** Nothing is written for an item that is on;
 * only explicit "off" is stored. That keeps the file small and — more importantly — means an
 * update that adds a new item, or a reinstall that clears the plugin, comes back **on**, which is
 * what a user expects rather than inheriting a stale "off" from months ago.
 */
import type { Category } from "./extension-model";

const NS = "jiumate.ext.";
const STATE_KEY = `${NS}state`;
const CATEGORIES_KEY = `${NS}categories`;

/**
 * Switch overrides: itemId -> false means "explicitly off". Absent means on.
 *
 * Keyed by a **scoped** id rather than the bare name (see `scopedId`): a bundled skill's switch
 * must not survive its plugin, and two plugins could ship a skill of the same name.
 */
export type SwitchMap = Record<string, boolean>;

function keyFor(userId: string | undefined | null, base: string): string {
  // No user id yet (auth still loading): use a shared key rather than one per anonymous render,
  // which would leak writes between users on the same machine once auth resolves.
  return userId ? `${base}.${userId}` : base;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // A file written by an older version, or hand-edited, can be any shape; only accept the one
    // we know how to use rather than letting a malformed map reach the UI as undefined keys.
    return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or a disabled store. The UI works without persistence; losing a switch on reload is
    // far better than a render that throws.
  }
}

/**
 * The identity a switch is stored under.
 *
 * A bundled skill is scoped by its plugin (`plugin/skill`), so removing the plugin drops its
 * children's switches by construction — the key simply no longer has anything that reads it, and
 * reinstalling the plugin starts from defaults. A standalone item is scoped by kind alone, since
 * two skills of the same name cannot be installed side by side anyway.
 */
export function scopedId(
  kind: "plugin" | "skill" | "connector",
  name: string,
  parent?: string | null,
): string {
  return parent ? `${kind}:${parent}/${name}` : `${kind}:${name}`;
}

/** All switches. */
export function loadSwitches(userId?: string | null): SwitchMap {
  return readJson<SwitchMap>(keyFor(userId, STATE_KEY), {});
}

/** Whether an item is on. Absent means on — see the file header. */
export function isOn(switches: SwitchMap, id: string): boolean {
  return switches[id] !== false;
}

/**
 * Returns a new map with the item set. Setting a switch back to "on" **removes** the entry rather
 * than storing `true`, so the file keeps meaning "explicitly off" and nothing else.
 */
export function withSwitch(switches: SwitchMap, id: string, on: boolean): SwitchMap {
  if (on) {
    if (!(id in switches)) return switches;
    const next = { ...switches };
    delete next[id];
    return next;
  }
  if (switches[id] === false) return switches;
  return { ...switches, [id]: false };
}

/** Drops every switch belonging to a plugin — used when a plugin is uninstalled. */
export function withoutPlugin(switches: SwitchMap, pluginName: string): SwitchMap {
  const prefix = `plugin:${pluginName}`;
  const next: SwitchMap = {};
  let changed = false;
  for (const [id, value] of Object.entries(switches)) {
    // Both the plugin's own switch and its bundled skills' (`skill:<plugin>/<name>`).
    if (id === prefix || id.startsWith(`skill:${pluginName}/`)) {
      changed = true;
      continue;
    }
    next[id] = value;
  }
  return changed ? next : switches;
}

export function saveSwitches(userId: string | undefined | null, switches: SwitchMap): void {
  writeJson(keyFor(userId, STATE_KEY), switches);
}

/** User-defined categories (the product's own are merged in by the caller, not stored here). */
export function loadCategories(userId?: string | null): Category[] {
  const raw = readJson<unknown>(keyFor(userId, CATEGORIES_KEY), []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is Category =>
      !!c &&
      typeof c === "object" &&
      typeof (c as Category).id === "string" &&
      typeof (c as Category).name === "string",
  );
}

export function saveCategories(userId: string | undefined | null, categories: Category[]): void {
  writeJson(keyFor(userId, CATEGORIES_KEY), categories);
}

/**
 * A category id that cannot collide with a generated one and cannot be typed.
 *
 * Derived from the name, so the same name always yields the same id — which is what lets a
 * category survive a rename of its display label — and prefixed to stay clear of a built-in id.
 */
export function categoryIdFor(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "");
  // A name made entirely of punctuation slugs to nothing; fall back to a stable hash-ish form so
  // the category still gets a usable id instead of colliding with every other empty one.
  return slug === "" ? `cat-${encodeURIComponent(name.trim()).slice(0, 24)}` : `user:${slug}`;
}

/** Renames a category, keeping its id — so every item filed under it stays filed. */
export function renameCategory(categories: Category[], id: string, name: string): Category[] {
  return categories.map((c) => (c.id === id ? { ...c, name: name.trim() } : c));
}

/**
 * Removes a category and reports the items left pointing at it.
 *
 * Items cannot be deleted with their category — an installed skill outlives the grouping it was
 * filed under — so they fall back to uncategorised. The caller needs the affected ids to do that
 * explicitly (and to tell the user how many items moved), which is why this returns them rather
 * than just the shortened list.
 *
 * A built-in category is refused, returning it unchanged with nothing orphaned: the product ships
 * it, plugins carry it, and deleting it would leave those plugins uncategorisable.
 */
export function removeCategory(
  categories: Category[],
  id: string,
  filedUnder: Readonly<Record<string, string | null>> = {},
): { categories: Category[]; orphaned: string[]; refused: boolean } {
  const target = categories.find((c) => c.id === id);
  if (target?.builtin) return { categories, orphaned: [], refused: true };
  const orphaned = Object.entries(filedUnder)
    .filter(([, cat]) => cat === id)
    .map(([itemId]) => itemId);
  return { categories: categories.filter((c) => c.id !== id), orphaned, refused: false };
}
