/**
 * The inspiration library's data model.
 *
 * A **case** is one starter the user can invoke: a prompt to fill the composer with, plus what
 * that prompt is meant to run against — a suggested Agent, a set of skills to preselect, the
 * tools it expects to have, and optionally a preview document showing what it produces. A case
 * is deliberately not a copy of an Agent or a Skill: those are per-Project objects this library
 * only *names*, and a name that does not resolve in the Project the user is in degrades to the
 * current Agent (see the web app's `inspiration-fill.ts`) rather than failing the invocation.
 *
 * A **category** is a label and an order. The built-in ones mirror the three folders the draft
 * screen used to hard-code; an admin adds their own beside them.
 *
 * ## Two sources, one list
 *
 * `source` says where a case came from: `builtin` cases ship inside this package and cannot be
 * edited or deleted (the same rule the built-in themes follow — they are the product's own
 * showcase, and the catalog merges an on-disk case over a built-in only by id, which no admin
 * action can produce for a built-in). `admin` cases live in the data root and are fully
 * editable.
 *
 * ## Two languages, three pairs of fields
 *
 * Every user-visible string is a pair: `title` / `titleZh`, `description` / `descriptionZh`,
 * `prompt` / `promptZh`. This is the flat two-field convention the rest of the app already uses
 * for bilingual data (plugins' `description` / `description_zh`, skills' `short_description_zh`),
 * and it is what `localizedText(locale, en, zh)` consumes directly. Coercion fills a missing side
 * from the side that is present, so a case authored in one language reads as that language in
 * both UIs rather than as an empty card.
 */
import { INSPIRATION_ID_LIMIT, INSPIRATION_SLUG_REGEX } from "./constants.js";

/** What a case is *about* — the badge on its card. */
export type InspirationKind = "app" | "agent" | "skill" | "tool" | "prompt";

/** Where a case came from. Built-ins ship in this package; admin cases live in the data root. */
export type InspirationSource = "builtin" | "admin";

/**
 * How a case draws its card thumbnail: a character glyph, or an image beside the manifest.
 *
 * The glyph is the zero-asset default (the built-in examples all use one), and the image is what
 * an admin uploading a screenshot gets. The union is discriminated rather than "glyph or
 * filename, whichever is set" so that a case with both cannot render differently in two places.
 */
export type InspirationCover =
  { kind: "glyph"; glyph: string } | { kind: "image"; filename: string; mimeType: string };

/**
 * The writable half of a case — everything an editor produces.
 *
 * The server's create/update routes validate against this shape, and `source`, the timestamps
 * and the resolved directory are the server's to fill rather than the client's to claim.
 */
export interface InspirationCaseInput {
  /** Slug; also the directory name. Lowercase, digits, dash, underscore. */
  id: string;
  kind: InspirationKind;
  /** The category this case is filed under. Must name a category in the same catalog. */
  categoryId: string;
  title: string;
  titleZh: string;
  description: string;
  descriptionZh: string;
  /** The text the click fills the composer with. Empty is legal — an Agent-only case has none. */
  prompt: string;
  promptZh: string;
  /** Suggested Agent id, or null to run on whatever Agent is selected. */
  agentId: string | null;
  /** Skill names to preselect, when the Agent has them installed. */
  skills: string[];
  /** Tool / MCP-server names the case expects to have. Shown, never auto-installed. */
  tools: string[];
  cover: InspirationCover;
  /** Filename of the preview document beside the manifest, or null. Always `preview.html`. */
  previewFilename: string | null;
  /** Shown under the gallery's "Featured" tab. */
  featured: boolean;
  /** Sort key within the category; ties fall back to the title. */
  order: number;
  /** Hidden from every list when false, without deleting the case. */
  enabled: boolean;
}

/** A case as the catalog holds it: the writable half plus what the host resolved. */
export interface InspirationCase extends InspirationCaseInput {
  source: InspirationSource;
  /**
   * Absolute on-disk directory, or null for a built-in case — a built-in has no directory of
   * its own, which is also why its cover is always a glyph: there is nowhere to read an image
   * from. The asset route only ever serves an admin case.
   */
  packagePath: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Admin userId that last wrote it, or null for a built-in. */
  createdBy: string | null;
}

/**
 * A category as the catalog holds it.
 *
 * There is no built-in/admin split here, and no `source`: a category is a label and an order, and
 * every one of them is the admin's. The three the product ships are **seed data** — written to the
 * library on first boot and ordinary files from then on — so an admin can rename, reorder or delete
 * any of them (see `seedInspirationCategories` in io.ts). What they cannot do is delete one that
 * still has cases filed under it; the server refuses that, which is also what keeps the built-in
 * cases from being orphaned.
 *
 * `order` is a sort key within the tab strip; ties fall back to the name.
 */
export interface InspirationCategory {
  id: string;
  name: string;
  nameZh: string;
  order: number;
}

/** A whole catalog read: the categories to draw tabs from and the cases to file under them. */
export interface InspirationCatalog {
  categories: InspirationCategory[];
  cases: InspirationCase[];
  /** Non-fatal problems found while reading (an unreadable case directory, a bad manifest). */
  diagnostics: string[];
}

/** True for a string that can be a case or category id (and therefore a path segment). */
export function isInspirationSlug(value: string): boolean {
  return (
    value.length > 0 && value.length <= INSPIRATION_ID_LIMIT && INSPIRATION_SLUG_REGEX.test(value)
  );
}

/**
 * The bounds this module's types are shaped by, re-exported here so that `./schema` is a
 * self-contained **Node-free** entry: the web app normalizes a stored favourites list against
 * `INSPIRATION_ID_LIMIT` and `isInspirationSlug`, and it must not reach the barrel (which pulls in
 * `io.ts` and its `node:fs`). `./presets` is the other Node-free entry, and the web bundle's
 * `node-free-imports` test enforces which of the three a browser-safe import may use.
 */
export {
  CASE_KINDS,
  COVER_KINDS,
  DESCRIPTION_LIMIT,
  GLYPH_LIMIT,
  INSPIRATION_ID_LIMIT,
  INSPIRATION_SLUG_REGEX,
  MAX_SKILLS,
  MAX_TOOLS,
  PREVIEW_LIMIT,
  PROMPT_LIMIT,
  REF_NAME_LIMIT,
  TITLE_LIMIT,
} from "./constants.js";
