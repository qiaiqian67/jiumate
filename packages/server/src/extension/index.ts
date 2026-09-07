/**
 * The harness's extension surface — the `@prismshadow/linsight-server/extension` subpath.
 *
 * The contract itself lives in `@prismshadow/linsight-core/extension`; what this module adds
 * is the harness's own members, contributed by AUGMENTING that contract rather than by
 * redeclaring it. Core names nothing it cannot reach, this layer names what it owns, and
 * an extension sees one `LinsightContext` either way.
 *
 * Re-exported here so an extension package has one import site for both halves.
 */
import type { TerminalManager } from "../terminal/manager.js";

declare module "@prismshadow/linsight-core/extension" {
  interface LinsightContext {
    terminals: TerminalManager;
  }
}

export type {
  Disposable,
  LinsightContext,
  LinsightInterface,
  Extension,
  ExtensionContext,
  ExtensionEvents,
  ToolFactory,
  WorkflowFactory,
  WorkflowInstance,
  WorkflowInstances,
} from "@prismshadow/linsight-core/extension";
