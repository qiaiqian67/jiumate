/**
 * Static extraction of the pets bundled with the Codex desktop app.
 *
 * Codex ships its pet definitions inside a webpack chunk, as plain object
 * literals. This reads them out of the script **as text and never evaluates it**:
 * the script is another application's bundle, so running it here would mean
 * executing third-party code inside the server. Mirrors OpenBitFun's
 * `codex-adapter/src/pet_source.rs` (`definitions`), including its refusals —
 * a value built at runtime (`${…}` interpolation, an escape, a function call)
 * means the shape is not one this parser understands, and the pet is skipped
 * rather than guessed at.
 */
import type { SpriteVersionNumber } from "@prismshadow/linsight-pets";

/** A definition is only accepted if it carries these two keys. */
const REQUIRED_KEYS = ["assetRef:", "spriteVersionNumber:"] as const;

/** Guard against a bundle that happens to contain a huge number of look-alikes. */
export const MAX_CODEX_DEFINITIONS = 128;

export interface CodexPetDefinition {
  id: string;
  displayName: string;
  description: string | null;
  spriteVersionNumber: SpriteVersionNumber;
  /** Name of the sprite asset, matched against the bundle's asset map. */
  assetRef: string;
}

/**
 * Read one `key: "literal"` field. Returns null for anything that is not a
 * plain string literal, which is what makes a runtime-built value a skip rather
 * than a wrong answer.
 */
function literalField(object: string, key: string): string | null {
  const at = object.indexOf(`${key}:`);
  if (at < 0) return null;
  const rest = object.slice(at + key.length + 1).trimStart();
  const quote = rest[0];
  if (quote !== "`" && quote !== "'" && quote !== '"') return null;
  const end = rest.indexOf(quote, 1);
  if (end < 0) return null;
  const value = rest.slice(1, end);
  if (value.includes("\\") || value.includes("${")) return null;
  return value;
}

function digitRunAfter(object: string, key: string): number | null {
  const at = object.indexOf(`${key}:`);
  if (at < 0) return null;
  const rest = object.slice(at + key.length + 1).trimStart();
  const digits = /^\d+/.exec(rest)?.[0];
  if (digits === undefined) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

function validPetId(id: string): boolean {
  return id.length > 0 && /^[A-Za-z0-9_-]+$/.test(id);
}

/**
 * Every pet definition in a Codex chunk, deduplicated by id.
 *
 * Throws on a conflicting duplicate (two definitions claiming one id with
 * different content) and on a version this host cannot render — both mean the
 * bundle is not the shape this parser was written for, and a partial import
 * would be worse than a diagnostic.
 */
export function codexPetDefinitions(script: string): CodexPetDefinition[] {
  const byId = new Map<string, CodexPetDefinition>();
  // Flat object literals only: from each `{` up to the next `}`. Nesting is what
  // `assetRef`/`spriteVersionNumber` sit outside of in the real bundle.
  for (const chunk of script.split("{")) {
    const end = chunk.indexOf("}");
    if (end < 0) continue;
    const object = chunk.slice(0, end);
    if (!REQUIRED_KEYS.every((key) => object.includes(key))) continue;
    const assetRef = literalField(object, "assetRef");
    const id = literalField(object, "id");
    const displayName = literalField(object, "displayName");
    if (assetRef === null || id === null || displayName === null || !validPetId(id)) continue;
    const version = digitRunAfter(object, "spriteVersionNumber");
    if (version !== 1 && version !== 2) {
      throw new Error("Unsupported bundled pet sprite version");
    }
    const description = literalField(object, "description");
    const definition: CodexPetDefinition = {
      id,
      displayName,
      description: description === null || description.trim() === "" ? null : description.trim(),
      spriteVersionNumber: version,
      assetRef,
    };
    const previous = byId.get(id);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(definition)) {
      throw new Error("Conflicting bundled pet definitions");
    }
    byId.set(id, definition);
  }
  return [...byId.values()];
}
