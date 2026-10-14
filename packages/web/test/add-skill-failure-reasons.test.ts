/**
 * The add-skill dialog's all-failed branch must say **why**.
 *
 * "没有添加任何技能" reached the user while the server had already computed a per-skill `reason`
 * for every entry in `failed` and the client dropped all of it. The partial-success branch beside
 * it always spoke those reasons; only the total-failure branch threw them away — which is the one
 * a user actually needs them in, since it is the branch that explains why nothing is on disk now.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dialog = fs.readFileSync(
  path.join(__dirname, "..", "src", "features", "plugins", "add-skill-dialog.tsx"),
  "utf8",
);
const zh = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "strings.ts"), "utf8");
const en = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "strings-en.ts"), "utf8");

describe("add-skill: the all-failed branch", () => {
  it("speaks the server's reasons instead of discarding them", () => {
    const branch = dialog.slice(
      dialog.indexOf("if (names.length === 0)"),
      dialog.indexOf("if (result.failed.length > 0)"),
    );
    // The reasons are read, joined per skill, and passed to the error.
    expect(branch).toContain("result.failed");
    expect(branch).toContain("f.reason");
    expect(branch).toContain("S.plugins.addSkillAllFailed(reasons)");
  });

  it("still falls back to the generic sentence when no reason came back", () => {
    // A server that answers 201 with an empty `added` *and* an empty `failed` is a distinct case:
    // there is genuinely nothing to report, and the message must not render as "没有添加任何技能："
    // with nothing after it.
    const branch = dialog.slice(
      dialog.indexOf("if (names.length === 0)"),
      dialog.indexOf("if (result.failed.length > 0)"),
    );
    expect(branch).toMatch(/reasons === ""\s*\? S\.plugins\.addSkillNoneAdded/);
  });

  it("keeps the partial-success branch reporting reasons too", () => {
    expect(dialog).toContain("result.failed.map((f) => `${f.name}（${f.reason}）`)");
  });

  it("has the new key in both dictionaries", () => {
    for (const src of [zh, en]) {
      expect(src).toContain("addSkillAllFailed:");
      expect(src).toContain("addSkillNoneAdded:");
    }
  });
});
