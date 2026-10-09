/**
 * Extension-item model shared by the plugin / skill / connector surfaces: where an item came
 * from, whether it is on, which category it sits in, and which Agents would be affected by
 * turning it off or removing it.
 *
 * **Why this exists as pure functions.** Three pages (plugins, skills, connectors) all need the
 * same three answers — origin, on/off state, impact — and all three were about to grow their own
 * slightly different version of each. They are here instead, so a plugin shown in the library and
 * the same plugin in the manage-installs modal cannot disagree about whether it is a built-in or
 * who it would break. Nothing here touches React or storage; the storage layer sits on top
 * (`extension-state.ts`) precisely so this file stays testable without a browser.
 *
 * **Why origin is derived, not stored.** The server already answers it — `origin: "library" |
 * "import"` plus `pluginName` on every installed skill — and duplicating that into client state
 * would create a second source of truth that drifts the moment a plugin is reinstalled from a
 * different source. Deriving keeps the server authoritative.
 */

/**
 * Where an item came from, as the UI distinguishes it.
 *
 * - `"builtin"` — ships with the product. Not installed by anyone; present and usable out of the
 *   box, and not something the user can remove.
 * - `"user"` — the user added it: a library/marketplace install, an imported file, or a locally
 *   added connector. Removable.
 * - `"bundled"` — **skills only**: shipped *inside* a plugin. It cannot be uninstalled on its own
 *   (removing it means removing the plugin, which removes it), but it can be switched on and off
 *   independently, and its switch is scoped to the plugin's lifetime.
 */
export type ExtensionOrigin = "builtin" | "user" | "bundled";

/**
 * The filter tabs. Plugins and connectors get the first three; skills get all four, since bundled
 * is a real state they alone can be in.
 */
export type ExtensionFilter = "all" | "builtin" | "user" | "bundled";

/** Which filter tabs a surface offers. */
export function filtersFor(hasBundled: boolean): ExtensionFilter[] {
  return hasBundled ? ["all", "builtin", "user", "bundled"] : ["all", "builtin", "user"];
}

/** Whether a filter can match anything at all — used to hide tabs that would always be empty. */
export function filterMatches(origin: ExtensionOrigin, filter: ExtensionFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "builtin":
      return origin === "builtin";
    case "user":
      return origin === "user";
    case "bundled":
      return origin === "bundled";
  }
}

/**
 * The origin of an installed skill.
 *
 * `pluginName` is the only signal needed: a skill installed through a plugin is bundled by
 * definition, and the server records that name on install. `origin` is kept as a second check
 * because it is what the server computed — if the two ever disagree the *recorded* plugin wins,
 * since that is what actually determines whether uninstalling the plugin takes this skill with it.
 */
export function skillOrigin(skill: {
  pluginName?: string | null;
  origin?: string | null;
}): ExtensionOrigin {
  if (skill.pluginName) return "bundled";
  return skill.origin === "library" ? "builtin" : "user";
}

/**
 * Whether a bundled skill may be switched independently of its plugin.
 *
 * It may — that is the whole distinction from the plugin itself. What it may **not** do is
 * outlive the plugin: the switch is stored under the plugin's name and dropped when the plugin
 * goes (see `extension-state.ts`), so a stale "off" can never resurrect against a plugin the user
 * has since removed and reinstalled expecting defaults.
 */
export function canToggleIndependently(origin: ExtensionOrigin): boolean {
  return origin !== "builtin";
}

/** Whether the item can be removed at all. Built-ins ship with the product; bundled skills go with their plugin. */
export function canUninstall(origin: ExtensionOrigin): boolean {
  return origin !== "builtin" && origin !== "bundled";
}

/**
 * A user-defined category.
 *
 * `builtin: true` marks a category the product ships; those may be renamed for display but not
 * deleted, because a plugin carrying that category would otherwise become uncategorisable. They
 * are also not persisted — the user's own list is stored separately and merged over them, so a
 * product update that adds a category does not get clobbered by a stale local copy.
 */
export interface Category {
  id: string;
  name: string;
  /** The product ships it; see above for why it cannot be deleted. */
  builtin?: boolean;
}

/** Where an item is filed. `null` = uncategorised, which is a real state, not a missing one. */
export type CategoryId = string | null;

/**
 * The text a search query is matched against.
 *
 * Both the name and **both** description languages, because a Chinese user searching a library
 * whose items only carry `shortDescriptionZh` would otherwise find nothing on an English
 * description. Includes the category so "点进去" from the category tab works too.
 */
export function searchText(item: {
  name: string;
  description?: string | null;
  shortDescription?: string | null;
  shortDescriptionZh?: string | null;
  category?: CategoryId;
}): string {
  return [item.name, item.description, item.shortDescription, item.shortDescriptionZh, item.category]
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join("\n")
    .toLowerCase();
}

/**
 * Whether an item matches a query.
 *
 * Empty query matches everything. Matched case-insensitively, and on substrings rather than
 * prefixes — a search that only matched from the start would make the middle of a long skill name
 * unreachable, and the names here are long.
 */
export function matchesQuery(
  item: {
    name: string;
    description?: string | null;
    shortDescription?: string | null;
    shortDescriptionZh?: string | null;
    category?: CategoryId;
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return searchText(item).includes(q);
}

/** One Agent a change would reach, with enough detail to identify it in a confirmation. */
export interface AffectedAgent {
  agentId: string;
  /** Display name when it differs from the id; the UI shows both otherwise. */
  displayName?: string | null;
  /**
   * Why this Agent is affected, in the user's terms rather than the mechanism's — the point of
   * the confirmation is that they can tell whether it matters to them.
   */
  reason: "installed" | "selected";
}

/**
 * Which Agents a disable or uninstall would affect.
 *
 * Built from the *installed* list, which is the ground truth for "who would stop being able to
 * use this". `selected` is tracked separately from installed on purpose: an Agent can have a
 * skill installed but not selected in its configuration, and telling such a user that an Agent is
 * "affected" would be noise — but an Agent that has it *selected* is affected even if the
 * install list is incomplete, so both are unioned and de-duplicated by id, with `selected` winning
 * the reason because it is the stronger claim.
 *
 * Sorted by id so the confirmation list does not reshuffle between opens.
 */
export function affectedAgents(
  installedAgents: readonly string[] | null | undefined,
  options?: {
    selectedAgents?: readonly string[] | null;
    displayNames?: Readonly<Record<string, string>> | null;
  },
): AffectedAgent[] {
  const out = new Map<string, AffectedAgent>();
  for (const id of installedAgents ?? []) {
    if (id) out.set(id, { agentId: id, reason: "installed" });
  }
  for (const id of options?.selectedAgents ?? []) {
    if (!id) continue;
    const prev = out.get(id);
    out.set(id, {
      agentId: id,
      reason: "selected",
      ...(prev?.displayName ? { displayName: prev.displayName } : {}),
    });
  }
  const names = options?.displayNames;
  return [...out.values()]
    .map((a) => ({
      ...a,
      ...(names?.[a.agentId] ? { displayName: names[a.agentId] } : {}),
    }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

/**
 * Whether a change is safe to perform without asking.
 *
 * A built-in going away is not something to confirm — there is no user action behind it — so it
 * reports no impact rather than pretending there are none.
 */
export function changeNeedsConfirming(affected: readonly AffectedAgent[]): boolean {
  return affected.length > 0;
}