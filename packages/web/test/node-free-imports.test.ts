/**
 * The web bundle must never import a *value* from a Node-only barrel.
 *
 * `@jiumate/skins` and `@jiumate/pets` publish their barrel as the
 * Node entry point: it pulls in `io.ts`, and through it `node:fs` / `node:crypto` / `node:path`.
 * The web app is meant to reach the Node-free siblings instead (`/css`, `/presets`). The same goes
 * for `@jiumate/inspirations`, whose barrel adds `io.ts` and whose siblings are
 * `/presets` (the built-in catalog) and `/schema` (the types, the bounds and the id rule).
 *
 * Nothing else catches a mistake here. `tsc` is happy because the barrel really does export the
 * name; the package's own vitest suite is happy because it runs in Node, where the built-ins
 * resolve. The browser is the first thing to notice, and it notices by failing to execute the
 * entire module graph — no React, no CSS (`styles.css` is imported by `main.tsx`), a blank page
 * and a console error naming a module nobody wrote by hand.
 *
 * That is a bad trade for a rule this cheap to check, so it is checked here.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_SRC = path.join(import.meta.dirname, "..", "src");

/** Barrels that are Node-only, and the sibling entry a browser-safe import should use. */
const NODE_ONLY_BARRELS: Record<string, string> = {
  "@jiumate/skins": "@jiumate/skins/css or /presets",
  "@jiumate/pets": "@jiumate/pets/presets",
  "@jiumate/inspirations": "@jiumate/inspirations/presets or /schema",
};

const SPECIFIER_ALTERNATION = Object.keys(NODE_ONLY_BARRELS)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

/**
 * An import or export statement whose module specifier is a Node-only barrel.
 *
 * The clause is forbidden from containing `import` or `export` of its own. Without that, the
 * lazy group happily spans several statements and reaches a barrel specifier further down the
 * file, reporting the statement above it — which is how a `import type` two lines earlier got
 * blamed for a real violation and, worse, how a real one could hide behind a `type` clause.
 */
const STATEMENT = new RegExp(
  String.raw`(?:^|\n)[ \t]*(import|export)[ \t]+((?:(?!\bimport\b|\bexport\b)[\s\S])*?)[ \t]*from[ \t]*["'](${SPECIFIER_ALTERNATION})["']`,
  "g",
);

/** Every statement in `code` that binds a runtime name to a Node-only barrel. */
export function runtimeBarrelImportsIn(code: string): string[] {
  const out: string[] = [];
  for (const match of code.matchAll(STATEMENT)) {
    const clause = (match[2] ?? "").trim();
    // A `type`-only clause is erased before a bundler sees it, and so is a clause made entirely
    // of inline `type` specifiers — the same thing spelled per name.
    if (/^type\s/.test(clause)) continue;
    const bound = clause.replace(/\btype\s+[A-Za-z_$][\w$]*/g, "").replace(/[{},\s]/g, "");
    if (bound === "") continue;
    out.push(match[0].trim());
  }
  return out;
}

/** Walk the web source, stripping comments first so prose cannot trip the rule. */
function scanSourceTree(): { file: string; statement: string }[] {
  const out: { file: string; statement: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const code = fs
        .readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      for (const statement of runtimeBarrelImportsIn(code)) {
        out.push({ file: path.relative(WEB_SRC, full), statement });
      }
    }
  };
  walk(WEB_SRC);
  return out;
}

describe("the scanner", () => {
  it("catches a value import from a barrel", () => {
    expect(
      runtimeBarrelImportsIn(
        `import { DEFAULT_SKIN_SURFACE_ALPHA } from "@jiumate/skins";`,
      ),
    ).toHaveLength(1);
    expect(
      runtimeBarrelImportsIn(`export { withAlpha } from "@jiumate/skins";`),
    ).toHaveLength(1);
  });

  it("allows a type-only import, however it is spelled", () => {
    expect(
      runtimeBarrelImportsIn(`import type { SkinMode } from "@jiumate/skins";`),
    ).toEqual([]);
    expect(
      runtimeBarrelImportsIn(`import { type SkinMode } from "@jiumate/skins";`),
    ).toEqual([]);
    expect(
      runtimeBarrelImportsIn(`import type SkinMode from "@jiumate/skins";`),
    ).toEqual([]);
  });

  it("catches a value smuggled alongside inline type specifiers", () => {
    // The shape that would otherwise hide behind a `type` in the same clause.
    expect(
      runtimeBarrelImportsIn(
        `import { type SkinMode, renderSkinCss } from "@jiumate/skins";`,
      ),
    ).toHaveLength(1);
  });

  it("allows the Node-free sibling entries", () => {
    expect(
      runtimeBarrelImportsIn(`import { withAlpha } from "@jiumate/skins/css";`),
    ).toEqual([]);
    expect(
      runtimeBarrelImportsIn(`import { BUILTIN_SKINS } from "@jiumate/skins/presets";`),
    ).toEqual([]);
  });

  it("does not blame an earlier statement for a later violation", () => {
    // The regression this scanner shipped with: the lazy clause spanned statements, so a real
    // violation on the last line was reported against the value import at the top.
    const code = [
      `import { BUILTIN_SKINS } from "@jiumate/skins/presets";`,
      `import type { BuiltinSkinPreset } from "@jiumate/skins/presets";`,
      `import type { SkinMode, SkinPackage } from "@jiumate/skins";`,
    ].join("\n");
    expect(runtimeBarrelImportsIn(code)).toEqual([]);
  });

  it("finds a violation written across several lines", () => {
    const code = ["import {", "  renderSkinCss,", `} from "@jiumate/skins";`].join(
      "\n",
    );
    expect(runtimeBarrelImportsIn(code)).toHaveLength(1);
  });
});

describe("web imports of the Node-only barrels", () => {
  it("binds no runtime name to a barrel that pulls in Node built-ins", () => {
    const violations = scanSourceTree();
    const report = violations
      .map((v) => `  ${v.file}: ${v.statement.replace(/\s+/g, " ")}`)
      .join("\n");
    expect(
      violations,
      violations.length === 0
        ? ""
        : `Import from the Node-free sibling instead (${Object.values(NODE_ONLY_BARRELS).join("; ")}):\n${report}`,
    ).toEqual([]);
  });
});
