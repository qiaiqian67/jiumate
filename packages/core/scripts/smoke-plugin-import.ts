/**
 * End-to-end check of the plugin-import path against real files on disk: a local plugin directory,
 * a real zip, a hostile zip, and an install into an Agent. Not part of the suite — run by hand after
 * changing the import path:
 *
 *     npx tsx scripts/smoke-plugin-import.ts
 *
 * Why a script and not a test: what this proves is that the three sources land in the library and
 * can then be installed into an Agent. The unit tests (test/plugin-import.test.ts) cover the refusal
 * rules; this covers the plumbing that connects a directory on disk to a skill an Agent loads,
 * which needs its own `JIUMATE_HOME` and is too stateful for the suite.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import {
  installPlugin,
  libraryPlugin,
  listInstalledSkills,
  loadPluginGroups,
  localPluginId,
  localPluginsDir,
  stripSingleRootDir,
  unpackPluginArchive,
  writePluginArchive,
  type LibraryPlugin,
} from "../src/index.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-import-"));
// The store is resolved through `JIUMATE_HOME` on every read, so it is set from the same temp
// directory the rest of the script uses — otherwise the plugins would be written to one root and
// looked for in another, and the first assertion would fail for a reason that has nothing to do
// with the code under test.
process.env.JIUMATE_HOME = root;
const projectId = "p1";
const agentId = "a1";

/** A minimal plugin: a manifest with a version, and one skill. */
function makePlugin(dir: string, name: string): void {
  fs.mkdirSync(path.join(dir, "skills", "demo-skill"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({
      name,
      version: "2026-01-01.1",
      description: `the ${name} plugin`,
      description_zh: `${name} 插件`,
    }),
  );
  fs.writeFileSync(
    path.join(dir, "skills", "demo-skill", "SKILL.md"),
    "---\nname: demo-skill\ndescription: does a demo thing\n---\n\nbody\n",
  );
}

/** Every file under `dir`, as the `{rel, data}` list the write path takes. */
function walkFiles(dir: string): { rel: string; data: Uint8Array }[] {
  const out: { rel: string; data: Uint8Array }[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) out.push({ rel, data: fs.readFileSync(full) });
    }
  };
  walk(dir, "");
  return out;
}

/** A plugin zipped the way a real download is: wrapped in its own top-level folder. */
function zipOfPlugin(name: string): Buffer {
  const dir = path.join(root, `zip-src-${name}`);
  makePlugin(dir, name);
  const entries: Record<string, Uint8Array> = {};
  for (const { rel, data } of walkFiles(dir)) entries[`${name}/${rel}`] = data;
  return Buffer.from(zipSync(entries));
}

/** What the /local route does, minus the route. */
async function importFromLocal(sourceDir: string, name: string): Promise<void> {
  await writePluginArchive(
    walkFiles(sourceDir),
    path.join(localPluginsDir(root), localPluginId(name)),
  );
}

/** What the /archive route does: unpack, strip the wrapper, write. */
async function importFromZip(bytes: Buffer, name: string): Promise<void> {
  const staging = path.join(root, `stage-${name}`);
  const entries = stripSingleRootDir(unpackPluginArchive(bytes));
  await writePluginArchive(entries, staging);
  await importFromLocal(staging, name);
}

const checks: string[] = [];
const ok = (label: string): void => void checks.push(`  ok  ${label}`);

async function main(): Promise<void> {
  // ① Local directory.
  const local = path.join(root, "local-src");
  makePlugin(local, "smoke-local");
  await importFromLocal(local, "smoke-local");
  assert.ok(libraryPlugin("smoke-local"), "a local plugin should appear in the library");
  ok("① a local plugin directory lands in the library");

  // ② A real zip, wrapped in its own folder as every download is.
  const zip = zipOfPlugin("smoke-zip");
  await importFromZip(zip, "smoke-zip");
  const zipPlugin = libraryPlugin("smoke-zip");
  assert.ok(zipPlugin, "a zipped plugin should appear in the library");
  assert.equal(zipPlugin.skills.length, 1, "the zipped plugin should carry its skill");
  ok("② a zip lands in the library, with its skill");

  // The wrapper strip is what makes a real download work; without it the manifest check would
  // fail on a path that looks nothing like a plugin.
  assert.ok(
    stripSingleRootDir(unpackPluginArchive(zip)).some((e) => e.rel === "plugin.json"),
    "the zip's wrapper folder should be stripped",
  );
  ok("② the zip's wrapper folder is stripped");

  // ③ A hostile zip is refused, and installs nothing.
  const hostile = Buffer.from(
    zipSync({
      "plugin.json": new TextEncoder().encode('{"name":"evil","version":"2026-01-01.1"}'),
      "../../escaped.txt": new TextEncoder().encode("boom"),
    }),
  );
  assert.throws(() => unpackPluginArchive(hostile), /escapes the destination/);
  assert.equal(libraryPlugin("evil"), undefined, "a refused archive must not be installed");
  ok("③ a traversal archive is refused and installs nothing");

  // ④ An imported plugin installs into an Agent like any other, skills and all.
  const plugin: LibraryPlugin = libraryPlugin("smoke-zip")!;
  fs.mkdirSync(path.join(root, projectId, "agents", agentId), { recursive: true });
  await installPlugin(root, projectId, agentId, plugin, localPluginId(plugin.name));
  const installed = await listInstalledSkills(root, projectId, agentId);
  assert.ok(
    installed.some((s) => s.name === "demo-skill"),
    `expected demo-skill installed, got: ${installed.map((s) => s.name).join(", ") || "(none)"}`,
  );
  ok("④ an imported plugin installs into an Agent and its skill loads");

  // ⑤ Both appear in the grouped listing the page renders.
  const names = loadPluginGroups().flatMap((g) => g.plugins.map((p) => p.name));
  assert.ok(names.includes("smoke-local") && names.includes("smoke-zip"));
  ok("⑤ both plugins appear in loadPluginGroups()");

  console.log(checks.join("\n"));
  console.log("\nall plugin-import smoke checks passed");
  fs.rmSync(root, { recursive: true, force: true });
}

await main();
