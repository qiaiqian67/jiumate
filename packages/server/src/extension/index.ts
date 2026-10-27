/**
 * The harness's extension surface — the `@jadelau/server/extension` subpath.
 *
 * The contract itself lives in `@jadelau/core/extension`; what this module adds
 * is the harness's own members, contributed by AUGMENTING that contract rather than by
 * redeclaring it. Core names nothing it cannot reach, this layer names what it owns, and
 * an extension sees one `JiuMateContext` either way.
 *
 * Re-exported here so an extension package has one import site for both halves.
 */
import type { TerminalManager } from "../terminal/manager.js";

declare module "@jadelau/core/extension" {
  interface JiuMateContext {
    terminals: TerminalManager;
  }
}

export type {
  Disposable,
  JiuMateContext,
  JiuMateInterface,
  Extension,
  ExtensionContext,
  ExtensionEvents,
  ToolFactory,
  WorkflowFactory,
  WorkflowInstance,
  WorkflowInstances,
} from "@jadelau/core/extension";
