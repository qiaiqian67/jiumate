/**
 * ui_prefs table repo (UI preferences): free-form JSON storage.
 */
import type { DatabaseSync } from "node:sqlite";
import type { UiPrefs } from "../../api/types.js";

export class UiPrefsRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Returns the raw JSON string; null if never set. */
  get(userId: string): string | null {
    const r = this.db.prepare("SELECT prefs_json FROM ui_prefs WHERE user_id = ?").get(userId);
    return r ? (r.prefs_json as string) : null;
  }

  /**
   * The prefs as an object, or an empty one.
   *
   * A row that is not JSON is not a row anyone can read, so it reads as no prefs at all:
   * the column is free-form, and a hand-edited one must not take the app down.
   */
  read(userId: string): UiPrefs {
    const raw = this.get(userId);
    if (raw === null) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === "object" && parsed !== null ? (parsed as UiPrefs) : {};
    } catch {
      return {};
    }
  }

  set(userId: string, prefsJson: string): void {
    this.db
      .prepare(
        `INSERT INTO ui_prefs (user_id, prefs_json) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json`,
      )
      .run(userId, prefsJson);
  }
}
