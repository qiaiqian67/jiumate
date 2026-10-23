/**
 * The whole loop, with a real cookie in the middle.
 *
 * The import reads a browser's store; the headless browser takes cookies; the page sees
 * them. Each is tested on its own, and this is the seam between them — the place where
 * two things that work apart can still not work together.
 *
 * The cookie is a real one, in a real Chromium store: the schema is the one Chrome
 * writes, and the value is in the clear, which is how a store that has not encrypted yet
 * (or a browser that stores values plainly) looks.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HeadlessLink } from "../../src/browser/headless/headless-link.js";
import { resolveChromium } from "../../src/browser/headless/chromium.js";
import { listImportSources, readCookies, type ImportEnv } from "../../src/browser/import/index.js";

/** A browser on this machine, or null. */
const browser = resolveChromium(undefined);

/** Why the test is skipped, or null when it may run. */
const skip = browser === null ? "no Chromium on this machine" : null;

/** A fresh data root for one test. */
function freshRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-loop-"));
}

/**
 * A Chromium profile with one cookie in its store.
 *
 * The layout is Chrome's own: a user-data directory with `Local State`, and a profile
 * directory with `Network/Cookies`. The store is a real SQLite database with the columns
 * Chrome writes.
 */
function profileWithCookie(root: string, host: string, name: string, value: string): void {
  const userData = path.join(root, "Google", "Chrome", "User Data");
  const profile = path.join(userData, "Default");
  fs.mkdirSync(path.join(profile, "Network"), { recursive: true });
  fs.writeFileSync(
    path.join(userData, "Local State"),
    JSON.stringify({ profile: { info_cache: { Default: { name: "Test" } } } }),
  );
  const store = path.join(profile, "Network", "Cookies");
  const db = new DatabaseSync(store);
  try {
    db.exec(
      `CREATE TABLE cookies (
         creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL,
         name TEXT NOT NULL, value TEXT NOT NULL, encrypted_value BLOB, path TEXT NOT NULL,
         expires_utc INTEGER NOT NULL, is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL,
         last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL DEFAULT 1,
         is_persistent INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 1,
         samesite INTEGER NOT NULL DEFAULT -1, source_scheme INTEGER NOT NULL DEFAULT 0,
         source_port INTEGER NOT NULL DEFAULT -1, is_same_party INTEGER NOT NULL DEFAULT 0,
         last_update_utc INTEGER NOT NULL
       )`,
    );
    db.exec("CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR)");
    db.prepare("INSERT INTO meta (key, value) VALUES ('version', '24')").run();
    db.prepare(
      `INSERT INTO cookies (creation_utc, host_key, top_frame_site_key, name, value,
         encrypted_value, path, expires_utc, is_secure, is_httponly, last_access_utc,
         has_expires, is_persistent, priority, samesite, source_scheme, source_port,
         is_same_party, last_update_utc)
       VALUES (13350000000000000, ?, '', ?, ?, NULL, '/', 0, 1, 0, 13350000000000000,
         0, 1, 1, 1, 0, -1, 0, 13350000000000000)`,
    ).run(host, name, value);
  } finally {
    db.close();
  }
}

/** The import environment of a machine whose Chrome is in `root`. */
function importEnv(root: string): ImportEnv {
  return {
    platform: "win32",
    homedir: root,
    env: { LOCALAPPDATA: root },
    tmpdir: os.tmpdir(),
    exec: async () => "",
  };
}

describe("the whole loop", () => {
  it.skipIf(skip !== null)(
    "a cookie read out of a browser lands in the headless browser, and the page sees it",
    async () => {
      // The import reads a store; the headless browser takes what the import read; the
      // page sees what the browser took. This walks the whole way.
      const root = freshRoot();
      const env = importEnv(root);
      profileWithCookie(root, "example.com", "session", "imported-value");

      // The import: the profile is found, and its cookie is read.
      const sources = listImportSources(env);
      const source = sources.find((s) => s.browser === "chrome");
      expect(source).toBeDefined();
      const read = await readCookies(source!, {}, env);
      expect(read.cookies).toHaveLength(1);
      expect(read.cookies[0]?.value).toBe("imported-value");

      // The hand-over: the same command the import uses.
      const link = new HeadlessLink({ root: path.join(root, "headless"), headless: true });
      try {
        const written = (await link.request({
          op: "set-cookies",
          cookies: read.cookies,
        })) as { written: number };
        expect(written.written).toBe(1);

        // The page: it sees the sign-in.
        const opened = (await link.request({
          op: "open-tab",
          url: "https://example.com/",
          activate: true,
        })) as { tabId: number };
        let cookie = "";
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 250));
          const seen = (await link.request({
            op: "cdp",
            tabId: opened.tabId,
            method: "Runtime.evaluate",
            params: { expression: "document.cookie", returnByValue: true },
          })) as { result?: { value?: unknown } };
          if (typeof seen.result?.value === "string") {
            cookie = seen.result.value;
            break;
          }
        }
        expect(cookie).toContain("session=imported-value");
      } finally {
        await link.close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
