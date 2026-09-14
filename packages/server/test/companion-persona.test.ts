/**
 * Server-side companion-persona injection at `POST /api/sessions/:sessionId/tasks`.
 *
 * The server reads `ui_prefs.companionPlacement` per request and, when set to anything
 * other than "off", prepends a `[companion_persona]` block as a `sender: "server"`
 * user message before the user's input. The old boolean `companionModeEnabled: true`
 * is still honoured — a user who opted in before the enum refactor keeps the persona
 * block until they explicitly pick something else. With the switch off / missing /
 * garbage, the input arrives unchanged. Goal-mode stripping is pinned by the core
 * `stripLeadingMarkerBlocks` test — this file only owns the plain-task wiring.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText } from "@prismshadow/linsight-core";
import type { OmniMessage } from "@prismshadow/linsight-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-09-10-09-00-00-comp0001";
const PROJECT_ID = "companion_user-default_project";

/** A single-text-input body, plain task. */
function taskBody(text: string): string {
  return JSON.stringify({ input: [{ type: "text", text }] });
}

type Case = {
  /** Display label, used in the `it.each` test name. */
  label: string;
  /** What to write into the prefs repo. Defaults to no write. */
  prefs?: Record<string, unknown>;
  /** When set, the prefs repo holds this raw string instead of `JSON.stringify(prefs)`. */
  prefsRaw?: string;
  /** Whether the first message fed to the runtime should be a persona block. */
  expectPersona: boolean;
};

describe("AI companion mode — POST /:sessionId/tasks", () => {
  let t: TestApp;
  let cookie: string;
  let runs: OmniMessage[][];

  const post = (body: string) =>
    t.app.request(`/api/sessions/${SID}/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body,
    });

  const setPrefs = (c: Case) => {
    if (c.prefsRaw !== undefined) {
      t.deps.prefsRepo.set("companion_user", c.prefsRaw);
      return;
    }
    if (c.prefs === undefined) return;
    t.deps.prefsRepo.set("companion_user", JSON.stringify(c.prefs));
  };

  beforeEach(async () => {
    t = await createTestApp();
    ({ cookie } = await provisionUser(t.app, "companion_user"));
    runs = [];
    const row: SessionRow = {
      sessionId: SID,
      projectId: PROJECT_ID,
      agentId: "default_agent",
      provider: "custom",
      modelId: "m1",
      workspace: "/tmp/w",
      approvalMode: "allow-all",
      title: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    const session: RuntimeSession = {
      sessionId: SID,
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      async *run(input: OmniMessage[]) {
        runs.push(input);
        yield assistantText("done");
      },
      async *compact() {},
    };
    t.deps.manager.adopt(row, session);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const cases: Case[] = [
    { label: "off (no prefs stored)", expectPersona: false },
    { label: "banner placement", prefs: { companionPlacement: "banner" }, expectPersona: true },
    { label: "widget placement", prefs: { companionPlacement: "widget" }, expectPersona: true },
    { label: "floating placement", prefs: { companionPlacement: "floating" }, expectPersona: true },
    { label: "explicit off placement", prefs: { companionPlacement: "off" }, expectPersona: false },
    { label: "legacy true migrates", prefs: { companionModeEnabled: true }, expectPersona: true },
    {
      label: "legacy false is opt-out",
      prefs: { companionModeEnabled: false },
      expectPersona: false,
    },
    {
      label: "legacy true + explicit off (explicit wins)",
      prefs: { companionModeEnabled: true, companionPlacement: "off" },
      expectPersona: false,
    },
    {
      label: "garbage string falls through",
      prefs: { companionPlacement: "garbage" },
      expectPersona: false,
    },
    { label: "corrupted JSON is opt-out", prefsRaw: "{this is not json", expectPersona: false },
    { label: "unrelated field is opt-out", prefs: { theme: "dark" }, expectPersona: false },
  ];

  it.each(cases)("$label", async (c) => {
    setPrefs(c);
    const res = await post(taskBody("hello"));
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);
    if (c.expectPersona) {
      expect(runs[0]).toHaveLength(2);
      const first = runs[0]![0]!.payload as { text: string; sender?: string; role?: string };
      expect(first.role).toBe("user");
      expect(first.sender).toBe("server");
      expect(first.text.startsWith("[companion_persona]\n")).toBe(true);
      expect(first.text.endsWith("\n[/companion_persona]")).toBe(true);
      const second = runs[0]![1]!.payload as { text: string; sender?: string };
      expect(second.text).toBe("hello");
      expect(second.sender).toBeUndefined();
    } else {
      expect(runs[0]).toHaveLength(1);
      expect((runs[0]![0]!.payload as { text: string }).text).toBe("hello");
      expect((runs[0]![0]!.payload as { sender?: string }).sender).toBeUndefined();
    }
  });
});
