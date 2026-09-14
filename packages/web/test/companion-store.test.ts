/**
 * `useCompanionStore` — placement hydration logic.
 *
 * The store's React surface is intentionally not tested here (vitest runs in node, no
 * DOM), but the pure helper that picks a placement out of a freshly-fetched prefs
 * record is. That helper is the entire hydration story: callers fetch the prefs,
 * pass the body to `placementFromPrefs`, and the result drives the visible state.
 *
 * The companion-mode refactor replaced a single boolean with a four-way enum, but
 * the legacy `companionModeEnabled: true` write must still translate to "banner"
 * (the default placement the old switch toggled). The unit test pins the precedence
 * order so a future refactor can't silently regress opt-in users.
 */
import { describe, expect, it } from "vitest";
import {
  placementFromPrefs,
  companionIdentityFromPrefs,
  companionTtsFromPrefs,
  companionAsrFromPrefs,
  companionAvatarFromPrefs,
  COMPANION_PLACEMENTS,
  COMPANION_TTS_PROVIDERS,
  COMPANION_ASR_PROVIDERS,
  COMPANION_AVATAR_RENDERERS,
  COMPANION_AVATAR_PRESETS,
  type CompanionPlacement,
  type CompanionPronoun,
} from "../src/features/chat/companion-store";

describe("placementFromPrefs", () => {
  // Loosen the helper's signature locally for the test: the production type only
  // declares the two relevant keys, but the test also exercises "no relevant key"
  // and "garbage" inputs which need extra fields. The runtime check is the only
  // thing that matters here.
  type Args = Parameters<typeof placementFromPrefs>[0];
  const call = (prefs: Record<string, unknown>) => placementFromPrefs(prefs as unknown as Args);

  it("returns the explicit placement when it is one of the four", () => {
    for (const p of ["off", "banner", "widget", "floating"] as CompanionPlacement[]) {
      expect(call({ companionPlacement: p })).toBe(p);
    }
  });

  it("returns null when no relevant key is set", () => {
    expect(call({})).toBeNull();
    expect(call({ theme: "dark" })).toBeNull();
  });

  it("treats an unknown placement string as opt-out", () => {
    // Garbage from a stale client, a manual edit, or a corrupted prefs file should
    // land the user on "off" rather than throwing or accidentally enabling.
    expect(call({ companionPlacement: "garbage" })).toBeNull();
    expect(call({ companionPlacement: 0 })).toBeNull();
    expect(call({ companionPlacement: null })).toBeNull();
    expect(call({ companionPlacement: { x: 1 } })).toBeNull();
  });

  it("migrates a legacy `companionModeEnabled: true` to 'banner'", () => {
    expect(call({ companionModeEnabled: true })).toBe("banner");
  });

  it("treats a legacy `companionModeEnabled: false` as opt-out", () => {
    expect(call({ companionModeEnabled: false })).toBeNull();
  });

  it("lets an explicit placement win over a stale legacy true", () => {
    // A user who once opted in and then picked "off" should stay opted out — the
    // explicit write is the source of truth, the legacy key is fallback only.
    expect(call({ companionModeEnabled: true, companionPlacement: "off" })).toBe("off");
  });

  it("ignores unrelated legacy-style booleans", () => {
    expect(call({ enabled: true })).toBeNull();
    expect(call({ companionModeEnabled: "true" })).toBeNull();
  });
});

describe("COMPANION_PLACEMENTS", () => {
  it("is exactly the four user-pickable values, in the canonical order", () => {
    // The Settings row iterates this directly; the order sets user expectation
    // (off → most subtle → most visible). A re-ordering is a UX change.
    expect([...COMPANION_PLACEMENTS]).toEqual(["off", "banner", "widget", "floating"]);
  });
});

describe("companionTtsFromPrefs", () => {
  type Args = Parameters<typeof companionTtsFromPrefs>[0];
  const call = (prefs: Record<string, unknown>) => companionTtsFromPrefs(prefs as unknown as Args);

  it("returns the safe defaults when no TTS field is present", () => {
    // The pre-L.4 row hydrates to "off" + empty voice so a user who never
    // opens the new picker sees no behaviour change (silent pet, same as
    // before).
    expect(call({})).toEqual({ provider: "off", voice: "" });
    expect(call({ theme: "dark" })).toEqual({ provider: "off", voice: "" });
  });

  it("echoes a known provider verbatim", () => {
    expect(call({ companionTtsProvider: "webspeech" }).provider).toBe("webspeech");
    expect(call({ companionTtsProvider: "off" }).provider).toBe("off");
  });

  it("falls back to 'off' for an unknown provider string", () => {
    // Garbage from a future enum value the renderer does not yet know about
    // (e.g. user upgraded server before client) must default to silent — a
    // bad TTS call should never crash the floating window.
    expect(call({ companionTtsProvider: "elevenlabs" }).provider).toBe("off");
    expect(call({ companionTtsProvider: null }).provider).toBe("off");
    expect(call({ companionTtsProvider: 42 }).provider).toBe("off");
  });

  it("echoes a non-empty voice id", () => {
    expect(call({ companionTtsVoice: "Microsoft Huihui" }).voice).toBe("Microsoft Huihui");
  });

  it("falls back to empty string for non-string voices", () => {
    expect(call({ companionTtsVoice: null }).voice).toBe("");
    expect(call({ companionTtsVoice: 42 }).voice).toBe("");
  });
});

describe("COMPANION_TTS_PROVIDERS", () => {
  it("is exactly the closed list, with 'off' first (the safe default)", () => {
    // The picker iterates this directly; "off" first means the default lands
    // on the opt-out, which is the only safe behaviour for a brand-new user.
    expect([...COMPANION_TTS_PROVIDERS]).toEqual(["off", "webspeech"]);
  });
});

describe("companionIdentityFromPrefs", () => {
  // Same type-loosening trick as `placementFromPrefs`: the helper's signature only
  // declares the three relevant keys, but the test feeds garbage in to make sure
  // the defaults land rather than the user seeing a half-hydrated companion.
  type Args = Parameters<typeof companionIdentityFromPrefs>[0];
  const call = (prefs: Record<string, unknown>) =>
    companionIdentityFromPrefs(prefs as unknown as Args);

  it("returns the three neutral defaults when no relevant key is present", () => {
    expect(call({})).toEqual({ name: "", pronoun: "they", proactiveTimeoutMs: 0 });
  });

  it("echoes a valid name verbatim", () => {
    expect(call({ companionName: "Lin" }).name).toBe("Lin");
    expect(call({ companionName: "我的小狐狸朋友" }).name).toBe("我的小狐狸朋友");
  });

  it("falls back to 'they' for an unknown pronoun string", () => {
    // Garbage must NOT pick a side silently: an unknown pronoun is the strongest
    // case for the "they" default because it represents a missed contract.
    expect(call({ companionPronoun: "garbage" }).pronoun).toBe("they");
    expect(call({ companionPronoun: null }).pronoun).toBe("they");
  });

  it("accepts each of the four valid pronouns", () => {
    for (const p of ["he", "she", "they", "it"] as CompanionPronoun[]) {
      expect(call({ companionPronoun: p }).pronoun).toBe(p);
    }
  });

  it("falls back to 0 (never proactive) for non-numeric timeouts", () => {
    expect(call({ companionProactiveTimeoutMs: "300000" }).proactiveTimeoutMs).toBe(0);
    expect(call({ companionProactiveTimeoutMs: NaN }).proactiveTimeoutMs).toBe(0);
    expect(call({ companionProactiveTimeoutMs: null }).proactiveTimeoutMs).toBe(0);
  });

  it("preserves a numeric timeout verbatim", () => {
    expect(call({ companionProactiveTimeoutMs: 300_000 }).proactiveTimeoutMs).toBe(300_000);
  });
});

describe("companionAsrFromPrefs", () => {
  // Same type-loosening trick: the helper's signature only declares the relevant
  // key, but the test feeds garbage in to make sure hydration never throws.
  type Args = Parameters<typeof companionAsrFromPrefs>[0];
  const call = (prefs: Record<string, unknown>) => companionAsrFromPrefs(prefs as unknown as Args);

  it("returns 'off' when no relevant key is present (the safe default)", () => {
    expect(call({})).toEqual({ provider: "off" });
    expect(call({ theme: "dark" })).toEqual({ provider: "off" });
  });

  it("echoes 'webspeech' verbatim", () => {
    expect(call({ companionAsrProvider: "webspeech" }).provider).toBe("webspeech");
  });

  it("echoes 'off' verbatim", () => {
    expect(call({ companionAsrProvider: "off" }).provider).toBe("off");
  });

  it("falls back to 'off' for unknown provider strings", () => {
    // A future server may ship an ASR enum extension the client does not know
    // about yet — picking 'webspeech' silently would put a button on the screen
    // that always errors. 'off' is the safe degradation.
    expect(call({ companionAsrProvider: "whisper-cloud" }).provider).toBe("off");
    expect(call({ companionAsrProvider: null }).provider).toBe("off");
    expect(call({ companionAsrProvider: 42 }).provider).toBe("off");
  });
});

describe("COMPANION_ASR_PROVIDERS", () => {
  it("is exactly the closed list, with 'off' first (the safe default)", () => {
    // The picker iterates this directly; "off" first means the default lands
    // on the opt-out, mirroring the TTS provider list for consistency.
    expect([...COMPANION_ASR_PROVIDERS]).toEqual(["off", "webspeech"]);
  });
});

describe("companionAvatarFromPrefs", () => {
  // Same type-loosening trick as the rest: the helper's signature only
  // declares the two relevant keys, but the test feeds garbage in to make
  // sure hydration never throws and never lands the user on a renderer or
  // preset the runtime cannot resolve.
  type Args = Parameters<typeof companionAvatarFromPrefs>[0];
  const call = (prefs: Record<string, unknown>) =>
    companionAvatarFromPrefs(prefs as unknown as Args);

  it("returns the safe defaults when no avatar field is present", () => {
    // A brand-new user (or one whose prefs predates L.6) hydrates to SVG
    // + Hiyori — they keep the existing 2D fox and only pay bundle cost
    // when they explicitly opt in to Live2D.
    expect(call({})).toEqual({ renderer: "svg", preset: "hiyori" });
    expect(call({ theme: "dark" })).toEqual({ renderer: "svg", preset: "hiyori" });
  });

  it("echoes a valid renderer verbatim", () => {
    expect(call({ companionAvatarRenderer: "svg" }).renderer).toBe("svg");
    expect(call({ companionAvatarRenderer: "live2d" }).renderer).toBe("live2d");
  });

  it("falls back to 'svg' for an unknown renderer string", () => {
    // A future server may ship an extension the client does not yet
    // understand (e.g. a "vrm" renderer landed after the running client).
    // Picking "live2d" silently would attempt to mount a renderer the
    // runtime cannot drive; "svg" is the safe degradation.
    expect(call({ companionAvatarRenderer: "vrm" }).renderer).toBe("svg");
    expect(call({ companionAvatarRenderer: null }).renderer).toBe("svg");
    expect(call({ companionAvatarRenderer: 42 }).renderer).toBe("svg");
  });

  it("echoes each known preset verbatim", () => {
    for (const p of ["hiyori", "mark", "mao"] as const) {
      expect(call({ companionAvatarPreset: p }).preset).toBe(p);
    }
  });

  it("falls back to 'hiyori' for an unknown preset string", () => {
    // A future preset removed from the catalog (or one added server-side
    // before the client ships the matching manifest) must still resolve to
    // a model — the user sees Hiyori instead of an empty canvas.
    expect(call({ companionAvatarPreset: "shizuku" }).preset).toBe("hiyori");
    expect(call({ companionAvatarPreset: null }).preset).toBe("hiyori");
    expect(call({ companionAvatarPreset: 42 }).preset).toBe("hiyori");
  });

  it("treats renderer and preset independently (any combination hydrates)", () => {
    // A user who flips the renderer on before opening the preset picker
    // must still get a working model (Hiyori default), and a user who
    // picked Mark before flipping the renderer on must keep Mark.
    expect(call({ companionAvatarRenderer: "live2d" })).toEqual({
      renderer: "live2d",
      preset: "hiyori",
    });
    expect(call({ companionAvatarPreset: "mark" })).toEqual({
      renderer: "svg",
      preset: "mark",
    });
    expect(call({ companionAvatarRenderer: "live2d", companionAvatarPreset: "mao" })).toEqual({
      renderer: "live2d",
      preset: "mao",
    });
  });
});

describe("COMPANION_AVATAR_RENDERERS", () => {
  it("is exactly the closed list, with 'svg' first (the safe default)", () => {
    // The Settings renderer row iterates this directly; "svg" first means
    // a brand-new user lands on the opt-out (the same default the
    // hydration helper picks when no value is persisted).
    expect([...COMPANION_AVATAR_RENDERERS]).toEqual(["svg", "live2d"]);
  });
});

describe("COMPANION_AVATAR_PRESETS", () => {
  it("is exactly the closed list, in the canonical display order", () => {
    // The Settings picker iterates this directly; the order sets user
    // expectation (the friendly character first, the lion last). A
    // re-ordering is a UX change.
    expect([...COMPANION_AVATAR_PRESETS]).toEqual(["hiyori", "mark", "mao"]);
  });
});
