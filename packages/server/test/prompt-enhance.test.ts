/**
 * Prompt enhancement (POST /api/projects/:p/prompt/enhance): the service resolves the Project's
 * default model, collapses every failure into a typed `{ ok:false, code }`, and the route
 * validates shape and access before any request goes out.
 *
 * The codes are the point of the shape. `no_model` is the only one the UI can act on ("go pick
 * a model"); conflating it with a provider failure would tell the user to retry a call that
 * cannot succeed until they configure something. And every failure — including a throw from
 * the LLM layer — arrives as a 200 with a body, because the caller is a button with nowhere to
 * show a 500.
 */
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectCreateResponse } from "../src/api/types.js";
import { ProjectConfigService } from "../src/services/project-config-service.js";
import type { LLMInterface } from "@jadelau/core";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/**
 * Stands in for the LLM factory so no provider client is ever constructed, plus a driver that
 * yields `reply`. The two are separate parameters on the service precisely so a test can
 * supply both without touching the network.
 */
const stubLLM = {} as LLMInterface;

const fakeLLM =
  (reply: string | null = "目标：修复登录报错") =>
  async () =>
    reply === null ? { prompt: null, usage: null } : { prompt: reply, usage: null };

describe("ProjectConfigService.enhancePrompt", () => {
  let root: string;
  let service: ProjectConfigService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "jiumate-enhance-"));
    service = new ProjectConfigService(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const project = async (models: unknown, defaultModel?: unknown): Promise<string> => {
    const projectId = "p1";
    await service.writeRaw(projectId, {
      ...(models !== undefined ? { models } : {}),
      ...(defaultModel !== undefined ? { default_model: defaultModel } : {}),
    });
    return projectId;
  };

  const entry = { provider: "openai", model_id: "gpt-x", api_key: "sk-1" };

  it("returns the rewrite the driver produced", async () => {
    const projectId = await project([entry], { provider: "openai", model_id: "gpt-x" });
    expect(
      await service.enhancePrompt(projectId, { text: "修复登录" }, () => stubLLM, fakeLLM()),
    ).toEqual({ ok: true, prompt: "目标：修复登录报错" });
  });

  it("reports no_model when the Project has no default model", async () => {
    const projectId = await project([entry]);
    // The one code the UI turns into "pick a model" rather than "try again".
    expect(await service.enhancePrompt(projectId, { text: "x" }, () => stubLLM, fakeLLM())).toEqual(
      { ok: false, code: "no_model" },
    );
  });

  it("reports no_model when the default reference names no stored entry", async () => {
    // A stale reference cannot be called: there is no entry to read a credential from.
    const projectId = await project([entry], { provider: "openai", model_id: "ghost" });
    const res = await service.enhancePrompt(projectId, { text: "x" }, () => stubLLM, fakeLLM());
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.code).toBe("no_model");
  });

  it("reports no_result when the model answered with nothing usable", async () => {
    const projectId = await project([entry], { provider: "openai", model_id: "gpt-x" });
    expect(
      await service.enhancePrompt(projectId, { text: "x" }, () => stubLLM, fakeLLM(null)),
    ).toEqual({ ok: false, code: "no_result" });
  });

  it("collapses a thrown request into request_failed instead of propagating", async () => {
    const projectId = await project([entry], { provider: "openai", model_id: "gpt-x" });
    const res = await service.enhancePrompt(projectId, { text: "x" }, () => {
      throw new Error("401 unauthorized");
    });
    expect(res).toEqual({ ok: false, code: "request_failed" });
  });
});

describe("POST /api/projects/:p/prompt/enhance route validation", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  const url = () => `/api/projects/${projectId}/prompt/enhance`;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "alice");
    api = apiClient(t.app, cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "alice-enh", name: "Enhance project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("rejects a missing, non-string or empty text before any request goes out", async () => {
    expect((await api.post(url(), {})).status).toBe(400);
    expect((await api.post(url(), { text: 42 })).status).toBe(400);
    expect((await api.post(url(), { text: "" })).status).toBe(400);
  });

  it("rejects an oversized draft rather than silently rewriting a truncated prefix", async () => {
    const res = await api.post(url(), { text: "x".repeat(20001) });
    expect(res.status).toBe(400);
  });

  it("answers a valid call with a body even when the Project has no model", async () => {
    // A 200 with `{ok:false}`: "couldn't rewrite this" is a rendered message, not a transport
    // error, and a 500 would have nowhere to be shown.
    const res = await api.post(url(), { text: "修复登录" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  it("does not reveal the Project to a non-member (404, not 403)", async () => {
    // requireProjectAccess answers 404 for a user with no access, deliberately: a 403 would
    // confirm the Project exists. My first version of this test expected 403, which is the
    // wrong assertion for this codebase's convention, not a missing guard.
    const { cookie: other } = await provisionUser(t.app, "bob");
    const bob = apiClient(t.app, other);
    expect((await bob.post(url(), { text: "x" })).status).toBe(404);
  });
});
