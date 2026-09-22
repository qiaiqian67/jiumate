import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SKIN_BOOTSTRAP_KEY,
  SKIN_BOOTSTRAP_VERSION,
  clearSkinBootstrap,
  writeSkinBootstrap,
} from "../src/features/skin/skin-bootstrap";
import type { SkinBootstrapPayload } from "../src/features/skin/skin-bootstrap";

/**
 * The inline script in index.html cannot import this module, so it repeats the key, the version
 * and the field names in plain JS. These assertions are what keeps the two copies from drifting:
 * a rename on one side that is not mirrored on the other turns the pre-paint restore into a
 * silent no-op, which is exactly the kind of breakage nothing else would notice.
 */
const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const PAYLOAD: SkinBootstrapPayload = {
  v: SKIN_BOOTSTRAP_VERSION,
  dark: true,
  skin: "midnight",
  accent: "neutral",
  ownsAccent: false,
  font: "16px",
  css: ':root[data-skin="midnight"] {\n  --color-gray-950: #04060c;\n}\n',
};

/** Minimal localStorage: vitest runs in Node, where there is none. */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  return store;
}

let store: Map<string, string>;

beforeEach(() => {
  store = stubStorage();
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("the inline script and this module agree", () => {
  it("reads the same storage key", () => {
    expect(HTML).toContain(`localStorage.getItem("${SKIN_BOOTSTRAP_KEY}")`);
  });

  it("checks the same payload version", () => {
    expect(HTML).toContain(`p.v !== ${SKIN_BOOTSTRAP_VERSION}`);
  });

  it("reads every field the payload carries", () => {
    // Each name here is a payload key; the script's own variable is `p`.
    for (const field of ["dark", "skin", "accent", "ownsAccent", "font", "css"]) {
      expect(HTML).toContain(`p.${field}`);
    }
  });

  it("writes the same attributes and element id the mounted app does", () => {
    expect(HTML).toContain('classList.add("dark")');
    expect(HTML).toContain('setAttribute("data-skin", p.skin)');
    expect(HTML).toContain('setAttribute("data-accent", p.accent)');
    // Must match SKIN_STYLE_ELEMENT_ID in skin-runtime.ts, or the mounted pass would append a
    // second stylesheet instead of adopting the one the pre-paint pass left behind.
    expect(HTML).toContain('style.id = "linsight-skin"');
  });

  it("skips data-accent when the skin owns the accent", () => {
    // Same rule as the mounted effect: the two selectors tie on specificity, so the skin must
    // not have to win a race it was never meant to enter.
    expect(HTML).toContain("p.accent && !p.ownsAccent");
  });

  it("declares the wallpaper layer the stylesheet positions", () => {
    expect(HTML).toContain('class="linsight-skin-background"');
  });
});

describe("writeSkinBootstrap", () => {
  it("round-trips the payload", () => {
    writeSkinBootstrap(PAYLOAD);
    expect(JSON.parse(store.get(SKIN_BOOTSTRAP_KEY) as string)).toEqual(PAYLOAD);
  });

  it("overwrites rather than merging, so a stale skin cannot survive", () => {
    writeSkinBootstrap(PAYLOAD);
    writeSkinBootstrap({ ...PAYLOAD, skin: null, css: "" });
    const stored = JSON.parse(store.get(SKIN_BOOTSTRAP_KEY) as string) as SkinBootstrapPayload;
    expect(stored.skin).toBeNull();
    expect(stored.css).toBe("");
  });

  it("swallows a storage failure", () => {
    // Blocked site data, or a full quota: neither is a reason for a theme change to throw.
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    expect(() => writeSkinBootstrap(PAYLOAD)).not.toThrow();
  });
});

describe("clearSkinBootstrap", () => {
  it("removes the cache", () => {
    writeSkinBootstrap(PAYLOAD);
    clearSkinBootstrap();
    expect(store.has(SKIN_BOOTSTRAP_KEY)).toBe(false);
  });

  it("swallows a storage failure", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(() => clearSkinBootstrap()).not.toThrow();
  });
});
