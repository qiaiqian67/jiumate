/**
 * The Agent API's calling side: `/amsp/v1/...`.
 *
 * The refusal matrix matters more than the happy path: every wrong thing has to be refused
 * without telling the caller more than it should. The two that matter most:
 *
 *   - "this Agent is not exposed" and "no such Agent" must look identical, or the endpoint
 *     becomes an oracle for enumerating what exists on the server;
 *   - a key minted for one Agent must not reach another, and must not be told that it exists
 *     but points elsewhere.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentApiKeyCreatedResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT_ID = "amsp_proj";
const AGENT_ID = "default_agent";

describe("amsp routes", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let key: string;

  const amsp = (suffix = "") =>
    `/amsp/v1/projects/${PROJECT_ID}/agents/${AGENT_ID}/sessions${suffix}`;

  const keyed = (path: string, method: string, body?: unknown, secret = key) =>
    t.app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await loginAdmin(t.app);
    admin = apiClient(t.app, cookie);
    const created = (await (
      await admin.post("/api/projects", { projectId: PROJECT_ID, name: "AMSP" })
    ).json()) as ProjectCreateResponse;
    expect(created.project.projectId).toBe(PROJECT_ID);
    await admin.put(`/api/projects/${PROJECT_ID}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6" }],
    });
    const put = await admin.put(`/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/api`, {
      enabled: true,
    });
    expect(put.status).toBe(200);
    const minted = (await (
      await admin.post(`/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/api/keys`, { name: "test" })
    ).json()) as AgentApiKeyCreatedResponse;
    key = minted.secret;
    expect(key.startsWith("jiumate_")).toBe(true);
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("accepts a keyed request and starts a run", async () => {
    const res = await keyed(amsp(), "POST", { prompt: "hello" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { sessionId: string; queued: boolean };
    expect(body.sessionId).toBeTruthy();
    expect(body.queued).toBe(false);
  });

  it("refuses a key that matches nothing", async () => {
    const res = await keyed(amsp(), "POST", { prompt: "hello" }, "jiumate_not_a_real_key");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("refuses a keyless request while `open` is off", async () => {
    const res = await t.app.request(amsp(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("answers 404 for an unknown Agent, like one that is not exposed", async () => {
    const unknown = await keyed(
      "/amsp/v1/projects/amsp_proj/agents/no_such_agent/sessions",
      "POST",
      { prompt: "hello" },
    );
    expect(unknown.status).toBe(404);
    const exposed = await keyed(amsp(), "POST", { prompt: "hello" });
    expect(exposed.status).toBe(202);
  });
});
