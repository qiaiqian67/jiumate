/**
 * Theme catalog client — talks to `GET/POST/DELETE /api/skins` and merges the built-in gallery
 * from the web bundle (`/themes/<id>/<file>`). Mirrors `features/pet/pet-service.ts`.
 *
 * ## One concept
 *
 * A theme is a palette, an artwork and how to frame it — one thing, one id, one selection. This
 * module used to expose two descriptors (a palette and a wallpaper) because the two were
 * separate choices, which is what made a wallpaper cost a palette and left three unrelated
 * controls on the settings page. `appearance` is what replaces the old per-mode split: a theme
 * says which shells its artwork holds up under, and the host pins the mode to match.
 *
 * The built-in table lives in `@prismshadow/linsight-skins/presets` rather than here, because
 * the server needs the same ids. Only the web-bundle URL shape is built here.
 */
import { apiFetch } from "../../api/client";
import { BUILTIN_THEMES } from "@prismshadow/linsight-skins/presets";
import type { BuiltinTheme } from "@prismshadow/linsight-skins/presets";
import { deriveRamps } from "@prismshadow/linsight-skins/css";
import type { SkinRenderInput, WallpaperInput } from "@prismshadow/linsight-skins/css";
import type { SkinPackage, ThemeAppearance, ThemeColors } from "@prismshadow/linsight-skins";

/** Where the web bundle serves a built-in theme's artwork from. */
const BUILTIN_THEME_BASE = "/themes";

/** A theme as the rest of the app sees it: what to render, plus what to call it. */
export interface ThemeDescriptor extends SkinRenderInput {
  name: string;
  description?: string;
  appearance: ThemeAppearance;
  /** Where the theme came from. */
  source: "preset" | "user";
  /** The declared palette, which is what a card previews. */
  colors: ThemeColors;
  /** The artwork and its framing, or null for a palette-only theme. */
  background: WallpaperInput | null;
}

export interface ListSkinsResponse {
  skins: SkinPackage[];
  diagnostics: string[];
}

export interface ImportThemeResult {
  theme: ThemeDescriptor;
  /** What a Codex-Dream-Skin read had to leave behind. Empty for a native theme. */
  warnings: string[];
}

/** The asset URL for an installed theme. `encodeURIComponent` because a filename may hold spaces. */
export function installedAssetUrl(id: string, filename: string): string {
  return `/api/skins/${encodeURIComponent(id)}/asset/${encodeURIComponent(filename)}`;
}

function fromPreset(preset: BuiltinTheme): ThemeDescriptor {
  // A built-in theme carries roles, not a ramp, so the ramp is derived here — the same call the
  // server's validator makes, from the same module, so a bundled theme and an imported one with
  // identical colours render identically.
  const ramps = deriveRamps(preset.colors);
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    appearance: preset.appearance,
    source: "preset",
    colors: preset.colors,
    tokens: { light: ramps.light.tokens, dark: ramps.dark.tokens },
    surfaces: { light: ramps.light.surfaces, dark: ramps.dark.surfaces },
    background:
      preset.filename === ""
        ? null
        : {
            url: `${BUILTIN_THEME_BASE}/${preset.id}/${preset.filename}`,
            focusX: preset.art.focusX,
            focusY: preset.art.focusY,
            zoom: preset.art.zoom,
            dim: preset.art.dim,
          },
  };
}

function fromInstalled(skin: SkinPackage): ThemeDescriptor {
  const background = skin.background;
  return {
    id: skin.id,
    name: skin.name,
    ...(skin.description === null ? {} : { description: skin.description }),
    appearance: skin.appearance,
    source: "user",
    colors: skin.colors,
    tokens: skin.tokens,
    surfaces: skin.surfaces,
    background:
      background === null
        ? null
        : {
            url: installedAssetUrl(skin.id, background.filename),
            focusX: background.focusX,
            focusY: background.focusY,
            zoom: background.zoom,
            dim: background.dim,
          },
  };
}

/**
 * The built-in gallery, seeded so the very first render can already apply a theme.
 *
 * The derived ramp is not in this table — it is computed from `colors` by the renderer's own
 * module (`@prismshadow/linsight-skins/css`), so the bundle carries one palette per theme
 * rather than two ramps.
 */
export function builtinThemes(): ThemeDescriptor[] {
  return BUILTIN_THEMES.map(fromPreset);
}

/** True when `id` names a theme that ships with the host, which therefore cannot be deleted. */
export function isBuiltinThemeId(id: string): boolean {
  return BUILTIN_THEMES.some((theme) => theme.id === id);
}

/**
 * Every theme the picker can offer: the bundled gallery plus the installed catalog.
 *
 * A server that cannot answer degrades to the built-ins rather than to nothing — a theme is
 * appearance, and losing the whole picker because the catalog request failed would be a worse
 * outcome than losing the user's own themes. (Same trade `listPets` makes.)
 */
export async function listThemes(): Promise<ThemeDescriptor[]> {
  let installed: SkinPackage[] = [];
  try {
    const response = await apiFetch<ListSkinsResponse>("/api/skins");
    installed = response.skins;
  } catch {
    installed = [];
  }
  const installedDescriptors = installed.map(fromInstalled);
  // An installed theme overrides a built-in with the same id, so a user who imports a corrected
  // copy of a bundled theme sees theirs.
  const installedIds = new Set(installedDescriptors.map((theme) => theme.id));
  return [
    ...builtinThemes().filter((theme) => !installedIds.has(theme.id)),
    ...installedDescriptors,
  ];
}

/**
 * Look up a theme in a catalog, or null for "none" — a legal selection meaning the app's own
 * appearance, not an error. An id no longer in the catalog resolves to null for the same reason:
 * a theme deleted on another host must not leave the app stuck without one.
 */
export function resolveThemeIn(
  catalog: readonly ThemeDescriptor[],
  id: string | null | undefined,
): ThemeDescriptor | null {
  if (!id) return null;
  return catalog.find((theme) => theme.id === id) ?? null;
}

/**
 * Import a folder holding either our own manifest or a Codex-Dream-Skin `theme.json`.
 *
 * The two are the same format, so the server reads one shape either way; the caller does not
 * have to say which it is handing over.
 */
export async function importTheme(path: string): Promise<ImportThemeResult> {
  const response = await apiFetch<{ skin: SkinPackage; warnings: string[] }>("/api/skins/import", {
    method: "POST",
    body: { path },
  });
  return { theme: fromInstalled(response.skin), warnings: response.warnings };
}

/**
 * Import a theme from an uploaded `.zip`.
 *
 * A separate call from {@link importTheme} because the request is a different shape: a raw body
 * rather than JSON, so there is nowhere to put a path. Idempotency comes from the archive's own
 * bytes on the server side, which is what lets re-uploading the same file be recognised.
 *
 * `application/octet-stream` rather than `application/zip`: the server's CSRF middleware admits
 * a fixed list of write content types and this one is already on it, and the route reads the
 * bytes rather than trusting the label.
 */
export async function importThemeArchive(file: Blob): Promise<ImportThemeResult> {
  const response = await apiFetch<{ skin: SkinPackage; warnings: string[] }>(
    "/api/skins/import/archive",
    {
      method: "POST",
      rawBody: file,
      contentType: "application/octet-stream",
    },
  );
  return { theme: fromInstalled(response.skin), warnings: response.warnings };
}

/** Remove an installed theme. The built-ins cannot be removed. */
export async function deleteTheme(id: string): Promise<void> {
  await apiFetch(`/api/skins/${encodeURIComponent(id)}`, { method: "DELETE" });
}
