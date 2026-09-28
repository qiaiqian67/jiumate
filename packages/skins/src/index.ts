/**
 * `@prismshadow/jiumate-skins` — JiuMate theme package IO.
 *
 * A theme is **one thing**: a palette of ten roles, an artwork, and how to frame it. That is
 * Codex Dream Skin's model, adopted rather than translated — see `roles.ts` for the contract and
 * `schema.ts` for why the shape is theirs. Keeping the format identical means a theme written for
 * that project imports here without a converter.
 *
 * Two sibling entry points exist for callers that must not pull in Node built-ins:
 *   - `@prismshadow/jiumate-skins/css`     — role -> CSS text (the web app's `<style>`)
 *   - `@prismshadow/jiumate-skins/presets` — the built-in gallery
 */
export type {
  SkinBackground,
  SkinExtras,
  SkinOrigin,
  SkinPackage,
  SkinReceipt,
  ThemeAppearance,
  ThemeArt,
  ThemeColorKey,
  ThemeColors,
  ThemeMode,
  ThemeSafeArea,
  ThemeTaskMode,
} from "./schema.js";
export {
  THEME_APPEARANCES,
  THEME_COLOR_KEYS,
  THEME_MODES,
  THEME_SAFE_AREAS,
  THEME_SURFACE_KEYS,
  THEME_TASK_MODES,
  isThemeAppearance,
  isThemeMode,
  isThemeSafeArea,
  isThemeTaskMode,
} from "./schema.js";

// The role -> ramp derivation. Published because authoring tools and the settings preview both
// need to show what a palette will actually look like.
export { deriveRamps, SURFACE_ROLE_KEYS } from "./palette.js";
export type { DerivedRamp, ThemeTokens } from "./palette.js";

// Token allowlist and format constants, re-exported because authoring tools and the import
// dialog both need to explain what a theme may say.
export {
  ACCENT_OWNING_TOKENS,
  ALLOWED_TOKENS,
  ALLOWED_TOKEN_NAMES,
  ACCENT_TOKENS,
  COLOR_VALUE_PATTERN,
  STRUCTURAL_TOKENS,
  TYPOGRAPHY_TOKENS,
  DREAMSKIN_ID_PREFIX,
  DEFAULT_SKIN_BACKGROUND_DIM,
  DEFAULT_SKIN_SURFACE_ALPHA,
  MAX_SURFACES,
  SKIN_OPACITY_MAX,
  SKIN_OPACITY_MIN,
  ownsAccent,
} from "./constants.js";

// CSS generation (also published as its own Node-free entry point).
export {
  WALLPAPER_VARIABLES,
  deriveAccentForeground,
  parseColor,
  renderSkinCss,
  renderSkinStylesheet,
  renderWallpaperCss,
  skinStyleSelector,
  withAlpha,
} from "./css.js";
export type {
  RenderSkinCssOptions,
  RenderWallpaperCssOptions,
  SkinRenderInput,
  WallpaperInput,
} from "./css.js";

// Reading a Codex-Dream-Skin package. Since the native format *is* theirs, this is a reader
// rather than a converter: it validates the upstream shape and fills in the fields this host
// understands but they do not.
export { readDreamSkinTheme, isDreamSkinTheme } from "./dreamskin.js";
export type { DreamSkinReadResult } from "./dreamskin.js";

// ZIP archives, for themes that arrive as an upload rather than a folder on disk.
export { ZIP_ARCHIVE_LIMIT, ZIP_LIMITS, ZipError, looksLikeZip, readZipEntries } from "./zip.js";
export type { ZipEntry, ZipLimits } from "./zip.js";

// IO
export {
  SkinPackageError,
  ASSET_LIMIT,
  MANIFEST_LIMIT,
  MAX_SKINS,
  MAX_TOKENS,
  skinsDir,
  skinDir,
  skinManifestPath,
  skinAssetPath,
  skinReceiptPath,
  slugifySkinId,
  readSkinPackage,
  readSkinCatalog,
  writeSkinPackage,
  fingerprintSkinPackage,
  importFingerprint,
  readSkinReceipt,
  writeSkinReceipt,
  deleteSkinPackage,
  coerceSkinPackage,
} from "./io.js";

// Constants
export {
  RECEIPT_FILENAME,
  RECEIPT_SCHEMA_VERSION,
  SKIN_SCHEMA,
  SKIN_SCHEMA_VERSION,
} from "./constants.js";

// The built-in gallery. Shared because the picker renders it and the server has to be able to
// name the themes a user can switch to.
export type { BuiltinTheme } from "./presets.js";
export {
  BUILTIN_THEMES,
  builtinThemePackage,
  builtinThemePackages,
  findBuiltinTheme,
} from "./presets.js";
