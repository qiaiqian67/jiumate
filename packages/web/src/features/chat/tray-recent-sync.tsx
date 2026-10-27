/**
 * Feeds the system tray's recent-conversation list, and applies the routes the tray asks for.
 *
 * ## Why the renderer pushes this
 *
 * The tray lives in the main process, which has no idea what a Session is. The renderer has the
 * session store, the project store and the dictionary — everything the list needs — so it sends
 * finished rows rather than the shell re-deriving them from a Project and an Agent it does not hold.
 * See packages/desktop/src/tray-menu.ts for the other half of that split.
 *
 * ## What a row carries
 *
 * An id, a label, and a kind suffix — all decided here. The label goes through the same truncation
 * and the same dictionary as the sidebar, because a tray row that says something different from the
 * row it mirrors is worse than no row: it would be a list the user cannot match to what they see.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { S } from "../../lib/strings";
import { sessionCategory } from "../../lib/session-grouping";
import { useSessions } from "../../state/sessions";
import type { SessionInfo } from "@jadelau/server/api";

/** Rows sent to the shell: enough for the menu, and a cap so a long history cannot bloat it. */
const MAX_ROWS = 30;

/**
 * Kind suffix for a row.
 *
 * Empty for an ordinary conversation: a menu of "chat - chat" would be noise, and the sidebar does
 * not label those rows either. The two the server actually distinguishes get named, so a scheduled
 * run and a subagent's own conversation are tellable apart at a glance — which is the whole reason
 * the reference layout labels its rows.
 */
function kindLabel(session: SessionInfo): string {
  switch (sessionCategory(session)) {
    case "subagent":
      return S.tray.subagentSuffix;
    case "schedule":
      return S.tray.scheduleSuffix;
    default:
      return "";
  }
}

/** Display label: the stored title, or the untitled placeholder, plus the kind suffix. */
export function trayRowLabel(session: SessionInfo): string {
  const title = session.title?.trim();
  const base = title === undefined || title === "" ? S.tray.untitled : title;
  const kind = kindLabel(session);
  return kind === "" ? base : `${base} · ${kind}`;
}

/**
 * Flatten the store's sessions into tray rows, newest first.
 *
 * Sorting here rather than relying on the store's order: the store keeps a per-agent paged order
 * for the sidebar's groups, which is not a global recency order, and "recent" has to mean recent.
 */
export function toTrayRows(sessions: readonly SessionInfo[]) {
  return [...sessions]
    .sort((a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt))
    .slice(0, MAX_ROWS)
    .map((s) => ({ sessionId: s.sessionId, label: trayRowLabel(s), kindLabel: kindLabel(s) }));
}

export function TrayRecentSync() {
  const navigate = useNavigate();
  const { sessions } = useSessions();

  useEffect(() => {
    // Optional: the bridge does not exist in a browser, and there is no tray to feed there.
    const bridge = window.trayRecent;
    if (bridge === undefined) return;
    void bridge.set(toTrayRows(sessions));
  }, [sessions]);

  // The shell owns no router, so a tray click arrives as a path and the page does the navigating.
  useEffect(() => {
    const bridge = window.trayNavigate;
    if (bridge === undefined) return;
    return bridge.onNavigate((path) => navigate(path));
  }, [navigate]);

  return null;
}
