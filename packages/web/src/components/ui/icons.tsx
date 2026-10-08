/**
 * Shared single-path icons and the dialog close button, replacing SVGs that were
 * inlined identically at many call sites. Note `chevron.tsx` is a *different*
 * glyph (the rotating right-caret used by collapsibles) and stays separate.
 */
import type { ButtonHTMLAttributes } from "react";
import { S } from "../../lib/strings";
import { AGENT_GROUP_ICON } from "./group-list";

/** Downward caret on Select / OptionMenu / composer dropdown triggers. Color follows currentColor (callers add text-gray-400). */
export function ChevronDown({ size = 12, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path d="M3 4.5l3 3 3-3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Selected-row checkmark in the Select / OptionMenu menus. */
export function CheckIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path d="M5 12l4 4L19 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "Add" plus glyph used by create buttons / new-row affordances. */
export function PlusIcon({
  size = 14,
  strokeWidth = 1.7,
  className = "",
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path
        d="M12 5v14M5 12h14"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Download glyph (tray with a down arrow), used by export/download affordances. */
export function DownloadIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path
        d="M12 4v11m0 0l-5-5m5 5l5-5M4 20h16"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Upload glyph (tray with an up arrow), used by import/upload affordances. */
export function UploadIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path
        d="M12 15V4m0 0L7 9m5-5l5 5M4 20h16"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The close cross. Drawn on a 14x14 grid at stroke 1.5 rather than the 24x24 icon grid: a
 * two-stroke mark aliases badly when its grid and its render size disagree.
 */
export function CloseIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`block shrink-0 ${className}`}
    >
      <path d="M2 2l10 10M12 2L2 12" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The X close button shared by the Modal / Drawer / Sheet headers: same glyph,
 * padding and hover treatment. Extra button props (e.g. Sheet's onPointerDown
 * guard) pass through.
 */
export function CloseButton({
  onClose,
  className = "",
  ...rest
}: { onClose: () => void; className?: string } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick"
>) {
  return (
    <button
      type="button"
      aria-label={S.common.close}
      onClick={onClose}
      className={`rounded-md p-1.5 text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 ${className}`}
      {...rest}
    >
      <CloseIcon />
    </button>
  );
}

/** Info circle: the app's 9-radius status circle with a bar and a dot inside it. */
export const INFO_ICON = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5m0-8h.01";

/** Chat bubble: the messaging binding's channel-neutral mark (dock panel tab). */
export const MESSAGING_ICON = "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z";

/**
 * Paper plane: remote control — the session-row mark for a Session that is relaying through
 * a messaging channel, and the row menu's action that sets one up. One shape for every
 * channel — shape alone is not the carrier, so the row pairs it with the channel's name in
 * a tooltip and in sr-only text, and the menu entry is labelled.
 */
export const MESSAGING_RELAY_ICON = "M22 2 11 13M22 2l-7 20-4-9-9-4z";

/**
 * Paper plane: "quick start" — the icon button that pre-fills the composer with a starter
 * prompt and opens the draft on the current Agent. Used by the plugins library's per-plugin
 * card and by the App Center's per-example card to share the same affordance.
 */
export const SEND_ICON = "M22 2 11 13M22 2 15 22 11 13 2 9 22 2";

/**
 * Heart (lucide's outline): the inspiration library's favourite mark. Its "on" state is the same
 * path filled in currentColor (`GlyphIcon filled`), which is what a star/favourite toggle reads as
 * — one shape that changes weight, rather than two shapes that have to be kept in step.
 */
export const HEART_ICON =
  "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z";

/** Standard gear (lucide settings): full tooth outline + center circle, crisp and undistorted at 16px. */
export const GEAR_ICON =
  "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z";

/**
 * Page-nav glyphs (moved from sidebar.tsx: the sidebar nav, the collapsed rail in
 * app-layout.tsx, and cross-page jump actions — e.g. the chat info dropdown's "view
 * trace" — share them; living here keeps chat-page free of a sidebar import cycle,
 * sidebar.tsx importing DRAFT_SESSION_ID from chat-page).
 */
/**
 * Hook package (a fishing hook: eye, shank, bend and a barbed tip). The mark of hook packages
 * as a kind, wherever skills are marked by the book: the agents page's hook count, the harness
 * banner, and what a settings Hooks tab row draws when its package carries no plugin icon.
 */
export const HOOK_ICON =
  "M16 4a2 2 0 1 0-4 0 2 2 0 0 0 4 0zM14 6v8a5 5 0 0 1-10 0v-2m0 0l-2 2m2-2l2 2";

/**
 * Plugin (a puzzle piece, lucide's outline): the mark of the plugin library in the nav, and
 * what a plugin tile draws when the plugin ships no icon.svg of its own.
 */
export const PLUGIN_ICON =
  "M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z";

/**
 * Connectors (a chain link): an MCP server is a connection to something outside the
 * harness, and the mark says so without naming any one of them — a connector may be a
 * local process or a remote endpoint, and the list shows both side by side. Also what a
 * connector tile draws (an MCP server carries no icon of its own).
 */
export const CONNECTOR_ICON = "M9.5 14.5 14.5 9.5M8 17a5 5 0 0 1 0-7l2-2M16 7a5 5 0 0 1 0 7l-2 2";

/**
 * Key: a credential. What a model row shows when its API key is unset, and what a library card
 * shows for a subject that declares `required_env` — so the same mark means "needs a secret,
 * and here is whether it has one" wherever that comes up.
 */
export const KEY_ICON =
  "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4";

export const NAV_ICONS = {
  /** App Center (a grid of four rounded squares — a catalog of starter apps, the eye's quick
     shorthand for a menu of things to launch). */
  appCenter: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  agents: AGENT_GROUP_ICON,
  /** Plugin library (the puzzle piece). */
  plugins: PLUGIN_ICON,
  /**
   * Model library (a brain: two lobes drawn as one path, closed across the midline). The chip
   * this replaces named the hardware a model runs on; what the page actually lists is language
   * models, and a brain is the mark that says so at a glance.
   */
  models:
    "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18ZM12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",
  /** Machines (two stacked server units, each with its own status lamp). */
  machines: "M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01",
  usage: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  traces: "M4 6h16M4 12h10M4 18h13",
  /** Benchmark center (a trophy: cup + two handles + base). */
  benchmark:
    "M7 4h10v5a5 5 0 0 1-10 0V4zM7 5H4v1a3 3 0 0 0 3 3m10-4h3v1a3 3 0 0 1-3 3M12 14v4m-4 0h8",
  /** Terminal (a `>_` prompt in a window frame). */
  terminal: "M3 5h18v14H3zM7 9l3 3-3 3M13 15h4",
} as const;
