/**
 * What the address bar makes of what was typed, and how it shows a page's address back.
 *
 * Pure, so the rules are pinned by tests rather than rediscovered in a running app.
 *
 * The rules, in order:
 * - `http://` / `https://` addresses are taken as typed (the URL parser normalises them);
 * - `about:blank` is the one other page a tab may show, the empty one a new tab starts on;
 * - a bare host — `amazon.com/your-orders`, `localhost:3000`, `192.168.1.1` — gets a scheme:
 *   https for a public name, http for a loopback or IP address (a development server rarely
 *   speaks TLS);
 * - anything else — words, a sentence, `file:` or `javascript:` text — is a web search.
 *
 * The agent uses these rules too. It opens pages by URL, and a model that says "search for
 * X" or "open the local dev server" should not have to spell out the scheme; the same pure
 * function serves the address bar and the tool, so the two can never disagree about what a
 * string means.
 */

/** Where a search goes. */
export const SEARCH_URL = "https://www.bing.com/search?q=";

/** The page a new tab starts on, and the address bar shows empty. */
export const BLANK_URL = "about:blank";

/**
 * A domain name: dot-separated labels of letters, digits and inner hyphens, ending in an
 * alphabetic top-level label (or its punycode form). The alphabetic TLD is what keeps `1.5`
 * and `3.14` searches; Unicode letters are allowed so an internationalised name is a name.
 */
const DOMAIN =
  /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})$/iu;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^\[[0-9a-f:.]+\]$/i;

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** The host part of a scheme-less address: everything up to the first `/`, `?` or `#`. */
function hostPart(text: string): string {
  const end = text.search(/[/?#]/);
  return end === -1 ? text : text.slice(0, end);
}

/** `host[:port]` split apart; null when the port is not a port. */
function splitPort(host: string): { name: string; port: string | null } | null {
  // An IPv6 literal carries colons of its own inside the brackets.
  const match = /^(\[[^\]]*\]|[^:]*)(?::(\d{1,5}))?$/.exec(host);
  if (match === null) return null;
  return { name: match[1] ?? "", port: match[2] ?? null };
}

/** Loopback and IP addresses: served over plain http by default. */
function isLocalName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "localhost" || lower.endsWith(".localhost") || IPV4.test(name) || IPV6.test(name)
  );
}

/** Whether the text is a bare host name: `example.com`, `localhost:3000`, `1.2.3.4`. */
export function isBareHost(text: string): boolean {
  const host = hostPart(text);
  const split = splitPort(host);
  if (split === null) return false;
  const { name } = split;
  if (name === "") return false;
  if (DOMAIN.test(name) || IPV4.test(name) || IPV6.test(name)) return true;
  // A single label is a host only when it is localhost: anything else (`intranet`) is a
  // word, and a word is a search.
  return name.toLowerCase() === "localhost" || name.toLowerCase().endsWith(".localhost");
}

/**
 * The address a typed string means.
 *
 * `null` when the text is not an address at all — the caller turns that into a search.
 */
export function addressOf(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed.toLowerCase() === BLANK_URL) return BLANK_URL;

  // A scheme that is already there: taken as typed. `file:` and `javascript:` are NOT
  // accepted — they are not pages the browser may show, and a text that happens to start
  // with one is a search, not an address.
  //
  // The scheme is read from the URL PARSER, and only when it is followed by `//`: the
  // parser reads `localhost:3000` as the scheme "localhost" with the path "3000", so a
  // colon alone says nothing about what the text means.
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  if (scheme !== null) {
    const name = scheme[1]!.toLowerCase();
    if (name !== "http" && name !== "https") return null;
    const parsed = parseUrl(trimmed);
    // `https://` with nothing after it parses but names no host: a search, not an address.
    return parsed !== null && parsed.hostname !== "" ? parsed.toString() : null;
  }
  // `about:` is the one scheme without `//` the browser may show.
  if (/^about:/i.test(trimmed)) {
    const parsed = parseUrl(trimmed);
    return parsed === null ? null : parsed.toString();
  }

  if (!isBareHost(trimmed)) return null;
  const host = hostPart(trimmed);
  const split = splitPort(host);
  if (split === null) return null;
  const schemeFor = isLocalName(split.name) ? "http" : "https";
  const path = trimmed.slice(host.length);
  const withScheme = parseUrl(`${schemeFor}://${host}${path}`);
  return withScheme === null ? null : withScheme.toString();
}

/**
 * The address a typed string means, or a search for it.
 *
 * This is what the address bar navigates to, and what the agent's "open" action navigates
 * to when the model gives it something that is not a URL. A model that says "search for
 * X" gets a search; one that says "open localhost:3000" gets the dev server.
 */
export function resolveAddress(text: string): string {
  const address = addressOf(text);
  if (address !== null) return address;
  return `${SEARCH_URL}${encodeURIComponent(text.trim())}`;
}

/** Whether the address is the empty page a new tab starts on. */
export function isBlankUrl(url: string): boolean {
  return url === BLANK_URL || url === "" || url === "about:blank";
}

/**
 * What the address bar shows for a page: its address, without the scheme and without a
 * leading `www.`, the way a browser does. The empty page shows nothing.
 */
export function displayAddress(url: string): string {
  if (isBlankUrl(url)) return "";
  const parsed = parseUrl(url);
  if (parsed === null) return url;
  const host = parsed.host.replace(/^www\./i, "");
  const rest = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return `${host}${rest === "/" ? "" : rest}`;
}

/** The name a tab shows before the page has a title of its own: the address it is opening. */
export function tabLabel(title: string, url: string): string {
  if (title.trim() !== "") return title;
  const shown = displayAddress(url);
  return shown === "" ? "" : shown;
}
