/**
 * The theme catalog client.
 *
 * Two things are worth stating about this file, because both used to be different and the
 * difference is the point of the rewrite:
 *
 *  - There is **one** descriptor, not two. A theme is a palette *and* an artwork, so there is no
 *    second list to keep in step and no `skin:<id>` namespacing to stop the two colliding.
 *  - The built-in gallery is a *fallback*, not a prerequisite. A theme is appearance, and losing
 *    the whole picker because the catalog request failed would be a worse outcome than losing
 *    the user's own themes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_THEMES } from "@prismshadow/linsight-skins/presets";
import {
  builtinThemes,
  deleteTheme,
  importTheme,
  importThemeArchive,
  installedAssetUrl,
  isBuiltinThemeId,
  listThemes,
  resolveThemeIn,
} from "../src/features/skin/skin-service";
import { themeOwnsAccent } from "../src/features/skin/skin-runtime";
import { apiFetch } from "../src/api/client";

vi.mock("../src/api/client", () => ({ apiFetch: vi.fn() }));

const mockFetch = vi.mocked(apiFetch);

/** One installed theme as `GET /api/skins` returns it. */
function installed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "my-theme",
    name: "My Theme",
    author: null,
    description: "An imported theme",
    version: "1.0.0",
    appearance: "dark",
    source: "user",
    packagePath: "/data/skins/my-theme",
    colors: {
      background: "#101014",
      panel: "#18181d",
      panelAlt: "#22222a",
      accent: "#c8a55a",
      accentAlt: "#e3c27a",
      secondary: "#74352e",
      highlight: "#4a2f2a",
      text: "#f3ead7",
      muted: "#b5a386",
      line: "#3a3a44",
    },
    art: {
      focusX: 0.7,
      focusY: 0.4,
      zoom: 1,
      dim: 0.2,
      safeArea: "left",
      taskMode: "ambient",
    },
    tokens: {
      light: { "--color-gray-50": "#f3ead7" },
      dark: { "--color-gray-950": "#101014" },
    },
    surfaces: {
      light: ["--color-gray-50"],
      dark: ["--color-gray-950"],
    },
    extras: { font: null },
    background: {
      filename: "background.jpg",
      assetPath: "/data/skins/my-theme/background.jpg",
      mimeType: "image/jpeg",
      focusX: 0.7,
      focusY: 0.4,
      zoom: 1,
      dim: 0.2,
    },
    previewPath: null,
    previewMimeType: null,
    origin: null,
    ...overrides,
  };
}

afterEach(() => {
  mockFetch.mockReset();
});

describe("builtinThemes", () => {
  it("describes every built-in theme with a bundle URL and a name", () => {
    const themes = builtinThemes();
    expect(themes.length).toBe(BUILTIN_THEMES.length);
    for (const theme of themes) {
      const preset = BUILTIN_THEMES.find((candidate) => candidate.id === theme.id);
      expect(theme.name.length).toBeGreaterThan(0);
      expect(theme.source).toBe("preset");
      expect(theme.appearance).toBe(preset?.appearance);
      if (preset?.filename === "") {
        // A palette-only theme: the app's own look as a choice, with nothing to paint.
        expect(theme.background).toBeNull();
      } else {
        expect(theme.background?.url).toBe(`/themes/${theme.id}/${preset?.filename ?? ""}`);
      }
    }
  });

  it("carries both derived readings, so the theme holds in either mode", () => {
    // The regression this guards. A palette is absolute; the ramp names are not. Deriving only
    // the authored reading would leave a dark theme showing a white page under a light shell.
    for (const theme of builtinThemes()) {
      expect(theme.tokens?.light, theme.id).toBeDefined();
      expect(theme.tokens?.dark, theme.id).toBeDefined();
      expect(theme.surfaces?.light?.length, theme.id).toBeGreaterThan(0);
      expect(theme.surfaces?.dark?.length, theme.id).toBeGreaterThan(0);
    }
  });

  it("lays the same palette onto both readings, under each mode's own names", () => {
    // The point of deriving twice: the roles are absolute, the ramp names are not. `background`
    // is the page, and it is called `gray-50` under a light shell and `gray-950` under a dark
    // one; `text` is `gray-900` and `gray-50` respectively. So the two readings must agree
    // *across* those names — a theme looks like itself in either mode — while differing within
    // a reading, which is what makes the components legible.
    for (const theme of builtinThemes()) {
      const light = theme.tokens?.light ?? {};
      const dark = theme.tokens?.dark ?? {};
      expect(light["--color-gray-50"], `${theme.id} page`).toBe(dark["--color-gray-950"]);
      expect(light["--color-gray-900"], `${theme.id} text`).toBe(dark["--color-gray-50"]);
      expect(light["--color-gray-50"], `${theme.id} page vs text`).not.toBe(
        light["--color-gray-900"],
      );
    }
  });

  it("previews the palette it actually declares", () => {
    // The card swatch reads `colors` directly, so a theme whose derived ramp disagreed with its
    // palette would preview one thing and render another.
    for (const theme of builtinThemes()) {
      expect(theme.colors.background.length).toBeGreaterThan(0);
      expect(theme.colors.accent.length).toBeGreaterThan(0);
    }
  });
});

describe("isBuiltinThemeId", () => {
  it("recognises the shipped gallery and nothing else", () => {
    for (const theme of BUILTIN_THEMES) expect(isBuiltinThemeId(theme.id)).toBe(true);
    expect(isBuiltinThemeId("not-a-theme")).toBe(false);
  });
});

describe("listThemes", () => {
  it("lists the built-ins alone when nothing is installed", async () => {
    mockFetch.mockResolvedValue({ skins: [], diagnostics: [] });
    expect((await listThemes()).map((theme) => theme.id)).toEqual(
      BUILTIN_THEMES.map((theme) => theme.id),
    );
  });

  it("appends an installed theme with a server asset URL", async () => {
    mockFetch.mockResolvedValue({ skins: [installed()], diagnostics: [] });
    const themes = await listThemes();
    const found = themes.find((theme) => theme.id === "my-theme");
    expect(found?.source).toBe("user");
    expect(found?.name).toBe("My Theme");
    expect(found?.background?.url).toBe("/api/skins/my-theme/asset/background.jpg");
    expect(found?.background?.focusX).toBe(0.7);
  });

  it("carries no artwork for a palette-only installed theme", async () => {
    mockFetch.mockResolvedValue({ skins: [installed({ background: null })], diagnostics: [] });
    const themes = await listThemes();
    expect(themes.find((theme) => theme.id === "my-theme")?.background).toBeNull();
  });

  it("lets an installed theme shadow a built-in with the same id", async () => {
    const shadowed = BUILTIN_THEMES[0]?.id ?? "";
    mockFetch.mockResolvedValue({
      skins: [installed({ id: shadowed, name: "Mine" })],
      diagnostics: [],
    });
    const themes = await listThemes();
    expect(themes.filter((theme) => theme.id === shadowed)).toHaveLength(1);
    expect(themes.find((theme) => theme.id === shadowed)?.source).toBe("user");
  });

  it("degrades to the built-ins when the catalog request fails", async () => {
    // A theme is appearance: losing the whole picker because one request failed would be worse
    // than losing the user's own themes.
    mockFetch.mockRejectedValue(new Error("offline"));
    expect((await listThemes()).map((theme) => theme.id)).toEqual(
      BUILTIN_THEMES.map((theme) => theme.id),
    );
  });
});

describe("resolveThemeIn", () => {
  it("resolves a bundled id to its descriptor", () => {
    const first = BUILTIN_THEMES[0];
    expect(first).toBeDefined();
    expect(resolveThemeIn(builtinThemes(), first?.id)?.id).toBe(first?.id);
  });

  it("reads no selection as the app's own appearance rather than an error", () => {
    for (const id of [null, undefined, ""]) {
      expect(resolveThemeIn(builtinThemes(), id)).toBeNull();
    }
  });

  it("reads an unknown id as none rather than an error", () => {
    // A theme deleted on another host must not leave the app stuck without one.
    expect(resolveThemeIn(builtinThemes(), "nope")).toBeNull();
  });
});

describe("themeOwnsAccent", () => {
  it("is false for no theme", () => {
    expect(themeOwnsAccent(null)).toBe(false);
  });

  it("matches whether either reading declares the accent pair", () => {
    for (const theme of builtinThemes()) {
      const declaresAccent = Boolean(
        theme.tokens?.light?.["--accent-bg"] ?? theme.tokens?.dark?.["--accent-bg"],
      );
      expect(themeOwnsAccent(theme), theme.id).toBe(declaresAccent);
    }
  });
});

describe("installedAssetUrl", () => {
  it("escapes both halves, because a filename may hold spaces or a slash", () => {
    expect(installedAssetUrl("my theme", "back ground.jpg")).toBe(
      "/api/skins/my%20theme/asset/back%20ground.jpg",
    );
  });
});

describe("importTheme", () => {
  it("returns the descriptor and whatever the read had to leave behind", async () => {
    mockFetch.mockResolvedValue({ skin: installed(), warnings: ["tagline"] });
    const result = await importTheme("/tmp/my-theme");
    expect(result.theme.id).toBe("my-theme");
    expect(result.warnings).toEqual(["tagline"]);
  });

  it("posts the path as JSON", async () => {
    mockFetch.mockResolvedValue({ skin: installed(), warnings: [] });
    await importTheme("/tmp/my-theme");
    expect(mockFetch).toHaveBeenCalledWith("/api/skins/import", {
      method: "POST",
      body: { path: "/tmp/my-theme" },
    });
  });
});

describe("importThemeArchive", () => {
  it("sends the file as a raw body, not JSON", async () => {
    // The difference from `importTheme` is the whole reason this is a second call: a raw body
    // has nowhere to put a path, and the server reads the bytes rather than a JSON envelope.
    mockFetch.mockResolvedValue({ skin: installed(), warnings: [] });
    const file = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]);

    await importThemeArchive(file);

    expect(mockFetch).toHaveBeenCalledWith("/api/skins/import/archive", {
      method: "POST",
      rawBody: file,
      // Not `application/zip`: the CSRF middleware admits a fixed list of write content types
      // and this one is already on it. The route reads the bytes, so the label is not load-bearing.
      contentType: "application/octet-stream",
    });
  });

  it("hands the body over untouched, so the server can hash it for idempotency", async () => {
    // Idempotency is keyed on the archive's own bytes, so the client must not re-encode it —
    // a `File` read as text and re-wrapped would hash differently every time.
    mockFetch.mockResolvedValue({ skin: installed(), warnings: [] });
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const file = new Blob([bytes]);

    await importThemeArchive(file);

    const [, options] = mockFetch.mock.calls[0] as [string, { rawBody: Blob }];
    expect(options.rawBody).toBe(file);
  });

  it("maps the response into a descriptor the picker can render", async () => {
    mockFetch.mockResolvedValue({ skin: installed(), warnings: ["文案"] });
    const result = await importThemeArchive(new Blob([new Uint8Array([1])]));
    expect(result.theme.id).toBe("my-theme");
    expect(result.theme.source).toBe("user");
    expect(result.warnings).toEqual(["文案"]);
  });
});

describe("deleteTheme", () => {
  it("escapes the id", async () => {
    mockFetch.mockResolvedValue(undefined);
    await deleteTheme("my theme");
    expect(mockFetch).toHaveBeenCalledWith("/api/skins/my%20theme", { method: "DELETE" });
  });
});
