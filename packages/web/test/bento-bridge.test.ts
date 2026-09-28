import { describe, expect, it } from "vitest";
import {
  BENTO_BRIDGE_SCRIPT,
  bentoGetMessage,
  isBentoDeck,
  isBentoMessage,
  spliceBentoDoc,
  withBentoBridge,
} from "../src/features/chat/bento-bridge";

const DECK = `<!doctype html>
<html><head><title>Deck</title></head>
<body><script type="application/bento+json" id="bento-doc">
{ "format": "bento/slides", "version": 1, "title": "Old" }
</script>
<div id="app"></div><script>/* the runtime */</script></body></html>`;

describe("isBentoDeck", () => {
  it("keys off the document block, not the file name", () => {
    expect(isBentoDeck(DECK)).toBe(true);
    // Renamed by hand, still a deck.
    expect(isBentoDeck(DECK.replace("Old", "Renamed"))).toBe(true);
  });

  it("is false for an HTML file that is not a deck", () => {
    expect(isBentoDeck("<html><body><h1>Report</h1></body></html>")).toBe(false);
    expect(isBentoDeck(undefined)).toBe(false);
  });

  it("accepts single quotes around the type", () => {
    expect(isBentoDeck(`<script type='application/bento+json' id='bento-doc'></script>`)).toBe(
      true,
    );
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
    const out = withBentoBridge(DECK, "<script>SHIM</script>");
    const shimAt = out.indexOf("SHIM");
    const bridgeAt = out.indexOf(BENTO_BRIDGE_SCRIPT);
    expect(shimAt).toBeGreaterThan(-1);
    expect(bridgeAt).toBeGreaterThan(-1);
    // Order matters: a deck reads localStorage while booting, and that throws in an opaque-origin
    // frame — which would stop the runtime before it ever defines the object the bridge asks for.
    expect(shimAt).toBeLessThan(bridgeAt);
    expect(out.indexOf("<title>Deck</title>")).toBeGreaterThan(shimAt);
  });

  it("falls back to <html> and then to the very start", () => {
    expect(withBentoBridge("<html><body>x</body></html>", "S")).toContain("S");
    expect(withBentoBridge("<body>x</body>", "S").startsWith("S")).toBe(true);
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
