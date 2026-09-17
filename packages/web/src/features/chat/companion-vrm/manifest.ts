/**
 * VRM preset manifest.
 *
 * The catalog is a JSON sidecar per preset directory under `public/avatars-vrm/`.
 * Vite's `import.meta.glob({ eager: true, import: "default" })` walks the
 * directory at build time and returns the parsed JSON objects directly —
 * the runtime never has to fetch / parse / 404-thrash. The order matches
 * `COMPANION_AVATAR_VRM_PRESETS` so the Settings picker iterates a
 * predictable sequence.
 *
 * ## Why a separate directory from Live2D
 *
 * Live2D presets live under `public/avatars/` (Cubism SDK `.moc3` +
 * `.motion3.json` files); VRM presets live under `public/avatars-vrm/`
 * (a single `.vrm` binary per preset, expression blend-shapes inside the
 * model). Splitting the directories keeps the asset-format naming
 * legible and lets a future asset drop ship one side without touching
 * the other. The closed-list id spaces are also disjoint on both client
 * and server (see `CompanionAvatarPreset` vs `CompanionAvatarVrmPreset`),
 * so the runtime can never confuse a Live2D preset id for a VRM one or
 * vice versa.
 *
 * ## License attribution
 *
 * Each bundled VRM file ships with an SPDX-style `license` string in
 * the manifest. The two slots in this initial drop are placeholders for
 * CC0 / VRM Consortium sample models — the asset sidecar under
 * `public/avatars-vrm/<id>/` carries the actual license text once a
 * specific model is chosen. The settings page surfaces the license via
 * a tooltip on the preset tile.
 */
import { COMPANION_AVATAR_VRM_PRESETS, type CompanionAvatarVrmPreset } from "../companion-store";

/** Raw JSON shape shipped under `public/avatars-vrm/<id>/index.json`.
 *  The `displayName` is keyed by locale so the Settings picker can
 *  render the user's UI language without a translation table. */
export interface PresetManifest {
  id: CompanionAvatarVrmPreset;
  displayName: { zh: string; en: string };
  /** File name of the `.vrm` model. Resolved to
   *  `/avatars-vrm/<id>/<vrm>` at runtime — the file itself ships in a
   *  follow-up asset drop. */
  vrm: string;
  /** SPDX-style license string for the bundled VRM model. Always
   *  present so the picker can surface a tooltip; never trust defaults
   *  derived from filenames. */
  license: string;
  /** Free-text notes; surfaced in dev tools / future "About" pages. */
  notes?: string;
}

/** Public type for the runtime — the result of parsing + sorting the glob. */
export interface ResolvedPreset {
  id: CompanionAvatarVrmPreset;
  displayName: { zh: string; en: string };
  /** Absolute URL to the `.vrm` file (browser cacheable as immutable). */
  vrmUrl: string;
  license: string;
}

/** `import.meta.glob` builds the catalog at compile time. The pattern is
 *  anchored at the package root (Vite resolves `/avatars-vrm/...` against
 *  `public/`) and eagerly imports the JSON default export. Unknown preset
 *  ids in the JSON are silently dropped — the closed list on the client
 *  (`COMPANION_AVATAR_VRM_PRESETS`) is the source of truth, the manifest
 *  is the data.
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
      ).glob("/avatars-vrm/*/index.json", { eager: true, import: "default" }) as Record<
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
  for (const id of COMPANION_AVATAR_VRM_PRESETS) {
    const entry = raw[`/avatars-vrm/${id}/index.json`];
    if (entry === undefined) continue;
    if (entry.id !== id) continue; // Manifest id disagrees with directory; skip rather than coerce.
    if (typeof entry.vrm !== "string" || entry.vrm.length === 0) continue;
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
      vrmUrl: `/avatars-vrm/${id}/${entry.vrm}`,
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

/** Runtime-facing preset catalog, in `COMPANION_AVATAR_VRM_PRESETS` order.
 *  Empty array means the asset drop has not happened yet — the runtime
 *  falls back to SVG with a one-time toast ("VRM preset not found —
 *  using SVG"). */
export function listResolvedVrmPresets(): ResolvedPreset[] {
  return RESOLVED;
}

/** Resolve a single preset id to its catalog entry. Returns `null` when
 *  the id is unknown or the manifest is malformed; the caller falls back
 *  to SVG in that case. */
export function resolveVrmPreset(id: CompanionAvatarVrmPreset): ResolvedPreset | null {
  return RESOLVED.find((p) => p.id === id) ?? null;
}
