/**
 * Whether a plugin is switched on **for this machine**, kept in `<root>/plugin-state.json`.
 *
 * **Why this is separate from the per-Agent flag.** A plugin installed on one Agent has one
 * manifest, so a switch shown only for installed plugins cannot exist for a plugin no Agent has
 * yet — and a plugin installed on *some other* Agent would silently have no switch on the page the
 * user is looking at, because the card would be answering about the Agent currently selected rather
 * than about the machine. "Should this plugin exist on this computer" is a property of the machine;
 * "should this Agent call it" is a property of the Agent. Both are real, they are different acts,
 * and one of them has to be expressible before anything is installed anywhere.
 *
 * **Two flags, and both must be on.** This file gates the *machine*; the manifest's `enabled` gates
 * one Agent. A plugin runs only where both say yes, so switching the machine off disables the
 * plugin for every Agent at once without touching their manifests, and switching one Agent off
 * leaves the machine-level decision alone. Neither flag overwrites the other.
 *
 * **Keyed by library name, not by plugin id.** The id carries an `@marketplace` suffix, and the
 * same library name can be resolved to either copy (`resolvePluginId` picks per machine). A switch
 * that had to be re-keyed whenever a name was resolved differently would move itself out from under
 * the user's setting; the name is what the card shows and what the library is keyed on.
 *
 * **Absent means enabled.** A file that has never been written, a name absent from it, and a
 * corrupt file all read as "on" — the same rule the Agent-level manifest uses. Defaulting the other
 * way would disable every plugin on every existing machine the moment this file appeared, and a
 * capability that vanishes without anyone deciding it is the one failure mode a switch must not
 * have.
 *
 * **Written atomically** (see `atomicWriteFile`), because this file is the whole answer to "is this
 * plugin on" and a half-written one would read as corrupt and therefore as enabled.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { pluginNameOf } from "./plugin-store.js";

/** The on-disk shape. Every name absent from `disabled` is switched on. */
interface MachinePluginState {
  /** Library names the user has switched off on this machine. */
  disabled?: string[];
}

const STATE_FILE = "plugin-state.json";

/** `<root>/plugin-state.json`. */
export function pluginStatePath(root: string): string {
  return path.join(root, STATE_FILE);
}

/**
 * The plugin names switched off on this machine.
 *
 * Tolerant on every path: no file, an unparsable one, or a wrong-typed field yields the set it can
 * salvage rather than an error, because a reader that threw would take the whole library down over
 * a flag that has a safe default.
 */
export async function readMachineDisabled(root: string): Promise<Set<string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(pluginStatePath(root), "utf8"));
  } catch {
    return new Set();
  }
  if (!parsed || typeof parsed !== "object") return new Set();
  const list = (parsed as MachinePluginState).disabled;
  if (!Array.isArray(list)) return new Set();
  // Only strings, and only ones that look like library names: a malformed entry is dropped rather
  // than disabling a plugin whose name we cannot even spell.
  return new Set(list.filter((n): n is string => typeof n === "string" && n !== ""));
}

/** Whether a plugin is switched on for this machine. Absent means on (see the file header). */
export async function isMachinePluginEnabled(root: string, name: string): Promise<boolean> {
  return !(await readMachineDisabled(root)).has(pluginNameOf(name));
}

/**
 * Switches a plugin on or off for this machine.
 *
 * Removes the entry when switching **on** rather than recording `true`, so the file only ever
 * carries the exceptional case and a plugin's absence keeps meaning "on" however this evolves.
 *
 * Returns the state written, so a caller can report what happened rather than what it intended.
 */
export async function setMachinePluginEnabled(
  root: string,
  name: string,
  enabled: boolean,
): Promise<boolean> {
  const key = pluginNameOf(name);
  const disabled = await readMachineDisabled(root);
  if (enabled) disabled.delete(key);
  else disabled.add(key);
  const next: MachinePluginState = disabled.size > 0 ? { disabled: [...disabled].sort() } : {};
  await atomicWriteFile(pluginStatePath(root), `${JSON.stringify(next, null, 2)}\n`);
  return enabled;
}

/**
 * Drops a plugin's machine-level entry.
 *
 * Called when the plugin leaves this machine, so uninstalling something the user had switched off
 * does not leave a name behind that a later re-add would silently inherit — re-adding is a fresh
 * decision and should land on the file's default rather than on a setting made about a plugin that
 * is no longer here.
 */
export async function clearMachinePluginEnabled(root: string, name: string): Promise<void> {
  const disabled = await readMachineDisabled(root);
  if (!disabled.delete(pluginNameOf(name))) return;
  const next: MachinePluginState = disabled.size > 0 ? { disabled: [...disabled].sort() } : {};
  await atomicWriteFile(pluginStatePath(root), `${JSON.stringify(next, null, 2)}\n`);
}
