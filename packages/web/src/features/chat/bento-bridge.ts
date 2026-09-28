/**
 * The message bridge to a Bento deck running in the preview frame.
 *
 * A `.bento.html` deck is a self-contained file: the whole editor — `bento-slides.js` and the
 * runtime behind it — ships inside it, and opening the file boots straight into the editor. That
 * makes it the one preview in this panel that can be *edited in place*, and it is also why its own
 * Save button cannot work here.
 *
 * Save is wired to `showSaveFilePicker`, and the browser refuses that call from a cross-origin
 * subframe ("Cross origin sub frames aren't allowed to show a file picker"). Both of this panel's
 * frames are cross-origin by construction — the isolated preview lives on its own origin, and the
 * `srcDoc` fallback has an opaque one — so there is no sandbox setting that fixes it. It is not a
 * misconfiguration to correct; the API does not reach into a frame like this.
 *
 * So the host saves instead, which is the same division of labour as the .docx editor: the thing
 * that holds the document hands out the bytes, and the panel decides where they go. Bento publishes
 * both halves of that for exactly this case — `window.bento.doc` to read the live document and
 * `window.bento.loadDoc(json)` to write one back — so the only thing missing is a way to ask, from
 * outside a cross-origin frame. That is what the injected script below is.
 *
 * What travels is the document as JSON, because that is what a deck *is*: the document lives in one
 * `<script type="application/bento+json" id="bento-doc">` block, and everything else in the file is
 * the runtime. Writing a save therefore means replacing that block and leaving the rest untouched —
 * never regenerating the HTML, which would throw away the runtime the file was built with.
 */

/** Marker on every message this bridge sends or accepts, so a page's other messages are ignored. */
const APP = "jiumate";
const TYPE_DOC = "bento-doc";
const TYPE_READY = "bento-ready";
const TYPE_UNAVAILABLE = "bento-unavailable";
const TYPE_GET = "bento-get";

export interface BentoDocMessage {
  app: typeof APP;
  type: typeof TYPE_DOC;
  /** Echoed request id, so a reply can be matched to the ask that produced it. */
  rid: number;
  json: string;
}

export interface BentoReadyMessage {
  app: typeof APP;
  type: typeof TYPE_READY;
}

export interface BentoUnavailableMessage {
  app: typeof APP;
  type: typeof TYPE_UNAVAILABLE;
  rid: number;
}

/**
 * Is this message one of ours? Written as a type predicate so callers narrow in one step instead of
 * re-checking the shape at every use.
 */
export function isBentoMessage(
  data: unknown,
): data is BentoDocMessage | BentoReadyMessage | BentoUnavailableMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as { app?: unknown; type?: unknown };
  return (
    message.app === APP &&
    (message.type === TYPE_DOC || message.type === TYPE_READY || message.type === TYPE_UNAVAILABLE)
  );
}

/** The message the host sends to ask for the document. */
export function bentoGetMessage(rid: number): { app: string; type: string; rid: number } {
  return { app: APP, type: TYPE_GET, rid };
}

/**
 * The injected script.
 *
 * Kept to one line of ES5 with no dependencies, because it is spliced into a document that will run
 * it before anything of its own — an unparseable byte here takes the whole deck down with it, and
 * the deck is the user's file, not ours.
 *
 * `window.bento` does not exist until the runtime boots, and it boots after the document parses, so
 * readiness is polled rather than assumed. The poll gives up after ~20s; a deck that never boots is
 * a broken deck, and an eternal `setInterval` in a frame the user has moved on from is worse than
 * silence.
 */
export const BENTO_BRIDGE_SCRIPT =
  "<script>(function(){function post(m){try{parent.postMessage(m,'*')}catch(e){}}" +
  "function doc(){try{return window.bento&&window.bento.doc?window.bento.doc:null}catch(e){return null}}" +
  // The file's own `<title>` is `bento/slides` — the shell's name, not the deck's. The host passes
  // the file name in and it is re-applied every time the runtime reports itself, because the
  // runtime sets its own title on boot and a single write here would be overwritten.
  "function title(){try{if(window.__jiumateDeckTitle)document.title=window.__jiumateDeckTitle}catch(e){}}" +
  "var n=0,t=setInterval(function(){if(doc()){clearInterval(t);title();post({app:'" +
  APP +
  "',type:'" +
  TYPE_READY +
  "'})}else if(++n>200){clearInterval(t)}},100);" +
  "window.addEventListener('message',function(e){var d=e.data;if(!d||d.app!=='" +
  APP +
  "'||d.type!=='" +
  TYPE_GET +
  "')return;title();" +
  "var j=doc();if(!j){post({app:'" +
  APP +
  "',type:'" +
  TYPE_UNAVAILABLE +
  "',rid:d.rid});return}" +
  "post({app:'" +
  APP +
  "',type:'" +
  TYPE_DOC +
  "',rid:d.rid,json:JSON.stringify(j)})})})();</script>";

/**
 * The file name to show as the deck's title, encoded for a `<script>` body.
 *
 * `<` becomes `\u003c` for the same reason the document JSON needs it: the value lands inside a
 * script element, and a name containing `</script>` would otherwise end it early.
 */
function titleScript(title: string): string {
  const encoded = JSON.stringify(title ?? "").replace(/</g, "\\u003c");
  return `<script>window.__jiumateDeckTitle=${encoded};</script>`;
}

/**
 * Injects a script at the earliest script position in the HTML: right after `<head>`, else right
 * after `<html>`, else at the very start.
 */
function injectAtStart(html: string, script: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + script);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + script);
  return script + html;
}

/**
 * The bridge plus, for an opaque-origin frame, the storage shim.
 *
 * A deck reads `localStorage` on boot, and in the `srcDoc` frame that throws a SecurityError which
 * stops the runtime before it ever defines `window.bento` — the bridge would then report a deck
 * that cannot be read rather than a deck that cannot boot. The shim has to be in place first, so it
 * is injected first.
 */
export function withBentoBridge(html: string, storageShim: string, title: string): string {
  // Injected in one pass, in this order: each `injectAtStart` lands immediately after `<head>`, so
  // two separate calls would put the later one FIRST and run the bridge before the shim. The title
  // goes before the bridge so the bridge can read it.
  return injectAtStart(html, storageShim + titleScript(title) + BENTO_BRIDGE_SCRIPT);
}

/**
 * Whether a file is a Bento deck.
 *
 * Two signals, because neither is sufficient on its own. The name is checked first: decks are named
 * `<Topic>.bento.html` by convention, and the name is the only thing available when a preview origin
 * is configured — in that mode the panel mounts the frame straight from the file and never downloads
 * the text, so a content-only test would answer "not a deck" for every real deck. The block is
 * checked second, for a deck renamed by hand. The block sits near the top of the file, so the content
 * test still holds when a preview's content was truncated on the way here.
 */
export function isBentoDeck(name: string, html: string | undefined): boolean {
  if (/\.bento\.html?$/i.test(name)) return true;
  return typeof html === "string" && /type=["']application\/bento\+json["']/.test(html);
}

/** The document block, captured whole. */
const BENTO_BLOCK = /(<script[^>]*\bid=["']bento-doc["'][^>]*>)([\s\S]*?)(<\/script>)/i;

/**
 * Replaces the document block's contents with `json`, returning the new file — or `null` when the
 * file has no such block, in which case there is nothing to write into and saving must not proceed.
 *
 * Every `<` in the JSON becomes the escape `\u003c`. This is the format's own requirement and it is
 * load-bearing: the block is inside a `<script>` element, so a `</script>` anywhere in the document
 * — in a text element's `html`, say — ends the block early and the rest of the JSON spills into the
 * page as markup. Escaping makes that unrepresentable rather than merely unlikely.
 */
export function spliceBentoDoc(html: string, json: string): string | null {
  if (!BENTO_BLOCK.test(html)) return null;
  const safe = json.replace(/</g, "\\u003c");
  return html.replace(BENTO_BLOCK, (_match, open: string, _body: string, close: string) => {
    return `${open}\n${safe}\n${close}`;
  });
}

/**
 * Removes the `collab` block from a document, reporting whether there was one to remove.
 *
 * A deck with collaboration switched on carries the credentials to that room in its own document —
 * the room address, a symmetric key, and on an owner copy an EC private key, all in plaintext.
 * Bento's own guide is explicit that this is what makes sharing work ("the file is the invitation")
 * and equally explicit that anything receiving the file receives the room: a chat, a ticket, a
 * harness, or a model provider's logs. A workspace file is read by the Agent, so it is the first of
 * those.
 *
 * The runtime mints dormant credentials on first open, which means a deck that was merely *opened*
 * here picks them up — and then the next save would write them into the file. Stripping on the way
 * out is what keeps a workspace copy from accumulating them.
 *
 * Removing them does not revoke anything: whoever has the old file still has the old room. Rotation
 * is the only retraction, and it happens in the deck's own Share menu.
 *
 * `docId` is deliberately left alone — it is the document's identity, not a credential.
 */
export function stripBentoCollab(json: string): { json: string; stripped: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // Not our business to fix a document the engine produced; saving it as-is beats refusing.
    return { json, stripped: false };
  }
  if (typeof parsed !== "object" || parsed === null || !("collab" in parsed)) {
    return { json, stripped: false };
  }
  delete (parsed as Record<string, unknown>).collab;
  return { json: JSON.stringify(parsed), stripped: true };
}
