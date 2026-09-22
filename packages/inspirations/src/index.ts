/**
 * The inspiration library's Node entry point: schema, bounds, path helpers and the on-disk
 * catalog IO.
 *
 * This barrel pulls in `io.ts` and through it `node:fs` / `node:path`, so it is **not** safe to
 * import from the browser. The web app reaches for `@prismshadow/linsight-inspirations/presets`
 * instead (pure data, no Node built-ins), which the web bundle's `node-free-imports` test
 * enforces.
 */
export {
  ASSET_FILENAME_LIMIT,
  CASE_KINDS,
  CASE_MANIFEST_FILENAME,
  CATEGORY_NAME_LIMIT,
  COVER_KINDS,
  COVER_LIMIT,
  DESCRIPTION_LIMIT,
  GLYPH_LIMIT,
  IMAGE_EXTENSIONS,
  INSPIRATION_ID_LIMIT,
  INSPIRATION_SCHEMA,
  INSPIRATION_SCHEMA_VERSION,
  INSPIRATION_SLUG_REGEX,
  MANIFEST_LIMIT,
  MAX_CASES,
  MAX_CATEGORIES,
  MAX_SKILLS,
  MAX_TOOLS,
  PREVIEW_FILENAME,
  PREVIEW_LIMIT,
  PROMPT_LIMIT,
  REF_NAME_LIMIT,
  TITLE_LIMIT,
} from "./constants.js";

export {
  coerceInspirationCaseInput,
  coerceInspirationCategory,
  deleteInspirationCase,
  deleteInspirationCategory,
  InspirationPackageError,
  readAdminCases,
  readAdminCategories,
  readInspirationCase,
  readInspirationCatalog,
  readInspirationCategory,
  readInspirationPreview,
  resolveCaseAsset,
  seedInspirationCategories,
  sortCases,
  sortCategories,
  writeInspirationCase,
  writeInspirationCategory,
  writeInspirationCover,
  writeInspirationPreview,
} from "./io.js";

export {
  caseAssetPath,
  caseDir,
  caseManifestPath,
  casesDir,
  categoriesDir,
  categoryPath,
  inspirationsDir,
  isAssetFilename,
  slugifyInspirationId,
} from "./paths.js";

export {
  BUILTIN_INSPIRATION_CASES,
  builtinInspirationCatalog,
  SEED_INSPIRATION_CATEGORIES,
} from "./presets.js";

export { isInspirationSlug } from "./schema.js";

export type {
  InspirationCase,
  InspirationCaseInput,
  InspirationCatalog,
  InspirationCategory,
  InspirationCover,
  InspirationKind,
  InspirationSource,
} from "./schema.js";
