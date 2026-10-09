/**
 * The installed-plugins tree: writing a plugin under `plugins/<name>@<marketplace>/`, switching it
 * on and off, removing it, and migrating Skills that were installed flat before the layout existed.
 *
 * The property these tests exist to protect is the one the layout was chosen for: **a bundled Skill
 * is removed by its plugin and by nothing else.** So most of what follows is about what must *not*
 * be reachable — `removeSkill` on a bundled name must be a no-op on the plugin's copy, and a
 * same-named standalone Skill must survive its plugin's uninstall.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LibraryPlugin } from "../src/plugins/index.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  assertPluginId,
  installPlugin,
  listInstalledPlugins,
  listInstalledSkills,
  migrateFlatBundledSkills,
  pluginDir,
  pluginNameOf,
  pluginsDir,
  removePluginInstall,
  removeSkill,
  setPluginEnabled,
  skillsDir,
} from "../src/state/index.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jiumate-plugin-store-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

/** A plugin with `names` as its Skills, shaped like the library's. */
const makePlugin = (name: string, names: string[]): LibraryPlugin =>
  ({
    name,
    version: "2026-10-01.1",
    description: `${name} description`,
    skills: names.map((n) => ({
      name: n,
      description: `${n} description`,
      version: "2026-10-01.1",
      content: `---\nname: ${n}\ndescription: ${n} description\n---\n\nbody of ${n}\n`,
    })),
  }) as unknown as LibraryPlugin;

const list = () => listInstalledSkills(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
const exists = async (p: string) => {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
};

describe("plugin id", () => {
  it("splits the name off a <name>@<marketplace> id", () => {
    expect(pluginNameOf("agent-tuning@jiumate-builtin")).toBe("agent-tuning");
    // No suffix: already a bare name. And a malformed leading `@` must not yield an empty key.
    expect(pluginNameOf("agent-tuning")).toBe("agent-tuning");
    expect(pluginNameOf("@weird")).toBe("@weird");
  });

  it("rejects an id that is not <name>@<marketplace>, including path traversal", () => {
    expect(() => assertPluginId("agent-tuning@jiumate-builtin")).not.toThrow();
    // The id becomes a directory name, so these must all be refused.
    for (const bad of ["no-at-sign", "../../etc/passwd", "a@../../b", "a@", "@b", "a@b/c"]) {
      expect(() => assertPluginId(bad)).toThrow();
    }
  });
});

describe("installPlugin writes into the plugins tree", () => {
  it("puts each Skill under the plugin's own directory, not in skills/", async () => {
    await installPlugin(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      makePlugin("tuning", ["a", "b"]),
    );

    const base = pluginDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "tuning@jiumate-builtin");
    expect(await exists(path.join(base, "skills", "a", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(base, "skills", "b", "SKILL.md"))).toBe(true);
    // The flat tree was never written: ownership is the path, not a note beside it.
    expect(
      await exists(path.join(skillsDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), "a")),
    ).toBe(false);

    // And the reader still finds them, now attributed structurally.
    const found = await list();
    expect(found.map((s) => s.name)).toEqual(["a", "b"]);
    expect(found.every((s) => s.plugin === "tuning@jiumate-builtin")).toBe(true);
  });

  it("writes a manifest naming the id, version and enabled state", async () => {
    await installPlugin(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, makePlugin("tuning", ["a"]));
    const file = path.join(
      pluginDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "tuning@jiumate-builtin"),
      "manifest.json",
    );
    const manifest = JSON.parse(await fs.readFile(file, "utf8"));
    expect(manifest.id).toBe("tuning@jiumate-builtin");
    expect(manifest.version).toBe("2026-10-01.1");
    expect(manifest.enabled).toBe(true);
  });

  it("reinstalling replaces the directory's contents wholesale", async () => {
    const plugin = makePlugin("tuning", ["a"]);
    await installPlugin(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, plugin);
    // A second version that drops a Skill and renames nothing else.
    await installPlugin(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, makePlugin("tuning", []));
    const base = pluginDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "tuning@jiumate-builtin");
    expect(await exists(path.join(base, "skills", "a"))).toBe(false);
    expect(
      (await listInstalledPlugins(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))[0]!.skills,
    ).toEqual([]);
  });
});

describe("a bundled Skill cannot be removed on its own", () => {
  it("removeSkill leaves the plugin's copy untouched", async () => {
    await installPlugin(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, makePlugin("tuning", ["a"]));

    // The standalone removal path, aimed at a bundled name.
    await removeSkill(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "a");

    // Still installed, still bundled — because `a` lives in plugins/, which removeSkill never
    // touches. There is no guard to bypass; there is no path.
    const found = await list();
    expect(found.map((s) => s.name)).toEqual(["a"]);
    expect(found[0]!.plugin).toBe("tuning@jiumate-builtin");
  });

  it("removing the plugin takes its Skills with it", async () => {
    await installPlugin(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      makePlugin("tuning", ["a", "b"]),
    );
    await removePluginInstall(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      "tuning@jiumate-builtin",
    );

    expect(await list()).toEqual([]);
    expect(
      await exists(
        pluginDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "tuning@jiumate-builtin"),
      ),
    ).toBe(false);
  });

  it("does not delete a same-named standalone Skill when its plugin is uninstalled", async () => {
    // The user's own `a`, installed on its own, alongside a plugin that also ships one.
    const solo = path.join(skillsDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), "a");
    await fs.mkdir(solo, { recursive: true });
    await fs.writeFile(
      path.join(solo, "SKILL.md"),
      "---\nname: a\ndescription: mine\n---\n\nmine\n",
      "utf8",
    );
    await installPlugin(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, makePlugin("tuning", ["a"]));

    await removePluginInstall(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      "tuning@jiumate-builtin",
    );

    // The user's copy survives: it was never the plugin's to delete.
    expect(await exists(solo)).toBe(true);
    const found = await list();
    expect(found).toHaveLength(1);
    expect(found[0]!.plugin).toBeUndefined();
  });
});

describe("enabled / disabled", () => {
  it("a disabled plugin's Skills stop being listed, and come back on re-enable", async () => {
    await installPlugin(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, makePlugin("tuning", ["a"]));
    expect((await list()).map((s) => s.name)).toEqual(["a"]);

    expect(
      await setPluginEnabled(
        tmpRoot,
        DEFAULT_PROJECT_ID,
        DEFAULT_AGENT_ID,
        "tuning@jiumate-builtin",
        false,
      ),
    ).toBe(false);
    expect(await list()).toEqual([]);

    // The files were never touched, so switching back on needs no reinstall.
    expect(
      await setPluginEnabled(
        tmpRoot,
        DEFAULT_PROJECT_ID,
        DEFAULT_AGENT_ID,
        "tuning@jiumate-builtin",
        true,
      ),
    ).toBe(true);
    expect((await list()).map((s) => s.name)).toEqual(["a"]);
  });

  it("reports the state through the plugin listing", async () => {
    await installPlugin(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, makePlugin("tuning", ["a"]));
    await setPluginEnabled(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      "tuning@jiumate-builtin",
      false,
    );
    const [entry] = await listInstalledPlugins(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(entry!.enabled).toBe(false);
    expect(entry!.id).toBe("tuning@jiumate-builtin");
    expect(entry!.name).toBe("tuning");
  });

  it("leaves a standalone Skill alone when a plugin is switched off", async () => {
    const solo = path.join(skillsDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), "mine");
    await fs.mkdir(solo, { recursive: true });
    await fs.writeFile(
      path.join(solo, "SKILL.md"),
      "---\nname: mine\ndescription: mine\n---\n\nmine\n",
      "utf8",
    );
    await installPlugin(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, makePlugin("tuning", ["a"]));
    await setPluginEnabled(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      "tuning@jiumate-builtin",
      false,
    );
    expect((await list()).map((s) => s.name)).toEqual(["mine"]);
  });

  it("switching something that is not installed reports enabled rather than inventing state", async () => {
    expect(
      await setPluginEnabled(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "absent@m", false),
    ).toBe(true);
  });
});

describe("listInstalledPlugins", () => {
  it("lists by id, sorted, with members", async () => {
    await installPlugin(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, makePlugin("zeta", ["z"]));
    await installPlugin(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      makePlugin("alpha", ["a1", "a2"]),
    );
    const entries = await listInstalledPlugins(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(entries.map((e) => e.id)).toEqual(["alpha@jiumate-builtin", "zeta@jiumate-builtin"]);
    expect(entries[0]!.skills).toEqual(["a1", "a2"]);
  });

  it("returns [] when nothing is installed", async () => {
    expect(await listInstalledPlugins(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID)).toEqual([]);
  });

  it("still lists a plugin whose manifest is corrupt, as enabled", async () => {
    const dir = path.join(pluginsDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), "broken@m");
    await fs.mkdir(path.join(dir, "skills", "s"), { recursive: true });
    await fs.writeFile(path.join(dir, "skills", "s", "SKILL.md"), "---\nname: s\n---\n\nb\n");
    await fs.writeFile(path.join(dir, "manifest.json"), "{ not json");
    const entries = await listInstalledPlugins(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(entries).toHaveLength(1);
    // The directory proves an install happened; a damaged manifest must not hide it.
    expect(entries[0]!.enabled).toBe(true);
    expect(entries[0]!.version).toBe("");
  });

  it("skips staging directories", async () => {
    const dir = path.join(pluginsDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), ".staging@m");
    await fs.mkdir(dir, { recursive: true });
    expect(await listInstalledPlugins(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID)).toEqual([]);
  });
});

describe("migrateFlatBundledSkills", () => {
  /** Writes a flat Skill the way the pre-migration install path did. */
  const writeFlat = async (name: string, body = "body"): Promise<void> => {
    const dir = path.join(skillsDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${body}\n---\n\n${body}\n`,
      "utf8",
    );
  };

  /** The library, as migration sees it: plugin name → the Skill names it ships. */
  const libraryOf = (...plugins: Array<[string, string[]]>) => new Map(plugins);

  it("moves a flat Skill the library ships from exactly one plugin", async () => {
    await writeFlat("a");

    const report = await migrateFlatBundledSkills(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      libraryOf(["tuning", ["a"]]),
    );

    expect(report.movedSkills).toEqual(["a"]);
    expect(report.migrated).toEqual(["tuning@jiumate-builtin"]);
    // Gone from the flat tree, present in the plugin's, and attributed structurally.
    expect(
      await exists(path.join(skillsDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), "a")),
    ).toBe(false);
    const found = await list();
    expect(found[0]!.plugin).toBe("tuning@jiumate-builtin");
  });

  it("migrates without a provenance record — the real-world case", async () => {
    // `.installs.json` is absent for every install made before it shipped, which is exactly the
    // population that needs migrating. The library says what a Skill *is*; the record only says who
    // brought it, and that is the half that is missing.
    await writeFlat("a");
    const { readInstalls } = await import("../src/state/installs.js");
    expect((await readInstalls(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID)).plugins).toEqual({});

    const report = await migrateFlatBundledSkills(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      libraryOf(["tuning", ["a"]]),
    );
    expect(report.movedSkills).toEqual(["a"]);
  });

  it("leaves a Skill the library does not ship exactly where it is", async () => {
    // The user's own import. Nothing claims it, so nothing moves it.
    await writeFlat("mine");
    await writeFlat("theirs");

    const report = await migrateFlatBundledSkills(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      libraryOf(["tuning", ["theirs"]]),
    );

    expect(report.movedSkills).toEqual(["theirs"]);
    // Explicitly reported rather than silently skipped — this is the answer to "why is this still
    // in skills/", and the list a user may want to act on themselves.
    expect(report.leftAlone).toEqual(["mine"]);
    const found = await list();
    // `theirs` moved and is now bundled; `mine` was never claimed and stays standalone.
    expect(found.find((s) => s.name === "mine")!.plugin).toBeUndefined();
    expect(found.find((s) => s.name === "theirs")!.plugin).toBe("tuning@jiumate-builtin");
  });

  it("leaves a Skill two plugins both ship, because it may have been installed alone", async () => {
    // The one case uniqueness rules out: the user may have installed this Skill on its own rather
    // than with either plugin, and moving it would take away the ability to remove just it.
    await writeFlat("shared");

    const report = await migrateFlatBundledSkills(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      libraryOf(["alpha", ["shared"]], ["beta", ["shared"]]),
    );

    expect(report.movedSkills).toEqual([]);
    expect(report.leftAlone).toEqual(["shared"]);
    expect((await list()).map((s) => s.name)).toEqual(["shared"]);
  });

  it("moves a partial plugin's members one at a time, each to the plugin that owns it", async () => {
    // Membership of the whole set is *not* required. A Skill shipped by exactly one plugin is
    // provably that plugin's, whether or not its siblings happen to be installed too.
    await writeFlat("a");
    await writeFlat("b");
    await writeFlat("c");

    const report = await migrateFlatBundledSkills(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      libraryOf(["tuning", ["a", "b"]], ["other", ["c"]]),
    );

    expect(report.movedSkills.sort()).toEqual(["a", "b", "c"]);
    expect(report.migrated.sort()).toEqual(["other@jiumate-builtin", "tuning@jiumate-builtin"]);
  });

  it("writes a manifest for each migrated plugin, so the switch has something to rewrite", async () => {
    await writeFlat("a");

    await migrateFlatBundledSkills(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      libraryOf(["tuning", ["a"]]),
    );

    // Without this the plugin has Skills but no `enabled` flag, and the switch would work on a
    // freshly installed plugin while silently doing nothing on an upgraded one.
    const file = path.join(
      pluginDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "tuning@jiumate-builtin"),
      "manifest.json",
    );
    const manifest = JSON.parse(await fs.readFile(file, "utf8"));
    expect(manifest.id).toBe("tuning@jiumate-builtin");
    expect(manifest.enabled).toBe(true);
    // Unknown rather than guessed: the on-disk copy's version is not something this checked.
    expect(manifest.version).toBe("");

    // And the switch therefore actually works on a migrated plugin.
    expect(
      await setPluginEnabled(
        tmpRoot,
        DEFAULT_PROJECT_ID,
        DEFAULT_AGENT_ID,
        "tuning@jiumate-builtin",
        false,
      ),
    ).toBe(false);
    expect(await list()).toEqual([]);
  });

  it("records provenance for a migrated plugin, so plugin-level uninstall knows it", async () => {
    await writeFlat("a");
    await writeFlat("b");

    await migrateFlatBundledSkills(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      libraryOf(["tuning", ["a", "b"]]),
    );

    const { readInstalls } = await import("../src/state/installs.js");
    const file = await readInstalls(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(file.plugins["tuning"]?.skills).toEqual(["a", "b"]);
  });

  it("does not overwrite an existing plugin's manifest or version", async () => {
    // A plugin that was installed properly first, then a stray flat copy of one of its members
    // appears. The manifest is the real one and must survive the migration untouched.
    await installPlugin(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, makePlugin("tuning", ["a"]));
    await writeFlat("b");

    await migrateFlatBundledSkills(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      libraryOf(["tuning", ["a", "b"]]),
    );

    const file = path.join(
      pluginDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "tuning@jiumate-builtin"),
      "manifest.json",
    );
    expect(JSON.parse(await fs.readFile(file, "utf8")).version).toBe("2026-10-01.1");
  });

  it("is idempotent: a second run moves nothing and reports nothing as moved", async () => {
    await writeFlat("a");

    const members = libraryOf(["tuning", ["a"]]);
    await migrateFlatBundledSkills(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, members);
    const second = await migrateFlatBundledSkills(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      members,
    );

    expect(second.movedSkills).toEqual([]);
    // Converges rather than duplicating, so it is safe to re-run on every read.
    expect((await list()).map((s) => s.name)).toEqual(["a"]);
  });

  it("does nothing at all when the library is empty", async () => {
    await writeFlat("a");
    const report = await migrateFlatBundledSkills(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      new Map(),
    );
    expect(report.migrated).toEqual([]);
    expect(report.leftAlone).toEqual(["a"]);
    expect((await list()).map((s) => s.name)).toEqual(["a"]);
  });

  it("does nothing when there are no flat skills, without creating the plugins tree", async () => {
    const report = await migrateFlatBundledSkills(
      tmpRoot,
      DEFAULT_PROJECT_ID,
      DEFAULT_AGENT_ID,
      libraryOf(["tuning", ["a"]]),
    );
    expect(report.migrated).toEqual([]);
    expect(await exists(pluginsDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID))).toBe(false);
  });
});
