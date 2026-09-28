/**
 * Tray label resolution and tray-icon path lookup. Pure logic — the Electron `Tray`
 * itself is exercised by the `pnpm desktop` smoke run, not here.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveTrayIcon, TRAY_ICON_RELPATH } from "../src/app-icon.js";
import { petTrayLabels } from "../src/pet-tray-labels.js";

describe("petTrayLabels", () => {
  it("uses Chinese for any zh locale tag", () => {
    for (const locale of ["zh", "zh-CN", "zh-Hans", "ZH-TW"]) {
      expect(petTrayLabels(locale).pet).toBe("显示桌面宠物");
    }
  });

  it("falls back to English for everything else", () => {
    expect(petTrayLabels("en-US").pet).toBe("Show desktop pet");
    expect(petTrayLabels("ja-JP").quit).toBe("Quit");
    expect(petTrayLabels("").pet).toBe("Show desktop pet");
  });

  it("keeps every label non-empty in both dictionaries", () => {
    for (const locale of ["zh-CN", "en-US"]) {
      const labels = petTrayLabels(locale);
      for (const value of Object.values(labels)) expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveTrayIcon", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-desktop-tray-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("is null until the build copies a tray icon in (the tray is then skipped)", () => {
    expect(resolveTrayIcon(tmp)).toBeNull();
  });

  it("resolves dist/tray.png once present", () => {
    const iconPath = path.join(tmp, ...TRAY_ICON_RELPATH);
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(iconPath, "png");
    expect(resolveTrayIcon(tmp)).toBe(iconPath);
  });

  it("has a 128px source for scripts/build-assets.mjs to copy", () => {
    const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    expect(fs.existsSync(path.join(pkgDir, "build", "icons", "128x128.png"))).toBe(true);
  });
});
