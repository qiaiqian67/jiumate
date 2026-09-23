/**
 * Types for check-licenses.mjs. The module is plain JavaScript because it is a build script run
 * by `node` directly; this lets packages/cli's typechecked test exercise the same decision
 * function CI gates on, instead of a restatement of it that could drift.
 */

/** A license expression as pnpm reports it, and the packages under it. */
export type LicenseTree = Record<
  string,
  Array<{ name: string; versions?: string[]; license?: string }>
>;

export interface Offender {
  name: string;
  versions: string[];
  license: string;
}

export interface TreeResult {
  /** How many packages were examined. */
  checked: number;
  /** Packages under a license the policy does not permit, and with no exception. */
  offenders: Offender[];
  /** Names of the exceptions that were actually applied. */
  usedExceptions: Set<string>;
}

/**
 * True when the SPDX expression permits bundling.
 *
 * A disjunction is satisfied by either side; a conjunction needs both.
 */
export declare function isAllowed(expression: string): boolean;

/** Removes parentheses only when they wrap the whole expression. */
export declare function stripWrappingParens(expression: string): string;

/** Splits on `" OR "` or `" AND "` only where it is not inside parentheses. */
export declare function splitTopLevel(expression: string, operator: string): string[];

/** Applies the policy to one dependency tree, without reading the real install. */
export declare function checkTree(
  byLicense: LicenseTree,
  exceptions?: Map<string, string>,
): TreeResult;
