/**
 * Live2D preset manifest.
 *
 * The catalog is a JSON sidecar per preset directory under `public/avatars/`.
 * Vite's `import.meta.glob({ eager: true, import: "default" })` walks the
 * directory at build time and returns the parsed JSON objects directly —
 * the runtime never has to fetch / parse / 404-thrash. The order matches
 * `COMPANION_AVATAR_PRESETS` so the Settings picker iterates a predictable
 * sequence.
 *
 * ## Asset state shape
 *
 * Each preset has an `index.json` whose shape is `PresetManifest` here. The
 * runtime fetches `.moc3` / `.png` / `.motion3.json` files lazily (they are
 * NOT globbed) so Vite serves them as immutable static assets — the browser
 * caches them on first request and the user only pays the download cost
 * once per preset.
 *
 * ## Why sidecar JSON rather than meta from filenames
 *
 * The manifest carries localized display names and the Live2D SDK Sample
 * Data License attribution. Trying to derive these from the file name would
 * either bake English-only labels into the path or require every locale to
 * ship a parallel `index.<lang>.json` — the sidecar keeps it simple.
 */
import { COMPANION_AVATAR_PRESETS, type CompanionAvatarPreset } from "../companion-store";

/** Raw JSON shape shipped under `public/avatars/<id>/index.json`. The
 *  `displayName` is keyed by locale so the Settings picker can render the
 *  user's UI language without a translation table. */
export interface PresetManifest {
  id: CompanionAvatarPreset;
  displayName: { zh: string; en: string };
  /** File name of the `.moc3` model. Resolved to `/avatars/<id>/<moc3>`
   *  at runtime — the file itself ships in a follow-up asset drop. */
  moc3: string;
  /** SPDX-style license string for the bundled sample data. Always the
   *  Live2D Cubism SDK Sample Data License for the bundled presets. */
  license: string;
  /** Free-text notes; surfaced in dev tools / future "About" pages. */
  notes?: string;
}

/** Public type for the runtime — the result of parsing + sorting the glob. */
export interface ResolvedPreset {
  id: CompanionAvatarPreset;
  displayName: { zh: string; en: string };
  /** Absolute URL to the `.moc3` (browser cacheable as immutable). */
  moc3Url: string;
  license: string;
}

/** `import.meta.glob` builds the catalog at compile time. The pattern is
 *  anchored at the package root (Vite resolves `/avatars/...` against
 *  `public/`) and eagerly imports the JSON default export. Unknown preset
 *  ids in the JSON are silently dropped — the closed list on the client
 *  (`COMPANION_AVATAR_PRESETS`) is the source of truth, the manifest is
 *  the data.
 *
 *  The result is wrapped in a `null` check + a tolerant `as` because the
 *  vitest node environment does not resolve `import.meta.glob` (the glob
 *  is a Vite-only primitive); the runtime sees a real object, the test
 *  sees an empty one and the unit test feeds synthetic data through
 *  `buildCatalogFromRawForTest` below. */
const RAW: Record<string, PresetManifest> =
  (import.meta as { glob?: unknown }).glob !== undefined
    ? ((
        import.meta as unknown as {
          glob: (pattern: string, opts: object) => Record<string, unknown>;
        }
      ).glob("/avatars/*/index.json", { eager: true, import: "default" }) as Record<
        string,
        PresetManifest
      >)
    : {};

/** Walk the raw glob result, normalize to the runtime shape, sort by the
 *  closed-list order. Pure: takes the RAW object as input so a unit test
 *  can feed a synthetic map without spinning up Vite.
 *
 *  Exported under a `ForTest` suffix so the unit test pins the catalog
 *  shape without reaching into the module's closure. */
export function buildCatalogFromRawForTest(raw: Record<string, PresetManifest>): ResolvedPreset[] {
  const out: ResolvedPreset[] = [];
  for (const id of COMPANION_AVATAR_PRESETS) {
    const entry = raw[`/avatars/${id}/index.json`];
    if (entry === undefined) continue;
    if (entry.id !== id) continue; // Manifest id disagrees with directory; skip rather than coerce.
    if (typeof entry.moc3 !== "string" || entry.moc3.length === 0) continue;
    if (typeof entry.displayName !== "object" || entry.displayName === null) continue;
    const { zh, en } = entry.displayName as { zh?: unknown; en?: unknown };
    // Empty strings are rejected: an empty `en` label would render an
    // empty button for non-zh locales; an empty `zh` would do the same
    // for zh locales. Both fall back to the preset id (raw English),
    // which is a regression vs. the i18n contract — drop rather than
    // ship a half-broken picker row.
    if (typeof zh !== "string" || zh.length === 0) continue;
    if (typeof en !== "string" || en.length === 0) continue;
    out.push({
      id,
      displayName: { zh, en },
      moc3Url: `/avatars/${id}/${entry.moc3}`,
      license: entry.license,
    });
  }
  return out;
}

/** Module-scope resolved catalog — built once from the Vite glob. Empty
 *  in vitest node (no glob); populated under Vite at build time. Every
 *  surface (banner / widget / floating window / Settings picker) reads
 *  the same array without re-walking the glob on every render. */
const RESOLVED: ResolvedPreset[] = buildCatalogFromRawForTest(RAW);

/** Runtime-facing preset catalog, in `COMPANION_AVATAR_PRESETS` order.
 *  Empty array means the asset drop has not happened yet — the runtime
 *  falls back to SVG with a one-time toast ("Live2D preset not found —
 *  using SVG"). */
export function listResolvedPresets(): ResolvedPreset[] {
  return RESOLVED;
}

/** Resolve a single preset id to its catalog entry. Returns `null` when
 *  the id is unknown or the manifest is malformed; the caller falls back
 *  to SVG in that case. */
export function resolvePreset(id: CompanionAvatarPreset): ResolvedPreset | null {
  return RESOLVED.find((p) => p.id === id) ?? null;
}
