import { describe, expect, it } from "vitest";
import { parseSetupIni, seedStorage } from "../src/setup-import.js";

describe("installer answers → localStorage seed", () => {
  it("seeds a chosen theme, its mode, and the server-reconcile marker", () => {
    const answers = parseSetupIni("[setup]\ntheme=gothic-void-crusade\nmode=dark\n");
    const seed = seedStorage(answers);
    expect(seed["jiumate.theme"]).toBe("gothic-void-crusade");
    expect(seed["jiumate.mode"]).toBe("dark");
    // The marker is what makes theme.tsx promote the seeded theme to the server instead of letting a
    // stale `activeTheme` (often null) overwrite it. See theme.tsx readPrefs.
    expect(seed["jiumate.setup.pending"]).toBe("1");
  });

  it("does not seed or mark a 'system' theme", () => {
    const answers = parseSetupIni("[setup]\ntheme=system\n");
    const seed = seedStorage(answers);
    expect(seed["jiumate.theme"]).toBeUndefined();
    // "system" is the built-in appearance: it must not clobber a theme the account already had, so it
    // sets no marker and the server's value stands.
    expect(seed["jiumate.setup.pending"]).toBeUndefined();
  });

  it("keeps mode independent of the theme branch", () => {
    // Dark appearance with the default theme is the most ordinary combination; the mode must survive
    // even though no theme id is seeded.
    const answers = parseSetupIni("[setup]\ntheme=system\nmode=dark\n");
    const seed = seedStorage(answers);
    expect(seed["jiumate.mode"]).toBe("dark");
    expect(seed["jiumate.theme"]).toBeUndefined();
  });

  it("drops unknown keys and tolerates a hand-edited file", () => {
    const answers = parseSetupIni("[setup]\nlang=en\ntheme=sakura\nbogus=x\n");
    const seed = seedStorage(answers);
    expect(seed["jiumate.lang"]).toBe("en");
    expect(seed["jiumate.theme"]).toBe("sakura");
    expect(seed["bogus"]).toBeUndefined();
  });
});
