/**
 * .pptx extraction: one unit per slide, in presentation order.
 *
 * The ordering is the only subtle part. Slides live at `ppt/slides/slideN.xml`, but N is the
 * order they were *created*, not the order they are *shown* — reordering a deck rewrites
 * `ppt/presentation.xml`, not the filenames. So the walk goes through the presentation part's
 * `sldIdLst`, resolves each `r:id` through `ppt/_rels/presentation.xml.rels`, and only then opens
 * a file. Reading `slide1.xml`, `slide2.xml`, ... would silently scramble any deck that has ever
 * been reordered, which is most of them.
 *
 * Text comes out of `<a:t>` runs wherever they are — shape, table, grouped shape, placeholder —
 * because DrawingML nests those arbitrarily and a walk down a fixed path would miss the tables.
 * Speaker notes are appended when present: they are often where the actual content is.
 */
import {
  asArray,
  attr,
  collectText,
  dig,
  parsePart,
  paragraphText,
  readArchive,
  readPart,
} from "./ooxml.js";
import { DocumentExtractError, type ExtractResult, type ExtractedUnit } from "./types.js";

/** Resolves a relationship id to its target inside the package, from a `.rels` part. */
function relationshipTargets(relsXml: string | null): Map<string, string> {
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

/** `../slides/slide3.xml` (relative to ppt/) becomes the archive key `ppt/slides/slide3.xml`. */
function resolveTarget(target: string, baseDir: string): string {
  const parts = `${baseDir}/${target}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

/** The title text of a slide, if it has a title placeholder. */
function slideTitle(parsed: Record<string, unknown>): string | null {
  for (const shape of slideShapes(parsed)) {
    if (!isTitleShape(shape)) continue;
    const text = paragraphText(dig(shape, "p:txBody"), "a:t").trim();
    if (text !== "") return text;
  }
  return null;
}

/** Every shape on the slide, in document order. */
function slideShapes(parsed: Record<string, unknown>): unknown[] {
  return asArray(dig(parsed, "p:sld", "p:cSld", "p:spTree", "p:sp"));
}

/** Whether a shape is a title placeholder. */
function isTitleShape(shape: unknown): boolean {
  const placeholders = asArray(dig(shape, "p:nvSpPr", "p:nvPr", "p:ph"));
  return placeholders.some((ph) => {
    const type = attr(ph, "type");
    return type === "title" || type === "ctrTitle";
  });
}

/**
 * The body text of a slide, with the title left out.
 *
 * The walk goes shape by shape rather than sweeping the whole tree for `<a:t>`, and that is the
 * point: a sweep collects the title's own runs along with everything else, so the title arrives
 * twice — once as the heading this module emits and once inside the body. Excluding the title
 * shape is the only way to know which occurrence to drop, and it also keeps each shape's
 * paragraphs in their own order instead of merging unrelated shapes into one line.
 *
 * Tables live in `p:graphicFrame` rather than `p:sp`, so they are walked separately; a table cell
 * becomes one row of the output.
 */
function slideBody(parsed: Record<string, unknown>): string[] {
  const lines: string[] = [];

  for (const shape of slideShapes(parsed)) {
    if (isTitleShape(shape)) continue;
    const body = dig(shape, "p:txBody");
    for (const paragraph of asArray(dig(body, "a:p"))) {
      const text = paragraphText(paragraph, "a:t").trim();
      if (text !== "") lines.push(text);
    }
  }

  for (const frame of asArray(dig(parsed, "p:sld", "p:cSld", "p:spTree", "p:graphicFrame"))) {
    for (const row of asArray(dig(frame, "a:graphic", "a:graphicData", "a:tbl", "a:tr"))) {
      const cells = asArray(dig(row, "a:tc")).map((cell) => paragraphText(cell, "a:t").trim());
      const rendered = cells.filter((cell) => cell !== "");
      if (rendered.length > 0) lines.push(rendered.join(" | "));
    }
  }

  return lines;
}

/** Speaker notes for a slide, or null. */
function slideNotes(archive: Record<string, Uint8Array>, slidePath: string): string | null {
  const dir = slidePath.slice(0, slidePath.lastIndexOf("/"));
  const file = slidePath.slice(slidePath.lastIndexOf("/") + 1);
  const rels = readPart(archive, `${dir}/_rels/${file}.rels`);
  if (rels === null) return null;
  for (const target of relationshipTargets(rels).values()) {
    if (!target.includes("notesSlide")) continue;
    const parsed = parsePart(archive, resolveTarget(target, dir));
    if (parsed === null) continue;
    const text = collectText(dig(parsed, "p:notes"), "a:t")
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (text !== "") return text;
  }
  return null;
}

/** One slide as the preview needs it: its title, its body lines, and its notes. */
export interface PptxSlide {
  title: string | null;
  lines: string[];
  notes: string | null;
}

/**
 * Every slide as structured text, in presentation order.
 *
 * The same walk `extractPptx` does, stopping one step earlier: the tool renders each slide to
 * Markdown, while the preview hands the parts to the web app so it can lay them out as slides.
 * Keeping the walk here rather than duplicating it means the ordering rule — follow `p:sldIdLst`,
 * never the part filenames — has exactly one implementation.
 */
export async function pptxSlides(data: Uint8Array): Promise<PptxSlide[]> {
  const archive = readArchive(data, ".pptx");
  const presentation = parsePart(archive, "ppt/presentation.xml");
  if (presentation === null) {
    throw new DocumentExtractError(
      "This .pptx file has no ppt/presentation.xml, so it is not a PowerPoint package. It may be corrupt or a different format with the wrong extension.",
    );
  }

  const rels = relationshipTargets(readPart(archive, "ppt/_rels/presentation.xml.rels"));
  const slideIds = asArray(dig(presentation, "p:presentation", "p:sldIdLst", "p:sldId"));

  const slides: PptxSlide[] = [];
  for (const slideId of slideIds) {
    const relId = attr(slideId, "r:id");
    const target = relId === undefined ? undefined : rels.get(relId);
    if (target === undefined) continue;
    const slidePath = resolveTarget(target, "ppt");
    const parsed = parsePart(archive, slidePath);
    if (parsed === null) continue;
    slides.push({
      title: slideTitle(parsed),
      lines: slideBody(parsed),
      notes: slideNotes(archive, slidePath),
    });
  }
  return slides;
}

export async function extractPptx(data: Uint8Array): Promise<ExtractResult> {
  const slides = await pptxSlides(data);

  const warnings: string[] = [];
  const units: ExtractedUnit[] = [];

  for (const [index, slide] of slides.entries()) {
    const body: string[] = [];
    if (slide.title !== null) body.push(`## ${slide.title}`);
    for (const line of slide.lines) body.push(line);
    if (slide.notes !== null) body.push("", `_Speaker notes:_ ${slide.notes}`);

    units.push({
      label: `slide ${index + 1}${slide.title !== null ? ` — ${slide.title}` : ""}`,
      markdown: body.join("\n").trim(),
    });
  }

  if (units.length === 0) {
    warnings.push("No slides were found in this presentation.");
  }
  warnings.push(
    "Only text was extracted. Images, charts, SmartArt, animations and layout are not represented.",
  );

  return { format: "pptx", units, warnings };
}
