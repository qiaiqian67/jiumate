/**
 * Live2D preset manifest — the closed catalog surfaced by the runtime.
 *
 * The catalog shape is what the Settings picker iterates and what the
 * `<CompanionLive2D>` runtime fetches from. A bad shape (wrong order,
 * missing locales, broken moc3Url) would silently land the user on an
 * empty canvas. These cases pin the shape so a future asset drop or
 * manifest edit cannot regress it.
 *
 * The test drives `buildCatalogFromRawForTest` with synthetic data
 * rather than reading the Vite-only `import.meta.glob` — vitest's node
 * environment does not resolve the glob, and reading the resolved array
 * directly would couple the test to whatever the runtime happens to ship
 * in `public/avatars/`. The pure builder is the testable surface.
 */
import { describe, expect, it } from "vitest";
import {
  buildCatalogFromRawForTest,
  resolvePreset,
  type PresetManifest,
  type ResolvedPreset,
} from "../../src/features/chat/companion-live2d/manifest";
import { COMPANION_AVATAR_PRESETS } from "../../src/features/chat/companion-store";

/** Synthetic manifest matching the JSON sidecar shape. Three presets in
 *  the closed-list order — mirrors what the runtime expects after a real
 *  asset drop. */
function syntheticRaw(): Record<string, PresetManifest> {
  return {
    "/avatars/hiyori/index.json": {
      id: "hiyori",
      displayName: { zh: "日和", en: "Hiyori" },
      moc3: "hiyori.moc3",
      license: "Live2D Cubism SDK Sample Data License",
    },
    "/avatars/mark/index.json": {
      id: "mark",
      displayName: { zh: "马克", en: "Mark" },
      moc3: "mark.moc3",
      license: "Live2D Cubism SDK Sample Data License",
    },
    "/avatars/mao/index.json": {
      id: "mao",
      displayName: { zh: "小瞳", en: "Mao" },
      moc3: "mao.moc3",
      license: "Live2D Cubism SDK Sample Data License",
    },
  };
}

describe("buildCatalogFromRawForTest", () => {
  it("lists exactly the closed-list preset ids, in canonical order", () => {
    // The picker iterates this catalog directly; the order sets user
    // expectation (Hiyori the friendly default, Mark the businesslike
    // one, Mao the cat at the end). A re-ordering is a UX change.
    const catalog = buildCatalogFromRawForTest(syntheticRaw());
    expect(catalog.map((p) => p.id)).toEqual([...COMPANION_AVATAR_PRESETS]);
  });

  it("carries both `zh` and `en` display names for every preset", () => {
    // The picker renders the user's UI locale — a missing locale key
    // would silently fall back to the preset id (raw English). Pin both
    // so a partial manifest edit can't ship.
    const catalog = buildCatalogFromRawForTest(syntheticRaw());
    for (const p of catalog) {
      expect(typeof p.displayName.zh, `${p.id}.displayName.zh`).toBe("string");
      expect(p.displayName.zh.length, `${p.id}.displayName.zh length`).toBeGreaterThan(0);
      expect(typeof p.displayName.en, `${p.id}.displayName.en`).toBe("string");
      expect(p.displayName.en.length, `${p.id}.displayName.en length`).toBeGreaterThan(0);
    }
  });

  it("exposes a valid moc3Url under `/avatars/<id>/...`", () => {
    // The runtime fetches this URL directly; a wrong path means a 404 on
    // first render and the WebGL fallback path engages.
    const catalog = buildCatalogFromRawForTest(syntheticRaw());
    for (const p of catalog) {
      expect(p.moc3Url.startsWith(`/avatars/${p.id}/`), `${p.id}.moc3Url`).toBe(true);
      expect(p.moc3Url.endsWith(".moc3"), `${p.id}.moc3Url extension`).toBe(true);
    }
  });

  it("records the Live2D Cubism SDK Sample Data License on every preset", () => {
    // Attribution lives on every preset so a downstream audit (future
    // THIRD-PARTY-NOTICES.md or Settings → About page) can read it
    // without a parallel registry.
    const catalog = buildCatalogFromRawForTest(syntheticRaw());
    for (const p of catalog) {
      expect(p.license, `${p.id}.license`).toContain("Live2D");
    }
  });

  it("returns an empty array when no manifests are present", () => {
    // The ship-without-assets shape — Vite's glob returns {} and the
    // catalog is empty. The runtime's Settings picker skips the preset
    // row entirely (see companion-section.tsx `presets.length > 0`
    // guard).
    expect(buildCatalogFromRawForTest({})).toEqual([]);
  });

  it("drops manifests whose id disagrees with their directory name", () => {
    // A misnamed manifest (typo in the JSON `id` field) must NOT be
    // coerced to the directory's id — silently using the wrong id would
    // point the runtime at the wrong motion catalog.
    const mismatched: Record<string, PresetManifest> = {
      "/avatars/hiyori/index.json": {
        id: "hiyori",
        displayName: { zh: "日和", en: "Hiyori" },
        moc3: "hiyori.moc3",
        license: "Live2D",
      },
      "/avatars/mark/index.json": {
        // Mark's manifest claims id "mao" — should be skipped, not
        // coerced. The picker only offers what `COMPANION_AVATAR_PRESETS`
        // says is valid.
        id: "mao",
        displayName: { zh: "马克", en: "Mark" },
        moc3: "mark.moc3",
        license: "Live2D",
      },
    };
    const catalog = buildCatalogFromRawForTest(mismatched);
    expect(catalog.map((p) => p.id)).toEqual(["hiyori"]);
  });

  it("drops manifests missing the `moc3` field or a display name locale", () => {
    // Partial / corrupt manifest edits must not produce a broken
    // catalog entry — the runtime would 404 on the URL or render an
    // empty label.
    const partial: Record<string, PresetManifest> = {
      "/avatars/hiyori/index.json": {
        id: "hiyori",
        // moc3 is required — drop.
        displayName: { zh: "日和", en: "Hiyori" },
        moc3: "",
        license: "Live2D",
      },
      "/avatars/mark/index.json": {
        id: "mark",
        // Mark's manifest only has `zh` — the English label is the
        // language the runtime falls back to for non-zh locales. Drop.
        displayName: { zh: "马克", en: "" as string },
        moc3: "mark.moc3",
        license: "Live2D",
      },
      "/avatars/mao/index.json": {
        id: "mao",
        displayName: { zh: "小瞳", en: "Mao" },
        moc3: "mao.moc3",
        license: "Live2D",
      },
    };
    const catalog = buildCatalogFromRawForTest(partial);
    // Only Mao has a complete manifest — Hiyori is dropped because
    // moc3 is empty (the URL would 404); Mark is dropped because the
    // English label is missing (non-zh locales would render an empty
    // button).
    expect(catalog.map((p) => p.id)).toEqual(["mao"]);
  });
});

describe("resolvePreset (runtime helper)", () => {
  // The runtime helper walks the same module-scope catalog. In the test
  // environment the module-scope array is empty (no Vite glob), so
  // resolvePreset returns null — we exercise that contract rather than
  // mocking the module.
  it("returns null when the module-scope catalog is empty", () => {
    // `resolvePreset` is imported from the runtime module; without a
    // Vite glob it has nothing to resolve. The test pins the contract
    // rather than asserting the happy path (which requires Vite).
    const id = COMPANION_AVATAR_PRESETS[0]!;
    expect(resolvePreset(id)).toBeNull();
  });
});
