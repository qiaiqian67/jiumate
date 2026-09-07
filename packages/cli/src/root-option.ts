/**
 * The `--root` option's meaning, in one place.
 *
 * Every command that touches the data root offers it, and the priority is a documented part
 * of the CLI's contract (/docs/cli): the option wins, then LINSIGHT_HOME, then the default
 * root. Two copies of that rule is two chances for one of them to drift.
 */
import path from "node:path";
import { resolveRoot } from "@prismshadow/linsight-core";

/** Data root: `--root` first (relative paths against cwd), else LINSIGHT_HOME / ~/.linsight/data. */
export function resolveRootOption(root: string | undefined): string {
  return root !== undefined ? path.resolve(root) : resolveRoot();
}
