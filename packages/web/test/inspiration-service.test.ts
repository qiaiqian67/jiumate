/**
 * The inspiration library's client-side decisions, all of them pure: what the merge produces, what
 * a tab and the search box show, which language a case reads in, and how the editor turns a draft
 * into a request.
 *
 * These are the parts the React layer only wires up, so they are the parts worth pinning: the
 * gallery's behaviour is `visibleCases` plus a grid, and a regression in it would otherwise only be
 * visible by clicking around.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { builtinInspirationCatalog } from "@jiumate/inspirations/presets";
import { TITLE_LIMIT as PACKAGE_TITLE_LIMIT } from "@jiumate/inspirations/schema";
import { S } from "../src/lib/strings";
import type { InspirationCase, InspirationCategory } from "@jiumate/inspirations";
import {
  builtinCatalogView,
  categoryLabel,
  coverUrl,
  defaultCaseId,
  inFilter,
  isCoverFilename,
  localizedCase,
  matchesQuery,
  mergeCatalog,
  previewUrl,
  visibleCases,
} from "../src/features/inspiration/inspiration-service";
import {
  caseDraftOf,
  caseDraftError,
  caseSaveBody,
  capturedCaseDraft,
  emptyCaseDraft,
  parseOrder,
  TITLE_LIMIT,
} from "../src/features/inspiration/inspiration-editor";
import {
  categoryDraftError,
  categoryIdFromName,
} from "../src/features/inspiration/inspiration-categories";
import {
  FAVORITE_MAX,
  normalizeFavorites,
  toggledFavorites,
} from "../src/features/inspiration/inspiration-favorites";

const builtins = builtinInspirationCatalog();

/** A minimal authored case, with `over` merged over it. */
function authored(over: Partial<InspirationCase> = {}): InspirationCase {
  return {
    id: "my-case",
    source: "admin",
    kind: "app",
    categoryId: "webapps",
    title: "My case",
    titleZh: "我的案例",
    description: "Something to start from.",
    descriptionZh: "一个起点。",
    prompt: "Build it.",
    promptZh: "把它做出来。",
    agentId: null,
    skills: ["web-design"],
    tools: [],
    cover: { kind: "glyph", glyph: "🧭" },
    previewFilename: null,
    featured: false,
    order: 0,
    enabled: true,
    packagePath: "/tmp/inspirations/cases/my-case",
    createdAt: null,
    updatedAt: null,
    createdBy: "admin",
    ...over,
  };
}

const category = (id: string, over: Partial<InspirationCategory> = {}): InspirationCategory => ({
  id,
  name: id,
  nameZh: id,
  order: 0,
  ...over,
});

describe("the built-in view", () => {
  it("carries the shipped cases and no management rights", () => {
    const view = builtinCatalogView();
    expect(view.cases).toEqual(builtins.cases);
    expect(view.canManage).toBe(false);
    expect(view.diagnostics).toEqual([]);
  });
});

describe("mergeCatalog", () => {
  it("puts the bundled built-ins in front of the server's answer", () => {
    const merged = mergeCatalog({
      categories: [category("internal")],
      cases: [authored()],
      diagnostics: [],
      canManage: true,
    });
    expect(merged.categories.map((one) => one.id)).toEqual([
      ...builtins.categories.map((one) => one.id),
      "internal",
    ]);
    expect(merged.cases.at(-1)?.id).toBe("my-case");
    expect(merged.canManage).toBe(true);
  });

  // The server refuses to shadow a built-in, so this can only happen if a future build changes
  // that rule — and the merge is what keeps the two halves from rendering the same id twice.
  it("lets the server's copy win when an id appears in both halves", () => {
    const shadowed = authored({ id: "game", title: "Not the built-in" });
    const merged = mergeCatalog({
      categories: [],
      cases: [shadowed],
      diagnostics: [],
      canManage: false,
    });
    const games = merged.cases.filter((one) => one.id === "game");
    expect(games).toHaveLength(1);
    expect(games[0]?.title).toBe("Not the built-in");
  });

  it("keeps the server's diagnostics", () => {
    const merged = mergeCatalog({
      categories: [],
      cases: [],
      diagnostics: ['skipped case "broken": not valid JSON'],
      canManage: true,
    });
    expect(merged.diagnostics).toHaveLength(1);
  });
});

describe("localizedCase", () => {
  it("reads the active language", () => {
    const one = authored();
    expect(localizedCase("zh", one).title).toBe("我的案例");
    expect(localizedCase("en", one).title).toBe("My case");
    expect(localizedCase("zh", one).prompt).toBe("把它做出来。");
  });

  // Coercion fills the missing side from the side that is present, so a one-language case reads as
  // that language in both UIs rather than as an empty card.
  it("falls back to the other language rather than to nothing", () => {
    const one = authored({ titleZh: "My case", descriptionZh: "Something to start from." });
    expect(localizedCase("zh", one).title).toBe("My case");
    expect(localizedCase("zh", one).description).toBe("Something to start from.");
  });
});

describe("coverUrl and previewUrl", () => {
  it("builds an asset URL only for an image cover", () => {
    expect(coverUrl(authored())).toBeNull();
    expect(
      coverUrl(authored({ cover: { kind: "image", filename: "shot.png", mimeType: "image/png" } })),
    ).toBe("/api/inspirations/my-case/asset/shot.png");
  });

  it("encodes the id, so a slug cannot break out of the path", () => {
    expect(previewUrl("a b")).toBe("/api/inspirations/a%20b/preview");
  });
});

describe("categoryLabel", () => {
  it("names the category in the active language", () => {
    const view = {
      categories: [category("internal", { name: "Internal", nameZh: "内部" })],
      cases: [],
      diagnostics: [],
      canManage: false,
    };
    expect(categoryLabel(view, "zh", authored({ categoryId: "internal" }))).toBe("内部");
    expect(categoryLabel(view, "en", authored({ categoryId: "internal" }))).toBe("Internal");
  });

  // A hand-edited manifest can name a category nobody has; the card still has to say something.
  it("falls back to the id when the category is gone", () => {
    const view = { categories: [], cases: [], diagnostics: [], canManage: false };
    expect(categoryLabel(view, "zh", authored({ categoryId: "gone" }))).toBe("gone");
  });
});

describe("matchesQuery", () => {
  const one = authored({ skills: ["web-design"], tools: ["gh"] });

  it("matches everything on an empty query", () => {
    expect(matchesQuery(one, "")).toBe(true);
    expect(matchesQuery(one, "   ")).toBe(true);
  });

  it("matches either language of the copy", () => {
    expect(matchesQuery(one, "我的")).toBe(true);
    expect(matchesQuery(one, "my case")).toBe(true);
  });

  it("matches the machine names a user might remember instead of the title", () => {
    expect(matchesQuery(one, "web-design")).toBe(true);
    expect(matchesQuery(one, "gh")).toBe(true);
    expect(matchesQuery(one, "my-case")).toBe(true);
  });

  it("requires every whitespace-separated term, in any order", () => {
    expect(matchesQuery(one, "design web")).toBe(true);
    expect(matchesQuery(one, "web missing")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesQuery(one, "MY CASE")).toBe(true);
  });
});

describe("inFilter", () => {
  it("reads each tab", () => {
    const one = authored({ featured: true });
    expect(inFilter(one, { kind: "all" }, [])).toBe(true);
    expect(inFilter(one, { kind: "featured" }, [])).toBe(true);
    expect(inFilter(one, { kind: "favorites" }, ["my-case"])).toBe(true);
    expect(inFilter(one, { kind: "favorites" }, [])).toBe(false);
    expect(inFilter(one, { kind: "category", categoryId: "webapps" }, [])).toBe(true);
    expect(inFilter(one, { kind: "category", categoryId: "agents" }, [])).toBe(false);
  });
});

describe("visibleCases", () => {
  const catalog = {
    categories: [category("webapps"), category("agents", { order: 1 })],
    cases: [
      authored({ id: "a", title: "A", categoryId: "webapps" }),
      authored({ id: "b", title: "B", categoryId: "agents", featured: true }),
      authored({ id: "c", title: "C", categoryId: "agents" }),
    ],
    diagnostics: [],
    canManage: false,
  };

  it("keeps the catalog's own order", () => {
    expect(visibleCases(catalog, { kind: "all" }, "", []).map((one) => one.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("filters by tab and then by search", () => {
    expect(
      visibleCases(catalog, { kind: "category", categoryId: "agents" }, "", []).map(
        (one) => one.id,
      ),
    ).toEqual(["b", "c"]);
    expect(visibleCases(catalog, { kind: "all" }, "c", []).map((one) => one.id)).toEqual(["c"]);
    expect(visibleCases(catalog, { kind: "featured" }, "", []).map((one) => one.id)).toEqual(["b"]);
  });

  // The favourites list is the user's own arrangement; re-sorting it by category would be the app
  // overruling it.
  it("returns favourites in the order they were starred", () => {
    const ids = visibleCases(catalog, { kind: "favorites" }, "", ["c", "a"]).map((one) => one.id);
    expect(ids).toEqual(["c", "a"]);
  });

  it("shows nothing for a favourite that no longer matches a case", () => {
    expect(visibleCases(catalog, { kind: "favorites" }, "", ["deleted-last-week"])).toEqual([]);
  });
});

describe("editor drafts", () => {
  it("opens a new draft on a glyph cover and the given category", () => {
    const draft = emptyCaseDraft("agents");
    expect(draft.categoryId).toBe("agents");
    expect(draft.coverKind).toBe("glyph");
    expect(draft.enabled).toBe(true);
    expect(draft.featured).toBe(false);
  });

  it("carries an existing case's values, including its cover filename", () => {
    const draft = caseDraftOf(
      authored({
        cover: { kind: "image", filename: "shot.webp", mimeType: "image/webp" },
        previewFilename: "preview.html",
        skills: ["web-design", "memory"],
        agentId: "researcher",
        order: 4,
      }),
    );
    expect(draft.id).toBe("my-case");
    expect(draft.coverKind).toBe("image");
    expect(draft.coverFilename).toBe("shot.webp");
    expect(draft.hasPreview).toBe(true);
    expect(draft.skills).toEqual(["web-design", "memory"]);
    expect(draft.agentId).toBe("researcher");
    expect(draft.order).toBe("4");
  });

  it("refuses a draft with no name in either language, and one with no id", () => {
    expect(caseDraftError(emptyCaseDraft("webapps"))).toBe("titleRequired");
    const named = { ...emptyCaseDraft("webapps"), titleZh: "有名字" };
    expect(caseDraftError(named)).toBe("idRequired");
    expect(caseDraftError({ ...named, id: "named" })).toBeNull();
  });

  it("accepts a name in either language alone", () => {
    const zh = { ...emptyCaseDraft("webapps"), id: "one", titleZh: "中文名" };
    const en = { ...emptyCaseDraft("webapps"), id: "two", title: "English name" };
    expect(caseDraftError(zh)).toBeNull();
    expect(caseDraftError(en)).toBeNull();
  });

  it("refuses a preview over the cap", () => {
    const draft = {
      ...emptyCaseDraft("webapps"),
      id: "big",
      title: "Big",
      previewHtml: "x".repeat(1024 * 1024 + 1),
    };
    expect(caseDraftError(draft)).toBe("previewTooLarge");
  });

  it("builds the request body: trimmed, with the picked lists as arrays and a null agent for none", () => {
    const body = caseSaveBody({
      ...emptyCaseDraft("webapps"),
      id: "  spaced  ",
      titleZh: "名字",
      agentId: "  ",
      skills: ["web-design", "memory"],
      tools: ["gh"],
      order: "12",
    });
    expect(body["id"]).toBe("spaced");
    expect(body["agentId"]).toBeNull();
    expect(body["skills"]).toEqual(["web-design", "memory"]);
    expect(body["tools"]).toEqual(["gh"]);
    expect(body["order"]).toBe(12);
    expect(body["cover"]).toEqual({ kind: "glyph", glyph: "✨" });
  });

  it("sends the uploaded bytes when there are any, and the existing filename when there are none", () => {
    const uploaded = caseSaveBody({
      ...emptyCaseDraft("webapps"),
      id: "x",
      title: "X",
      coverKind: "image",
      coverFile: { filename: "new.png", dataBase64: "AAAA", objectUrl: "blob:1" },
    });
    expect(uploaded["cover"]).toEqual({ kind: "image", filename: "new.png" });
    expect(uploaded["coverUpload"]).toEqual({ filename: "new.png", dataBase64: "AAAA" });

    const kept = caseSaveBody({
      ...emptyCaseDraft("webapps"),
      id: "x",
      title: "X",
      coverKind: "image",
      coverFilename: "old.png",
    });
    expect(kept["cover"]).toEqual({ kind: "image", filename: "old.png" });
    expect(kept["coverUpload"]).toBeUndefined();
  });

  // Three intents on one key: absent keeps the preview, a string writes one, null removes it. A
  // body cannot express "remove" by omission, which is why the editor has to send the key — and
  // why it loads the existing document into the textarea rather than opening it empty (an
  // untouched save must write back what is there, not delete it).
  it("distinguishes keeping, writing and removing a preview", () => {
    const base = { ...emptyCaseDraft("webapps"), id: "x", title: "X" };
    // No preview on disk and nothing typed: there is nothing to say about the preview at all.
    expect("previewHtml" in caseSaveBody(base)).toBe(false);
    // A document on disk is loaded into the field, so an untouched save writes it back verbatim.
    expect(
      caseSaveBody({ ...base, hasPreview: true, previewHtml: "<html></html>" })["previewHtml"],
    ).toBe("<html></html>");
    // Clearing the field is how a preview is removed, and the key says so.
    expect(
      caseSaveBody({ ...base, hasPreview: true, previewHtml: "  " })["previewHtml"],
    ).toBeNull();
    // Typing one into a case that had none writes it.
    expect(caseSaveBody({ ...base, previewHtml: "<html>new</html>" })["previewHtml"]).toBe(
      "<html>new</html>",
    );
  });

  it("parses an order leniently", () => {
    expect(parseOrder("7")).toBe(7);
    expect(parseOrder("nonsense")).toBe(0);
    expect(parseOrder("")).toBe(0);
  });

  it("keeps the form's title cap in step with the package's", () => {
    // Duplicated on purpose (the server enforces, this drives the counter); this is the check that
    // the two copies have not drifted.
    expect(TITLE_LIMIT).toBe(PACKAGE_TITLE_LIMIT);
  });
});

describe("capturing a Session", () => {
  it("seeds both language fields with the conversation's own text", () => {
    // Which language a conversation was held in is not something the app knows, so the text goes
    // into both sides: the case reads the same in either UI, and the admin translates one side.
    const draft = capturedCaseDraft("webapps", {
      title: "Penguin sled",
      prompt: "Build a penguin sled game.",
      agentId: "default",
    });
    expect(draft.title).toBe("Penguin sled");
    expect(draft.titleZh).toBe("Penguin sled");
    expect(draft.prompt).toBe("Build a penguin sled game.");
    expect(draft.promptZh).toBe("Build a penguin sled game.");
    expect(draft.agentId).toBe("default");
    expect(draft.id).toBe("penguin-sled");
    expect(caseDraftError(draft)).toBeNull();
  });

  it("carries no skills: a run's used skills are not what a case needs", () => {
    expect(capturedCaseDraft("webapps", { title: "T", prompt: "P", agentId: null }).skills).toEqual(
      [],
    );
  });

  it("survives a session that has no title yet", () => {
    const draft = capturedCaseDraft("webapps", { title: null, prompt: "P", agentId: null });
    expect(draft.title).toBe("");
    expect(draft.agentId).toBe("");
    // The name is what the editor then requires, which is the right thing to ask for.
    expect(caseDraftError(draft)).toBe("titleRequired");
  });
});

describe("category drafts", () => {
  it("needs a name in at least one language", () => {
    expect(categoryDraftError({ id: "x", name: "", nameZh: "", order: "0" })).toBe("nameRequired");
    expect(categoryDraftError({ id: "x", name: "", nameZh: "内部", order: "0" })).toBeNull();
  });

  it("needs an id", () => {
    expect(categoryDraftError({ id: " ", name: "Internal", nameZh: "", order: "0" })).toBe(
      "idRequired",
    );
  });

  // A create derives its id from the name as the admin types, so the dialog must not read "is this
  // an edit?" off the id — that flipped a create into an update the moment a name was entered, and
  // the save then PUT a category that did not exist yet (a 404 the admin could do nothing about).
  it("derives a new category's id from its name", () => {
    expect(categoryIdFromName("Internal tools")).toBe("internal-tools");
    expect(categoryIdFromName("Data & Analysis!")).toBe("data-analysis");
    expect(categoryIdFromName("A".repeat(200))).toHaveLength(64);
    // A CJK name folds to nothing, which the id field then asks about rather than inventing a word.
    expect(categoryIdFromName("内部工具")).toBe("");
    expect(
      categoryDraftError({
        id: categoryIdFromName("内部工具"),
        nameZh: "内部工具",
        name: "",
        order: "0",
      }),
    ).toBe("idRequired");
  });

  it("tells the category's id rule apart from the case's", () => {
    // A case's id is its directory name; a category's is a file name. Reusing one hint for both
    // described the wrong artifact on whichever field was not the one it was written for.
    expect(S.inspiration.categoryIdHint).not.toBe(S.inspiration.fieldIdHint);
  });
});

describe("the editor's pickers", () => {
  // The three fields the admin used to type into are lists now: the Agent is a pick over the
  // project's Agents (what is stored is the id), and skills and tools are multi-selects.
  it("stores the picked agent's id and nothing else", () => {
    const body = caseSaveBody({
      ...emptyCaseDraft("webapps"),
      id: "x",
      title: "X",
      agentId: "researcher",
    });
    expect(body["agentId"]).toBe("researcher");
  });

  it("treats a whitespace-only agent as none", () => {
    const body = caseSaveBody({
      ...emptyCaseDraft("webapps"),
      id: "x",
      title: "X",
      agentId: "   ",
    });
    expect(body["agentId"]).toBeNull();
  });

  it("sends the picked skills and tools as arrays, in the order they were picked", () => {
    const body = caseSaveBody({
      ...emptyCaseDraft("webapps"),
      id: "x",
      title: "X",
      skills: ["memory", "web-design"],
      tools: ["gh", "fetch"],
    });
    expect(body["skills"]).toEqual(["memory", "web-design"]);
    expect(body["tools"]).toEqual(["gh", "fetch"]);
  });

  // The catalog no longer records where a category came from — the three the product ships are seed
  // data and the admin owns them — so nothing in the DTO can gate an edit affordance on it.
  it("keeps no provenance on a category", () => {
    expect(Object.keys(category("webapps")).sort()).toEqual(["id", "name", "nameZh", "order"]);
  });
});

describe("favourites", () => {
  it("normalizes a stored list: drops junk, de-duplicates, caps", () => {
    expect(normalizeFavorites(["game", "game", "  rag  ", 1, null, "Not A Slug"])).toEqual([
      "game",
      "rag",
    ]);
    expect(normalizeFavorites("game")).toEqual([]);
    expect(normalizeFavorites(undefined)).toEqual([]);
    expect(normalizeFavorites(Array.from({ length: 300 }, (_, i) => `case-${i}`))).toHaveLength(
      FAVORITE_MAX,
    );
  });

  it("appends a new star and removes an existing one", () => {
    expect(toggledFavorites(["a"], "b")).toEqual(["a", "b"]);
    expect(toggledFavorites(["a", "b"], "a")).toEqual(["b"]);
  });

  it("refuses to grow past the cap", () => {
    const full = Array.from({ length: FAVORITE_MAX }, (_, i) => `case-${i}`);
    expect(toggledFavorites(full, "one-more")).toHaveLength(FAVORITE_MAX);
    // …but un-starring always works, or a full list would be a trap.
    expect(toggledFavorites(full, "case-0")).toHaveLength(FAVORITE_MAX - 1);
  });

  it("keeps the Web App's cap in step with the server's", () => {
    // Two copies on purpose, and jiumate-server is a type-only dependency here — so the check
    // reads the server module as text rather than importing it.
    const source = readFileSync(
      fileURLToPath(new URL("../../server/src/services/inspiration-favorites.ts", import.meta.url)),
      "utf8",
    );
    const match = /export const INSPIRATION_FAVORITE_MAX = (\d+);/.exec(source);
    expect(match, "the server's cap").not.toBeNull();
    expect(FAVORITE_MAX).toBe(Number(match?.[1]));
  });
});

describe("cover filenames", () => {
  it("accepts the image extensions the server accepts", () => {
    expect(isCoverFilename("shot.png")).toBe(true);
    expect(isCoverFilename("SHOT.WEBP")).toBe(true);
    expect(isCoverFilename("shot.svg")).toBe(true);
    expect(isCoverFilename("shot.txt")).toBe(false);
    expect(isCoverFilename("shot")).toBe(false);
  });
});

describe("defaultCaseId", () => {
  it("folds a title into something the server will accept", () => {
    expect(defaultCaseId("My Best Case!")).toBe("my-best-case");
    expect(defaultCaseId("   ")).toBe("case");
    expect(defaultCaseId("已存在")).toBe("case");
    expect(defaultCaseId("A".repeat(200)).length).toBeLessThanOrEqual(64);
  });
});
