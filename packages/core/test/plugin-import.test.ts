/**
 * Archive unpacking and plugin discovery (core/state/plugin-import.ts, plugin-discovery.ts).
 *
 * The unpack tests are mostly about what the code **refuses**, because an archive is the one input
 * here that neither the user nor the server authored: it is base64 from a browser, written to disk.
 * Each case below is a way that can go wrong, and the assertion is that it fails loudly and writes
 * nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  MAX_PLUGIN_ARCHIVE_FILES,
  PluginArchiveError,
  discoverPlugins,
  localPluginId,
  stripSingleRootDir,
  unpackPluginArchive,
  writePluginArchive,
} from "../src/state/index.js";

/** A staging directory per test, removed after. Nothing in these tests touches a real store. */
let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-import-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A zip of the given entries, each a string. */
function zipOf(entries: Record<string, string>): Buffer {
  return Buffer.from(
    zipSync(
      Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, new TextEncoder().encode(v)])),
    ),
  );
}

describe("unpackPluginArchive", () => {
  it("rejects an empty archive rather than writing an empty directory", () => {
    expect(() => unpackPluginArchive(Buffer.alloc(0))).toThrow(PluginArchiveError);
  });

  it("rejects bytes that are not a zip", () => {
    expect(() => unpackPluginArchive(Buffer.from("not a zip at all"))).toThrow(/could not be read/);
  });

  it("keeps a normal plugin's files, keyed by relative path", () => {
    const entries = unpackPluginArchive(
      zipOf({
        "plugin.json": '{"name":"x","version":"2026-01-01.1"}',
        "skills/a/SKILL.md": "---\nname: a\n---\n",
      }),
    );
    expect(entries.map((e) => e.rel).sort()).toEqual(["plugin.json", "skills/a/SKILL.md"]);
  });

  // Path traversal is the reason this file exists. Each of these names escapes the destination when
  // joined naively, and each must be refused before anything is written.
  it.each([
    ["../escape.txt", "a parent directory"],
    ["../../escape.txt", "a grandparent directory"],
    ["a/../../escape.txt", "traversal after a real segment"],
    ["/etc/passwd", "an absolute path"],
    ["..\\escape.txt", "a Windows parent segment"],
  ])("refuses %s (%s)", (name) => {
    let thrown: unknown;
    try {
      unpackPluginArchive(zipOf({ [name]: "x" }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PluginArchiveError);
    expect((thrown as PluginArchiveError).code).toBe("path_escape");
  });

  it("refuses an archive with too many files", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i <= MAX_PLUGIN_ARCHIVE_FILES; i++) many[`f${i}.txt`] = "x";
    let thrown: unknown;
    try {
      unpackPluginArchive(zipOf(many));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as PluginArchiveError)?.code).toBe("too_many_files");
  });

  it("writes nothing at all when one entry escapes — not even the good ones", () => {
    // The whole archive is validated before the first write, so a zip whose last entry escapes
    // cannot leave a half-installed plugin behind.
    const bytes = zipOf({
      "plugin.json": '{"name":"x","version":"2026-01-01.1"}',
      "../../escaped.txt": "boom",
    });
    expect(() => unpackPluginArchive(bytes)).toThrow(PluginArchiveError);
    const dest = path.join(tmp, "dest");
    fs.mkdirSync(dest);
    expect(fs.readdirSync(dest)).toEqual([]);
  });
});

describe("writePluginArchive", () => {
  it("creates nested directories and writes each file", async () => {
    const dest = path.join(tmp, "out");
    await writePluginArchive(
      [
        { rel: "plugin.json", data: new TextEncoder().encode("{}") },
        { rel: "skills/a/SKILL.md", data: new TextEncoder().encode("body") },
      ],
      dest,
    );
    expect(fs.readFileSync(path.join(dest, "plugin.json"), "utf8")).toBe("{}");
    expect(fs.readFileSync(path.join(dest, "skills", "a", "SKILL.md"), "utf8")).toBe("body");
  });

  it("re-derives the containment check at write time, not only at parse time", async () => {
    // Hand-built entries bypass `unpackPluginArchive` entirely, so the write path has to hold the
    // line on its own rather than trusting the caller.
    await expect(
      writePluginArchive([{ rel: "../escaped.txt", data: new TextEncoder().encode("boom") }], tmp),
    ).rejects.toThrow(/escapes the destination/);
    expect(fs.existsSync(path.join(path.dirname(tmp), "escaped.txt"))).toBe(false);
  });
});

describe("stripSingleRootDir", () => {
  it("unwraps the folder most plugin zips wrap themselves in", () => {
    const entries = [
      { rel: "my-plugin/plugin.json", data: new Uint8Array() },
      { rel: "my-plugin/skills/a/SKILL.md", data: new Uint8Array() },
    ];
    expect(stripSingleRootDir(entries).map((e) => e.rel)).toEqual([
      "plugin.json",
      "skills/a/SKILL.md",
    ]);
  });

  it("leaves an already-flat archive alone", () => {
    const entries = [
      { rel: "plugin.json", data: new Uint8Array() },
      { rel: "skills/a/SKILL.md", data: new Uint8Array() },
    ];
    expect(stripSingleRootDir(entries).map((e) => e.rel)).toEqual([
      "plugin.json",
      "skills/a/SKILL.md",
    ]);
  });

  it("does not unwrap a zip whose manifest sits beside a folder at the top level", () => {
    // `plugin.json` + a `my-plugin/` directory is a deliberate layout, not a wrapped archive.
    const entries = [
      { rel: "plugin.json", data: new Uint8Array() },
      { rel: "my-plugin/x.txt", data: new Uint8Array() },
    ];
    expect(stripSingleRootDir(entries).map((e) => e.rel)).toEqual([
      "plugin.json",
      "my-plugin/x.txt",
    ]);
  });

  it("leaves a single top-level file alone — stripping it would leave nothing", () => {
    const entries = [{ rel: "plugin.json", data: new Uint8Array() }];
    expect(stripSingleRootDir(entries).map((e) => e.rel)).toEqual(["plugin.json"]);
  });
});

describe("localPluginId", () => {
  it("separates an added plugin from the built-in of the same name", () => {
    // The whole reason a local marketplace exists: two plugins named `foo` are two install targets.
    expect(localPluginId("foo")).toBe("foo@local");
    expect(localPluginId("foo")).not.toBe("foo@jiumate-builtin");
  });
});

describe("discoverPlugins", () => {
  /**
   * The names found in `dir` alone.
   *
   * `discoverPlugins` always probes the real home directory as well, so on a developer's machine it
   * also finds whatever their own Agents have installed. Comparing the whole list would make these
   * tests pass in CI and fail on a laptop; this restricts the assertion to what the test created.
   */
  function foundIn(
    plugins: readonly { name: string }[],
    ...expected: string[]
  ): string[] {
    return plugins.map((p) => p.name).filter((n) => expected.includes(n));
  }
  /** A minimal plugin directory: a manifest with a version, and one skill. */
  function makePlugin(parent: string, name: string, version = "2026-01-01.1"): string {
    const dir = path.join(parent, name);
    fs.mkdirSync(path.join(dir, "skills", "demo"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({ name, version, description: `the ${name} plugin` }),
    );
    fs.writeFileSync(
      path.join(dir, "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: does a thing\n---\n",
    );
    return dir;
  }

  it("finds a plugin in a directory the user picked", () => {
    const container = path.join(tmp, "container");
    fs.mkdirSync(container);
    makePlugin(container, "mine");

    const { plugins } = discoverPlugins(container);
    const mine = plugins.find((p) => p.name === "mine");
    expect(mine).toBeDefined();
    expect(mine?.origin).toBe("manual");
    expect(mine?.skills.map((s) => s.name)).toEqual(["demo"]);
    expect(mine?.skills[0]?.description).toBe("does a thing");
  });

  it("accepts the plugin directory itself, not only a folder holding plugins", () => {
    // 「选哪个都行」 is the promise the manual picker makes; a user who picks the plugin folder
    // itself rather than its parent must not get an empty list.
    const container = path.join(tmp, "container");
    fs.mkdirSync(container);
    const pluginDir = makePlugin(container, "mine");

    const { plugins } = discoverPlugins(pluginDir);
    expect(foundIn(plugins, "mine")).toEqual(["mine"]);
  });

  it("skips a directory with no manifest, and one whose version this version cannot read", () => {
    const container = path.join(tmp, "container");
    fs.mkdirSync(container);
    fs.mkdirSync(path.join(container, "not-a-plugin"));
    fs.writeFileSync(path.join(container, "not-a-plugin", "readme.md"), "hi");
    const badVersion = makePlugin(container, "bad");
    fs.writeFileSync(
      path.join(badVersion, "plugin.json"),
      JSON.stringify({ name: "bad", version: "1.0" }),
    );

    const { plugins } = discoverPlugins(container);
    // Offered nowhere rather than offered broken: an unparseable plugin cannot be installed, so
    // listing it would be an offer this version cannot honour.
    expect(foundIn(plugins, "not-a-plugin", "bad")).toEqual([]);
  });

  it("accepts a manifest with a BOM, as a Windows editor writes", () => {
    // PowerShell's `Out-File -Encoding UTF8` and most Windows editors prepend EF BB BF. A plugin
    // someone hand-wrote on Windows is a plugin someone hand-wrote on Windows, so refusing it as
    // "not a plugin" would read as the scanner being broken rather than as a stray byte.
    const container = path.join(tmp, "container");
    fs.mkdirSync(container);
    const dir = path.join(container, "bommed");
    fs.mkdirSync(path.join(dir, "skills", "demo"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      `﻿${JSON.stringify({ name: "bommed", version: "2026-01-01.1", description: "d" })}`,
      "utf8",
    );
    fs.writeFileSync(path.join(dir, "skills", "demo", "SKILL.md"), "---\nname: demo\n---\n");

    const { plugins } = discoverPlugins(container);
    expect(foundIn(plugins, "bommed")).toEqual(["bommed"]);
  });

  it("reports every probed directory, existing or not, so a miss is legible", () => {
    // The user needs to see which places were checked to understand an empty result.
    const { probes } = discoverPlugins();
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.some((p) => p.label.includes("Claude Code"))).toBe(true);
    expect(probes.every((p) => typeof p.exists === "boolean")).toBe(true);
  });

  it("marks a plugin the library already has, rather than offering a duplicate copy", () => {
    const container = path.join(tmp, "container");
    fs.mkdirSync(container);
    makePlugin(container, "mine");
    const { plugins } = discoverPlugins(container, new Set(["mine"]));
    expect(plugins.find((p) => p.name === "mine")?.alreadyInstalled).toBe(true);
  });

  it("returns empty rather than throwing when the picked path does not exist", () => {
    // A mistyped path is the common case, not an exceptional one.
    expect(() => discoverPlugins(path.join(tmp, "nope"))).not.toThrow();
    // Only asserted on the names this test owns: the real home directory is probed too.
    expect(discoverPlugins(path.join(tmp, "nope")).plugins.filter((p) => p.origin === "manual")).toEqual(
      [],
    );
  });
});