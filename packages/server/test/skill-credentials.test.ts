/**
 * `toSkillItem` is the one place that decides what the API says about a skill's credentials, and
 * the browser has no other way to find out: it cannot read the server's environment. So the two
 * rules it encodes are pinned here rather than left to be re-derived —
 *
 *   - a variable set to whitespace counts as unset, because a half-configured credential is the
 *     state this marker exists to show, and reporting it green would hide the exact problem;
 *   - a skill declaring no variables carries no key fields at all, so the UI can tell "needs a
 *     key it hasn't got" apart from "needs nothing" instead of showing an amber key on every
 *     skill that has no credentials to begin with.
 */
import { describe, expect, it } from "vitest";
import { toSkillItem } from "../src/services/plugin-library.js";

/** Minimal `SkillMetadata` for one declared variable. */
const skill = (name: string, requiredEnv?: string[]) => ({
  name,
  description: "",
  version: "",
  ...(requiredEnv !== undefined ? { requiredEnv } : {}),
});

describe("toSkillItem — credential readiness", () => {
  const KEY = "JIUMATE_TEST_PROBE_KEY";

  it("reports ready only when every declared variable is set", () => {
    delete process.env[KEY];
    expect(toSkillItem(skill("a", [KEY])).requiredEnvReady).toBe(false);

    process.env[KEY] = "value";
    try {
      expect(toSkillItem(skill("a", [KEY])).requiredEnvReady).toBe(true);
      // Whitespace-only is unset, not set: an env var written as "" or " " is what a
      // half-removed credential looks like, and calling that ready is the failure mode.
      process.env[KEY] = "   ";
      expect(toSkillItem(skill("a", [KEY])).requiredEnvReady).toBe(false);
      process.env[KEY] = "";
      expect(toSkillItem(skill("a", [KEY])).requiredEnvReady).toBe(false);
    } finally {
      delete process.env[KEY];
    }
  });

  it("carries the declared names through, so the UI can say which variable to set", () => {
    delete process.env[KEY];
    const item = toSkillItem(skill("a", [KEY]));
    expect(item.requiredEnv).toEqual([KEY]);
    // The value itself never travels — only the names and whether they are present.
    expect(JSON.stringify(item)).not.toContain("value");
  });

  it("omits the key fields entirely when a skill declares nothing", () => {
    const plain = toSkillItem(skill("plain"));
    expect(plain).not.toHaveProperty("requiredEnv");
    expect(plain).not.toHaveProperty("requiredEnvReady");
    // An empty list is treated as declaring nothing rather than as an unsatisfiable
    // requirement that would read as permanently unready.
    const empty = toSkillItem(skill("empty", []));
    expect(empty).not.toHaveProperty("requiredEnv");
    expect(empty).not.toHaveProperty("requiredEnvReady");
  });
});
