/**
 * The mobile nav drawer and the sidebar column it holds must present ONE header between them.
 *
 * The drawer used to pass `title={S.appName}` AND mount the column under it, and the column
 * draws its own top row (logo + app name) — so a phone showed the name twice, stacked, with
 * two different close affordances. Nothing failed; it just looked like a rendering bug, which
 * is exactly the kind of regression that survives a test suite.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = (p: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), p), "utf8");

const APP_LAYOUT = "../src/components/layout/app-layout.tsx";
const DRAWER = "../src/components/ui/drawer.tsx";
const SIDEBAR = "../src/components/layout/sidebar.tsx";

describe("the mobile nav drawer", () => {
  it("does not title itself when its content supplies a header", () => {
    // The nav drawer holds the sidebar column, whose own top row already carries the app
    // name. Passing `title` as well put the same name on one screen twice.
    const layout = src(APP_LAYOUT);
    const drawer = layout.slice(
      layout.indexOf("open={drawerOpen}"),
      layout.indexOf("open={drawerOpen}") + 600,
    );
    expect(drawer).toContain("onClose");
    expect(drawer).not.toContain("title=");
    expect(drawer).not.toContain("S.appName");
  });

  it("draws no header row at all without a title", () => {
    // An empty header bar (the rule plus an empty span) is still a visible seam, so the row
    // is skipped entirely rather than rendered blank. Panels that DO pass a title — the
    // session-info one — keep the row, which is also the only home their close button has.
    const drawer = src(DRAWER);
    expect(drawer).toContain("title !== undefined && (");
  });

  it("still closes on Escape and on the scrim, with no header", () => {
    // Removing the header row removes the close BUTTON with it, so these two paths become
    // the only ways out on a phone. Asserting they survive is what stops a future "tidy up"
    // from leaving the drawer with no exit.
    const drawer = src(DRAWER);
    expect(drawer).toContain('if (e.key === "Escape") onClose();');
    expect(drawer).toContain("onMouseDown={onClose}");
  });

  it("gives the column a close button in place of its collapse toggle", () => {
    // The column's top row is now the drawer's only title, so it has to also offer the way
    // out. It offers CLOSE, not collapse: a drawer has no narrower state to collapse to, it
    // dismisses. `onClose` takes precedence over `onCollapse` for exactly that reason.
    const sidebar = src(SIDEBAR);
    expect(sidebar).toContain("onClose?: () => void;");
    expect(sidebar).toContain("{onClose ? (");
    expect(sidebar.indexOf("{onClose ? (")).toBeLessThan(sidebar.indexOf(") : onCollapse ? ("));
  });
});
