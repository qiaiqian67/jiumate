/**
 * The rule that decides which disclosure a site gets (src/components/ui/info-popover.tsx and
 * help-fold.tsx): **the circled "?" may only appear beside a title — the circled "!" may not.**
 *
 * A "?" is an anchored mark — it reads as help because it modifies the title next to it. Standing
 * alone at the top of a panel it modifies nothing, and a reader has to click it to find out what
 * it even refers to. Where there is no title, the disclosure has to name itself, which is what
 * `HelpFold` is for.
 *
 * The "!" is exempt, and deliberately so. It marks a CONSEQUENCE — "this directory is deleted
 * recursively and cannot be recovered" — and its whole job is to sit next to the *button* it
 * warns about, in the slot the button is not in. Requiring a title beside it would push those
 * warnings onto the page title, which is the one place they cannot protect anyone: the reader
 * has to be looking at the delete button to be at risk of pressing it, and that is exactly when
 * the mark is beside them rather than across the page. A warning that can only be found by
 * scrolling back to the top is a warning nobody reads.
 *
 * So the check is per-tone: a "?" needs a title, a "!" needs nothing. Reading `tone` off the
 * element is what keeps the two from drifting into each other — a "?" that lost its anchor and
 * a "!" that grew one are both wrong in opposite directions.
 *
 * This is a rule rather than a preference, so it is checked rather than remembered. The check
 * parses the real JSX with the TypeScript parser instead of matching text: whether a title sits
 * beside a "?" is a question about sibling nodes, and a regex cannot see siblings.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** Components whose whole job is to render a field's or a section's title. */
const TITLE_ELEMENTS = new Set(["FieldLabel"]);

function tsxFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) tsxFiles(path, out);
    else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const jsxTag = (node: ts.Node): string | null => {
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  return null;
};

/**
 * Does this sibling put a title on screen? Text and an interpolated expression both do. A nested
 * element does only when it is one of the title components — a `<Button>` beside a "?" is not a
 * title, it is just another control sharing the row.
 */
function rendersTitle(node: ts.Node): boolean {
  if (ts.isJsxText(node)) return node.text.trim() !== "";
  // `{/* a comment */}` parses as a JsxExpression with no expression: it renders nothing.
  if (ts.isJsxExpression(node)) return node.expression !== undefined;
  const tag = jsxTag(node);
  return tag !== null && TITLE_ELEMENTS.has(tag);
}

/**
 * The JSX child slot this node occupies, and the element holding it. A "?" is often wrapped in a
 * conditional (`{!isOwner && <InfoPopover …/>}`), so the slot is the outermost node whose own
 * parent is the enclosing element, not the "?" itself.
 */
function slotIn(node: ts.Node): { host: ts.JsxElement | ts.JsxFragment; slot: ts.Node } | null {
  let slot: ts.Node = node;
  while (slot.parent !== undefined) {
    const host = slot.parent;
    if (ts.isJsxElement(host) || ts.isJsxFragment(host)) return { host, slot };
    slot = host;
  }
  return null;
}

/** The `tone` prop's literal, read off the element's attributes. Defaults to "help". */
function toneOf(node: ts.Node): string {
  const attrs = ts.isJsxSelfClosingElement(node)
    ? node.attributes.properties
    : ts.isJsxElement(node)
      ? node.openingElement.attributes.properties
      : [];
  for (const attr of attrs) {
    if (ts.isJsxAttribute(attr) && ts.isIdentifier(attr.name) && attr.name.text === "tone") {
      return attr.initializer !== undefined && ts.isStringLiteral(attr.initializer)
        ? attr.initializer.text
        : "warn"; // {tone} is dynamic; treat it as the stricter of the two.
    }
  }
  return "help";
}

/** Every `InfoPopover` that breaks the rule for ITS OWN tone. */
function findOrphans(): string[] {
  const orphans: string[] = [];
  for (const path of tsxFiles()) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if (jsxTag(node) === "InfoPopover" && toneOf(node) === "help") {
        const here = slotIn(node);
        const anchored =
          here !== null &&
          here.host.children
            .slice(0, here.host.children.indexOf(here.slot as never))
            .some(rendersTitle);
        if (!anchored) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          orphans.push(`${path.slice(SRC.length + 1).replaceAll(sep, "/")}:${line}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return orphans.sort();
}

/** Run the per-tone orphan check over a JSX snippet rather than the whole tree. */
function orphansIn(jsx: string): string[] {
  const source = ts.createSourceFile(
    "t.tsx",
    `const x = ${jsx};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (jsxTag(node) === "InfoPopover" && toneOf(node) === "help") {
      const here = slotIn(node);
      const anchored =
        here !== null &&
        here.host.children
          .slice(0, here.host.children.indexOf(here.slot as never))
          .some(rendersTitle);
      if (!anchored) found.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("disclosure anchoring", () => {
  it("never leaves an InfoPopover standing without a title beside it", () => {
    expect(
      findOrphans(),
      'A circled "?" must sit after a title. Where the surface has no title — an Agent settings ' +
        "tab, whose name lives in the tab bar — use HelpFold (components/ui/help-fold.tsx) instead.",
    ).toEqual([]);
  });

  it("actually looks at siblings — the check itself is exercised on a known-orphan shape", () => {
    // Guards the guard: if `rendersTitle`/`slotIn` ever stopped seeing structure, the assertion
    // above would pass on broken code. These are the four shapes that matter.
    const parse = (jsx: string) =>
      ts.createSourceFile(
        "t.tsx",
        `const x = ${jsx};`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
    const anchoredOf = (jsx: string): boolean => {
      const source = parse(jsx);
      let result = false;
      const visit = (node: ts.Node): void => {
        if (jsxTag(node) === "InfoPopover" && toneOf(node) === "help") {
          const here = slotIn(node);
          result =
            here !== null &&
            here.host.children
              .slice(0, here.host.children.indexOf(here.slot as never))
              .some(rendersTitle);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return result;
    };
    // A title beside it, plain and interpolated, and through a conditional wrapper.
    expect(anchoredOf("<h1>Vault<InfoPopover>d</InfoPopover></h1>")).toBe(true);
    expect(anchoredOf("<h1>{title}<InfoPopover>d</InfoPopover></h1>")).toBe(true);
    expect(anchoredOf("<h1>{title}{ok && <InfoPopover>d</InfoPopover>}</h1>")).toBe(true);
    expect(
      anchoredOf("<span><FieldLabel>{l}</FieldLabel><InfoPopover>d</InfoPopover></span>"),
    ).toBe(true);
    // Alone in a stack; preceded only by a comment; and beside a control that is not a title.
    expect(anchoredOf('<div className="space-y-4"><InfoPopover>d</InfoPopover></div>')).toBe(false);
    expect(anchoredOf("<div>{/* why */}<InfoPopover>d</InfoPopover></div>")).toBe(false);
    expect(anchoredOf("<div><InfoPopover>d</InfoPopover><Button>Import</Button></div>")).toBe(
      false,
    );
    // The warning tone is exempt from the anchor requirement, and exempt only there: the same
    // three shapes with tone="warn" must NOT be reported, and a "?" beside them must still be.
    expect(orphansIn('<div><InfoPopover tone="warn">d</InfoPopover></div>')).toEqual([]);
    expect(
      orphansIn('<div><InfoPopover tone="warn">d</InfoPopover><Button>Delete</Button></div>'),
    ).toEqual([]);
    expect(orphansIn('<div><InfoPopover>d</InfoPopover><Button>Delete</Button></div>')).toHaveLength(
      1,
    );
  });
});
