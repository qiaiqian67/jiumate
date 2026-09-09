---
name: format
description: Format generated Markdown documents so a human can edit them in place afterwards — atomic sections, semantic headings, fenced diagrams and code, no mega paragraphs.
---

# Writing documents that stay editable

The user will open this file in the Files panel and edit it. Write so every
section is small enough to read, find, and rewrite without re-rendering the
whole file.

## Before you start

If the user's message only references this skill (e.g. "use the editable-doc
skill") without a concrete document to produce, ask what document they want
generated. This skill shapes how Markdown is written; it never produces a
document on its own.

## Structure

- One H1 (`#`) per document, then a flat sequence of H2 (`##`) sections.
- Each H2 stands alone: a short intro paragraph, then content (lists, tables,
  fenced blocks), then a blank line before the next H2. **No mega-paragraphs**
  longer than ~6 lines — split a wall of text into the sub-points it actually
  contains.
- Lists are real Markdown lists (one bullet / number per line), not a single
  paragraph with em-dash separators.
- Tables are GitHub-flavored Markdown tables with a header row and `---`
  separator; never a preformatted-text block of spaces.

## Diagrams and code

- Every diagram is a **fenced Mermaid block** with a one-line info string.
- The **opening fence must carry the language**: ```mermaid, ```ts,
  ```python, ```json, ```bash. An unlabeled fence renders as plain
  text and the editor cannot re-highlight it.
- A Mermaid diagram is preceded by one short paragraph naming what it shows,
  so the user can edit the description without reading the diagram.

## Do not

- Do not embed HTML for layout (use Markdown). A <table> block survives
  but a <div>-based layout cannot be edited without re-rendering.
- Do not put a code block **inside** a list item by indenting — the editor
  source view shows the indent but a Markdown round-trip can drop it. Lift
  the block out, keep the list item to one line.
- Do not ship a 5000-line single-section document. If a section grows past
  ~80 lines, add an H3 sub-section.