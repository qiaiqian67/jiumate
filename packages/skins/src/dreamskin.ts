/**
 * Reading a Codex Dream Skin theme.
 *
 * This used to be a converter: their format mapped onto ours, ten palette keys onto a token
 * table, with a separate table per mode and a pile of warnings for everything with no
 * equivalent. It is a **reader** now, because the native format *is* theirs — the same ten roles,
 * the same `appearance`, the same `art` block. There is nothing to translate.
 *
 * What is left is the part that was never about the format: their `theme.json` carries copy for
 * the Codex shell's own chrome, and it names its artwork with a fixed filename. Both are handled
 * here so `coerceSkinPackage` can stay a pure validator of one shape.
 */
import type { ThemeAppearance, ThemeArt, ThemeColors } from "./roles.js";

/** What a read produced: a manifest-shaped body, plus what had to be left behind. */
export interface DreamSkinReadResult {
  /** A body ready for `coerceSkinPackage`, with `schema`/`schemaVersion` filled in. */
  manifest: Record<string, unknown>;
  /** Copy strings this host has no surface for, kept for a round-trip export. */
  copy: Record<string, string>;
  /** The source `id`, before any prefix. */
  originalId: string;
  /** Human-readable notes about anything dropped or normalised. */
  warnings: string[];
}

/** The copy keys a Dream-Skin theme may carry for the Codex shell's chrome. */
const COPY_KEYS = [
  "brandSubtitle",
  "tagline",
  "projectPrefix",
  "projectLabel",
  "statusText",
  "quote",
  "promoTitle",
  "promoSub",
  "promoUrl",
] as const;

/** The ten palette keys their format uses. Identical to ours — that is the point. */
const COLOR_KEYS = [
  "background",
  "panel",
  "panelAlt",
  "accent",
  "accentAlt",
  "secondary",
  "highlight",
  "text",
  "muted",
  "line",
] as const;

/** Image names their validator fixes. Used to recognise a package when `image` is absent. */
const IMAGE_NAMES = ["background.webp", "background.jpg", "background.png"] as const;

/**
 * True when `value` looks like a Dream-Skin `theme.json` rather than a native manifest.
 *
 * The two are nearly the same shape, so the discriminator is the `schema` field: a native
 * manifest declares one, theirs does not.
 */
export function isDreamSkinTheme(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const raw = value as Record<string, unknown>;
  if (raw["schema"] !== undefined) return false;
  if (raw["schemaVersion"] !== 1) return false;
  return raw["colors"] !== undefined || raw["palette"] !== undefined;
}

/**
 * Read one, producing a body `coerceSkinPackage` accepts.
 *
 * `mode` is the reading to treat the palette as the primary one for. It is only a fallback for
 * `appearance`: their `auto` means "the artwork holds up under both shells", which is exactly
 * what our `auto` means, so it carries across unchanged. Their `appearance` may also be absent,
 * which upstream treats as `auto`; we do the same.
 */
export function readDreamSkinTheme(
  value: unknown,
  options: { mode?: "light" | "dark" } = {},
): DreamSkinReadResult {
  const raw = value as Record<string, unknown>;
  const warnings: string[] = [];

  const declared = raw["colors"] ?? raw["palette"];
  if (typeof declared !== "object" || declared === null) {
    throw new Error("Theme has no `colors` block");
  }
  const table = declared as Record<string, unknown>;
  const colors = {} as ThemeColors;
  const missing: (typeof COLOR_KEYS)[number][] = [];
  for (const key of COLOR_KEYS) {
    const entry = table[key];
    if (typeof entry === "string" && entry.length > 0) colors[key] = entry;
    else missing.push(key);
  }
  if (missing.length > 0) {
    // Their format requires all ten; an older Windows theme used `palette.accent` alone. Rather
    // than refuse the import, fill the gaps from the ones that are present — a theme with a
    // usable accent and a guessed neutral is still a theme, and the warning says so.
    warnings.push(`主题缺少这些颜色，已按已有颜色补齐：${missing.join(", ")}`);
    const fallback = colors.background ?? colors.panel ?? "#808080";
    for (const key of missing) {
      colors[key] = key === "line" ? fallback : (colors.text ?? fallback);
    }
  }

  const appearanceRaw = raw["appearance"];
  const appearance: ThemeAppearance =
    appearanceRaw === "light" || appearanceRaw === "dark" ? appearanceRaw : "auto";

  const artRaw = (raw["art"] ?? {}) as Record<string, unknown>;
  const art: Partial<ThemeArt> = {};
  if (typeof artRaw["focusX"] === "number") art.focusX = artRaw["focusX"];
  if (typeof artRaw["focusY"] === "number") art.focusY = artRaw["focusY"];
  if (typeof artRaw["safeArea"] === "string" && artRaw["safeArea"] !== "auto") {
    art.safeArea = artRaw["safeArea"] as ThemeArt["safeArea"];
  }
  if (typeof artRaw["taskMode"] === "string" && artRaw["taskMode"] !== "auto") {
    art.taskMode = artRaw["taskMode"] as ThemeArt["taskMode"];
  }

  const copy: Record<string, string> = {};
  for (const key of COPY_KEYS) {
    const entry = raw[key];
    if (typeof entry === "string" && entry.length > 0) copy[key] = entry;
  }
  if (Object.keys(copy).length > 0) {
    // Their copy is written for the Codex shell's chrome — a tagline, a project label, a
    // signature quote. This host has no surface for any of it, so it is kept in `origin` rather
    // than dropped, and the user is told it was not applied.
    warnings.push(
      `主题带的文案（${Object.keys(copy).join("、")}）在本应用里没有对应位置，已保留但未使用。`,
    );
  }

  const originalId = typeof raw["id"] === "string" ? raw["id"] : "theme";
  const image =
    typeof raw["image"] === "string" && raw["image"].length > 0
      ? raw["image"]
      : IMAGE_NAMES.find((name) => name === raw["image"]);

  return {
    manifest: {
      schema: "linsight.skin",
      schemaVersion: 1,
      id: originalId,
      name: typeof raw["name"] === "string" ? raw["name"] : originalId,
      version: "1.0.0",
      appearance,
      colors,
      art,
      ...(image === undefined ? {} : { image }),
      origin: {
        format: "dreamskin",
        originalId,
        appearance: typeof appearanceRaw === "string" ? appearanceRaw : null,
        copy,
      },
      source: "user",
      mode: options.mode ?? "dark",
    },
    copy,
    originalId,
    warnings,
  };
}
