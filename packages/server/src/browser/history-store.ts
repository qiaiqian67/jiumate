/**
 * The built-in browser's history: the pages a tab visits, and what an import brought in from
 * a system browser.
 *
 * One JSON file, `<root>/builtin-browser/history.json`, read on first use and written
 * atomically a moment after the last change (a page load produces a burst of tab events).
 * At most {@link HISTORY_CAP} entries are kept, the most recently visited ones.
 *
 * Two stores can share the file for a moment: across a hot swap, the previous server's store
 * makes its last write while the next one's has already read the file. So a write merges
 * what is on disk rather than overwriting it, and neither loses the other's visits.
 */
import fs from "node:fs";
import path from "node:path";
import type { HistoryEntry } from "./import/history.js";

/** The most entries the file keeps. */
export const HISTORY_CAP = 5_000;

const WRITE_DELAY_MS = 1_000;

/** Whether a URL is a web page — the only kind the history keeps. */
export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Where the history file lives under the data root. */
export function historyFile(root: string): string {
  return path.join(root, "builtin-browser", "history.json");
}

function parseEntry(value: unknown): HistoryEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.url !== "string" || !isWebUrl(e.url)) return null;
  return {
    url: e.url,
    title: typeof e.title === "string" ? e.title : "",
    visitCount: typeof e.visitCount === "number" && e.visitCount > 0 ? Math.floor(e.visitCount) : 1,
    lastVisitAt: typeof e.lastVisitAt === "number" ? e.lastVisitAt : 0,
    source: typeof e.source === "string" && e.source !== "" ? e.source : "builtin",
  };
}

export interface HistoryStoreOptions {
  now?: () => number;
  log?: (line: string) => void;
}

/**
 * The history: what the browser has seen.
 *
 * It is written a moment after the last change rather than on every one: a page load
 * produces a burst of events, and each write is a whole file.
 */
export class HistoryStore {
  private readonly file: string;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private entries: HistoryEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private loaded = false;

  constructor(root: string, opts: HistoryStoreOptions = {}) {
    this.file = historyFile(root);
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => undefined);
  }

  /** The entries, newest first. */
  list(): HistoryEntry[] {
    this.load();
    return [...this.entries];
  }

  /**
   * Records a visit.
   *
   * A page visited again keeps its visit count and moves to the front, so the history
   * reads the way a browser's does.
   */
  record(entry: HistoryEntry): void {
    this.load();
    if (!isWebUrl(entry.url)) return;
    const rest = this.entries.filter((e) => e.url !== entry.url);
    const previous = this.entries.find((e) => e.url === entry.url);
    const merged: HistoryEntry = {
      url: entry.url,
      title: entry.title !== "" ? entry.title : (previous?.title ?? ""),
      visitCount: (previous?.visitCount ?? 0) + Math.max(1, entry.visitCount),
      lastVisitAt: entry.lastVisitAt > 0 ? entry.lastVisitAt : this.now(),
      source: entry.source,
    };
    this.entries = [merged, ...rest].slice(0, HISTORY_CAP);
    this.schedule();
  }

  /**
   * Brings an import's entries in.
   *
   * They are merged rather than replacing: what the built-in browser has seen is the user's
   * own history too, and an import adds to it.
   */
  merge(entries: readonly HistoryEntry[]): number {
    this.load();
    let added = 0;
    for (const entry of entries) {
      if (!isWebUrl(entry.url)) continue;
      const previous = this.entries.find((e) => e.url === entry.url);
      if (previous === undefined) {
        this.entries.push({ ...entry });
        added++;
        continue;
      }
      previous.visitCount += Math.max(1, entry.visitCount);
      if (entry.lastVisitAt > previous.lastVisitAt) {
        previous.lastVisitAt = entry.lastVisitAt;
        previous.title = entry.title !== "" ? entry.title : previous.title;
      }
    }
    this.entries.sort((a, b) => b.lastVisitAt - a.lastVisitAt);
    this.entries = this.entries.slice(0, HISTORY_CAP);
    if (added > 0) this.schedule();
    return added;
  }

  /** Empties the history. */
  clear(): void {
    this.load();
    this.entries = [];
    this.schedule();
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const text = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) return;
      this.entries = parsed
        .map((value) => parseEntry(value))
        .filter((e): e is HistoryEntry => e !== null)
        .slice(0, HISTORY_CAP);
    } catch {
      // A missing or unreadable file is an empty history: the browser is new, or the file
      // was written by something else.
      this.entries = [];
    }
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, WRITE_DELAY_MS);
    this.timer.unref?.();
  }

  /** Writes the file atomically, merging what is on disk so a hot swap loses nothing. */
  private write(): void {
    const merged = mergeDisk(this.file, this.entries);
    this.entries = merged;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(merged), "utf8");
      fs.renameSync(temp, this.file);
    } catch (err) {
      this.log(`browser history: could not be written: ${messageOf(err)}`);
    }
  }
}

/**
 * What is on disk merged with what this store holds.
 *
 * Across a hot swap the previous server's store makes its last write while this one's has
 * already read the file, so a write must not overwrite what is there.
 */
export function mergeDisk(file: string, entries: readonly HistoryEntry[]): HistoryEntry[] {
  let onDisk: HistoryEntry[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (Array.isArray(parsed)) {
      onDisk = parsed
        .map((value) => parseEntry(value))
        .filter((e): e is HistoryEntry => e !== null);
    }
  } catch {
    // No file, or one that is not ours: our own entries are the whole history.
  }
  const byUrl = new Map<string, HistoryEntry>();
  for (const entry of onDisk) byUrl.set(entry.url, { ...entry });
  for (const entry of entries) {
    const previous = byUrl.get(entry.url);
    if (previous === undefined) {
      byUrl.set(entry.url, { ...entry });
      continue;
    }
    previous.visitCount = Math.max(previous.visitCount, entry.visitCount);
    if (entry.lastVisitAt > previous.lastVisitAt) {
      previous.lastVisitAt = entry.lastVisitAt;
      if (entry.title !== "") previous.title = entry.title;
    }
  }
  return [...byUrl.values()].sort((a, b) => b.lastVisitAt - a.lastVisitAt).slice(0, HISTORY_CAP);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
