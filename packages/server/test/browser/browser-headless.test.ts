/**
 * The headless browser, driven the way the server drives it.
 *
 * This is the one test that starts a real browser: it needs a Chromium on the machine, and
 * it needs a network for the page it opens. So it is skipped when there is no browser, and
 * the skip says why rather than failing quietly.
 *
 * What it proves is the whole chain, not a piece of it: the browser starts, a tab opens, a
 * script runs in the page, a screenshot comes back, a cookie is written and the page sees
 * it, and the tab closes.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HeadlessLink } from "../../src/browser/headless/headless-link.js";
import { listChromiums, resolveChromium } from "../../src/browser/headless/chromium.js";

/** A browser on this machine, or null. */
const browser = resolveChromium(undefined);

/** Why the test is skipped, or null when it may run. */
const skip = browser === null ? "no Chromium on this machine" : null;

/** A fresh data root for one test. */
function freshRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-headless-"));
  return root;
}

/**
 * The cookies a browser's own store holds, read through a copy.
 *
 * The browser holds the file open, so it is copied first — and the copy brings the
 * write-ahead log, so a page the browser has not checkpointed yet is read too.
 */
function storedCookies(root: string): string[] {
  const store = path.join(root, "browser", "chrome", "Default", "Network", "Cookies");
  if (!fs.existsSync(store)) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-store-"));
  try {
    const copy = path.join(dir, "Cookies");
    fs.copyFileSync(store, copy);
    for (const suffix of ["-wal", "-shm"]) {
      try {
        fs.copyFileSync(store + suffix, copy + suffix);
      } catch {
        // No write-ahead log yet.
      }
    }
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      return db
        .prepare("SELECT name FROM cookies")
        .all()
        .map((row) => (row as { name: string }).name);
    } finally {
      db.close();
    }
  } catch {
    return [];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Opens a page and waits for it to load.
 *
 * A cookie is only visible to a page that has loaded: the browser has it, but the page
 * has to have asked for it.
 */
async function openLoadedPage(link: HeadlessLink): Promise<{ tabId: number; cookie: string }> {
  const opened = (await link.request({
    op: "open-tab",
    url: "https://example.com/",
    activate: true,
  })) as { tabId: number };
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const seen = (await link.request({
      op: "cdp",
      tabId: opened.tabId,
      method: "Runtime.evaluate",
      params: { expression: "document.cookie", returnByValue: true },
    })) as { result?: { value?: unknown } };
    const value = seen.result?.value;
    if (typeof value === "string") return { tabId: opened.tabId, cookie: value };
  }
  return { tabId: opened.tabId, cookie: "" };
}

/**
 * Removes a profile directory, waiting for the browser to be gone first.
 *
 * The browser holds its profile open, so on Windows the directory cannot be removed until
 * the process that owns it has exited.
 */
async function removeRoot(root: string, link: HeadlessLink): Promise<void> {
  await link.close();
  for (let i = 0; i < 20; i++) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

describe("the headless browser", () => {
  it.skipIf(skip !== null)(
    "starts, opens a page, and drives it",
    async () => {
      const root = freshRoot();
      const link = new HeadlessLink({ root, headless: true });
      try {
        // The handshake asks whether the browser is there; it does not start one. The
        // browser starts when the agent opens a page.
        expect(await link.handshake()).toBe(false);

        const opened = (await link.request({
          op: "open-tab",
          url: "https://example.com/",
          activate: true,
        })) as { tabId: number };
        expect(typeof opened.tabId).toBe("number");
        expect(link.running).toBe(true);
        expect(await link.handshake()).toBe(true);

        // The page loads and announces itself.
        let tab: { title: string; url: string; loading: boolean } | undefined;
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 250));
          const tabs = (await link.request({ op: "tabs" })) as {
            tabs: { title: string; url: string; loading: boolean }[];
          };
          tab = tabs.tabs[0];
          if (tab !== undefined && !tab.loading) break;
        }
        expect(tab?.loading).toBe(false);
        expect(tab?.url).toContain("example.com");

        // A script runs in the page, the way the driver's own evaluation does.
        const evaluated = (await link.request({
          op: "cdp",
          tabId: opened.tabId,
          method: "Runtime.evaluate",
          params: {
            expression: "(async () => {\nreturn document.title\n})()",
            awaitPromise: true,
            returnByValue: true,
          },
        })) as { result?: { value?: unknown } };
        expect(evaluated.result?.value).toContain("Example");

        // A screenshot comes back.
        const shot = (await link.request({
          op: "cdp",
          tabId: opened.tabId,
          method: "Page.captureScreenshot",
          params: { format: "png" },
        })) as { data?: string };
        expect((shot.data ?? "").length).toBeGreaterThan(1000);

        // A cookie is written, and the page sees it.
        const written = (await link.request({
          op: "set-cookies",
          cookies: [
            {
              url: "https://example.com/",
              name: "jiumate_probe",
              value: "probe-value",
              path: "/",
              secure: true,
              httpOnly: false,
              sameSite: "lax",
            },
          ],
        })) as { written: number };
        expect(written.written).toBe(1);

        const seen = (await link.request({
          op: "cdp",
          tabId: opened.tabId,
          method: "Runtime.evaluate",
          params: { expression: "document.cookie", returnByValue: true },
        })) as { result?: { value?: unknown } };
        expect(String(seen.result?.value)).toContain("jiumate_probe=probe-value");

        // The tab closes.
        await link.request({ op: "close-tab", tabId: opened.tabId });
        const after = (await link.request({ op: "tabs" })) as { tabs: unknown[] };
        expect(after.tabs).toHaveLength(0);
      } finally {
        await removeRoot(root, link);
      }
    },
    120_000,
  );

  it.skipIf(skip !== null)(
    "keeps its profile between runs, so the sign-ins survive",
    async () => {
      const root = freshRoot();
      const first = new HeadlessLink({ root, headless: true });
      try {
        // A page is opened first, the way a sign-in happens: a cookie set against an
        // origin the browser has never visited is a cookie in a profile the browser has
        // never written out.
        const opened = (await first.request({
          op: "open-tab",
          url: "https://example.com/",
          activate: true,
        })) as { tabId: number };
        await first.request({
          op: "set-cookies",
          cookies: [
            {
              url: "https://example.com/",
              name: "jiumate_kept",
              value: "kept-value",
              path: "/",
              secure: true,
              httpOnly: false,
              sameSite: "lax",
            },
          ],
        });
        await first.request({ op: "close-tab", tabId: opened.tabId });
      } finally {
        // The profile must SURVIVE this browser, so the root is not removed here — only the
        // browser is stopped, and stopped gracefully: a browser killed outright does not
        // write its cookie store out.
        await first.close();
      }

      const second = new HeadlessLink({ root, headless: true });
      try {
        // The cookie is in the profile on disk, not just in the running browser's memory: a
        // browser that was stopped and started again still has it. The store is the file the
        // browser wrote when it closed — read through a copy, because the browser holds it
        // open.
        const store = path.join(root, "browser", "chrome", "Default", "Network", "Cookies");
        // The browser has exited, but the store is written as it goes, so the file may
        // appear a moment after the process is gone. Waiting for it is not a retry of the
        // thing being tested: the thing being tested is that the profile survives, and
        // the profile is on disk the moment the browser has flushed it.
        for (let i = 0; i < 50 && !fs.existsSync(store); i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(fs.existsSync(store)).toBe(true);
        const copy = path.join(root, "cookies-copy");
        fs.copyFileSync(store, copy);
        const db = new DatabaseSync(copy, { readOnly: true });
        try {
          const rows = db.prepare("SELECT host_key, name, path, is_secure FROM cookies").all() as {
            host_key: string;
            name: string;
          }[];
          expect(rows.map((r) => r.name)).toContain("jiumate_kept");
        } finally {
          db.close();
        }
      } finally {
        await second.close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it.skipIf(skip !== null)(
    "keeps the sign-ins through a crash, not just through a clean exit",
    async () => {
      // This is what the record is for. Chrome writes its cookie store only when it
      // closes, politely: a browser that is killed writes nothing, and the sign-ins an
      // import brought would be gone. The server's own record is what survives.
      const root = freshRoot();
      const first = new HeadlessLink({ root, headless: true });
      try {
        await first.request({ op: "open-tab", url: "https://example.com/", activate: true });
        await first.request({
          op: "set-cookies",
          cookies: [
            {
              url: "https://example.com/",
              name: "jiumate_crashed",
              value: "crash-value",
              path: "/",
              secure: true,
              httpOnly: false,
              sameSite: "lax",
            },
          ],
        });
        // A hard kill: no goodbye, no flush, exactly what a crash looks like.
        first.process?.kill("SIGKILL");
        await new Promise((r) => setTimeout(r, 2000));
      } finally {
        first.dispose();
      }

      // The browser's own store is empty: it never got the chance to write.
      const store = path.join(root, "browser", "chrome", "Default", "Network", "Cookies");
      if (fs.existsSync(store)) {
        const copy = path.join(root, "cookies-copy");
        fs.copyFileSync(store, copy);
        const db = new DatabaseSync(copy, { readOnly: true });
        try {
          const rows = db.prepare("SELECT name FROM cookies").all() as { name: string }[];
          expect(rows.map((r) => r.name)).not.toContain("jiumate_crashed");
        } finally {
          db.close();
        }
      }

      // But the record has it, and the next browser is given it back.
      const second = new HeadlessLink({ root, headless: true });
      try {
        const page = await openLoadedPage(second);
        expect(page.cookie).toContain("jiumate_crashed=crash-value");
      } finally {
        await second.close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it.skipIf(skip !== null)(
    "survives many restarts",
    async () => {
      // The sign-ins have to still be there after the fifth restart, not only the second.
      const root = freshRoot();
      try {
        for (let round = 0; round < 5; round++) {
          const link = new HeadlessLink({ root, headless: true });
          try {
            if (round === 0) {
              // The first round writes the cookie.
              await link.request({ op: "open-tab", url: "https://example.com/", activate: true });
              await link.request({
                op: "set-cookies",
                cookies: [
                  {
                    url: "https://example.com/",
                    name: "jiumate_restarts",
                    value: "restart-value",
                    path: "/",
                    secure: true,
                    httpOnly: false,
                    sameSite: "lax",
                  },
                ],
              });
            } else {
              const page = await openLoadedPage(link);
              expect(page.cookie).toContain("jiumate_restarts=restart-value");
            }
          } finally {
            await link.close();
          }
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it("says so when the machine has no browser", async () => {
    const root = freshRoot();
    const link = new HeadlessLink({
      root,
      headless: true,
      // A browser that is not on the machine: the link must say so rather than hang.
      browserId: "not-a-browser",
    });
    try {
      // The handshake asks whether the browser is there; it does not start one.
      expect(await link.handshake()).toBe(false);
      // A command that needs the browser says why it cannot have one.
      await expect(
        link.request({ op: "open-tab", url: "https://example.com/", activate: true }),
      ).rejects.toThrow(/not-a-browser/);
    } finally {
      await link.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("does not start a browser just to answer a question", async () => {
    const root = freshRoot();
    const link = new HeadlessLink({ root, headless: true });
    try {
      // A server that has never driven a page must not leave a browser running.
      expect(await link.handshake()).toBe(false);
      const tabs = await link.request({ op: "tabs" });
      expect(tabs).toEqual({ tabs: [] });
      expect(link.running).toBe(false);
    } finally {
      await link.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("finding a browser", () => {
  it("lists the browsers it knows, and says which it found", () => {
    const listed = listChromiums();
    expect(listed.length).toBeGreaterThan(0);
    for (const entry of listed) {
      expect(entry.name).not.toBe("");
      // Found or not, each entry says which.
      expect(entry.path === null || entry.path.endsWith(".exe") || !entry.path.includes("\\")).toBe(
        true,
      );
    }
  });

  it("says so when the browser the user named is not there", () => {
    expect(resolveChromium("not-a-browser")).toBeNull();
  });
});
