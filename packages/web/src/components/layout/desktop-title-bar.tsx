/**
 * The page-drawn title bar for the desktop shell.
 *
 * ## Why it exists
 *
 * With the default window frame, Windows draws the title bar as a native control in the system
 * accent colour, and no CSS can reach it. That left one pale strip above an otherwise themed
 * window — the sidebar beside it was already following the selected theme, and the title bar was
 * not. `titleBarStyle: "hidden"` + `titleBarOverlay` in main.ts moves the window buttons over the
 * page, which is what makes the strip themeable at all; this component is the part that fills it.
 *
 * ## Why it is one strip across the whole width
 *
 * The window controls sit at the top *right*, so a bar that only covered the sidebar column would
 * leave the buttons floating over the content panel's own background. One strip spanning the full
 * width matches how every other windowed app draws this, and it gives the buttons a bar to sit on
 * rather than the content behind them.
 *
 * ## Why the colour is the frame's, not the content's
 *
 * The content panel is a white card floating on the layout's gray frame, with a rounded corner and
 * an inset edge on every side. The title bar continues that frame: it is the same gray the sidebar
 * sits on, so the window reads as one surface at the top and the card below it, rather than a bar
 * of a third colour welded onto the side.
 *
 * ## Height
 *
 * Must match TITLE_BAR_HEIGHT in main.ts. A mismatch shows up as content tucked under the buttons,
 * so the two are pinned by a test rather than by convention.
 *
 * ## Where the title comes from
 *
 * Read from `document.title` rather than passed in, because each page already sets that through
 * `useDocumentTitle` for the browser tab. Reading it here means the bar and the tab cannot disagree,
 * and a page that sets one gets the other for free — including a Session title that arrives
 * mid-conversation from a `session_title` event, which no caller would have threaded through the
 * layout.
 */
import { useEffect, useState } from "react";
import { S } from "../../lib/strings";

/**
 * Height of the page-drawn title bar, in CSS pixels.
 *
 * Exported so a test can pin it against the main process's own copy (main.ts cannot share a module
 * with the web app — separate builds, and the renderer cannot import from the main process). The
 * height itself lives in `.jiumate-title-bar` in styles.css, which is what actually paints it.
 */
export const TITLE_BAR_HEIGHT = 32;

/** Whether the window is maximized right now. */
export function DesktopTitleBar() {
  // `true` while the window is maximized: the overlay buttons swap to "restore" and grow slightly,
  // and a bar that keeps the maximized layout would show a hairline of page above the frame.
  const [maximized, setMaximized] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    const bridge = window.titleBar;
    if (bridge === undefined) return;
    const off = bridge.onMaximizeChanged((next) => setMaximized(next));
    // Read once on mount: the window may already be maximized before this subscribes (a user who
    // maximized it, then reloaded the page), and the event alone would not have fired yet.
    void bridge.isMaximized().then(setMaximized).catch(() => undefined);
    return off;
  }, []);

  // `document.title` is set by each page's `useDocumentTitle`, so it changes without this component
  // re-rendering. A MutationObserver on <title> is the only way to see it: there is no React state
  // behind it, and polling would be both slower and less honest about what is being watched.
  useEffect(() => {
    const read = () => {
      // The tab title carries the " · JiuMate" suffix; the bar shows the page's own name, so the
      // suffix is stripped rather than repeated at the end of a strip that is already truncated.
      const full = document.title;
      const suffix = ` · ${S.appName}`;
      setTitle(full.endsWith(suffix) ? full.slice(0, -suffix.length) : full);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.querySelector("title") ?? document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="jiumate-title-bar" style={{ paddingRight: maximized ? "8px" : undefined }}>
      <span className="truncate">{title === "" ? S.appName : title}</span>
    </div>
  );
}