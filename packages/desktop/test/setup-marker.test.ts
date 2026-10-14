/**
 * 完成标记：决定向导是否再次出现的那一个文件。
 *
 * 测的是「这台机器还需不需要被引导」这个判断本身，因为它有一条错误的读法——把读不到
 * 标记当成「已完成」，用户就再也不会被问到；反过来的代价只是重看一次已经看过的向导。
 * 下面每个用例都钉住这个方向：任何异常、无效内容、未知版本，一律读作「还没设置」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SETUP_MARKER_FILE,
  SETUP_MARKER_VERSION,
  isSetupComplete,
  readSetupMarker,
  setupMarkerPath,
  writeSetupMarker,
} from "../src/setup-marker.js";

const temps: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-setup-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("setup marker", () => {
  it("reports not-set-up on a fresh install, with no file to read", () => {
    const dir = tempDir();
    expect(isSetupComplete(dir)).toBe(false);
    expect(readSetupMarker(dir)).toBeNull();
  });

  it("records completion and reads it back", () => {
    const dir = tempDir();
    expect(writeSetupMarker(dir, "zh")).toBe(true);

    const marker = readSetupMarker(dir);
    expect(marker).not.toBeNull();
    expect(marker!.version).toBe(SETUP_MARKER_VERSION);
    // Kept for diagnostics only — the app reads its own pref from `jiumate.lang`. Two copies of
    // a preference would be two copies that disagree, which is why this is not read back.
    expect(marker!.lang).toBe("zh");
    expect(Date.parse(marker!.at)).not.toBeNaN();
    expect(isSetupComplete(dir)).toBe(true);
  });

  it("omits the language rather than writing undefined", () => {
    const dir = tempDir();
    writeSetupMarker(dir, undefined);
    // `JSON.stringify` drops an undefined-valued key, so the file holds no `"lang"` at all
    // rather than `"lang": null` — which would read back as a language named "null".
    expect(fs.readFileSync(setupMarkerPath(dir), "utf8")).not.toContain("lang");
  });

  it("creates the data directory it was pointed at", () => {
    const dir = path.join(tempDir(), "nested", "userData");
    expect(writeSetupMarker(dir, "en")).toBe(true);
    expect(fs.existsSync(setupMarkerPath(dir))).toBe(true);
  });

  // Every case below is the same failure in different clothing: a marker this build cannot
  // vouch for reads as "not set up", because the cost of that error is a wizard the user has
  // already seen and the cost of the opposite error is never being offered setup at all.
  const unreadable: readonly [string, (dir: string) => void][] = [
    ["empty file", (d: string) => fs.writeFileSync(setupMarkerPath(d), "", "utf8")],
    ["malformed JSON", (d: string) => fs.writeFileSync(setupMarkerPath(d), "{oops", "utf8")],
    ["a JSON array", (d: string) => fs.writeFileSync(setupMarkerPath(d), "[]", "utf8")],
    ["a JSON null", (d: string) => fs.writeFileSync(setupMarkerPath(d), "null", "utf8")],
    [
      "a non-numeric version",
      (d: string) => fs.writeFileSync(setupMarkerPath(d), '{"version":"1"}', "utf8"),
    ],
    ["no version at all", (d: string) => fs.writeFileSync(setupMarkerPath(d), "{}", "utf8")],
    [
      "a version from a future build",
      (d: string) =>
        fs.writeFileSync(setupMarkerPath(d), `{"version":${SETUP_MARKER_VERSION + 1}}`, "utf8"),
    ],
  ];

  it.each(unreadable)("treats %s as not set up", (_label, corrupt) => {
    const dir = tempDir();
    corrupt(dir);
    expect(readSetupMarker(dir)).toBeNull();
    expect(isSetupComplete(dir)).toBe(false);
  });

  it("reports the write failing rather than throwing, and leaves no partial marker", () => {
    // A directory where the marker file belongs makes the write fail for real. The caller logs
    // it and continues: the app works either way, and the wizard reappearing is an annoyance
    // rather than a failure worth blocking a first launch on.
    const dir = tempDir();
    fs.mkdirSync(setupMarkerPath(dir), { recursive: true });

    expect(writeSetupMarker(dir, "zh")).toBe(false);
    expect(isSetupComplete(dir)).toBe(false);
  });

  it("keeps the marker filename stable", () => {
    // Changing the filename silently re-runs the wizard for everyone who already installed,
    // with no diff to show for it. The version field is the lever for that; the name is not.
    expect(SETUP_MARKER_FILE).toBe("setup-complete.json");
    expect(setupMarkerPath("/data")).toBe(path.join("/data", SETUP_MARKER_FILE));
  });
});
