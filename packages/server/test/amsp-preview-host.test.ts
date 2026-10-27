/**
 * The Agent API answers on both loopback names.
 *
 * The preview host (the loopback counterpart of the App host) exists so that Agent-written preview
 * HTML, which runs in a browser, cannot spend the user's session on the App's own API — that
 * surface is cookie-authenticated, so the preview host answers it with a 401 rather than serving
 * it. The Agent API is not cookie-authenticated: it authenticates an `jiumate_` key.
 *
 * Redirecting it there was actively wrong. A 302 turns a POST into a GET for most clients, and the
 * Authorization header is dropped when the redirect crosses to another host — so a program that
 * called the server by its IP got a redirect instead of a run, and a 200 with no body. That is a
 * caller-visible failure that looks like a server ignoring the key.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentApiKeyCreatedResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT_ID = "owner_api-preview";
const AGENT_ID = "preview_agent";

describe("the agent api on the preview host", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let key: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_api");
    owner = apiClient(t.app, a.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: PROJECT_ID, name: "Shared" })
    ).json()) as ProjectCreateResponse;
    expect(created.project.projectId).toBe(PROJECT_ID);
    // A default model, because creating a session needs one to resolve.
    await owner.put(`/api/projects/${PROJECT_ID}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6" }],
    });
    expect(
      (await owner.post(`/api/projects/${PROJECT_ID}/agents`, { agentId: AGENT_ID })).status,
    ).toBe(201);
    expect(
      (await owner.put(`/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/api`, { enabled: true }))
        .status,
    ).toBe(200);
    const minted = (await (
      await owner.post(`/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/api/keys`, { name: "k" })
    ).json()) as AgentApiKeyCreatedResponse;
    key = minted.secret;
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("serves a keyed request on the preview host instead of redirecting it", async () => {
    // The test app binds 127.0.0.1, so that name is the preview host here and "localhost" is the
    // canonical one — the same pair the running server answers on.
    const res = await t.app.request(
      `http://127.0.0.1/amsp/v1/projects/${PROJECT_ID}/agents/${AGENT_ID}/sessions`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      },
    );
    const text = await res.text();
    expect(res.status, `body: ${text}`).toBe(202);
    const body = JSON.parse(text) as { sessionId: string };
    expect(body.sessionId).toBeTruthy();
  });
  it("still refuses the cookie-authenticated API on the preview host", async () => {
    // The guard this change carves an exception out of is still there for the surface it was
    // written for: a preview page must not be able to spend the user's session.
    const res = await t.app.request("http://127.0.0.1/api/me");
    expect(res.status).toBe(401);
  });
});
