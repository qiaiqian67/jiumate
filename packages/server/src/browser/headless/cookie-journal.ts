/**
 * The headless browser's own record of the cookies it was given.
 *
 * Chrome does not write its cookie store while it runs: the store is written when the
 * browser closes, politely. A browser that is killed — a crash, a power cut, a `kill -9` —
 * writes nothing, and every sign-in it was given is gone. That is not acceptable for the
 * one thing the import is for: the sign-ins are the user's, they took effort to bring
 * over, and a server crash is not a reason to lose them.
 *
 * So the server keeps its own copy. It is written the moment a cookie is set, and it is
 * read back when the browser starts. The browser's own store is the fast path; this is
 * the durable one.
 *
 * The record holds the cookies, so it holds secrets. It is a file in the data root, and
 * the data root is the user's own.
 */
import fs from "node:fs";
import path from "node:path";
import type { BrowserCookie } from "@jadelau/core/interfaces";

/** How many cookies the record keeps. The newest win. */
export const JOURNAL_LIMIT = 5_000;

/** Where the record lives, under the data root. */
export function journalFile(root: string, browserId: string): string {
  return path.join(root, "browser", browserId, "cookies.json");
}

/** One cookie as the record holds it: the shell's shape plus when it was set. */
interface JournalCookie extends BrowserCookie {
  /** Epoch ms, when the server wrote it down. */
  at: number;
}

export interface CookieJournalOptions {
  now?: () => number;
}

/**
 * The record of the cookies the headless browser was given.
 *
 * It is written whole, and atomically: a half-written file would be a lost record, and
 * the record is the thing that survives a crash.
 */
export class CookieJournal {
  private readonly file: string;
  private readonly now: () => number;
  private cookies = new Map<string, JournalCookie>();
  private loaded = false;
  /** The write under way, so a burst of cookies is one file write rather than many. */
  private writing: Promise<void> | null = null;
  /** Whether a write is wanted after the one under way finishes. */
  private dirty = false;

  constructor(root: string, browserId: string, opts: CookieJournalOptions = {}) {
    this.file = journalFile(root, browserId);
    this.now = opts.now ?? Date.now;
  }

  /**
   * The cookies the record holds.
   *
   * The newest for a name wins: a cookie set again is the one that counts.
   */
  list(): BrowserCookie[] {
    this.load();
    return [...this.cookies.values()].map(({ at: _at, ...cookie }) => cookie);
  }

  /**
   * Records cookies, and writes the record out.
   *
   * A thousand cookies are one write, not a thousand: the record is written whole, and
   * writing it per cookie would make an import quadratic in the number of cookies.
   */
  add(cookies: readonly BrowserCookie[]): void {
    this.load();
    const at = this.now();
    for (const cookie of cookies) {
      this.cookies.set(keyOf(cookie), { ...cookie, at });
    }
    // The oldest go first, so the record stays the size it is meant to be.
    //
    // The trim is only needed once the record is over the limit. Below it, the map holds
    // every cookie and sorting it would only cost time: a burst of cookies is added one at
    // a time, and sorting the whole record on each of those turns a linear add into a
    // quadratic one. Above the limit the sort is what decides which cookies survive, so
    // it runs then — and it runs on a record that is already no larger than the limit plus
    // what just arrived.
    if (this.cookies.size > JOURNAL_LIMIT) {
      const kept = [...this.cookies.values()].sort((a, b) => b.at - a.at).slice(0, JOURNAL_LIMIT);
      this.cookies = new Map(kept.map((cookie) => [keyOf(cookie), cookie]));
    }
    this.schedule();
  }

  /** Forgets everything — the user asked for the browser's data to be cleared. */
  clear(): void {
    this.load();
    this.cookies.clear();
    this.schedule();
  }

  /**
   * Waits for the record to be on disk.
   *
   * The write is deferred so a burst of cookies is one file write, which means the record
   * is not on disk the instant a cookie is added. This waits for it.
   */
  async flush(): Promise<void> {
    await this.writing;
    // A write that was asked for while the last one finished starts another one.
    if (this.dirty) await this.flush();
  }

  /** The record is written at once, and a burst of cookies is one write. */
  private schedule(): void {
    this.dirty = true;
    if (this.writing !== null) return;
    this.writing = this.writeLoop().finally(() => {
      this.writing = null;
    });
  }

  private async writeLoop(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      this.write();
      // The next write waits a beat, so a burst that arrives while this one is running is
      // one more write rather than one per cookie.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const value of parsed) {
        const cookie = parseCookie(value);
        if (cookie !== null) this.cookies.set(keyOf(cookie), cookie);
      }
    } catch {
      // No record, or one that is not ours: there is nothing to restore.
    }
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      // The temporary file and the rename: a reader sees the old record or the new one,
      // never half of either.
      const temp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify([...this.cookies.values()]), "utf8");
      fs.renameSync(temp, this.file);
    } catch {
      // The record is a safety net, not the browser's store: a failure to write it must
      // not fail the cookie write itself.
    }
  }
}
/** A cookie's identity: its name, its domain and its path. */
function keyOf(cookie: BrowserCookie): string {
  // The separator is a unit separator, not a space: a cookie's name, domain and path can
  // each contain a space, and a key built from a space would let one cookie's parts run
  // into another's. The character is written as an escape rather than a literal byte, so
  // the file stays text and a diff of it is readable.
  return `${cookie.name}\u001f${cookie.domain ?? hostOf(cookie.url)}\u001f${cookie.path}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** A record entry, or null when it is not one. */
function parseCookie(value: unknown): JournalCookie | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry["url"] !== "string" || typeof entry["name"] !== "string") return null;
  if (typeof entry["value"] !== "string") return null;
  const cookie: JournalCookie = {
    url: entry["url"],
    name: entry["name"],
    value: entry["value"],
    path: typeof entry["path"] === "string" ? entry["path"] : "/",
    secure: entry["secure"] === true,
    httpOnly: entry["httpOnly"] === true,
    sameSite: sameSiteOf(entry["sameSite"]),
    at: typeof entry["at"] === "number" ? entry["at"] : 0,
    ...(typeof entry["domain"] === "string" ? { domain: entry["domain"] } : {}),
    ...(typeof entry["expirationDate"] === "number"
      ? { expirationDate: entry["expirationDate"] }
      : {}),
  };
  return cookie;
}

/** The same-site value, or the browser's default for one that is not there. */
function sameSiteOf(value: unknown): BrowserCookie["sameSite"] {
  switch (value) {
    case "no_restriction":
      return "no_restriction";
    case "lax":
      return "lax";
    case "strict":
      return "strict";
    default:
      return "unspecified";
  }
}
