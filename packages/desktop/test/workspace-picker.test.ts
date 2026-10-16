/**
 * The workspace picker's IPC surface.
 *
 * Tested through a stubbed `electron` module rather than a real one (theme-picker.test.ts
 * convention): `workspace-picker.ts` imports `app` / `dialog` / `ipcMain` at module scope and a
 * unit test has no Electron runtime. What matters to the renderer is the cancel contract, the
 * copy the system dialog shows, and that registering twice is not a crash.
 *
 * The dialog's TITLE is asserted here rather than left to "looks right": this channel exists
 * precisely because `theme:pickFolder` would have said "Import theme folder" to someone who
 * asked for a workspace, and the title is the only thing that told them what the dialog was
 * for. The two sets of labels are therefore pinned apart.
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
      // idempotency below would go untested.
      if (handlers.has(channel)) throw new Error(`duplicate handler: ${channel}`);
      handlers.set(channel, handler);
    },
  },
}));

const { WORKSPACE_PICK_CHANNEL, registerWorkspacePicker, resetWorkspacePickerForTest } =
  await import("../src/workspace-picker.js");
const { workspacePickerLabels } = await import("../src/workspace-picker-labels.js");
const { themePickerLabels } = await import("../src/theme-picker-labels.js");

/** Invoke the registered handler the way the renderer's `ipcRenderer.invoke` would. */
async function invoke(): Promise<unknown> {
  const handler = handlers.get(WORKSPACE_PICK_CHANNEL);
  if (handler === undefined) throw new Error("no handler registered");
  return await handler();
}

beforeEach(() => {
  handlers.clear();
  showOpenDialog.mockReset();
  getLocale.mockReturnValue("zh-CN");
  resetWorkspacePickerForTest();
});

describe("registerWorkspacePicker", () => {
  it("registers exactly one channel", () => {
    registerWorkspacePicker();
    expect([...handlers.keys()]).toEqual([WORKSPACE_PICK_CHANNEL]);
  });

  it("registers idempotently (main.ts reaches this from two paths)", () => {
    registerWorkspacePicker();
    expect(() => registerWorkspacePicker()).not.toThrow();
    expect(handlers.size).toBe(1);
  });

  it("asks for a directory and returns the chosen path", async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["E:\\MyWork\\AIwork\\penguin-harness"],
    });
    registerWorkspacePicker();
    expect(await invoke()).toBe("E:\\MyWork\\AIwork\\penguin-harness");
    expect(showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ["openDirectory"] }),
    );
  });

  it("returns null when the user cancels — the caller reads that as 'nothing happened'", async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    registerWorkspacePicker();
    expect(await invoke()).toBe(null);
  });

  it("returns null on a cancel that still carries paths (defensive)", async () => {
    // Cancelled with a populated list should not hand a path to a caller that already
    // treated this as "the user changed their mind".
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: ["/home/u/ws"] });
    registerWorkspacePicker();
    expect(await invoke()).toBe(null);
  });

  it("returns null when the dialog reports no selection and no cancel", async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });
    registerWorkspacePicker();
    expect(await invoke()).toBe(null);
  });

  it("passes no parent window (both windows can trigger it; the wrong one makes it a sheet)", async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    registerWorkspacePicker();
    await invoke();
    // A `BrowserWindow` key would pin the dialog to one surface.
    expect(Object.keys(showOpenDialog.mock.calls[0]![0] as object)).not.toContain(
      "browserWindow",
    );
  });

  it("titles the dialog for a workspace, in the UI language", async () => {
    // The label is read at CALL time, not registration time — so switching the locale between
    // two invocations must change the next dialog without re-registering. That is the real
    // requirement (the shell's language can change under a running window); asserting it this
    // way also keeps the test off `resetWorkspacePickerForTest`, which resets the module flag
    // but not the fake's handler map, so re-registering here would throw on a duplicate.
    getLocale.mockReturnValue("zh-CN");
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    registerWorkspacePicker();

    await invoke();
    expect(showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: "打开本地文件夹", buttonLabel: "打开" }),
    );

    showOpenDialog.mockClear();
    getLocale.mockReturnValue("en-US");
    await invoke();
    expect(showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Open local folder", buttonLabel: "Open" }),
    );
  });

  it("does not reuse the theme channel or its wording", async () => {
    // The whole reason this channel exists. Asserted directly: a future "simplification" that
    // folds the two together is exactly the regression that would show a user "Import theme
    // folder" on a workspace dialog.
    expect(WORKSPACE_PICK_CHANNEL).not.toBe("theme:pickFolder");
    const zh = workspacePickerLabels("zh-CN");
    const theme = themePickerLabels("zh-CN");
    expect(zh.title).not.toBe(theme.title);
    expect(zh.button).not.toBe(theme.button);
    // "Open", not "import": nothing is imported — the user is naming an existing directory.
    expect(zh.button).toBe("打开");
  });

  it("picks Chinese for zh locales regardless of region, English otherwise", () => {
    for (const locale of ["zh", "zh-CN", "zh-TW", "ZH-Hans-CN"]) {
      expect(workspacePickerLabels(locale).title, locale).toBe("打开本地文件夹");
    }
    for (const locale of ["en", "en-US", "de-DE", "ja-JP"]) {
      expect(workspacePickerLabels(locale).title, locale).toBe("Open local folder");
    }
  });
});