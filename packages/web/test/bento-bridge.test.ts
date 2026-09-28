import { describe, expect, it } from "vitest";
import {
  BENTO_BRIDGE_SCRIPT,
  bentoGetMessage,
  isBentoDeck,
  isBentoMessage,
  spliceBentoDoc,
  stripBentoCollab,
  withBentoBridge,
} from "../src/features/chat/bento-bridge";

const DECK = `<!doctype html>
<html><head><title>Deck</title></head>
<body><script type="application/bento+json" id="bento-doc">
{ "format": "bento/slides", "version": 1, "title": "Old" }
</script>
<div id="app"></div><script>/* the runtime */</script></body></html>`;

describe("isBentoDeck", () => {
  it("keys off the document block when the content is there", () => {
    // A deck renamed by hand keeps working: the block is what makes the file one.
    expect(isBentoDeck("renamed.html", DECK)).toBe(true);
    expect(isBentoDeck("renamed.html", DECK.replace("Old", "Renamed"))).toBe(true);
  });

  it("keys off the name when the content has not been fetched", () => {
    // The case that made the Save button invisible: with a preview origin configured the panel
    // mounts the frame straight from the file and never downloads the text, so a preview can be a
    // deck with no content at all.
    expect(isBentoDeck("kimi-k3-strategy.bento.html", undefined)).toBe(true);
    expect(isBentoDeck("Deck.BENTO.HTM", undefined)).toBe(true);
    // A plain HTML file is not one, and a name that merely contains the word is not either.
    expect(isBentoDeck("report.html", undefined)).toBe(false);
    expect(isBentoDeck("bento-notes.html", undefined)).toBe(false);
  });

  it("is false for an HTML file that is not a deck", () => {
    expect(isBentoDeck("report.html", "<html><body><h1>Report</h1></body></html>")).toBe(false);
    expect(isBentoDeck("report.html", undefined)).toBe(false);
  });

  it("accepts single quotes around the type", () => {
    expect(
      isBentoDeck("d.html", `<script type='application/bento+json' id='bento-doc'></script>`),
    ).toBe(true);
  });
});

describe("spliceBentoDoc", () => {
  it("replaces the document block and leaves the runtime alone", () => {
    const next = spliceBentoDoc(DECK, '{"format":"bento/slides","title":"New"}');
    expect(next).not.toBeNull();
    expect(next).toContain('"title":"New"');
    expect(next).not.toContain('"title": "Old"');
    // The parts of the file that are the editor, not the document, survive verbatim.
    expect(next).toContain("<title>Deck</title>");
    expect(next).toContain("<script>/* the runtime */</script>");
  });

  it("escapes every `<`, so JSON containing `</script>` cannot end the block early", () => {
    // A text element whose content mentions a closing script tag. Written raw this ends the
    // document block mid-JSON and the remainder spills into the page as markup.
    const hostile = JSON.stringify({
      format: "bento/slides",
      slides: [{ elements: [{ type: "text", html: "watch </script> this" }] }],
    });
    const next = spliceBentoDoc(DECK, hostile);
    expect(next).not.toBeNull();
    expect(next).not.toContain("</script> this");
    expect(next).toContain("\\u003c/script> this");
    // Exactly one block: the original was replaced, never appended to.
    expect(next!.match(/id="bento-doc"/g)).toHaveLength(1);
  });

  it("returns null when there is no block to write into", () => {
    // Saving must not proceed: there is nowhere for the document to go, and writing the file
    // unchanged would report a save that did not happen.
    expect(spliceBentoDoc("<html><body>no deck here</body></html>", "{}")).toBeNull();
  });

  it("handles a block whose attributes are in another order", () => {
    const file = `<script id="bento-doc" type="application/bento+json">\n{}\n</script>`;
    const next = spliceBentoDoc(file, '{"a":1}');
    expect(next).toContain('{"a":1}');
    expect(next).toMatch(/id="bento-doc"/);
  });
});

describe("withBentoBridge", () => {
  it("injects the shim and the bridge after <head>, shim first", () => {
    const out = withBentoBridge(DECK, "<script>SHIM</script>", "deck.bento.html");
    const shimAt = out.indexOf("SHIM");
    const bridgeAt = out.indexOf(BENTO_BRIDGE_SCRIPT);
    expect(shimAt).toBeGreaterThan(-1);
    expect(bridgeAt).toBeGreaterThan(-1);
    // Order matters: a deck reads localStorage while booting, and that throws in an opaque-origin
    // frame — which would stop the runtime before it ever defines the object the bridge asks for.
    expect(shimAt).toBeLessThan(bridgeAt);
    expect(out.indexOf("<title>Deck</title>")).toBeGreaterThan(shimAt);
  });

  it("declares the deck's title before the bridge, so the bridge can read it", () => {
    const out = withBentoBridge(DECK, "S", "Kimi K3.bento.html");
    const titleAt = out.indexOf("__linsightDeckTitle");
    expect(titleAt).toBeGreaterThan(-1);
    expect(titleAt).toBeLessThan(out.indexOf(BENTO_BRIDGE_SCRIPT));
    expect(out).toContain("Kimi K3.bento.html");
  });

  it("escapes `<` in the title, so a name cannot end the script early", () => {
    const out = withBentoBridge(DECK, "S", "</script><script>bad()</script>");
    expect(out).not.toContain("</script><script>bad()");
    expect(out).toContain("\\u003c");
  });

  it("falls back to <html> and then to the very start", () => {
    expect(withBentoBridge("<html><body>x</body></html>", "S", "t")).toContain("S");
    expect(withBentoBridge("<body>x</body>", "S", "t").startsWith("S")).toBe(true);
  });
});

describe("stripBentoCollab", () => {
  const withCreds = JSON.stringify({
    format: "bento/slides",
    docId: "c5f6ed8c-849f-470f-b58a-c2cd7cbaaec5",
    collab: {
      room: "wss://sync.bento.page/d/room",
      key: "CczeeRqiBprVtv2EUBiPJ1Cg2CbzdUJcR3pVkC7p6JQ",
      on: true,
      role: "writer",
      ownerPriv: "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg",
    },
    slides: [{ id: "s1" }],
  });

  it("removes the credential block and reports that it did", () => {
    const { json, stripped } = stripBentoCollab(withCreds);
    expect(stripped).toBe(true);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.collab).toBeUndefined();
    expect(json).not.toContain("ownerPriv");
    expect(json).not.toContain("MIGHAgEA");
  });

  it("keeps docId, which is identity rather than a credential", () => {
    const { json } = stripBentoCollab(withCreds);
    expect(JSON.parse(json).docId).toBe("c5f6ed8c-849f-470f-b58a-c2cd7cbaaec5");
    expect(json).toContain('"slides"');
  });

  it("leaves a deck with no collab block untouched, and says so", () => {
    const plain = JSON.stringify({ format: "bento/slides", slides: [] });
    const { json, stripped } = stripBentoCollab(plain);
    expect(stripped).toBe(false);
    expect(json).toBe(plain);
  });

  it("passes unparseable JSON through rather than refusing the save", () => {
    // Not our business to fix a document the engine produced.
    const { json, stripped } = stripBentoCollab("not json");
    expect(stripped).toBe(false);
    expect(json).toBe("not json");
  });
});

describe("messages", () => {
  it("recognises its own three message types and nothing else", () => {
    expect(isBentoMessage({ app: "linsight", type: "bento-doc", rid: 1, json: "{}" })).toBe(true);
    expect(isBentoMessage({ app: "linsight", type: "bento-ready" })).toBe(true);
    expect(isBentoMessage({ app: "linsight", type: "bento-unavailable", rid: 1 })).toBe(true);
    // Anything else — including a same-shaped message from another app — is ignored rather than
    // trusted: the handler settles a pending save from what it accepts here.
    expect(isBentoMessage({ app: "other", type: "bento-doc", rid: 1, json: "{}" })).toBe(false);
    expect(isBentoMessage({ app: "linsight", type: "something-else" })).toBe(false);
    expect(isBentoMessage(null)).toBe(false);
    expect(isBentoMessage("bento-doc")).toBe(false);
  });

  it("stamps the app marker on the ask", () => {
    expect(bentoGetMessage(7)).toEqual({ app: "linsight", type: "bento-get", rid: 7 });
  });
});
