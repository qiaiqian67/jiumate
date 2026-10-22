/**
 * The import's rules: the domain filter, the cookie shape, and the profile discovery.
 *
 * These are the parts a test can pin without a browser on the machine: what a domain filter
 * means, what a cookie looks like when it reaches the shell, and which profiles discovery
 * finds. The decryption itself is the browser's own, and is exercised by the import running
 * against a real profile.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  chromiumSameSite,
  firefoxSameSite,
  inDomains,
  isExpired,
  normalizeDomains,
  toDesktopCookie,
  type StoredCookie,
} from "../../src/browser/import/cookie-rules.js";
import { discoverProfiles } from "../../src/browser/import/discovery.js";
import { HistoryStore, mergeDisk } from "../../src/browser/history-store.js";
import type { ImportEnv } from "../../src/browser/import/index.js";

const cookie = (over: Partial<StoredCookie> = {}): StoredCookie => ({
  host: "example.com",
  name: "session",
  value: "abc",
  path: "/",
  secure: true,
  httpOnly: true,
  expires: 0,
  sameSite: "lax",
  ...over,
});

describe("the domain filter", () => {
  it("keeps a site's own cookies and its subdomains", () => {
    expect(inDomains("example.com", ["example.com"])).toBe(true);
    expect(inDomains(".example.com", ["example.com"])).toBe(true);
    expect(inDomains("www.example.com", ["example.com"])).toBe(true);
  });

  it("keeps a site that is not a lookalike", () => {
    // `notexample.com` ends with the text but is a different site.
    expect(inDomains("notexample.com", ["example.com"])).toBe(false);
  });

  it("brings a domain cookie along when one of its sites is asked for", () => {
    // `.amazon.com` is sent to `www.amazon.com`, so asking for that site's sign-in has to
    // bring it along.
    expect(inDomains(".amazon.com", ["www.amazon.com"])).toBe(true);
  });

  it("takes every site when nothing is asked for", () => {
    expect(inDomains("anything.example", [])).toBe(true);
  });

  it("reads a pasted address as its host", () => {
    expect(normalizeDomains(["https://www.amazon.com/orders?x=1"])).toEqual(["www.amazon.com"]);
    expect(normalizeDomains(["  Example.COM  "])).toEqual(["example.com"]);
    expect(normalizeDomains([])).toEqual([]);
    expect(normalizeDomains(undefined)).toEqual([]);
  });
});

describe("the cookie the shell takes", () => {
  it("gives a domain cookie its domain, and a host-only cookie none", () => {
    // Giving a host-only cookie a domain would widen it to every subdomain.
    const domain = toDesktopCookie(cookie({ host: ".example.com" }));
    expect(domain.domain).toBe(".example.com");
    const host = toDesktopCookie(cookie({ host: "example.com" }));
    expect(host.domain).toBeUndefined();
  });

  it("sets the URL on the host, with the path", () => {
    expect(toDesktopCookie(cookie({ path: "/app" })).url).toBe("https://example.com/app");
  });

  it("falls back to the browser's default for an insecure SameSite=None", () => {
    // SameSite=None is only valid on a secure cookie.
    const insecure = toDesktopCookie(cookie({ secure: false, sameSite: "no_restriction" }));
    expect(insecure.sameSite).toBe("unspecified");
  });

  it("reads the two families' same-site columns", () => {
    expect(chromiumSameSite(0)).toBe("no_restriction");
    expect(chromiumSameSite(1)).toBe("lax");
    expect(chromiumSameSite(2)).toBe("strict");
    expect(chromiumSameSite(-1)).toBe("unspecified");
    expect(firefoxSameSite(0)).toBe("no_restriction");
    expect(firefoxSameSite(1)).toBe("lax");
    expect(firefoxSameSite(2)).toBe("strict");
  });

  it("knows an expired cookie", () => {
    expect(isExpired(cookie({ expires: 100 }), 200)).toBe(true);
    expect(isExpired(cookie({ expires: 300 }), 200)).toBe(false);
    // A session cookie (0) never expires.
    expect(isExpired(cookie({ expires: 0 }), 999)).toBe(false);
  });
});

describe("profile discovery", () => {
  it("finds a Chromium profile by its Local State", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-import-test-"));
    try {
      // Chrome's Windows layout: %LOCALAPPDATA%\Google\Chrome\User Data, one directory
      // per profile, and the names in `Local State`.
      const userData = path.join(root, "Google", "Chrome", "User Data");
      const profile = path.join(userData, "Default");
      fs.mkdirSync(profile, { recursive: true });
      fs.writeFileSync(path.join(profile, "Cookies"), "");
      fs.writeFileSync(
        path.join(userData, "Local State"),
        JSON.stringify({ profile: { info_cache: { Default: { name: "Work" } } } }),
      );
      const env: ImportEnv = {
        platform: "win32",
        homedir: root,
        env: { LOCALAPPDATA: root },
        tmpdir: os.tmpdir(),
        exec: async () => "",
      };
      const found = discoverProfiles(env);
      const chrome = found.find((p) => p.source.browser === "chrome");
      expect(chrome).toBeDefined();
      expect(chrome?.source.profileName).toBe("Work");
      expect(chrome?.source.hasCookies).toBe(true);
      expect(chrome?.source.hasHistory).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds nothing on a machine with no browsers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-import-empty-"));
    try {
      const env: ImportEnv = {
        platform: "linux",
        homedir: root,
        env: { XDG_CONFIG_HOME: path.join(root, "config") },
        tmpdir: os.tmpdir(),
        exec: async () => "",
      };
      expect(discoverProfiles(env)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the history", () => {
  const entry = (url: string, lastVisitAt: number) => ({
    url,
    title: url,
    visitCount: 1,
    lastVisitAt,
    source: "chrome",
  });

  it("keeps a visit, newest first", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-history-"));
    try {
      const store = new HistoryStore(root, { now: () => 1000 });
      store.record(entry("https://a.test/", 1000));
      store.record(entry("https://b.test/", 2000));
      expect(store.list().map((e) => e.url)).toEqual(["https://b.test/", "https://a.test/"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("counts a second visit to the same page", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-history-"));
    try {
      const store = new HistoryStore(root, { now: () => 1000 });
      store.record(entry("https://a.test/", 1000));
      store.record(entry("https://a.test/", 2000));
      const [first] = store.list();
      expect(first?.visitCount).toBe(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("brings an import's entries in, without losing what it had", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-history-"));
    try {
      const store = new HistoryStore(root, { now: () => 1000 });
      store.record(entry("https://mine.test/", 1000));
      const added = store.merge([entry("https://theirs.test/", 2000)]);
      expect(added).toBe(1);
      expect(store.list().map((e) => e.url)).toEqual([
        "https://theirs.test/",
        "https://mine.test/",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps both sides' visits of the same page", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-history-"));
    try {
      const store = new HistoryStore(root, { now: () => 1000 });
      store.record(entry("https://a.test/", 1000));
      store.merge([entry("https://a.test/", 2000)]);
      const [first] = store.list();
      expect(first?.visitCount).toBe(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not lose the other side's visits when both write", () => {
    // Across a hot swap the previous server's store makes its last write while this one's
    // has already read the file, so a write must merge rather than overwrite.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-history-"));
    try {
      const file = path.join(root, "builtin-browser", "history.json");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify([
          {
            url: "https://theirs.test/",
            title: "Theirs",
            visitCount: 3,
            lastVisitAt: 5000,
            source: "chrome",
          },
        ]),
      );
      const merged = mergeDisk(file, [entry("https://mine.test/", 1000)]);
      expect(merged.map((e) => e.url)).toEqual(["https://theirs.test/", "https://mine.test/"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps nothing but web pages", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-history-"));
    try {
      const store = new HistoryStore(root, { now: () => 1000 });
      store.record(entry("about:blank", 1000));
      expect(store.list()).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
