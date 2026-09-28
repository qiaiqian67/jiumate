/**
 * The inspiration library, loaded once per browser session and shared by every surface that shows
 * it — the gallery page and the draft screen's picker.
 *
 * **One read, two consumers.** The library is server state plus a bundled built-in half, so a
 * naive implementation would have each surface fetch it: two requests on a page load that shows
 * both (the draft screen renders its picker while the gallery may be open in another tab), and two
 * answers that can disagree after an admin edits a case. A module-level store makes the list one
 * value, so an edit applied from the gallery is already what the picker renders.
 *
 * **It never starts empty.** The store opens on the bundled built-ins
 * (`builtinCatalogView()`), so the picker paints its rows in the same frame as the rest of the
 * draft screen and swaps in the server's answer when it lands. The swap is invisible in the common
 * case — the two agree about every built-in — and the failure case is a shorter list rather than an
 * empty one, which is the direction the theme picker degrades in too.
 *
 * **Writes update the store, not the whole list.** A save returns the case the server stored, so
 * `applyCase` puts *that* back rather than re-fetching: the server's copy is authoritative (it
 * derived the MIME type, the timestamps and the preview filename) and one round trip is enough.
 */
import { useEffect } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand/react";
import * as api from "../../api/endpoints";
import type { PickableItem } from "../skills/skill-pick-list";
import {
  builtinCatalogView,
  createInspirationCase,
  createInspirationCategory,
  deleteInspirationCase,
  deleteInspirationCategory,
  fetchInspirationCatalog,
  updateInspirationCase,
  updateInspirationCategory,
} from "./inspiration-service";
import type { InspirationCatalogView } from "./inspiration-service";
import type { InspirationCase, InspirationCategory } from "@prismshadow/jiumate-inspirations";

/** Where the shared catalog is in its life: painting the built-ins, or holding the server's list. */
export type CatalogStatus = "builtin" | "ready" | "failed";

interface InspirationState {
  status: CatalogStatus;
  catalog: InspirationCatalogView;
  /** Set when the last load failed; the built-ins are still what `catalog` holds. */
  error: unknown;
}

const store = createStore<InspirationState>(() => ({
  status: "builtin",
  catalog: builtinCatalogView(),
  error: null,
}));

let loading = false;

/**
 * Loads the server's catalog once.
 *
 * A failure leaves the status at `failed` rather than retrying in a loop: the built-ins are a
 * complete, usable library, and re-requesting on every render would be a request storm for a
 * server that is down. The next explicit `reload()` (an admin's save, or a remount after the
 * network returns) tries again.
 */
function load(): void {
  if (loading || store.getState().status === "ready") return;
  loading = true;
  void fetchInspirationCatalog()
    .then((catalog) => {
      store.setState({ status: "ready", catalog, error: null });
    })
    .catch((error: unknown) => {
      store.setState({ status: "failed", error });
    })
    .finally(() => {
      loading = false;
    });
}

/** Re-read the catalog, whatever the current status — after a write, or after a failed load. */
export function reloadInspiration(): Promise<void> {
  loading = true;
  return fetchInspirationCatalog()
    .then((catalog) => {
      store.setState({ status: "ready", catalog, error: null });
    })
    .catch((error: unknown) => {
      store.setState({ status: "failed", error });
    })
    .finally(() => {
      loading = false;
    });
}

/** The shared catalog, loading it on first use. Pass `false` to defer the read entirely. */
export function useInspirationCatalog(enabled = true): InspirationState {
  useEffect(() => {
    if (enabled) load();
  }, [enabled]);
  return useStore(store, (state) => state);
}

/** The shared catalog without subscribing — for an event handler that needs it right now. */
export function inspirationCatalogNow(): InspirationCatalogView {
  return store.getState().catalog;
}

/** Put a case the server just returned into the catalog, replacing any copy with the same id. */
export function applyCatalogCase(one: InspirationCase): void {
  const { catalog } = store.getState();
  const at = catalog.cases.findIndex((candidate) => candidate.id === one.id);
  const cases =
    at === -1
      ? [...catalog.cases, one]
      : catalog.cases.map((candidate) => (candidate.id === one.id ? one : candidate));
  store.setState({ catalog: { ...catalog, cases } });
}

/** Drop a case the server just deleted. */
export function removeCatalogCase(id: string): void {
  const { catalog } = store.getState();
  store.setState({
    catalog: { ...catalog, cases: catalog.cases.filter((one) => one.id !== id) },
  });
}

/** Put a category the server just returned into the catalog, replacing any copy with the same id. */
export function applyCatalogCategory(one: InspirationCategory): void {
  const { catalog } = store.getState();
  const at = catalog.categories.findIndex((candidate) => candidate.id === one.id);
  const categories =
    at === -1
      ? [...catalog.categories, one]
      : catalog.categories.map((candidate) => (candidate.id === one.id ? one : candidate));
  store.setState({ catalog: { ...catalog, categories } });
}

/** Drop a category the server just deleted. */
export function removeCatalogCategory(id: string): void {
  const { catalog } = store.getState();
  store.setState({
    catalog: { ...catalog, categories: catalog.categories.filter((one) => one.id !== id) },
  });
}

// ---------------------------------------------------------------------------
// Write helpers — the store half of the service calls
// ---------------------------------------------------------------------------

export async function saveInspirationCase(
  id: string | null,
  body: Record<string, unknown>,
): Promise<InspirationCase> {
  const stored =
    id === null ? await createInspirationCase(body) : await updateInspirationCase(id, body);
  applyCatalogCase(stored);
  return stored;
}

export async function removeInspirationCase(id: string): Promise<void> {
  await deleteInspirationCase(id);
  removeCatalogCase(id);
}

export async function saveInspirationCategory(
  id: string | null,
  body: { id: string; name: string; nameZh: string; order: number },
): Promise<InspirationCategory> {
  const stored =
    id === null ? await createInspirationCategory(body) : await updateInspirationCategory(id, body);
  applyCatalogCategory(stored);
  return stored;
}

export async function removeInspirationCategory(id: string): Promise<void> {
  await deleteInspirationCategory(id);
  removeCatalogCategory(id);
}

// ---------------------------------------------------------------------------
// The editor's pickers
// ---------------------------------------------------------------------------

/**
 * The shipped skill catalog, flattened out of the plugin library.
 *
 * A case pins skills by name and the composer preselects those the chosen Agent has installed, so
 * the list to pick from is the catalog of skills the product ships — which is exactly what the
 * plugin library endpoint serves (metadata only: name, descriptions, version). Read once per editor
 * open and cached by the caller rather than by the module: the list is small, and a module-level
 * cache would outlive a library upgrade within the same tab.
 *
 * A plugin's skills share the plugin's icon, which the plugin item carries once — attached here so
 * the picker's rows draw the same icons the composer's dropdown does.
 */
export async function fetchSkillCatalog(): Promise<PickableItem[]> {
  const library = await api.getPluginLibrary();
  const out: PickableItem[] = [];
  for (const group of library.groups) {
    for (const plugin of group.plugins) {
      for (const skill of plugin.skills) {
        out.push({ ...skill, ...(plugin.icon !== undefined ? { icon: plugin.icon } : {}) });
      }
    }
  }
  return out;
}

/**
 * The tool names an Agent actually has: its built-in tool table plus its MCP servers.
 *
 * MCP servers are listed by **server** name, not by the `mcp__<server>__<tool>` names they expand
 * into: a case states which servers it expects to be wired up, and the individual tools inside one
 * are that server's business (and are only known once it connects).
 */
export async function fetchAgentToolNames(projectId: string, agentId: string): Promise<string[]> {
  const response = await api.getAgentConfig(projectId, agentId);
  const names = [
    ...response.config.toolsBuiltin.map((tool) => tool.name),
    ...response.config.mcpServers.map((server) => server.name),
  ];
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
