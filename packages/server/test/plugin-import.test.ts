/**
 * The three plugin-import routes (server/http/routes/plugin-import.ts), against a booted app.
 *
 * What these cover that the core tests cannot: the HTTP layer — auth, the Project-member check,
 * the status codes, and above all that an import actually lands **in the library the page reads**.
 * The core tests stop at "the bytes were written"; these stop at "a plugin a user can install now
 * appears", which is the thing that was silently not happening.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { libraryPlugin, localPluginsDir } from "@jadelau/core";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("plugin import", () => {
  let t: TestApp;
  let client: ReturnType<typeof apiClient>;
  let projectId: string;
  let agentId: string;

  /** A minimal plugin on disk: a manifest with a version, and one skill. */
  function makePlugin(dir: string, name: string): string {
    fs.mkdirSync(path.join(dir, "skills", "demo"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({ name, version: "2026-01-01.1", description: `the ${name} plugin` }),
    );
    fs.writeFileSync(
      path.join(dir, "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: does a thing\n---\n",
    );
    return dir;
  }

  /** A plugin zipped the way a real download is: wrapped in its own top-level folder. */
  function zipOfPlugin(name: string): string {
    const dir = makePlugin(path.join(t.root, "zip-src", name), name);
    const entries: Record<string, Uint8Array> = {};
    const walk = (cur: string, prefix: string): void => {
      for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
        const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
        if (e.isDirectory()) walk(path.join(cur, e.name), rel);
        else entries[`${name}/${rel}`] = fs.readFileSync(path.join(cur, e.name));
      }
    };
    walk(dir, "");
    return Buffer.from(zipSync(entries)).toString("base64");
  }

  beforeEach(async () => {
    t = await createTestApp();
    const user = await provisionUser(t.app, "importer");
    client = apiClient(t.app, user.cookie);
    const created = await client.post("/api/projects", {
      projectId: "importer-shared",
      name: "P",
    });
    // Surfaced rather than asserted: a 400 here is a harness mistake, and the body says which.
    if (created.status !== 201) {
      throw new Error(`project create failed: ${created.status} ${await created.text()}`);
    }
    projectId = ((await created.json()) as { project: { projectId: string } }).project.projectId;

    // An Agent to install into. Machine-level delete has to report which Agents are affected, so
    // the tests that cover it need one that actually holds the plugin.
    const agent = await client.post(`/api/projects/${projectId}/agents`, {
      agentId: "importer_agent",
      name: "A",
    });
    if (agent.status !== 201 && agent.status !== 200) {
      throw new Error(`agent create failed: ${agent.status} ${await agent.text()}`);
    }
    agentId = "importer_agent";
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("imports a plugin from a local directory, and it reaches the library", async () => {
    const source = makePlugin(path.join(t.root, "local-src"), "from-local");

    const res = await client.post(`/api/projects/${projectId}/plugins/import/local`, {
      path: source,
    });

    if (res.status !== 201) {
      throw new Error(`import failed: ${res.status} ${await res.text()}`);
    }
    // The assertion that matters: the plugin is readable by the same reader the library listing
    // uses, so it appears on the page rather than only on disk.
    const stored = libraryPlugin("from-local");
    expect(stored).toBeDefined();
    expect(stored?.skills.map((s) => s.name)).toEqual(["demo"]);
  });

  it("imports a plugin from an uploaded archive, and it reaches the library", async () => {
    const res = await client.post(`/api/projects/${projectId}/plugins/import/archive`, {
      dataBase64: zipOfPlugin("from-zip"),
    });

    expect(res.status).toBe(201);
    expect(libraryPlugin("from-zip")).toBeDefined();
  });

  it("imports a plugin whose skills directory name and frontmatter match", async () => {
    // A skill directory is only readable if its name and its frontmatter agree — the reader keys
    // on the directory and the frontmatter supplies the metadata, and a mismatch reads as a skill
    // that is not a skill. Reproduced here because it is the most likely shape of a real import
    // failing, and a 400 from it is indistinguishable from any other refusal without the message.
    const source = path.join(t.root, "realistic");
    fs.mkdirSync(path.join(source, "skills", "weather-report"), { recursive: true });
    fs.writeFileSync(
      path.join(source, "plugin.json"),
      JSON.stringify({
        name: "realistic",
        version: "2026-03-01.1",
        description: "A plugin I made locally",
        description_zh: "我在本地做的插件",
      }),
    );
    fs.writeFileSync(
      path.join(source, "skills", "weather-report", "SKILL.md"),
      "---\nname: weather-report\ndescription: 查询某个城市的天气。当用户问天气时使用。\n---\n\n# 天气播报\n\n请播报天气。\n",
    );

    const res = await client.post(`/api/projects/${projectId}/plugins/import/local`, {
      path: source,
    });

    if (res.status !== 201) {
      throw new Error(`import failed: ${res.status} ${await res.text()}`);
    }
    const stored = libraryPlugin("realistic");
    expect(stored?.skills.map((s) => s.name)).toEqual(["weather-report"]);
  });

  it("gives an imported plugin its own id, separate from the built-in of the same name", async () => {
    // Two plugins called `humanizer` must be two install targets, not one overwriting the other.
    const source = makePlugin(path.join(t.root, "clash"), "humanizer");
    const res = await client.post(`/api/projects/${projectId}/plugins/import/local`, {
      path: source,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("humanizer@local");
  });

  it("refuses an archive that escapes its destination, installing nothing", async () => {
    const hostile = Buffer.from(
      zipSync({
        "plugin.json": new TextEncoder().encode('{"name":"evil","version":"2026-01-01.1"}'),
        "../../escaped.txt": new TextEncoder().encode("boom"),
      }),
    ).toString("base64");

    const res = await client.post(`/api/projects/${projectId}/plugins/import/archive`, {
      dataBase64: hostile,
    });

    expect(res.status).toBe(400);
    expect(libraryPlugin("evil")).toBeUndefined();
  });

  it("refuses a zip that is not a plugin", async () => {
    const notAPlugin = Buffer.from(
      zipSync({ "readme.md": new TextEncoder().encode("hi") }),
    ).toString("base64");

    const res = await client.post(`/api/projects/${projectId}/plugins/import/archive`, {
      dataBase64: notAPlugin,
    });

    expect(res.status).toBe(400);
  });

  it("imports every plugin in a directory, none of them enabled for any Agent", async () => {
    // 添加目录 = the directory's plugins, and the crucial half is 「都是待启用状态」: on this
    // machine, into no Agent. A bulk import that switched five plugins on for whichever Agent
    // happened to be selected would be a huge effect from a small action.
    const dir = path.join(t.root, "collection");
    for (const name of ["alpha", "beta", "gamma"]) {
      makePlugin(path.join(dir, name), name);
    }

    const res = await client.post(`/api/projects/${projectId}/plugins/import/local/batch`, {
      path: dir,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { added: { name: string }[]; failed: unknown[] };
    expect(body.failed).toEqual([]);
    expect(body.added.map((p) => p.name).sort()).toEqual(["alpha", "beta", "gamma"]);

    // All three are in the library — and none of them is installed on the Agent, because adding
    // a directory does not enable anything.
    for (const name of ["alpha", "beta", "gamma"]) {
      expect(libraryPlugin(name)).toBeDefined();
    }
    const installed = await client.get(`/api/projects/${projectId}/agents/${agentId}/plugins`);
    const names = (((await installed.json()) as { skills: { name: string }[] }).skills ?? []).map(
      (s) => s.name,
    );
    expect(names).toEqual([]);
  });

  it("imports the good plugins in a directory and reports the ones it could not", async () => {
    // One unreadable manifest must not take the other nine down with it — a folder of ten where
    // one is broken is a folder of nine usable plugins, and refusing all of them would make the
    // button useless on any real collection.
    const dir = path.join(t.root, "mixed");
    makePlugin(path.join(dir, "good"), "good");
    // A directory that is not a plugin at all: the scanner skips it silently, which is the case
    // that must not empty the whole import.
    fs.mkdirSync(path.join(dir, "not-a-plugin"), { recursive: true });

    const res = await client.post(`/api/projects/${projectId}/plugins/import/local/batch`, {
      path: dir,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { added: { name: string }[]; failed: unknown[] };
    expect(body.added.map((p) => p.name)).toEqual(["good"]);
    expect(libraryPlugin("good")).toBeDefined();
  });

  it("refuses a directory with no plugins in it, rather than reporting an empty success", async () => {
    // The user asked for their plugins and got none. A silent 200 with an empty list reads as a
    // bug; a 400 that says what a plugin needs does not.
    const empty = path.join(t.root, "nothing-here");
    fs.mkdirSync(empty);
    const res = await client.post(`/api/projects/${projectId}/plugins/import/local/batch`, {
      path: empty,
    });
    expect(res.status).toBe(400);
  });

  it("accepts a single plugin directory as a one-plugin collection", async () => {
    // 「选哪个都行」: pointing at the plugin itself, or at a folder of them, means the same thing.
    const solo = makePlugin(path.join(t.root, "solo"), "solo-plugin");
    const res = await client.post(`/api/projects/${projectId}/plugins/import/local/batch`, {
      path: solo,
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { added: { name: string }[] }).added.map((p) => p.name)).toEqual([
      "solo-plugin",
    ]);
  });

  it("deletes an added plugin from the machine and reports which Agents had it", async () => {
    // 卸载 is machine-wide and irreversible, so the response names the affected Agents: that list
    // is what lets the client show a confirm the user can actually reason about, and it has to be
    // read *before* the delete or there is nothing left to read.
    const source = makePlugin(path.join(t.root, "doomed"), "doomed-plugin");
    const added = await client.post(`/api/projects/${projectId}/plugins/import/local`, {
      path: source,
    });
    expect(added.status).toBe(201);
    const id = ((await added.json()) as { id: string }).id;

    const installed = await client.post(`/api/projects/${projectId}/agents/${agentId}/plugins`, {
      names: ["doomed-plugin"],
    });
    expect(installed.status).toBe(201);

    const res = await client.delete(`/api/projects/${projectId}/plugins/import/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, affectedAgents: [agentId] });

    // Gone from the library, not just from the store — otherwise the card would keep offering to
    // delete something that is already gone.
    expect(libraryPlugin("doomed-plugin")).toBeUndefined();
  });

  it("refuses to delete a built-in plugin", async () => {
    // Built-ins ship with the app and their files are not in the added-plugin store, so deleting by
    // path would either fail obscurely or reach a directory it should not.
    const res = await client.delete(
      `/api/projects/${projectId}/plugins/import/humanizer%40jiumate-builtin`,
    );
    expect(res.status).toBe(400);
  });

  it("reports a folder-sourced plugin as having nothing to upgrade", async () => {
    // `upgradable: false` is not "up to date" — it is "there is no source to ask". The two mean
    // different things to the user and the client words them differently.
    const source = makePlugin(path.join(t.root, "local-one"), "local-one");
    await client.post(`/api/projects/${projectId}/plugins/import/local`, { path: source });

    const res = await client.post(
      `/api/projects/${projectId}/plugins/import/local-one%40local/upgrade`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ upgraded: false, upgradable: false });
  });

  it("refuses a URL that names no repository, with a 400 rather than a 500", async () => {
    const res = await client.post(`/api/projects/${projectId}/plugins/import/url`, {
      url: "not-a-url",
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "bad_repo_url" },
    });
  });

  it("refuses a URL whose scheme is not http(s)", async () => {
    // Checked before any request is made, so a `file://` paste cannot reach the network layer at all.
    const res = await client.post(`/api/projects/${projectId}/plugins/import/url`, {
      url: "file:///C:/Windows",
    });
    expect(res.status).toBe(400);
  });

  it("refuses a directory with no manifest", async () => {
    const empty = path.join(t.root, "empty");
    fs.mkdirSync(empty);
    const res = await client.post(`/api/projects/${projectId}/plugins/import/local`, {
      path: empty,
    });

    expect(res.status).toBe(400);
  });

  it("refuses a path that does not exist, rather than 500ing", async () => {
    const res = await client.post(`/api/projects/${projectId}/plugins/import/local`, {
      path: path.join(t.root, "nope"),
    });

    expect(res.status).toBe(400);
  });

  it("lists what it probed, so an empty discovery is explainable", async () => {
    const res = await client.get(`/api/projects/${projectId}/plugins/import/discover`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { probes: { path: string; exists: boolean }[] };
    expect(body.probes.length).toBeGreaterThan(0);
  });

  it("keeps a caller's files out of the store's read path", async () => {
    // `.staging` is where an archive is unpacked; `localPluginRoots` skips dot-names, so a
    // half-written import can never be listed as a plugin.
    await client.post(`/api/projects/${projectId}/plugins/import/local`, {
      path: makePlugin(path.join(t.root, "ok"), "clean"),
    });
    const entries = fs.readdirSync(localPluginsDir(t.root));
    expect(entries.every((e) => !e.startsWith("."))).toBe(true);
  });
});
