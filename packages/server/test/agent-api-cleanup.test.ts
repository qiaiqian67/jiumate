/**
 * What happens to an Agent API key when the thing that owns it goes away.
 *
 * Both cases here were found by deleting a test account that had minted a key: the delete
 * answered 500, because `agent_api_keys.created_by` is a foreign key to users(user_id) and the
 * row outlived the account. And deleting a Project left its keys behind, because neither table
 * has a foreign key to projects — so a key that still authenticated outlived the Agent it was
 * for, and the list that would have shown it was gone too.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentApiKeyCreatedResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT_ID = "owner_api-shared";
const AGENT_ID = "api_agent";

describe("agent api rows follow what owns them", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let admin: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_api");
    owner = apiClient(t.app, a.cookie);
    const adminSession = await loginAdmin(t.app);
    admin = apiClient(t.app, adminSession.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: PROJECT_ID, name: "Shared" })
    ).json()) as ProjectCreateResponse;
    expect(created.project.projectId).toBe(PROJECT_ID);
  });

  afterEach(async () => {
    await t.cleanup();
  });

  /** Exposes the Agent and mints one key on it. */
  const expose = async (): Promise<void> => {
    expect((await owner.post(`/api/projects/${PROJECT_ID}/agents`, { agentId: AGENT_ID })).status).toBe(
      201,
    );
    expect(
      (
        await owner.put(`/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/api`, { enabled: true })
      ).status,
    ).toBe(200);
    const minted = (await (
      await owner.post(`/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/api/keys`, { name: "k" })
    ).json()) as AgentApiKeyCreatedResponse;
    expect(minted.secret.startsWith("jiumate_")).toBe(true);
  };

  it("deleting a Project drops its settings row and its keys", async () => {
    await expose();
    expect(t.deps.agentApiRepo.get(PROJECT_ID, AGENT_ID)).not.toBeNull();
    expect(t.deps.agentApiRepo.listKeys(PROJECT_ID, AGENT_ID).length).toBe(1);

    expect((await owner.delete(`/api/projects/${PROJECT_ID}`)).status).toBe(204);

    // Neither table has a foreign key to projects, so nothing removed them by itself. A key left
    // behind still authenticates — it is a live credential for an Agent that no longer exists.
    expect(t.deps.agentApiRepo.get(PROJECT_ID, AGENT_ID)).toBeNull();
    expect(t.deps.agentApiRepo.listKeys(PROJECT_ID, AGENT_ID).length).toBe(0);
  });

  it("deleting a user who minted a key succeeds, and takes the key with it", async () => {
    await expose();
    const keyId = t.deps.agentApiRepo.listKeys(PROJECT_ID, AGENT_ID)[0]!.keyId;

    // The foreign key on created_by is enforced, so before the fix this failed on the constraint
    // and the account survived a delete the admin had asked for.
    expect((await admin.delete("/api/admin/users/owner_api")).status).toBe(204);

    expect(t.deps.agentApiRepo.findKeyByHash("x")).toBeNull();
    expect(
      t.deps.agentApiRepo
        .listKeys(PROJECT_ID, AGENT_ID)
        .filter((k) => k.keyId === keyId).length,
    ).toBe(0);
  });
});
