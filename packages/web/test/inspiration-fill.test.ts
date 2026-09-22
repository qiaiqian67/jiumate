/**
 * Clicking an inspiration case FILLS the composer and sends nothing.
 *
 * Two halves. `buildInspirationFill` decides what the composer becomes — the plain prompt (never a
 * `[use_skills]` block, which the send path builds and a user cannot sensibly edit), taking the text
 * body outright so a typed draft is cleared rather than appended to, with the case's installed
 * skills joining the selection so that pressing Send produces exactly the message the case describes.
 * And the click path in the picker, checked with the TypeScript parser the way
 * test/command-policy-add-rule.test.ts checks JSX structure: a regex cannot tell which handler an
 * onClick names, and "the row no longer submits" is precisely a claim about that handler.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  buildInspirationFill,
  resolveInvokeAgent,
} from "../src/features/inspiration/inspiration-fill";
import { buildSkillsMessage } from "../src/features/chat/skill-use";

const PROMPT = "Build a cute penguin sledding game.";

const fill = (over: Partial<Parameters<typeof buildInspirationFill>[0]> = {}) =>
  buildInspirationFill({
    prompt: PROMPT,
    caseSkills: [],
    installedSkills: [],
    selectedSkills: [],
    ...over,
  });

describe("buildInspirationFill — what lands in the text body", () => {
  it("puts the plain prompt in an empty composer", () => {
    expect(fill().text).toBe(PROMPT);
  });

  it("never writes the [use_skills] block into the textarea", () => {
    // The composer wraps the selection at send time; wrapping here would both double it up and
    // leave a marker block in a box the user is meant to edit.
    const f = fill({ caseSkills: ["web-design"], installedSkills: ["web-design"] });
    expect(f.text).toBe(PROMPT);
    expect(f.text).not.toContain("use_skills");
    expect(f.text).not.toBe(buildSkillsMessage(["web-design"], PROMPT));
  });

  it("clears a typed draft rather than appending behind it", () => {
    // A click asks for THIS prompt; leaving the old text in front made the user find and
    // delete the leftover half themselves.
    expect(fill({ prompt: PROMPT }).text).toBe(PROMPT);
  });

  it("leaves nothing of a previous case behind when a second one is clicked", () => {
    // Browsing the list must not stack one canned prompt behind another.
    const second = fill({ prompt: "Other prompt." });
    expect(second.text).toBe("Other prompt.");
    expect(second.text).not.toContain(PROMPT);
  });

  it("carries the prompt through verbatim, newlines and all", () => {
    const prompt = "Line one.\n\n## Section\n- a\n- b";
    expect(fill({ prompt }).text).toBe(prompt);
  });
});

describe("buildInspirationFill — what lands in the skills dropdown", () => {
  it("preselects the case's skills", () => {
    expect(fill({ caseSkills: ["web-design"], installedSkills: ["web-design"] }).skills).toEqual([
      "web-design",
    ]);
  });

  it("drops skills the selected Agent has not installed", () => {
    // Pinning a Skill that isn't there is what the old auto-submit filtered out too.
    const f = fill({
      caseSkills: ["linsight-sdk", "web-design"],
      installedSkills: ["web-design"],
    });
    expect(f.skills).toEqual(["web-design"]);
  });

  it("joins the existing selection instead of replacing it, without duplicating", () => {
    const f = fill({
      caseSkills: ["linsight-sdk", "web-design"],
      installedSkills: ["linsight-sdk", "web-design", "memory"],
      selectedSkills: ["memory", "web-design"],
    });
    expect(f.skills).toEqual(["memory", "web-design", "linsight-sdk"]);
  });

  it("leaves the selection untouched for a case that pins nothing", () => {
    const selectedSkills = ["memory"];
    expect(fill({ selectedSkills, installedSkills: selectedSkills }).skills).toEqual(["memory"]);
  });
});

describe("resolveInvokeAgent — the suggested Agent is a hint", () => {
  it("uses the case's own Agent when the Project has it", () => {
    expect(
      resolveInvokeAgent({
        suggested: "researcher",
        currentAgentId: "default",
        projectAgentIds: ["default", "researcher"],
      }),
    ).toBe("researcher");
  });

  it("falls back to the Agent the user is on when the suggestion is not here", () => {
    // A case is server-global and an Agent is per-Project, so a name imported from another
    // deployment has to land somewhere usable rather than fail.
    expect(
      resolveInvokeAgent({
        suggested: "researcher",
        currentAgentId: "writer",
        projectAgentIds: ["default", "writer"],
      }),
    ).toBe("writer");
  });

  it("falls back to the Project's first Agent when neither is here", () => {
    expect(
      resolveInvokeAgent({
        suggested: "researcher",
        currentAgentId: "ghost",
        projectAgentIds: ["default"],
      }),
    ).toBe("default");
  });

  it("returns null only when the Project has no Agent at all", () => {
    expect(
      resolveInvokeAgent({ suggested: null, currentAgentId: null, projectAgentIds: [] }),
    ).toBeNull();
  });

  it("prefers the current Agent for a case that suggests none", () => {
    expect(
      resolveInvokeAgent({
        suggested: null,
        currentAgentId: "writer",
        projectAgentIds: ["default", "writer"],
      }),
    ).toBe("writer");
  });
});

const SOURCE = fileURLToPath(
  new URL("../src/features/inspiration/inspiration-picker.tsx", import.meta.url),
);
const source = ts.createSourceFile(
  SOURCE,
  readFileSync(SOURCE, "utf8"),
  ts.ScriptTarget.Latest,
  /* setParentNodes */ true,
  ts.ScriptKind.TSX,
);

/** Attribute text of the first JSX element carrying `marker` among its attributes. */
function attributes(marker: string): string | null {
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    const tag = ts.isJsxSelfClosingElement(node)
      ? node
      : ts.isJsxElement(node)
        ? node.openingElement
        : null;
    if (tag) {
      const text = tag.attributes.getText(source);
      if (text.includes(marker)) {
        found = text;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("the case row's click path", () => {
  it("routes the click to the fill callback with the case's own skills", () => {
    const attrs = attributes("copy.description");
    expect(attrs, "the case row button").not.toBeNull();
    expect(attrs).toContain("onClick={onFill}");
    expect(attrs).toContain("disabled={disabled}");
  });

  it("cannot send: the row neither posts a task nor creates a Session", () => {
    const text = source.getText(source);
    const start = text.indexOf("function CaseRow(");
    const end = text.indexOf("export function InspirationPicker(");
    expect(start, "the CaseRow component").toBeGreaterThan(-1);
    expect(end, "the InspirationPicker component").toBeGreaterThan(start);
    const row = text.slice(start, end);
    expect(row).not.toContain("api.");
    expect(row).not.toContain("onSend");
    expect(row).not.toContain("navigate(");
  });

  it("waits for the installed skills before a case row can be clicked", () => {
    // Filling before the list arrives would merge against an empty one and silently drop the
    // case's pins — the same gate the composer's own pruning cannot help with.
    const text = source.getText(source);
    expect(text).toContain("disabled={!skillsReady}");
  });
});
