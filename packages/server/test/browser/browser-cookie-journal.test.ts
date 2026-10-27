/**
 * The server's own record of the cookies the headless browser was given.
 *
 * Chrome writes its cookie store only when it closes, politely: two minutes of running
 * leave the file untouched, and a browser that is killed writes nothing at all. So the
 * server keeps a record of its own, and the sign-ins survive a crash.
 *
 * These are the rules of that record, and they are worth pinning: a record that loses a
 * cookie, or keeps one the user asked to be cleared, is worse than no record.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserCookie } from "@jadelau/core/interfaces";
import {
  CookieJournal,
  JOURNAL_LIMIT,
  journalFile,
} from "../../src/browser/headless/cookie-journal.js";

const cookie = (over: Partial<BrowserCookie> = {}): BrowserCookie => ({
  url: "https://example.com/",
  name: "session",
  value: "abc",
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "lax",
  ...over,
});

/** A fresh data root for one test. */
function freshRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-journal-"));
}

describe("the cookie record", () => {
  it("keeps a cookie, and reads it back", async () => {
    const root = freshRoot();
    try {
      const journal = new CookieJournal(root, "chrome", { now: () => 1000 });
      journal.add([cookie({ name: "a", value: "one" })]);
      await journal.flush();
      expect(journal.list()).toHaveLength(1);
      expect(journal.list()[0]?.value).toBe("one");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("survives the process that wrote it", async () => {
    const root = freshRoot();
    try {
      const first = new CookieJournal(root, "chrome", { now: () => 1000 });
      first.add([cookie({ name: "a", value: "one" })]);
      await first.flush();
      // A new record over the same file: the process that wrote it is gone.
      const second = new CookieJournal(root, "chrome");
      expect(second.list().map((c) => c.name)).toEqual(["a"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("counts a cookie set again as the one that counts", async () => {
    const root = freshRoot();
    try {
      const journal = new CookieJournal(root, "chrome", { now: () => 1000 });
      journal.add([cookie({ name: "a", value: "one" })]);
      journal.add([cookie({ name: "a", value: "two" })]);
      await journal.flush();
      expect(journal.list()).toHaveLength(1);
      expect(journal.list()[0]?.value).toBe("two");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("tells two cookies of the same name on different paths apart", async () => {
    // A site sets a cookie for its whole domain and another for one path: both are real.
    const root = freshRoot();
    try {
      const journal = new CookieJournal(root, "chrome", { now: () => 1000 });
      journal.add([cookie({ name: "a", path: "/" })]);
      journal.add([cookie({ name: "a", path: "/admin" })]);
      await journal.flush();
      expect(journal.list()).toHaveLength(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the newest when there are too many", async () => {
    const root = freshRoot();
    try {
      let now = 1000;
      const journal = new CookieJournal(root, "chrome", { now: () => now++ });
      for (let i = 0; i < JOURNAL_LIMIT + 10; i++) {
        journal.add([cookie({ name: `c${i}` })]);
      }
      await journal.flush();
      const kept = journal.list();
      expect(kept).toHaveLength(JOURNAL_LIMIT);
      // The newest are the ones kept.
      expect(kept.some((c) => c.name === `c${JOURNAL_LIMIT + 9}`)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("forgets everything when the browser's data is cleared", async () => {
    const root = freshRoot();
    try {
      const journal = new CookieJournal(root, "chrome", { now: () => 1000 });
      journal.add([cookie({ name: "a" })]);
      await journal.flush();
      journal.clear();
      await journal.flush();
      expect(journal.list()).toEqual([]);
      // And it stays gone: a new record over the same file sees nothing.
      expect(new CookieJournal(root, "chrome").list()).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads a file that is not a record as no record", () => {
    // The file is in the user's data root: something else may have put it there, and it
    // must not take the server down.
    const root = freshRoot();
    try {
      const file = journalFile(root, "chrome");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "not json at all");
      expect(new CookieJournal(root, "chrome").list()).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips the entries that are not cookies", () => {
    const root = freshRoot();
    try {
      const file = journalFile(root, "chrome");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify([
          { name: "no-url", value: "x" },
          { url: "https://a.test/", value: "no-name" },
          { url: "https://a.test/", name: "good", value: "x", path: "/", at: 1 },
          "not an object",
        ]),
      );
      const kept = new CookieJournal(root, "chrome").list();
      expect(kept).toHaveLength(1);
      expect(kept[0]?.name).toBe("good");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes the record atomically", async () => {
    // A reader sees the old record or the new one, never half of either.
    const root = freshRoot();
    try {
      const journal = new CookieJournal(root, "chrome", { now: () => 1000 });
      journal.add([cookie({ name: "a" })]);
      await journal.flush();
      const file = journalFile(root, "chrome");
      expect(fs.existsSync(file)).toBe(true);
      // No temporary file left behind.
      const leftovers = fs.readdirSync(path.dirname(file)).filter((name) => name.includes(".tmp"));
      expect(leftovers).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
