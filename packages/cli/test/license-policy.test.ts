/**
 * Drift guard for the license policy the build ships under.
 *
 * The gate itself is `scripts/check-licenses.mjs`; what is tested here is the part of it that
 * can be wrong in silence. A license check that quietly answers "fine" is worse than no check at
 * all — the build stays green and the dependency stays in the artifact — so the decision function
 * is exercised against the expressions that actually appear in the wild, plus the shapes that are
 * easy to get wrong.
 *
 * One of those shapes was wrong when this test was written. `(MPL-2.0 OR Apache-2.0) AND GPL-3.0`
 * was passing: stripping the outer parentheses with a pattern rather than a scan removed the
 * opening `(` but not the matching `)`, which left the `OR` looking like the outer operator and
 * made the GPL conjunct vanish. `dompurify` is in this tree under exactly that first half, so the
 * shape is not hypothetical.
 *
 * Lives here rather than at the repo root because the root runs no test suite of its own,
 * following dev-script-entry.test.ts and tsup-target.test.ts.
 */
import { describe, expect, it } from "vitest";
import { checkTree, isAllowed } from "../../../scripts/check-licenses.mjs";

const allows = (expression: string) => isAllowed(expression);

describe("license policy — SPDX evaluation", () => {
  it.each([
    "MIT",
    "ISC",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "0BSD",
    "Unlicense",
    "BlueOak-1.0.0",
    "Zlib",
    "MPL-2.0",
    "Apache-2.0+",
    "MIT-0",
    "CC0-1.0",
  ])("permits %s", (license) => {
    expect(allows(license)).toBe(true);
  });

  it.each([
    "AGPL-3.0",
    "AGPL-3.0-only",
    "AGPL-3.0-or-later",
    "AGPL-1.0",
    "GPL-2.0-or-later",
    "GPL-3.0",
    "LGPL-2.1",
    "LGPL-3.0",
    "SSPL-1.0",
    "BUSL-1.1",
    "Elastic-2.0",
    "CC-BY-NC-4.0",
    "CC-BY-SA-4.0",
    "Unknown",
    "SEE LICENSE IN LICENSE",
    "",
  ])("refuses %s", (license) => {
    expect(allows(license)).toBe(false);
  });

  it("matches SPDX identifiers case-insensitively, so a lowercase GPL is still a GPL", () => {
    expect(allows("gpl-3.0")).toBe(false);
    expect(allows("AgPl-3.0")).toBe(false);
    expect(allows("mit")).toBe(true);
  });

  describe("compound expressions", () => {
    it("takes either side of an OR", () => {
      expect(allows("(MPL-2.0 OR Apache-2.0)")).toBe(true);
      expect(allows("(MIT OR GPL-3.0)")).toBe(true);
    });

    it("needs both sides of an AND", () => {
      expect(allows("(MIT AND GPL-3.0)")).toBe(false);
      expect(allows("(MIT OR ISC) AND Apache-2.0")).toBe(true);
    });

    // The regression this file exists for: the denied half is the *second* conjunct, and the
    // permitted half sits inside parentheses whose closing paren a naive strip removes.
    it("does not let a permitted OR inside parentheses excuse a denied conjunct", () => {
      expect(allows("(MPL-2.0 OR Apache-2.0) AND GPL-3.0")).toBe(false);
      expect(allows("GPL-3.0 AND (MPL-2.0 OR Apache-2.0)")).toBe(false);
    });

    it("unwraps repeated parentheses", () => {
      expect(allows("((MIT))")).toBe(true);
      expect(allows("((AGPL-3.0))")).toBe(false);
    });
  });
});

describe("license policy — tree evaluation", () => {
  const tree = (license: string, name: string) => ({ [license]: [{ name, versions: ["1.0.0"] }] });

  it("reports a denied package with its license and version", () => {
    const result = checkTree(tree("AGPL-3.0", "copyleft-pkg"), new Map());
    expect(result.checked).toBe(1);
    expect(result.offenders).toEqual([
      { name: "copyleft-pkg", versions: ["1.0.0"], license: "AGPL-3.0" },
    ]);
  });

  it("lets a documented exception through and says it was used", () => {
    const result = checkTree(
      tree("AGPL-3.0", "documented-pkg"),
      new Map([["documented-pkg", "why it is acceptable"]]),
    );
    expect(result.offenders).toEqual([]);
    expect([...result.usedExceptions]).toEqual(["documented-pkg"]);
  });

  it("scopes an exception to its package, not its license", () => {
    const result = checkTree(
      tree("AGPL-3.0", "some-other-pkg"),
      new Map([["documented-pkg", "x"]]),
    );
    expect(result.offenders).toHaveLength(1);
  });

  it("passes a tree that is entirely permissive", () => {
    const result = checkTree({ MIT: [{ name: "a" }], "Apache-2.0": [{ name: "b" }] }, new Map());
    expect(result.checked).toBe(2);
    expect(result.offenders).toEqual([]);
  });
});
