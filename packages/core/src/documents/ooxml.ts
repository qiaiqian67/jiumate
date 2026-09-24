/**
 * Zip and XML helpers shared by the OOXML (.pptx) and ODF (.odt/.ods/.odp) extractors.
 *
 * Both families are a zip whose parts are XML, so both need the same two primitives — read one
 * part out of the archive, and walk a parsed tree — and nothing else. Keeping them here rather
 * than in either format module is what makes the two extractors readable: what is left in each
 * is the part that is actually about that format.
 */
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { DocumentExtractError } from "./types.js";

/**
 * Parser settings for OOXML and ODF.
 *
 * `ignoreAttributes: false` is the important one: in both formats the text is not in an element
 * body but in attributes (`<a:t>` holds it as a child, but `<text:p text:style-name="...">` and
 * `<draw:page draw:name="...">` carry meaning as attributes), and a parser that drops attributes
 * loses slide order and page names. `isArray` is not set: whether an element repeats is decided
 * per call by `asArray`, which is explicit at the point of use.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

/**
 * The same settings, but keeping child order.
 *
 * The object form above is convenient and lossy in one specific way that matters: repeated
 * siblings collapse into one array under one key, so a document whose body is `<text:h>`,
 * `<text:p>`, `<text:h>` comes back as two headings and a paragraph with no way to know the
 * paragraph sat between them. ODF needs the order, so it parses with this instead — every node
 * becomes `{ tag: children[], ":@": attributes }` in an array that preserves sequence.
 */
const orderedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  preserveOrder: true,
});

/** One node of an order-preserving parse: a single tag key, its children, and its attributes. */
export interface OrderedNode {
  [tag: string]: OrderedNode[] | Record<string, string> | undefined;
}

/** Parses one archive entry preserving child order, or null when the entry is absent. */
export function parsePartOrdered(
  archive: Record<string, Uint8Array>,
  name: string,
): OrderedNode[] | null {
  const text = readPart(archive, name);
  if (text === null) return null;
  try {
    return orderedParser.parse(text) as OrderedNode[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DocumentExtractError(`Malformed XML in ${name}: ${message}`);
  }
}

/** The tag a node carries: its only key that is not the attribute holder. */
export function nodeTag(node: OrderedNode): string {
  for (const key of Object.keys(node)) {
    if (key !== ":@") return key;
  }
  return "";
}

/** The children of a node, which the parser always stores as an array (possibly empty). */
export function nodeChildren(node: OrderedNode): OrderedNode[] {
  const value = node[nodeTag(node)];
  return Array.isArray(value) ? value : [];
}

/** The attributes of a node, or an empty object. */
export function nodeAttrs(node: OrderedNode): Record<string, string> {
  const value = node[":@"];
  return value !== undefined && !Array.isArray(value) ? value : {};
}

/** The children whose tag is `tag`. */
export function childNodes(node: OrderedNode, tag: string): OrderedNode[] {
  return nodeChildren(node).filter((child) => nodeTag(child) === tag);
}

/** The first descendant carrying `tag`, depth-first, or null. */
export function findNode(nodes: OrderedNode[], tag: string): OrderedNode | null {
  for (const node of nodes) {
    if (nodeTag(node) === tag) return node;
    const found = findNode(nodeChildren(node), tag);
    if (found !== null) return found;
  }
  return null;
}

/** Unzips an archive, failing with a message that names the format rather than an fflate error. */
export function readArchive(data: Uint8Array, format: string): Record<string, Uint8Array> {
  try {
    return unzipSync(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DocumentExtractError(
      `This ${format} file could not be opened as a zip archive (${message}). It may be corrupt, truncated, or not really a ${format} file.`,
    );
  }
}

/** Decodes one archive entry as UTF-8, or null when the entry is absent. */
export function readPart(archive: Record<string, Uint8Array>, name: string): string | null {
  const bytes = archive[name];
  return bytes === undefined ? null : new TextDecoder("utf-8").decode(bytes);
}

/** Parses one archive entry, or null when the entry is absent. */
export function parsePart(
  archive: Record<string, Uint8Array>,
  name: string,
): Record<string, unknown> | null {
  const text = readPart(archive, name);
  if (text === null) return null;
  try {
    return parser.parse(text) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DocumentExtractError(`Malformed XML in ${name}: ${message}`);
  }
}

/**
 * Normalizes a child that may be absent, a single node, or a list into a list.
 *
 * Both formats omit the wrapper when an element occurs once, so `<a:p>` is an object in one
 * slide and an array in the next. Every walk over a repeated element goes through here rather
 * than testing `Array.isArray` at each site.
 */
export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Reads an attribute (as `@_name`) off a node, or undefined. */
export function attr(node: unknown, name: string): string | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return typeof value === "string" ? value : undefined;
}

/**
 * Resolves a relationship id to its target inside the package, from a `.rels` part.
 *
 * Shared by the OOXML readers because every one of them needs it for the same reason: a part is
 * never addressed by its filename. `presentation.xml` names slides through `r:id`s, `workbook.xml`
 * names sheets the same way, and the mapping lives in a sibling `_rels` part. Reading
 * `sheet1.xml` because it is called `sheet1.xml` is how a workbook with reordered or renamed
 * sheets gets its data from the wrong place.
 */
export function relationshipTargets(relsXml: string | null): Map<string, string> {
  const targets = new Map<string, string>();
  if (relsXml === null) return targets;
  // The rels part is XML too, but it is small and flat; matching it directly avoids a second
  // parser configuration for one shape.
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = /\bId="([^"]*)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]*)"/.exec(tag)?.[1];
    if (id && target) targets.set(id, target);
  }
  return targets;
}

/**
 * Resolves a relationship target to its archive key.
 *
 * Two forms, and the difference matters: a target beginning with `/` is absolute from the package
 * root, while anything else is relative to the part that declared it. Treating the absolute form as
 * relative prepends the base directory a second time — `xl/xl/worksheets/sheet1.xml` — which is a
 * file that does not exist, and the failure reads as a missing part rather than as a path bug.
 */
export function resolveTarget(target: string, baseDir: string): string {
  const parts = (target.startsWith("/") ? target : `${baseDir}/${target}`).split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

/** The `<c>` element addresses in a worksheet part that hold a formula. */
export function formulaCellAddresses(xml: string): string[] {
  const addresses: string[] = [];
  const pattern = /<c r="([A-Za-z]+[0-9]+)"(?:\s[^>]*)?>\s*<f[\s>][\s\S]*?<\/c>/g;
  for (const match of xml.matchAll(pattern)) {
    if (match[1]) addresses.push(match[1].toUpperCase());
  }
  return addresses;
}

/** Sheet name to the archive path of its worksheet part. */
export function workbookSheetParts(archive: Record<string, Uint8Array>): Map<string, string> {
  const workbook = parsePart(archive, "xl/workbook.xml");
  if (workbook === null) {
    throw new DocumentExtractError(
      "This .xlsx file has no xl/workbook.xml, so it is not a workbook package.",
    );
  }
  const rels = relationshipTargets(readPart(archive, "xl/_rels/workbook.xml.rels"));
  const paths = new Map<string, string>();
  for (const sheet of asArray(dig(workbook, "workbook", "sheets", "sheet"))) {
    const name = attr(sheet, "name");
    const relId = attr(sheet, "r:id");
    if (name === undefined || relId === undefined) continue;
    const target = rels.get(relId);
    if (target === undefined) continue;
    paths.set(name, resolveTarget(target, "xl"));
  }
  return paths;
}

/** Navigates a chain of object keys, returning undefined at the first missing link. */
export function dig(node: unknown, ...keys: string[]): unknown {
  let current: unknown = node;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Recursively collects the text of every element named `tag`.
 *
 * Used for the OOXML shapes whose text sits in a dedicated leaf element (`<a:t>` in DrawingML,
 * `<w:t>` in WordprocessingML) regardless of how deeply it is nested inside paragraphs, runs,
 * groups and tables. Depth is the reason this recurses rather than walking a known path: a shape
 * inside a group inside a placeholder is a normal deck, not an edge case.
 */
export function collectText(node: unknown, tag: string, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, tag, out);
    return out;
  }
  if (typeof node !== "object" || node === null) return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === tag) {
      for (const item of asArray(value)) {
        if (typeof item === "string") out.push(item);
        else if (typeof item === "number") out.push(String(item));
        else collectText(item, tag, out);
      }
      continue;
    }
    if (key.startsWith("@_")) continue;
    collectText(value, tag, out);
  }
  return out;
}

/**
 * Turns the text runs of one paragraph-like node into a single line.
 *
 * Runs are joined without a separator because a word split across runs (`<a:t>Hel</a:t><a:t>lo`)
 * is one word; a space between runs would corrupt it. Line breaks inside a run are preserved.
 */
export function paragraphText(node: unknown, tag: string): string {
  return collectText(node, tag)
    .join("")
    .replace(/\u000b/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}
