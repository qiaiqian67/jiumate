/**
 * The tray menu's shape, as a pure function of what the renderer reported.
 *
 * ## Why this is a pure module
 *
 * Everything here is a decision about *what the menu looks like* — how many rows, which section,
 * what a row is labelled, what happens when one is clicked. None of it touches Electron. Keeping
 * it out of `tray.ts` (which does) is what makes those decisions testable at all: the alternative is
 * asserting on `Menu.buildFromTemplate` output, which needs an Electron runtime, and the decisions
 * most worth pinning are exactly the ones a reader would otherwise have to take on trust.
 *
 * ## Why the renderer owns the content
 *
 * The recent-conversation list has to come from somewhere that already knows about Sessions,
 * Projects and Agents. That is the renderer: it holds the session store, the project store and
 * the dictionary. The main process has a token and an origin, and reconstructing the list there
 * would mean re-deriving the current Project and Agent before it could even ask the server — and
 * those two are the renderer's state, not the shell's.
 *
 * So the renderer pushes a flat list of rows and the shell arranges it. The shell still owns the
 * items that are genuinely its own (the pet toggle, new chat, settings, quit), because those act on
 * the shell or the app rather than on a Session.
 *
 * ## One tray, not two
 *
 * There used to be a second Tray for the pet, created only while the pet was on. Two icons for one
 * app in the notification area is the sort of thing a user notices before they can say what is
 * wrong with it, and the two menus disagreed: the pet's had a checkbox the app's had no way to
 * reach. The pet toggle is now an item inside this one menu, and the tray exists for the whole
 * session — which it already did, since the app tray does not depend on the pet.
 */
import type { AppTrayLabels } from "./tray-labels.js";

/**
 * One recent conversation, as the renderer describes it.
 *
 * A flat row rather than a Session id alone, because the title and the kind are the renderer's to
 * know: `kindLabel` has already been through the dictionary and the truncation rules there, and
 * re-deriving either here would be a second implementation that could disagree with the sidebar's.
 */
export interface TrayRecentRow {
  sessionId: string;
  /** Display title, already truncated by the renderer. */
  label: string;
  /** Kind suffix ("子智能体" / "定时任务"), or empty for an ordinary conversation. */
  kindLabel: string;
}

/** Rows shown directly under the "recent" heading. */
export const RECENT_VISIBLE = 5;
/** Rows in the "more" submenu. Everything past RECENT_VISIBLE, capped at this many. */
export const MORE_LIMIT = 10;

/** A menu entry, described without Electron so it can be asserted on directly. */
export type TrayMenuItem =
  | { kind: "heading"; label: string }
  | { kind: "item"; label: string; sessionId: string }
  | { kind: "submenu"; label: string; items: TrayMenuItem[] }
  | { kind: "separator" }
  | { kind: "checkbox"; id: TrayActionId; label: string; checked: boolean }
  | { kind: "action"; id: TrayActionId };

/**
 * The shell-owned entries. Anything that acts on the app rather than opening a Session.
 *
 * `toggle-pet` is a checkbox rather than an action because it holds a state the user can read at a
 * glance — whether the pet is running — and a checkbox is the only item type that shows that without
 * opening anything.
 */
export type TrayActionId = "toggle-pet" | "new-chat" | "settings" | "quit";

export interface TrayMenuInput {
  rows: readonly TrayRecentRow[];
  labels: AppTrayLabels;
  /** Whether the floating pet is on. Reported by the renderer, which owns the `enablePet` pref. */
  petEnabled: boolean;
}

/**
 * How many rows the "more" submenu shows.
 *
 * Zero, not an empty submenu: a submenu with nothing in it opens on hover to reveal a blank panel,
 * which reads as a bug. The item is omitted entirely when there is nothing to put in it.
 */
export function moreCount(total: number): number {
  return Math.min(Math.max(total - RECENT_VISIBLE, 0), MORE_LIMIT);
}

/**
 * Build the menu.
 *
 * The order follows the reference layout: the recent conversations first (so the common case —
 * going back to what you were doing — is where the pointer already is), then the actions. "More"
 * sits between them rather than after the actions, because it belongs to the list above it: a
 * submenu that separated its own heading from the section it extends would read as an action.
 *
 * The pet toggle sits with the actions rather than above the list: it is a setting, not a
 * conversation, and putting it at the top would separate it from the other entries of its kind.
 */
export function buildTrayMenu({ rows, labels, petEnabled }: TrayMenuInput): TrayMenuItem[] {
  const menu: TrayMenuItem[] = [];
  const usable = rows.slice(0, RECENT_VISIBLE + MORE_LIMIT);

  menu.push({ kind: "heading", label: labels.recent });

  if (usable.length === 0) {
    // A heading with nothing under it is worse than no list: it promises conversations and shows
    // none. One disabled row states the situation without pretending there is something to click.
    menu.push({ kind: "item", label: labels.noRecent, sessionId: "" });
  } else {
    for (const row of usable.slice(0, RECENT_VISIBLE)) {
      menu.push({ kind: "item", label: row.label, sessionId: row.sessionId });
    }
    if (moreCount(usable.length) > 0) {
      menu.push({
        kind: "submenu",
        label: labels.more,
        items: usable.slice(RECENT_VISIBLE).map((row) => ({
          kind: "item" as const,
          label: row.label,
          sessionId: row.sessionId,
        })),
      });
    }
  }

  menu.push({ kind: "separator" });
  menu.push({ kind: "checkbox", id: "toggle-pet", label: labels.pet, checked: petEnabled });
  menu.push({ kind: "action", id: "new-chat" });
  menu.push({ kind: "action", id: "settings" });
  menu.push({ kind: "separator" });
  menu.push({ kind: "action", id: "quit" });

  return menu;
}
