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
