/**
 * Plaza client — the catalog, its two sources, and the write calls an admin makes.
 *
 * ## Two sources, one list
 *
 * The library's built-in half ships inside `@prismshadow/jiumate-inspirations/presets`, which the
 * web bundle imports directly; the admin's own half lives on the server. `fetchInspirationCatalog`
 * merges them the way the theme picker merges its built-in gallery with the installed catalog:
 * built-ins first, the server's answer taking precedence by id. In practice the two can never
 * disagree about a built-in — the server refuses to shadow one (see the catalog service) — so the
 * merge is what lets the *bundled* list be a first paint and a fallback at the same time. A server
 * that cannot answer degrades to the built-ins rather than to nothing, because the built-ins are
 * the product's own showcase and an empty gallery would be a worse outcome than a short one.
 *
 * ## What is pure here, and why
 *
 * Everything that decides *what the user sees* — the localized copy, the search filter, the cover
 * URL — is a pure function in this module, so the gallery's behaviour is testable without a DOM or
 * a server. The React layer (`inspiration-store.ts`) only holds the fetched list and calls these.
 */
import { builtinInspirationCatalog } from "@prismshadow/jiumate-inspirations/presets";
import type {
  InspirationCase,
  InspirationCategory,
  InspirationKind,
} from "@prismshadow/jiumate-inspirations";
import { apiFetch } from "../../api/client";
import { S } from "../../lib/strings";
import { localizedText } from "../chat/skill-use";
import type { Locale } from "../../state/locale";

/** The whole library as a surface reads it. */
export interface InspirationCatalogView {
  categories: InspirationCategory[];
  cases: InspirationCase[];
  /** Non-fatal problems the server found while reading the library (empty offline). */
  diagnostics: string[];
  /** Whether the viewer may write. False for a member, and for the built-in fallback. */
  canManage: boolean;
}

/** The bundled built-ins, as a catalog view: the first paint and the offline fallback. */
export function builtinCatalogView(): InspirationCatalogView {
  const builtins = builtinInspirationCatalog();
  return {
    categories: builtins.categories,
    cases: builtins.cases,
    diagnostics: [],
    canManage: false,
  };
}

/** The server's answer, with the bundled built-ins merged in front of it. */
export function mergeCatalog(response: {
  categories: InspirationCategory[];
  cases: InspirationCase[];
  diagnostics: string[];
  canManage: boolean;
}): InspirationCatalogView {
  const builtins = builtinInspirationCatalog();
  const servedIds = new Set(response.cases.map((one) => one.id));
  const servedCategoryIds = new Set(response.categories.map((one) => one.id));
  return {
    categories: [
      ...builtins.categories.filter((one) => !servedCategoryIds.has(one.id)),
      ...response.categories,
    ],
    cases: [...builtins.cases.filter((one) => !servedIds.has(one.id)), ...response.cases],
    diagnostics: response.diagnostics,
    canManage: response.canManage,
  };
}

/** Read the whole library: the server's answer merged with the built-ins, or the built-ins alone. */
export async function fetchInspirationCatalog(): Promise<InspirationCatalogView> {
  const response = await apiFetch<{
    categories: InspirationCategory[];
    cases: InspirationCase[];
    diagnostics: string[];
    canManage: boolean;
  }>("/api/inspirations");
  return mergeCatalog(response);
}

/** Where a case's cover image is served from. Null for a glyph cover, which is drawn locally. */
export function coverUrl(one: InspirationCase): string | null {
  if (one.cover.kind !== "image") return null;
  return `/api/inspirations/${encodeURIComponent(one.id)}/asset/${encodeURIComponent(one.cover.filename)}`;
}

/** Where a case's preview document is served from. */
export function previewUrl(id: string): string {
  return `/api/inspirations/${encodeURIComponent(id)}/preview`;
}

/**
 * Read a case's preview document, for the editor to open on.
 *
 * The editor loads the stored markup into its textarea rather than opening empty, so that saving an
 * unrelated field writes the preview back instead of deleting it — "what the field shows is what
 * gets saved" is the only rule an admin can hold in their head here. Returns null for a case with no
 * preview (the request 404s, which is that answer rather than an error).
 */
export async function fetchInspirationPreview(id: string): Promise<string | null> {
  try {
    const response = await fetch(previewUrl(id), { credentials: "same-origin" });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/** The three strings a case shows, in one language, with the other language as the fallback. */
export interface LocalizedCase {
  title: string;
  description: string;
  prompt: string;
}

/**
 * The badge label for a case's kind.
 *
 * A function rather than a module-level `Record`, because `S` is a live binding swapped on locale
 * change: a map built at import time would freeze the labels in whatever language the app booted
 * in, and the kind badges would stay Chinese in an English UI.
 */
export function kindLabel(kind: InspirationKind): string {
  return S.inspiration.kind[kind];
}

/**
 * A case's copy for the active language.
 *
 * The fallback is the *other* language rather than an empty string, matching what coercion does on
 * the way in: a case authored in one language is readable in both UIs, which is what an admin
 * writing in a hurry gets instead of an empty card.
 */
export function localizedCase(locale: Locale, one: InspirationCase): LocalizedCase {
  return {
    title: localizedText(locale, one.title, one.titleZh),
    description: localizedText(locale, one.description, one.descriptionZh),
    prompt: localizedText(locale, one.prompt, one.promptZh),
  };
}

/** The category a case is filed under, or null when its category no longer exists. */
export function categoryOf(
  catalog: InspirationCatalogView,
  one: InspirationCase,
): InspirationCategory | null {
  return catalog.categories.find((category) => category.id === one.categoryId) ?? null;
}

/** A case's category name for the active language, or the id when the category is gone. */
export function categoryLabel(
  catalog: InspirationCatalogView,
  locale: Locale,
  one: InspirationCase,
): string {
  const category = categoryOf(catalog, one);
  if (category === null) return one.categoryId;
  return localizedText(locale, category.name, category.nameZh);
}

/**
 * The search haystack for one case: every language of its copy plus the machine names a user might
 * remember instead of the title.
 *
 * Both languages are matched on purpose — a Chinese-UI user searching `rag` and an English-UI user
 * searching `文档` should both find the same card, and neither should have to know which language
 * the case was authored in. Skills and tools are in the haystack for the same reason: they are what
 * a user who wants "the one that uses web-design" actually remembers.
 */
export function searchHaystack(one: InspirationCase): string {
  return [
    one.title,
    one.titleZh,
    one.description,
    one.descriptionZh,
    one.prompt,
    one.promptZh,
    one.id,
    one.categoryId,
    ...one.skills,
    ...one.tools,
  ]
    .join("\n")
    .toLowerCase();
}

/** True when `query` matches a case anywhere in its haystack. An empty query matches everything. */
export function matchesQuery(one: InspirationCase, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  // Every whitespace-separated term must appear, in any order: "web design" should not stop
  // matching because the haystack happens to say "design, web".
  return needle.split(/\s+/).every((term) => searchHaystack(one).includes(term));
}

/** Which slice of the library a tab shows. */
export type InspirationFilter =
  | { kind: "all" }
  | { kind: "featured" }
  | { kind: "favorites" }
  | { kind: "category"; categoryId: string };

/** Whether a case belongs in a tab, before the search box is applied. */
export function inFilter(
  one: InspirationCase,
  filter: InspirationFilter,
  favorites: readonly string[],
): boolean {
  switch (filter.kind) {
    case "all":
      return true;
    case "featured":
      return one.featured;
    case "favorites":
      return favorites.includes(one.id);
    case "category":
      return one.categoryId === filter.categoryId;
  }
}

/**
 * The cards a tab shows, in display order: the filter, then the search, keeping the catalog's own
 * order (which the server already sorted by category and case order).
 *
 * Favourites come back in the order they were starred rather than in catalog order — that list is
 * the user's own arrangement, and re-sorting it by category would be the app overruling it.
 */
export function visibleCases(
  catalog: InspirationCatalogView,
  filter: InspirationFilter,
  query: string,
  favorites: readonly string[],
): InspirationCase[] {
  const matched = catalog.cases.filter(
    (one) => inFilter(one, filter, favorites) && matchesQuery(one, query),
  );
  if (filter.kind !== "favorites") return matched;
  const rank = new Map(favorites.map((id, index) => [id, index]));
  return [...matched].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * The body a create or update sends.
 *
 * `coverUpload` and `previewHtml` are the two things that cannot ride on the case itself: the
 * first is bytes (base64, because the route's write contract is JSON) and the second has three
 * intents — a string writes a preview, `null` removes one, and leaving it out keeps whatever is on
 * disk. That is why it is optional here rather than defaulted to null.
 */
export interface InspirationCaseWrite {
  coverUpload?: { filename: string; dataBase64: string };
  previewHtml?: string | null;
}

export async function createInspirationCase(
  body: Record<string, unknown> & InspirationCaseWrite,
): Promise<InspirationCase> {
  const response = await apiFetch<{ case: InspirationCase }>("/api/inspirations/cases", {
    method: "POST",
    body,
  });
  return response.case;
}

export async function updateInspirationCase(
  id: string,
  body: Record<string, unknown> & InspirationCaseWrite,
): Promise<InspirationCase> {
  const response = await apiFetch<{ case: InspirationCase }>(
    `/api/inspirations/cases/${encodeURIComponent(id)}`,
    { method: "PUT", body },
  );
  return response.case;
}

export async function deleteInspirationCase(id: string): Promise<void> {
  await apiFetch(`/api/inspirations/cases/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function createInspirationCategory(body: {
  id: string;
  name: string;
  nameZh: string;
  order: number;
}): Promise<InspirationCategory> {
  const response = await apiFetch<{ category: InspirationCategory }>(
    "/api/inspirations/categories",
    { method: "POST", body },
  );
  return response.category;
}

export async function updateInspirationCategory(
  id: string,
  body: { id: string; name: string; nameZh: string; order: number },
): Promise<InspirationCategory> {
  const response = await apiFetch<{ category: InspirationCategory }>(
    `/api/inspirations/categories/${encodeURIComponent(id)}`,
    { method: "PUT", body },
  );
  return response.category;
}

export async function deleteInspirationCategory(id: string): Promise<void> {
  await apiFetch(`/api/inspirations/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * The default id for a case the admin is creating, derived from its title.
 *
 * The server's rule (lowercase, digits, dash, underscore) is applied here so the field opens with
 * something legal rather than with a name the save would reject. Only a suggestion — the editor
 * keeps it editable, and the server is what enforces the rule.
 */
export function defaultCaseId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
  return slug === "" ? "case" : slug;
}

/** Reads a picked file as bare base64 (no data-URL prefix) — what the route's `coverUpload` takes. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** The image extensions a cover may use — the same set the server accepts. */
export const COVER_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"] as const;

/** True when a picked file has an extension the cover route will accept. */
export function isCoverFilename(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return (COVER_EXTENSIONS as readonly string[]).includes(name.slice(dot).toLowerCase());
}

/** A case's kind, narrowed for the badge map the UI indexes by. */
export function kindOf(one: InspirationCase): InspirationKind {
  return one.kind;
}

/**
 * True when the viewer may act on this case: an admin, whatever the case's source.
 *
 * Built-ins used to be excluded here, on the grounds that a case compiled into the bundle is not
 * the admin's to change. That is half true and it blocks the obvious thing: the first thing an
 * admin wants of a built-in example is to change its prompt, because their users do not want the
 * example, they want their prompt. So a built-in is editable too — by **shadowing**, not by
 * rewriting: the editor writes an admin case under the same id, and the catalog merge already
 * drops a built-in whose id the server has. The original stays in the bundle, so removing the
 * shadow brings it back, and no upgrade can carry the change away.
 *
 * Deleting a built-in is the same operation for the same reason: it writes nothing, it deletes an
 * id the server does not hold, and the built-in it was shadowing is simply visible again. Neither
 * action touches `presets.ts`.
 */
export function isEditable(one: InspirationCase, canManage: boolean): boolean {
  return canManage;
}

/**
 * True when acting on this case writes a *new* file rather than editing one.
 *
 * The editor needs it to say what the save will do: overwriting an admin case is a plain edit,
 * while saving a built-in is a copy, and "Save" on a form whose result is a new file should not
 * be a surprise. The copy is also what carries the built-in's cover, since the bundle's image
 * bytes are not on the server to be re-uploaded.
 */
export function isShadowing(one: InspirationCase): boolean {
  return one.source === "builtin";
}
