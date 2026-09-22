/**
 * Integration tests for the inspiration library surface:
 *   - GET    /api/inspirations                 (built-ins only, then built-ins + an authored case)
 *   - POST   /api/inspirations/cases           (create, cover upload, preview, conflicts)
 *   - PUT    /api/inspirations/cases/:id       (replace, preview preservation, id agreement)
 *   - DELETE /api/inspirations/cases/:id       (removes the case and its assets)
 *   - POST|PUT|DELETE /api/inspirations/categories
 *   - GET    /api/inspirations/:id/preview     (the document, and nothing for a case without one)
 *   - GET    /api/inspirations/:id/asset/:name (the cover, and nothing else)
 *   - PUT    /api/me/prefs                     (inspirationFavorites, bounds enforced)
 *
 * The manifest/coercion rules themselves live in `@prismshadow/linsight-inspirations` and are
 * covered by its own unit suite; these tests pin the HTTP contract and the merge on top — in
 * particular that the built-in half cannot be written to, and that a non-admin cannot write at all.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import type { InspirationCatalogResponse } from "../src/api/types.js";

let app: TestApp;
let admin: { cookie: string };
let member: { cookie: string };

beforeEach(async () => {
  app = await createTestApp();
  admin = await loginAdmin(app.app);
  member = await provisionUser(app.app, "reader");
});

afterEach(async () => {
  await app.cleanup();
});

/** A minimal valid case body; `over` is merged over it. */
function caseBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "my-case",
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
    featured: false,
    order: 0,
    enabled: true,
    ...over,
  };
}

async function catalog(cookie: string): Promise<InspirationCatalogResponse> {
  const res = await apiClient(app.app, cookie).get("/api/inspirations");
  expect(res.status).toBe(200);
  return (await res.json()) as InspirationCatalogResponse;
}

describe("GET /api/inspirations", () => {
  it("serves the built-in catalog with no library directory on disk", async () => {
    const body = await catalog(member.cookie);
    expect(body.cases.length).toBeGreaterThan(0);
    expect(body.categories.map((one) => one.id)).toEqual(["webapps", "agents", "schedules"]);
    expect(body.cases.every((one) => one.source === "builtin")).toBe(true);
    expect(body.cases.every((one) => one.packagePath === null)).toBe(true);
    expect(body.diagnostics).toEqual([]);
    expect(body.canManage).toBe(false);
  });

  it("tells an admin they may manage, and a member that they may not", async () => {
    expect((await catalog(admin.cookie)).canManage).toBe(true);
  });

  it("merges an authored case in after the built-ins, sorted by its category", async () => {
    const created = await apiClient(app.app, admin.cookie).post(
      "/api/inspirations/cases",
      caseBody({ id: "scheduled-standup", categoryId: "schedules" }),
    );
    expect(created.status).toBe(201);
    const body = await catalog(member.cookie);
    const ids = body.cases.map((one) => one.id);
    expect(ids).toContain("scheduled-standup");
    expect(body.cases.find((one) => one.id === "scheduled-standup")?.source).toBe("admin");
    // Category order first: the schedules cases are the last run in the list.
    expect(ids.indexOf("scheduled-standup")).toBeGreaterThan(ids.indexOf("game"));
  });

  it("hides a disabled case from a member but keeps it for an admin", async () => {
    await apiClient(app.app, admin.cookie).post(
      "/api/inspirations/cases",
      caseBody({ id: "parked", enabled: false }),
    );
    expect((await catalog(member.cookie)).cases.map((one) => one.id)).not.toContain("parked");
    expect((await catalog(admin.cookie)).cases.map((one) => one.id)).toContain("parked");
  });
});

describe("case writes", () => {
  it("refuses a non-admin with the admin-user 403 shape", async () => {
    const client = apiClient(app.app, member.cookie);
    for (const res of [
      await client.post("/api/inspirations/cases", caseBody()),
      await client.put("/api/inspirations/cases/my-case", caseBody()),
      await client.delete("/api/inspirations/cases/my-case"),
      await client.post("/api/inspirations/categories", {
        id: "mine",
        name: "Mine",
        nameZh: "我的",
      }),
    ]) {
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("admin_required");
    }
  });

  it("round-trips a case, then replaces it in place", async () => {
    const client = apiClient(app.app, admin.cookie);
    expect((await client.post("/api/inspirations/cases", caseBody())).status).toBe(201);
    const updated = await client.put(
      "/api/inspirations/cases/my-case",
      caseBody({ title: "Renamed", order: 7 }),
    );
    expect(updated.status).toBe(200);
    const body = await catalog(admin.cookie);
    const stored = body.cases.find((one) => one.id === "my-case");
    expect(stored?.title).toBe("Renamed");
    expect(stored?.order).toBe(7);
    expect(stored?.createdBy).toBe("admin");
    expect(stored?.createdAt).not.toBeNull();
  });

  it("refuses a create whose id is already taken, and one that shadows a built-in", async () => {
    const client = apiClient(app.app, admin.cookie);
    await client.post("/api/inspirations/cases", caseBody());
    const duplicate = await client.post("/api/inspirations/cases", caseBody());
    expect(duplicate.status).toBe(409);
    const shadow = await client.post(
      "/api/inspirations/cases",
      caseBody({ id: "game", title: "Not the built-in" }),
    );
    expect(shadow.status).toBe(409);
  });

  it("refuses a body whose id disagrees with the path", async () => {
    const res = await apiClient(app.app, admin.cookie).put(
      "/api/inspirations/cases/other-id",
      caseBody(),
    );
    expect(res.status).toBe(400);
  });

  it("refuses a case filed under a category that does not exist", async () => {
    const res = await apiClient(app.app, admin.cookie).post(
      "/api/inspirations/cases",
      caseBody({ categoryId: "nowhere" }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      "nowhere",
    );
  });

  it("refuses an unknown kind and an oversized field", async () => {
    const client = apiClient(app.app, admin.cookie);
    expect((await client.post("/api/inspirations/cases", caseBody({ kind: "movie" }))).status).toBe(
      400,
    );
    expect(
      (await client.post("/api/inspirations/cases", caseBody({ title: "x".repeat(200) }))).status,
    ).toBe(400);
  });

  it("stores an uploaded cover and serves it back with its own MIME type", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const res = await apiClient(app.app, admin.cookie).post(
      "/api/inspirations/cases",
      caseBody({
        cover: { kind: "glyph", glyph: "🧭" },
        coverUpload: { filename: "shot.png", dataBase64: bytes.toString("base64") },
      }),
    );
    expect(res.status).toBe(201);
    const stored = (await catalog(admin.cookie)).cases.find((one) => one.id === "my-case");
    // The uploaded bytes win over the body's own cover.
    expect(stored?.cover).toEqual({
      kind: "image",
      filename: "shot.png",
      mimeType: "image/png",
    });

    const asset = await apiClient(app.app, member.cookie).get(
      "/api/inspirations/my-case/asset/shot.png",
    );
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await asset.arrayBuffer())).toEqual(new Uint8Array(bytes));
  });

  it("refuses a cover upload whose name is not a single image segment", async () => {
    const res = await apiClient(app.app, admin.cookie).post(
      "/api/inspirations/cases",
      caseBody({
        coverUpload: { filename: "../escape.png", dataBase64: Buffer.from([1]).toString("base64") },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("serves nothing for a cover name it does not recognise", async () => {
    await apiClient(app.app, admin.cookie).post("/api/inspirations/cases", caseBody());
    for (const name of ["../../package.json", "case.json", "missing.png"]) {
      const res = await apiClient(app.app, member.cookie).get(
        `/api/inspirations/my-case/asset/${encodeURIComponent(name)}`,
      );
      expect(res.status, name).toBe(404);
    }
  });

  it("writes, serves and then removes a preview document", async () => {
    const client = apiClient(app.app, admin.cookie);
    await client.post(
      "/api/inspirations/cases",
      caseBody({ previewHtml: "<html><body>hi</body></html>" }),
    );
    const preview = await apiClient(app.app, member.cookie).get(
      "/api/inspirations/my-case/preview",
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toContain("text/html");
    expect(await preview.text()).toContain("hi");
    expect(
      (await catalog(admin.cookie)).cases.find((one) => one.id === "my-case")?.previewFilename,
    ).toBe("preview.html");

    // An update that says nothing about the preview keeps it.
    await client.put("/api/inspirations/cases/my-case", caseBody({ title: "Renamed" }));
    expect(
      (await catalog(admin.cookie)).cases.find((one) => one.id === "my-case")?.previewFilename,
    ).toBe("preview.html");

    // `null` removes it.
    await client.put(
      "/api/inspirations/cases/my-case",
      caseBody({ title: "Renamed", previewHtml: null }),
    );
    expect(
      (await catalog(admin.cookie)).cases.find((one) => one.id === "my-case")?.previewFilename,
    ).toBeNull();
    expect(
      (await apiClient(app.app, member.cookie).get("/api/inspirations/my-case/preview")).status,
    ).toBe(404);
  });

  it("404s the preview of a built-in, which has no directory", async () => {
    expect(
      (await apiClient(app.app, member.cookie).get("/api/inspirations/game/preview")).status,
    ).toBe(404);
  });

  it("deletes a case and its assets, and refuses to delete a built-in", async () => {
    const client = apiClient(app.app, admin.cookie);
    await client.post(
      "/api/inspirations/cases",
      caseBody({
        previewHtml: "<html></html>",
        coverUpload: { filename: "shot.png", dataBase64: Buffer.from([1, 2]).toString("base64") },
      }),
    );
    expect((await client.delete("/api/inspirations/cases/my-case")).status).toBe(204);
    expect((await catalog(admin.cookie)).cases.map((one) => one.id)).not.toContain("my-case");
    expect(
      (await apiClient(app.app, member.cookie).get("/api/inspirations/my-case/asset/shot.png"))
        .status,
    ).toBe(404);

    expect((await client.delete("/api/inspirations/cases/game")).status).toBe(409);
    expect((await client.delete("/api/inspirations/cases/nope")).status).toBe(404);
  });
});

describe("category writes", () => {
  it("adds a category beside the shipped tabs, and files a case under it", async () => {
    const client = apiClient(app.app, admin.cookie);
    const created = await client.post("/api/inspirations/categories", {
      id: "internal",
      name: "Internal tools",
      nameZh: "内部工具",
      order: 9,
    });
    expect(created.status).toBe(201);
    expect(
      (await client.post("/api/inspirations/cases", caseBody({ categoryId: "internal" }))).status,
    ).toBe(201);
    const body = await catalog(member.cookie);
    expect(body.categories.map((one) => one.id)).toEqual([
      "webapps",
      "agents",
      "schedules",
      "internal",
    ]);
  });

  // The three the product ships are seed data: ordinary files from the moment a library exists, so
  // an admin renames and reorders them like anything else. Nothing on the category DTO even records
  // where one came from.
  it("renames and reorders a shipped category", async () => {
    const client = apiClient(app.app, admin.cookie);
    const renamed = await client.put("/api/inspirations/categories/webapps", {
      id: "webapps",
      name: "Web things",
      nameZh: "网页那些事",
      order: 40,
    });
    expect(renamed.status).toBe(200);
    const body = await catalog(member.cookie);
    const stored = body.categories.find((one) => one.id === "webapps");
    expect(stored).toEqual({
      id: "webapps",
      name: "Web things",
      nameZh: "网页那些事",
      order: 40,
    });
    // Sorted last now, and the shipped cases filed under it moved with it.
    expect(body.categories.at(-1)?.id).toBe("webapps");
  });

  it("refuses to delete a category that still holds cases, and allows it once they are gone", async () => {
    const client = apiClient(app.app, admin.cookie);
    await client.post("/api/inspirations/categories", {
      id: "internal",
      name: "Internal",
      nameZh: "内部",
    });
    await client.post("/api/inspirations/cases", caseBody({ categoryId: "internal" }));

    const refused = await client.delete("/api/inspirations/categories/internal");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(
      "1 case",
    );

    await client.delete("/api/inspirations/cases/my-case");
    expect((await client.delete("/api/inspirations/categories/internal")).status).toBe(204);
    expect((await catalog(admin.cookie)).categories.map((one) => one.id)).toEqual([
      "webapps",
      "agents",
      "schedules",
    ]);
  });

  // The delete rule is what keeps the shipped cases from being orphaned: a category they are filed
  // under cannot go while they are. Once every case under it is gone — the authored ones deleted,
  // and the shipped ones… are not deletable, which is exactly the point — the category stays put.
  it("refuses to delete a category the shipped cases are filed under", async () => {
    const client = apiClient(app.app, admin.cookie);
    const refused = await client.delete("/api/inspirations/categories/webapps");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(
      "4 cases",
    );
    // Still there, and still holding them.
    const body = await catalog(admin.cookie);
    expect(body.categories.map((one) => one.id)).toContain("webapps");
    expect(body.cases.filter((one) => one.categoryId === "webapps")).toHaveLength(4);
  });

  it("keeps a deleted category deleted across a re-read", async () => {
    // Seeding is "the categories directory does not exist", not a marker — so a library that has
    // ever had one is never repopulated, and an admin's deletion is not undone by the next request.
    const client = apiClient(app.app, admin.cookie);
    await client.post("/api/inspirations/categories", {
      id: "temp",
      name: "Temp",
      nameZh: "临时",
    });
    expect((await client.delete("/api/inspirations/categories/temp")).status).toBe(204);
    for (let i = 0; i < 3; i += 1) {
      const body = await catalog(admin.cookie);
      expect(body.categories.map((one) => one.id)).toEqual(["webapps", "agents", "schedules"]);
    }
  });

  it("404s a category that does not exist", async () => {
    expect(
      (await apiClient(app.app, admin.cookie).delete("/api/inspirations/categories/nope")).status,
    ).toBe(404);
  });
});

describe("PUT /api/me/prefs — inspirationFavorites", () => {
  it("stores the list normalized and returns it on the next read", async () => {
    const client = apiClient(app.app, member.cookie);
    const res = await client.put("/api/me/prefs", {
      inspirationFavorites: ["game", "game", "  rag  "],
    });
    expect(res.status).toBe(200);
    const prefs = await client.get("/api/me/prefs");
    expect(
      ((await prefs.json()) as { prefs: { inspirationFavorites: string[] } }).prefs
        .inspirationFavorites,
    ).toEqual(["game", "rag"]);
  });

  it("refuses a non-array, a non-slug entry and an over-long list", async () => {
    const client = apiClient(app.app, member.cookie);
    for (const value of [
      "game",
      [1],
      ["Not A Slug"],
      Array.from({ length: 257 }, (_, i) => `case-${i}`),
    ]) {
      const res = await client.put("/api/me/prefs", { inspirationFavorites: value });
      expect(res.status, JSON.stringify(value).slice(0, 40)).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "invalid_inspiration_favorites",
      );
    }
  });

  it("keeps favourites a legal selection when they name no case", async () => {
    const client = apiClient(app.app, member.cookie);
    // Bounded, not resolved: a case deleted on another host must not fail the write.
    expect(
      (await client.put("/api/me/prefs", { inspirationFavorites: ["deleted-last-week"] })).status,
    ).toBe(200);
  });
});
