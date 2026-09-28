/**
 * On-disk catalog IO: the round trip, the strict writes, the tolerant reads, and the two places
 * a name reaches the filesystem (a case id and a cover filename).
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  caseDir,
  caseManifestPath,
  categoriesDir,
  categoryPath,
  isAssetFilename,
  slugifyInspirationId,
} from "../src/paths.js";
import {
  coerceInspirationCaseInput,
  coerceInspirationCategory,
  deleteInspirationCase,
  deleteInspirationCategory,
  InspirationPackageError,
  readAdminCases,
  readAdminCategories,
  readInspirationCase,
  readInspirationCatalog,
  readInspirationPreview,
  resolveCaseAsset,
  seedInspirationCategories,
  sortCategories,
  writeInspirationCase,
  writeInspirationCategory,
  writeInspirationCover,
  writeInspirationPreview,
} from "../src/io.js";
import type { InspirationCaseInput } from "../src/schema.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jiumate-inspiration-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A minimal valid case, with `over` merged over it. */
function input(over: Partial<InspirationCaseInput> = {}): InspirationCaseInput {
  return {
    id: "sample",
    kind: "app",
    categoryId: "webapps",
    title: "Sample case",
    titleZh: "示例案例",
    description: "A case used by the tests.",
    descriptionZh: "测试用的案例。",
    prompt: "Build something small.",
    promptZh: "做一个小东西。",
    agentId: null,
    skills: [],
    tools: [],
    cover: { kind: "glyph", glyph: "✨" },
    previewFilename: null,
    featured: false,
    order: 0,
    enabled: true,
    ...over,
  };
}

describe("coerceInspirationCaseInput", () => {
  it("requires the declared id to match the directory it is read from", () => {
    expect(() => coerceInspirationCaseInput(input(), { expectedId: "other" })).toThrow(
      /sits in directory/,
    );
    expect(() => coerceInspirationCaseInput(input({ id: "sample" }), { expectedId: "sample" })).not
      .toThrow;
  });

  it("rejects ids that cannot be a directory name", () => {
    for (const id of ["", "Upper", "with space", "dot.dot", "../escape", "-leading"]) {
      expect(() => coerceInspirationCaseInput(input({ id })), id).toThrow(InspirationPackageError);
    }
  });

  it("fills a missing language side from the one that is present", () => {
    const only = coerceInspirationCaseInput(input({ titleZh: "", prompt: "" }));
    expect(only.titleZh).toBe("Sample case");
    expect(only.prompt).toBe("做一个小东西。");
  });

  it("leaves both sides empty when neither is written — an agent-only case has no prompt", () => {
    const empty = coerceInspirationCaseInput(input({ prompt: "", promptZh: "" }));
    expect(empty.prompt).toBe("");
    expect(empty.promptZh).toBe("");
  });

  it("rejects an unknown kind and an unknown cover kind", () => {
    expect(() => coerceInspirationCaseInput({ ...input(), kind: "movie" })).toThrow(/kind must be/);
    expect(() => coerceInspirationCaseInput({ ...input(), cover: { kind: "video" } })).toThrow(
      /cover.kind must be/,
    );
  });

  it("derives an image cover's MIME type from its extension rather than trusting the manifest", () => {
    const cover = coerceInspirationCaseInput({
      ...input(),
      cover: { kind: "image", filename: "shot.svg", mimeType: "image/png" },
    }).cover;
    expect(cover).toEqual({ kind: "image", filename: "shot.svg", mimeType: "image/svg+xml" });
  });

  it("refuses a cover filename that is not a single image path segment", () => {
    for (const filename of ["../shot.png", "sub/shot.png", ".hidden.png", "shot.exe", "shot"]) {
      expect(
        () => coerceInspirationCaseInput({ ...input(), cover: { kind: "image", filename } }),
        filename,
      ).toThrow(/cover.filename/);
    }
  });

  it("refuses a preview under any name but the fixed one", () => {
    expect(() => coerceInspirationCaseInput({ ...input(), preview: "other.html" })).toThrow(
      /preview must be/,
    );
    expect(
      coerceInspirationCaseInput({ ...input(), preview: "preview.html" }).previewFilename,
    ).toBe("preview.html");
  });

  // A case read off disk and written back must be unchanged: the manifest spells the preview
  // `preview`, the in-memory case spells it `previewFilename`, and coercion is the bridge.
  it("reads either spelling of the preview, so a round trip cannot drop it", () => {
    expect(
      coerceInspirationCaseInput({ ...input(), previewFilename: "preview.html" }).previewFilename,
    ).toBe("preview.html");
  });

  it("deduplicates and caps the referenced names", () => {
    const one = coerceInspirationCaseInput({
      ...input(),
      skills: ["web-design", "web-design", "  jiumate-sdk  "],
    });
    expect(one.skills).toEqual(["web-design", "jiumate-sdk"]);
    expect(() =>
      coerceInspirationCaseInput({
        ...input(),
        skills: Array.from({ length: 17 }, (_, i) => `skill-${i}`),
      }),
    ).toThrow(/at most 16/);
  });

  it("clamps order rather than refusing an out-of-range hint", () => {
    expect(coerceInspirationCaseInput({ ...input(), order: 1e9 }).order).toBe(10_000);
    expect(coerceInspirationCaseInput({ ...input(), order: -1e9 }).order).toBe(-10_000);
    expect(coerceInspirationCaseInput({ ...input(), order: 2.6 }).order).toBe(3);
  });
});

describe("case IO", () => {
  it("round-trips a case, including its cover and preview", async () => {
    await writeInspirationCase(root, input(), {
      createdBy: "admin",
      updatedAt: "2026-09-21T00:00:00Z",
    });
    await writeInspirationCover(root, "sample", "cover.png", new Uint8Array([1, 2, 3]));
    await writeInspirationPreview(root, "sample", "<html>hi</html>");
    const stored = await readInspirationCase(root, "sample");
    expect(stored?.title).toBe("Sample case");
    expect(stored?.source).toBe("admin");
    expect(stored?.createdBy).toBe("admin");
    expect(stored?.packagePath).toBe(caseDir(root, "sample"));

    const asset = resolveCaseAsset(root, "sample", "cover.png");
    expect(asset?.mimeType).toBe("image/png");
    expect(new Uint8Array(await readFile(asset!.path))).toEqual(new Uint8Array([1, 2, 3]));
    expect(await readInspirationPreview(root, "sample")).toBe("<html>hi</html>");
  });

  it("writes a manifest the reader can parse, and never a half-written one", async () => {
    await writeInspirationCase(root, input(), {
      createdBy: null,
      updatedAt: "2026-09-21T00:00:00Z",
    });
    const body = JSON.parse(await readFile(caseManifestPath(root, "sample"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(body["schema"]).toBe("jiumate.inspiration");
    expect(body["schemaVersion"]).toBe(1);
    expect(body["id"]).toBe("sample");
    // `preview` is the on-disk key; `previewFilename` is the in-memory one.
    expect(body["preview"]).toBeNull();
    expect(body["previewFilename"]).toBeUndefined();
  });

  it("drops the previous cover when a new one replaces it", async () => {
    await writeInspirationCase(root, input(), {
      createdBy: null,
      updatedAt: "2026-09-21T00:00:00Z",
    });
    await writeInspirationCover(root, "sample", "first.png", new Uint8Array([1]));
    await writeInspirationCover(root, "sample", "second.png", new Uint8Array([2]));
    expect(resolveCaseAsset(root, "sample", "first.png")).not.toBeNull();
    expect(await readFile(join(caseDir(root, "sample"), "first.png")).catch(() => null)).toBeNull();
  });

  it("drops every cover when the case goes back to a glyph", async () => {
    await writeInspirationCover(root, "sample", "cover.png", new Uint8Array([1]));
    await writeInspirationCase(root, input(), {
      createdBy: null,
      updatedAt: "2026-09-21T00:00:00Z",
    });
    expect(await readFile(join(caseDir(root, "sample"), "cover.png")).catch(() => null)).toBeNull();
  });

  it("refuses an empty or oversized cover image", async () => {
    await expect(
      writeInspirationCover(root, "sample", "cover.png", new Uint8Array(0)),
    ).rejects.toThrow(/empty/);
    await expect(
      writeInspirationCover(root, "sample", "cover.png", new Uint8Array(9 * 1024 * 1024)),
    ).rejects.toThrow(/at most/);
  });

  it("refuses an asset name that is not a legal image filename", async () => {
    await expect(
      writeInspirationCover(root, "sample", "../cover.png", new Uint8Array([1])),
    ).rejects.toThrow(/single image path segment/);
    expect(resolveCaseAsset(root, "sample", "../../etc/passwd")).toBeNull();
    expect(resolveCaseAsset(root, "..", "cover.png")).toBeNull();
  });

  it("refuses an oversized preview document", async () => {
    await expect(
      writeInspirationPreview(root, "sample", "x".repeat(1024 * 1024 + 1)),
    ).rejects.toThrow(/at most/);
  });

  it("removes a case's whole directory", async () => {
    await writeInspirationCase(root, input(), {
      createdBy: null,
      updatedAt: "2026-09-21T00:00:00Z",
    });
    await writeInspirationCover(root, "sample", "cover.png", new Uint8Array([1]));
    await deleteInspirationCase(root, "sample");
    expect(await readInspirationCase(root, "sample")).toBeNull();
    expect(await readFile(join(caseDir(root, "sample"), "cover.png")).catch(() => null)).toBeNull();
  });

  it("reads a missing catalog as empty rather than as an error", async () => {
    expect(await readAdminCases(root)).toEqual({ cases: [], diagnostics: [] });
    expect(await readAdminCategories(root)).toEqual({ categories: [], diagnostics: [] });
  });
});

describe("seedInspirationCategories", () => {
  it("writes the shipped categories into a library that has never had any", async () => {
    await seedInspirationCategories(root);
    const read = await readAdminCategories(root);
    // `readAdminCategories` returns directory order; `readInspirationCatalog` is what sorts.
    expect(read.categories.map((one) => one.id).sort()).toEqual(["agents", "schedules", "webapps"]);
    expect(sortCategories(read.categories).map((one) => one.id)).toEqual([
      "webapps",
      "agents",
      "schedules",
    ]);
    // Plain files, so an admin's editor can rewrite them like any other category.
    for (const one of read.categories) {
      expect(JSON.parse(await readFile(categoryPath(root, one.id), "utf8"))).toEqual(one);
    }
  });

  it("never overwrites a category an admin has changed", async () => {
    await seedInspirationCategories(root);
    await writeInspirationCategory(root, {
      id: "webapps",
      name: "Web things",
      nameZh: "网页那些事",
      order: 7,
    });
    await seedInspirationCategories(root);
    const read = await readAdminCategories(root);
    expect(read.categories.find((one) => one.id === "webapps")).toEqual({
      id: "webapps",
      name: "Web things",
      nameZh: "网页那些事",
      order: 7,
    });
  });

  // The rule is "the directory does not exist", not a marker file — which is what makes a delete
  // stick. A marker would also work and would be one more file to keep in step; the directory's own
  // existence is already the fact the seed cares about.
  it("does not bring back a category the admin deleted", async () => {
    await seedInspirationCategories(root);
    await deleteInspirationCategory(root, "webapps");
    await seedInspirationCategories(root);
    const read = await readAdminCategories(root);
    expect(read.categories.map((one) => one.id)).toEqual(["agents", "schedules"]);
  });

  it("does not repopulate a library whose categories were all deleted", async () => {
    await seedInspirationCategories(root);
    for (const id of ["webapps", "agents", "schedules"]) {
      await deleteInspirationCategory(root, id);
    }
    await seedInspirationCategories(root);
    expect(await readAdminCategories(root)).toEqual({ categories: [], diagnostics: [] });
  });
});

describe("category coercion", () => {
  it("fills a missing category name from the other language", () => {
    expect(coerceInspirationCategory({ id: "tools", nameZh: "工具" }).name).toBe("工具");
    expect(() => coerceInspirationCategory({ id: "tools", name: "", nameZh: "" })).toThrow(
      /must not be empty/,
    );
  });

  it("deletes a category file without touching the cases under it", async () => {
    await writeInspirationCategory(root, { id: "tools", name: "Tools", nameZh: "工具", order: 0 });
    await deleteInspirationCategory(root, "tools");
    expect(await readAdminCategories(root)).toEqual({ categories: [], diagnostics: [] });
  });
});

describe("catalog reads", () => {
  async function seed(): Promise<void> {
    for (const [id, order, name] of [
      ["b-second", 1, "Second"],
      ["a-first", 0, "First"],
    ] as const) {
      await writeInspirationCategory(root, { id, name, nameZh: name, order });
    }
    await writeInspirationCase(
      root,
      input({ id: "z-case", categoryId: "b-second", title: "Z", order: 0 }),
      { createdBy: null, updatedAt: "2026-09-21T00:00:00Z" },
    );
    await writeInspirationCase(
      root,
      input({ id: "a-case", categoryId: "b-second", title: "A", order: 1 }),
      { createdBy: null, updatedAt: "2026-09-21T00:00:00Z" },
    );
    await writeInspirationCase(
      root,
      input({ id: "m-case", categoryId: "a-first", title: "M", order: 5 }),
      { createdBy: null, updatedAt: "2026-09-21T00:00:00Z" },
    );
  }

  it("sorts categories by order and cases by category, then order, then title", async () => {
    await seed();
    const catalog = await readInspirationCatalog(root);
    expect(catalog.categories.map((one) => one.id)).toEqual(["a-first", "b-second"]);
    expect(catalog.cases.map((one) => one.id)).toEqual(["m-case", "z-case", "a-case"]);
    expect(catalog.diagnostics).toEqual([]);
  });

  it("skips one unreadable case with a diagnostic instead of failing the whole read", async () => {
    await seed();
    await mkdir(caseDir(root, "broken"), { recursive: true });
    await writeFile(caseManifestPath(root, "broken"), "{ not json", "utf8");
    const catalog = await readInspirationCatalog(root);
    expect(catalog.cases.map((one) => one.id)).toEqual(["m-case", "z-case", "a-case"]);
    expect(catalog.diagnostics.join(" ")).toContain("broken");
  });

  it("reports a case filed under a category that no longer exists, and still lists it", async () => {
    await writeInspirationCategory(root, { id: "kept", name: "Kept", nameZh: "保留", order: 0 });
    await writeInspirationCase(root, input({ id: "orphan", categoryId: "gone" }), {
      createdBy: null,
      updatedAt: "2026-09-21T00:00:00Z",
    });
    const catalog = await readInspirationCatalog(root);
    expect(catalog.cases.map((one) => one.id)).toEqual(["orphan"]);
    expect(catalog.diagnostics.join(" ")).toContain("unknown category");
  });

  it("ignores dotfiles and stray files in the cases directory", async () => {
    await seed();
    await mkdir(join(caseDir(root, ".hidden"), "nested"), { recursive: true });
    await writeFile(join(caseDir(root, "notes.txt")), "hello", "utf8");
    const catalog = await readInspirationCatalog(root);
    expect(catalog.cases.map((one) => one.id)).toEqual(["m-case", "z-case", "a-case"]);
    expect(catalog.diagnostics).toEqual([]);
  });
});

describe("category IO", () => {
  it("round-trips a category and refuses a file whose name disagrees with its id", async () => {
    await writeInspirationCategory(root, { id: "tools", name: "Tools", nameZh: "工具", order: 3 });
    await mkdir(categoriesDir(root), { recursive: true });
    await writeFile(
      categoryPath(root, "sneaky"),
      JSON.stringify({ id: "other", name: "X", nameZh: "X" }),
      "utf8",
    );
    const read = await readAdminCategories(root);
    expect(read.categories.map((one) => one.id)).toEqual(["tools"]);
    expect(read.diagnostics.join(" ")).toContain("sneaky");
  });
});

describe("slugifyInspirationId", () => {
  it("folds a human-typed name into a directory-safe slug", () => {
    expect(slugifyInspirationId("My Best Case!")).toBe("my-best-case");
    expect(slugifyInspirationId("  --weird--  ")).toBe("weird");
    expect(slugifyInspirationId("已存在的名字")).toBe("case");
    expect(slugifyInspirationId(null)).toBe("case");
    expect(slugifyInspirationId("a".repeat(200)).length).toBe(200);
  });
});

describe("isAssetFilename", () => {
  it("accepts a plain image name and nothing that could climb out", () => {
    expect(isAssetFilename("cover.png")).toBe(true);
    expect(isAssetFilename("my shot-2.WEBP")).toBe(true);
    expect(isAssetFilename("cover.txt")).toBe(false);
    expect(isAssetFilename("cover")).toBe(false);
    expect(isAssetFilename(".png")).toBe(false);
    expect(isAssetFilename("a/b.png")).toBe(false);
    expect(isAssetFilename("a\\b.png")).toBe(false);
    expect(isAssetFilename("co:ver.png")).toBe(false);
  });
});
