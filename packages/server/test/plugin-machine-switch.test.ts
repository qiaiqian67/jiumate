/**
 * The machine-level plugin switch over HTTP: `POST /api/plugins/enabled`, and the install gate it
 * puts in front of `POST /api/projects/:p/agents/:a/plugins`.
 *
 * What these cover that the core tests cannot: the HTTP layer — that the switch is reachable
 * without a Project or an Agent (it is machine-wide, so the path carries neither), that the library
 * listing reports the state it wrote, and that a disabled plugin cannot be installed with a status
 * the UI can tell apart from an unknown plugin.
 *
 * The install gate is the part worth pinning. The switch is stored in one file that no other code
 * path consults, so without a refusal at the install endpoint a user could switch a plugin off,
 * watch the card go grey, and still install it onto an Agent — the switch would be decorative.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import type { PluginLibraryResponse } from "../src/api/types.js";

describe("machine-level plugin switch", () => {
  let t: TestApp;
  let client: ReturnType<typeof apiClient>;
  let projectId: string;
  let agentId: string;

  /** A built-in plugin the library carries, so no import is needed to exercise the switch. */
  const PLUGIN = "humanizer";

  beforeEach(async () => {
    t = await createTestApp();
    const user = await provisionUser(t.app, "switcher");
    client = apiClient(t.app, user.cookie);
    const created = await client.post("/api/projects", {
      projectId: "switcher-shared",
      name: "P",
    });
    if (created.status !== 201) {
      throw new Error(`project create failed: ${created.status} ${await created.text()}`);
    }
    projectId = ((await created.json()) as { project: { projectId: string } }).project.projectId;
    const agent = await client.post(`/api/projects/${projectId}/agents`, {
      agentId: "switcher_agent",
      name: "A",
    });
    if (agent.status !== 201 && agent.status !== 200) {
      throw new Error(`agent create failed: ${agent.status} ${await agent.text()}`);
    }
    agentId = "switcher_agent";
  });

  afterEach(async () => {
    await t.cleanup();
  });

  /** The library's answer for one plugin, as the card reads it. */
  async function libraryEnabled(name: string): Promise<boolean | undefined> {
    const res = await client.get("/api/plugins");
    if (res.status !== 200) throw new Error(`library failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as PluginLibraryResponse;
    for (const group of body.groups) {
      for (const plugin of group.plugins) {
        if (plugin.name === name) return plugin.enabled;
      }
    }
    return undefined;
  }

  it("reports every plugin as enabled before anything is switched off", async () => {
    // The field is unconditional, not "absent means on": the card shows a switch for every plugin,
    // so the listing has to carry an answer even for one that was never touched.
    expect(await libraryEnabled(PLUGIN)).toBe(true);
  });

  it("switches a plugin off for the machine and back on", async () => {
    const off = await client.post("/api/plugins/enabled", { id: PLUGIN, enabled: false });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { enabled: boolean }).enabled).toBe(false);
    expect(await libraryEnabled(PLUGIN)).toBe(false);

    const on = await client.post("/api/plugins/enabled", { id: PLUGIN, enabled: true });
    expect(on.status).toBe(200);
    expect(await libraryEnabled(PLUGIN)).toBe(true);
  });

  it("takes a full plugin id as well as a bare name", async () => {
    // The card holds `name@jiumate-builtin` and the listing holds `name`; a switch that understood
    // only one of them would let the two disagree about whether the plugin is on.
    const res = await client.post("/api/plugins/enabled", {
      id: `${PLUGIN}@jiumate-builtin`,
      enabled: false,
    });
    expect(res.status).toBe(200);
    expect(await libraryEnabled(PLUGIN)).toBe(false);
  });

  it("refuses to install a plugin switched off for this machine", async () => {
    await client.post("/api/plugins/enabled", { id: PLUGIN, enabled: false });

    const res = await client.post(`/api/projects/${projectId}/agents/${agentId}/plugins`, {
      names: [PLUGIN],
    });
    // 409, not 400: the plugin exists and is installable in principle — it is switched off, which
    // is a state the user can change, so the UI has to be able to say what unblocks it.
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("plugin_disabled");

    // And nothing was written: a refused install must not leave a directory behind.
    const dir = path.join(t.root, projectId, "agents", agentId, "agent_state", "plugins");
    expect(fs.existsSync(path.join(dir, `${PLUGIN}@jiumate-builtin`))).toBe(false);
  });

  it("installs normally once the plugin is switched back on", async () => {
    await client.post("/api/plugins/enabled", { id: PLUGIN, enabled: false });
    await client.post("/api/plugins/enabled", { id: PLUGIN, enabled: true });

    const res = await client.post(`/api/projects/${projectId}/agents/${agentId}/plugins`, {
      names: [PLUGIN],
    });
    expect(res.status).toBe(201);
  });

  it("rejects the whole batch when one name is switched off, rather than half-installing it", async () => {
    await client.post("/api/plugins/enabled", { id: PLUGIN, enabled: false });

    const res = await client.post(`/api/projects/${projectId}/agents/${agentId}/plugins`, {
      names: [PLUGIN, "agent-tuning"],
    });
    expect(res.status).toBe(409);

    // The other name in the batch was fine — it must not have been installed anyway, or the caller
    // cannot tell from the response which half of the request landed.
    const dir = path.join(t.root, projectId, "agents", agentId, "agent_state", "plugins");
    expect(fs.existsSync(path.join(dir, "agent-tuning@jiumate-builtin"))).toBe(false);
  });

  it("rejects a non-boolean enabled rather than coercing it", async () => {
    // `"false"` is truthy. Coercing it would write the opposite of what the caller meant.
    const res = await client.post("/api/plugins/enabled", { id: PLUGIN, enabled: "false" });
    expect(res.status).toBe(400);
    expect(await libraryEnabled(PLUGIN)).toBe(true);
  });
});
