/**
 * The theme import picker's IPC surface.
 *
 * Tested through a stubbed `electron` module rather than a real one: `theme-picker.ts` imports
 * `app` / `dialog` / `ipcMain` at module scope, and a unit test has no Electron runtime. What is
 * worth pinning is the behaviour the renderer depends on — the cancel contract, the labels the
 * system dialog shows, and the fact that registering twice is not a crash.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, () => Promise<unknown>>();
const showOpenDialog = vi.fn();
const getLocale = vi.fn(() => "zh-CN");

vi.mock("electron", () => ({
  app: { getLocale: () => getLocale() },
  dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialog(...args) },
  ipcMain: {
    handle: (channel: string, handler: () => Promise<unknown>) => {
      // Real `ipcMain.handle` throws on a duplicate channel; the fake has to as well, or the
      // idempotency below would be untested.
      if (handlers.has(channel)) throw new Error(`duplicate handler: ${channel}`);
      handlers.set(channel, handler);
    },
  },
}));

const { THEME_PICK_CHANNEL, registerThemePicker, resetThemePickerForTest } =
  await import("../src/theme-picker.js");
const { themePickerLabels } = await import("../src/theme-picker-labels.js");

/** Invoke the registered handler the way the renderer's `ipcRenderer.invoke` would. */
async function invoke(): Promise<unknown> {
  const handler = handlers.get(THEME_PICK_CHANNEL);
  if (handler === undefined) throw new Error("no handler registered");
  return await handler();
}

beforeEach(() => {
  handlers.clear();
  showOpenDialog.mockReset();
  getLocale.mockReturnValue("zh-CN");
  resetThemePickerForTest();
});

describe("registerThemePicker", () => {
  it("registers exactly one handler, on its own channel", () => {
    registerThemePicker();
    expect([...handlers.keys()]).toEqual([THEME_PICK_CHANNEL]);
  });

  it("survives being called twice", () => {
    // `main.ts` reaches this from two paths and only one of them is behind a null check, so a
    // second call must be a no-op — `ipcMain.handle` would otherwise throw at startup.
    registerThemePicker();
    expect(() => {
      registerThemePicker();
    }).not.toThrow();
    expect(handlers.size).toBe(1);
  });

  it("asks for a directory and returns the chosen path", async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/home/u/themes/mine"] });
    registerThemePicker();
    expect(await invoke()).toBe("/home/u/themes/mine");
    expect(showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ["openDirectory"] }),
    );
  });

  it("answers null when the user cancels", async () => {
    // Null, not a rejection: the renderer treats it as "nothing happened" and must not clear a
    // path the user typed or raise an error toast.
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    registerThemePicker();
    expect(await invoke()).toBeNull();
  });

  it("answers null when the dialog reports success with no path", async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });
    registerThemePicker();
    expect(await invoke()).toBeNull();
  });

  it("titles the dialog from the OS locale, not a hard-coded string", async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    registerThemePicker();

    getLocale.mockReturnValue("zh-CN");
    await invoke();
    expect(showOpenDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "导入主题文件夹", buttonLabel: "导入" }),
    );

    getLocale.mockReturnValue("en-US");
    await invoke();
    expect(showOpenDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Import theme folder", buttonLabel: "Import" }),
    );
  });
});

describe("themePickerLabels", () => {
  it("reads any Chinese tag as Chinese", () => {
    for (const locale of ["zh", "zh-CN", "zh-Hans", "ZH-TW"]) {
      expect(themePickerLabels(locale).button).toBe("导入");
    }
  });

  it("falls back to English for anything else, including a bare or odd tag", () => {
    for (const locale of ["en", "en-GB", "ja-JP", "de", ""]) {
      expect(themePickerLabels(locale).button).toBe("Import");
    }
  });
});
