/**
 * 连接器页签的「添加连接器」按钮，必须真的打开那个对话框。
 *
 * **这是一个断过的链路。** 页头的按钮已经存在（和别的页签一样占头部同一个位置），文案也已经是
 * 「添加连接器」；但它只把一个 `addNonce` 传给 `ConnectorsTab`，而那个 tab 接下这个 prop 就再没
 * 用过。于是页头那个按钮点了什么都不发生，而列表下面另有一个「添加 MCP Server」按钮是唯一有效的
 * 入口——同一个对话框的两个入口，还用了两个不同的名字。
 *
 * 两件事一起坏，比只坏一件更难看出来：底下那个能点，所以功能"看起来是好的"；只是上面那个是死的。
 *
 * 所以这里断言的是**链路通**，不是"有一个按钮"：
 *
 * 1. 页头有按钮，文案是「添加连接器」；
 * 2. tab 把 nonce **转发**给 section（不是接下就算）；
 * 3. section 真的监听它并打开表单；
 * 4. section 自己**不再画**第二个按钮。
 *
 * 全部读源码：这里要抓的是"prop 一路传到没有消费它的地方"这种结构问题，渲染不出来。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

const page = src("features", "plugins", "plugins-page.tsx");
const tab = src("features", "plugins", "connectors-tab.tsx");
const section = src("features", "agents", "mcp-servers-section.tsx");

describe("the connectors tab has exactly one add button, and it works", () => {
  it("puts the add button in the page toolbar, labelled 添加连接器", () => {
    expect(page).toContain("S.plugins.addConnector}");
    // The page's button is the one that drives the section's form.
    expect(page).toContain("setConnectorsAddNonce((n) => n + 1)");
    expect(page).toContain("addNonce={connectorsAddNonce}");
  });

  it("forwards the nonce instead of swallowing it", () => {
    // This is the link that was missing: the prop arrived at the tab and stopped there.
    expect(tab).toContain("addNonce={addNonce}");
  });

  it("has the section act on the nonce", () => {
    expect(section).toContain("addNonce");
    // A ref rather than a bare effect, so the first render (nonce unchanged, form closed) is a
    // no-op and pressing the button twice opens the form twice.
    expect(section).toContain("lastAddNonce");
    expect(section).toMatch(
      /if \(addNonce === lastAddNonce\.current\) return;[\s\S]{0,200}openAdd\(\)/,
    );
  });

  it("does not draw a second add button below the list", () => {
    // The old state: 「添加连接器」 in the header, 「添加 MCP Server」 under the cards. One dialog,
    // two doors, two names.
    expect(tab).toContain("hideAddButton");
    expect(section).toContain("!readOnly && !hideAddButton");
  });

  it("keeps the section's own button on the agent Tools tab", () => {
    // Hiding it everywhere would leave the Agent's Tools tab with no way to add at all — that
    // surface has no toolbar button of its own, so the section's is the only one there.
    const agentPage = src("features", "agents", "agent-settings-page.tsx");
    expect(agentPage).not.toContain("hideAddButton");
  });
});

describe("the connectors tab states nothing the tab's name does not", () => {
  it("drops the paragraph explaining that the registry is shared", () => {
    // It said the same thing as the header: this is the project's one list, and agents keep copies.
    // A paragraph under a tab called 连接器, repeating that the tab is the project's list.
    expect(tab).not.toContain("connectorsDesc");
    expect(tab).not.toContain("connectorsReadOnly");
  });

  it("drops the section's own heading on this tab only", () => {
    // 「MCP Server」 under a tab named 连接器 states the same fact twice, and the user who just
    // clicked the tab has been told it already. Gated on the cards layout, so the Agent's Tools
    // tab — which has no tab of its own to be its heading — keeps its label.
    expect(section).toContain('target.layout !== "cards"');
  });

  it("leaves the saved toast, which is the one line the user cannot infer", () => {
    // Saving changes nothing visible on this page; the consequence is on another one. That is not
    // something the header implies, so this one stays.
    expect(tab).toContain("connectorsSavedToast");
  });

  it("removes the retired strings from both dictionaries", () => {
    // Left in place, an unused string is what the next change reaches for without asking why it
    // stopped being used — and why it was removed in the first place.
    for (const dict of [src("lib", "strings.ts"), src("lib", "strings-en.ts")]) {
      expect(dict).not.toContain("connectorsDesc:");
      expect(dict).not.toContain("connectorsReadOnly:");
      expect(dict).not.toContain("connectorsEmpty:");
    }
  });
});

describe("a connector card is drawn like a plugin card", () => {
  it("overlays its controls instead of letting them push the name", () => {
    // Without the overlay the two buttons sat inline and cost the title a third of its width,
    // wrapping 「http · auto」 onto a second line — the clearest sign that this list was not the
    // same card system as the plugins one.
    expect(section).toContain("actionOverlay");
  });

  it("uses the plugin card's 28px glyph buttons, not labelled ghost buttons", () => {
    // 「编辑」「删除」 in ghost buttons were too wide for a row of controls, and one of the two
    // names this action carries elsewhere (删除, on the plugin card) — so the connectors list had
    // a Delete that did not look like the Delete beside it.
    expect(section).toContain("PENCIL_ICON");
    expect(section).toContain("TRASH_ICON");
    expect(section).toMatch(/className="h-7 w-7 shrink-0 justify-center p-0"/);
    // Scoped to the **cards** branch: the table layout on the Agent's Tools tab keeps its own
    // labelled buttons, which is a different surface with a different row to fit. A file-wide
    // "no ghost buttons" rule would have been asserting about a screen this change did not touch.
    const cardsBranch = /target\.layout === "cards" \? \([\s\S]*?\n      \) : \(/.exec(section);
    expect(cardsBranch, "cards branch not found").not.toBeNull();
    expect(cardsBranch![0]).not.toMatch(/variant="ghost"/);
    expect(cardsBranch![0]).toMatch(/GlyphIcon/);
  });
});
