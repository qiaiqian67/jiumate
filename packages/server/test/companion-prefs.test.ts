/**
 * Companion-specific `ui_prefs` fields (`companionName`, `companionPronoun`,
 * `companionProactiveTimeoutMs`).
 *
 * Companion prefs are the second piece of user-authored text in `ui_prefs` (the
 * first was `draftShortcuts`). The route-level contract is the same: a rejected
 * write stores nothing, and a successful one does not disturb the other writers
 * merging into the same object. These tests exercise the real `PUT /api/me/prefs`
 * route rather than the validator alone, because the merge semantics are what we
 * actually ship.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import {
  COMPANION_NAME_MAX,
  COMPANION_PROACTIVE_TIMEOUT_MAX_MS,
  COMPANION_PROACTIVE_TIMEOUT_MIN_MS,
  COMPANION_TTS_VOICE_MAX,
} from "../src/services/companion-prefs.js";
import type { CompanionPronoun, UiPrefs } from "../src/api/types.js";

describe("ui_prefs companionName", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "gina");
    api = apiClient(t.app, cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const readPrefs = async (): Promise<UiPrefs> => {
    const body = (await (await api.get("/api/me/prefs")).json()) as { prefs: UiPrefs };
    return body.prefs;
  };

  it("stores a valid name verbatim", async () => {
    const res = await api.put("/api/me/prefs", { companionName: "Lin" });
    expect(res.status).toBe(200);
    expect((await readPrefs()).companionName).toBe("Lin");
  });

  it("trims whitespace before storing", async () => {
    await api.put("/api/me/prefs", { companionName: "  Lin  " });
    expect((await readPrefs()).companionName).toBe("Lin");
  });

  it("accepts an empty string (the 'use default greeting' state)", async () => {
    await api.put("/api/me/prefs", { companionName: "" });
    expect((await readPrefs()).companionName).toBe("");
  });

  it("rejects names longer than the cap with a 400 and stores nothing", async () => {
    // Seed an unrelated field to prove the failed merge did not clobber it.
    await api.put("/api/me/prefs", { lastProjectId: "default_project" });
    const tooLong = "x".repeat(COMPANION_NAME_MAX + 1);
    const res = await api.put("/api/me/prefs", { companionName: tooLong });
    expect(res.status).toBe(400);
    const body = (await readPrefs()) as UiPrefs & { companionName?: string };
    expect(body.companionName).toBeUndefined();
    expect(body.lastProjectId).toBe("default_project");
  });

  it("rejects non-string names", async () => {
    const res = await api.put("/api/me/prefs", { companionName: 42 });
    expect(res.status).toBe(400);
  });
});

describe("ui_prefs companionPronoun", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "hank");
    api = apiClient(t.app, cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const readPrefs = async (): Promise<UiPrefs> => {
    const body = (await (await api.get("/api/me/prefs")).json()) as { prefs: UiPrefs };
    return body.prefs;
  };

  it("stores each of the four closed pronouns verbatim", async () => {
    for (const p of ["he", "she", "they", "it"] as CompanionPronoun[]) {
      await api.put("/api/me/prefs", { companionPronoun: p });
      expect((await readPrefs()).companionPronoun).toBe(p);
    }
  });

  it("rejects an unknown pronoun string with a 400", async () => {
    const res = await api.put("/api/me/prefs", { companionPronoun: "ze" });
    expect(res.status).toBe(400);
    expect((await readPrefs()).companionPronoun).toBeUndefined();
  });
});

describe("ui_prefs companionProactiveTimeoutMs", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "ivy");
    api = apiClient(t.app, cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const readPrefs = async (): Promise<UiPrefs> => {
    const body = (await (await api.get("/api/me/prefs")).json()) as { prefs: UiPrefs };
    return body.prefs;
  };

  it("stores 0 as the explicit 'never proactive' value", async () => {
    await api.put("/api/me/prefs", { companionProactiveTimeoutMs: 0 });
    expect((await readPrefs()).companionProactiveTimeoutMs).toBe(0);
  });

  it("rounds an in-range value to the nearest whole ms", async () => {
    await api.put("/api/me/prefs", { companionProactiveTimeoutMs: 60_000.7 });
    expect((await readPrefs()).companionProactiveTimeoutMs).toBe(60_001);
  });

  it("rejects values below the floor", async () => {
    const res = await api.put("/api/me/prefs", {
      companionProactiveTimeoutMs: COMPANION_PROACTIVE_TIMEOUT_MIN_MS - 1,
    });
    expect(res.status).toBe(400);
    expect((await readPrefs()).companionProactiveTimeoutMs).toBeUndefined();
  });

  it("rejects values above the ceiling", async () => {
    const res = await api.put("/api/me/prefs", {
      companionProactiveTimeoutMs: COMPANION_PROACTIVE_TIMEOUT_MAX_MS + 1,
    });
    expect(res.status).toBe(400);
    expect((await readPrefs()).companionProactiveTimeoutMs).toBeUndefined();
  });

  it("rejects non-finite values", async () => {
    const res = await api.put("/api/me/prefs", { companionProactiveTimeoutMs: "300000" });
    expect(res.status).toBe(400);
  });
});

describe("ui_prefs companionTtsProvider", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "jane");
    api = apiClient(t.app, cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const readPrefs = async (): Promise<UiPrefs> => {
    const body = (await (await api.get("/api/me/prefs")).json()) as { prefs: UiPrefs };
    return body.prefs;
  };

  it("stores 'off' verbatim", async () => {
    await api.put("/api/me/prefs", { companionTtsProvider: "off" });
    expect((await readPrefs()).companionTtsProvider).toBe("off");
  });

  it("stores 'webspeech' verbatim", async () => {
    await api.put("/api/me/prefs", { companionTtsProvider: "webspeech" });
    expect((await readPrefs()).companionTtsProvider).toBe("webspeech");
  });

  it("rejects an unknown provider with a 400 and stores nothing", async () => {
    // Seed an unrelated field to prove the failed merge did not clobber it.
    await api.put("/api/me/prefs", { lastProjectId: "default_project" });
    const res = await api.put("/api/me/prefs", { companionTtsProvider: "elevenlabs" });
    expect(res.status).toBe(400);
    const body = (await readPrefs()) as UiPrefs & { companionTtsProvider?: string };
    expect(body.companionTtsProvider).toBeUndefined();
    expect(body.lastProjectId).toBe("default_project");
  });
});

describe("ui_prefs companionTtsVoice", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "kara");
    api = apiClient(t.app, cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const readPrefs = async (): Promise<UiPrefs> => {
    const body = (await (await api.get("/api/me/prefs")).json()) as { prefs: UiPrefs };
    return body.prefs;
  };

  it("stores a valid voice id verbatim", async () => {
    await api.put("/api/me/prefs", { companionTtsVoice: "Microsoft Huihui" });
    expect((await readPrefs()).companionTtsVoice).toBe("Microsoft Huihui");
  });

  it("trims whitespace before storing", async () => {
    await api.put("/api/me/prefs", { companionTtsVoice: "  Microsoft Huihui  " });
    expect((await readPrefs()).companionTtsVoice).toBe("Microsoft Huihui");
  });

  it("accepts an empty string (the 'follow system' state)", async () => {
    await api.put("/api/me/prefs", { companionTtsVoice: "" });
    expect((await readPrefs()).companionTtsVoice).toBe("");
  });

  it("rejects voices longer than the cap with a 400 and stores nothing", async () => {
    await api.put("/api/me/prefs", { lastProjectId: "default_project" });
    const tooLong = "x".repeat(COMPANION_TTS_VOICE_MAX + 1);
    const res = await api.put("/api/me/prefs", { companionTtsVoice: tooLong });
    expect(res.status).toBe(400);
    const body = (await readPrefs()) as UiPrefs & { companionTtsVoice?: string };
    expect(body.companionTtsVoice).toBeUndefined();
    expect(body.lastProjectId).toBe("default_project");
  });
});

describe("ui_prefs companionAsrProvider", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "ollie");
    api = apiClient(t.app, cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const readPrefs = async (): Promise<UiPrefs> => {
    const body = (await (await api.get("/api/me/prefs")).json()) as { prefs: UiPrefs };
    return body.prefs;
  };

  it("stores 'off' verbatim", async () => {
    await api.put("/api/me/prefs", { companionAsrProvider: "off" });
    expect((await readPrefs()).companionAsrProvider).toBe("off");
  });

  it("stores 'webspeech' verbatim", async () => {
    await api.put("/api/me/prefs", { companionAsrProvider: "webspeech" });
    expect((await readPrefs()).companionAsrProvider).toBe("webspeech");
  });

  it("rejects an unknown provider with a 400 and stores nothing", async () => {
    // The chat composer hides the mic button on an unknown value (the web
    // hydration treats it as 'off'), so a future server extension cannot
    // silently enable a button the client cannot drive.
    await api.put("/api/me/prefs", { lastProjectId: "default_project" });
    const res = await api.put("/api/me/prefs", { companionAsrProvider: "whisper-cloud" });
    expect(res.status).toBe(400);
    const body = (await readPrefs()) as UiPrefs & { companionAsrProvider?: string };
    expect(body.companionAsrProvider).toBeUndefined();
    expect(body.lastProjectId).toBe("default_project");
  });
});

describe("ui_prefs companionAvatarRenderer", () => {
  // The renderer is the closed enum that gates the runtime swap inside
  // <CompanionPet>. The client silently degrades to "svg" on WebGL failure,
  // so the safe default on the wire is "svg" — a brand-new user never sees a
  // Live2D model without opting in. Unknown values are rejected (not
  // downgraded) to keep a hand-crafted PUT from putting junk in the prefs
  // row that the hydration helper cannot interpret.
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "pete");
    api = apiClient(t.app, cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const readPrefs = async (): Promise<UiPrefs> => {
    const body = (await (await api.get("/api/me/prefs")).json()) as { prefs: UiPrefs };
    return body.prefs;
  };

  it("stores 'svg' verbatim", async () => {
    await api.put("/api/me/prefs", { companionAvatarRenderer: "svg" });
    expect((await readPrefs()).companionAvatarRenderer).toBe("svg");
  });

  it("stores 'live2d' verbatim", async () => {
    await api.put("/api/me/prefs", { companionAvatarRenderer: "live2d" });
    expect((await readPrefs()).companionAvatarRenderer).toBe("live2d");
  });

  it("rejects an unknown renderer with a 400 and stores nothing", async () => {
    // Seed an unrelated field to prove the failed merge did not clobber it.
    await api.put("/api/me/prefs", { lastProjectId: "default_project" });
    const res = await api.put("/api/me/prefs", { companionAvatarRenderer: "vrm" });
    expect(res.status).toBe(400);
    const body = (await readPrefs()) as UiPrefs & { companionAvatarRenderer?: string };
    expect(body.companionAvatarRenderer).toBeUndefined();
    expect(body.lastProjectId).toBe("default_project");
  });

  it("rejects non-string renderers", async () => {
    const res = await api.put("/api/me/prefs", { companionAvatarRenderer: 1 });
    expect(res.status).toBe(400);
  });
});

describe("ui_prefs companionAvatarPreset", () => {
  // The preset id selects which built-in Cubism model the runtime loads when
  // the renderer is "live2d". The closed list mirrors
  // `packages/web/src/features/chat/companion-live2d/manifest.ts` — server
  // and client must agree. Unknown ids are rejected so a hand-crafted PUT
  // cannot leave the runtime trying to resolve a model URL it cannot find.
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "quinn");
    api = apiClient(t.app, cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const readPrefs = async (): Promise<UiPrefs> => {
    const body = (await (await api.get("/api/me/prefs")).json()) as { prefs: UiPrefs };
    return body.prefs;
  };

  it.each(["hiyori", "mark", "mao"] as const)("stores '%s' verbatim", async (preset) => {
    await api.put("/api/me/prefs", { companionAvatarPreset: preset });
    expect((await readPrefs()).companionAvatarPreset).toBe(preset);
  });

  it("rejects an unknown preset with a 400 and stores nothing", async () => {
    // Seed an unrelated field to prove the failed merge did not clobber it,
    // and seed a valid renderer too — the two fields are independent on
    // purpose and a bad preset write must not roll back a good renderer
    // write that happened in the same PUT.
    await api.put("/api/me/prefs", {
      lastProjectId: "default_project",
      companionAvatarRenderer: "live2d",
    });
    const res = await api.put("/api/me/prefs", { companionAvatarPreset: "shizuku" });
    expect(res.status).toBe(400);
    const body = (await readPrefs()) as UiPrefs & {
      companionAvatarPreset?: string;
      companionAvatarRenderer?: string;
    };
    expect(body.companionAvatarPreset).toBeUndefined();
    expect(body.companionAvatarRenderer).toBe("live2d");
    expect(body.lastProjectId).toBe("default_project");
  });

  it("rejects non-string presets", async () => {
    const res = await api.put("/api/me/prefs", { companionAvatarPreset: 0 });
    expect(res.status).toBe(400);
  });
});
