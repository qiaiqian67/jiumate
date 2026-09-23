/**
 * Types for turndown-plugin-gfm, which ships none.
 *
 * The package is a set of Turndown rules exported as plain functions; the shape below is the part
 * this project uses. Turndown's own `use` takes a plugin, so the declared parameter type has to
 * match what `turndown`'s `use` accepts — hence the import rather than a hand-written structural
 * type, which would drift from it silently.
 */
declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  /** A plugin as Turndown's `use` accepts it. */
  type Plugin = (service: TurndownService) => void;

  /** Tables, strikethrough, task list items and fenced code — the whole GFM rule set. */
  export const gfm: Plugin;
  export const tables: Plugin;
  export const strikethrough: Plugin;
  export const taskListItems: Plugin;
  export const highlightedCodeBlock: Plugin;
}
