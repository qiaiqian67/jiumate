/**
 * Applying a theme to the document.
 *
 * The host writes the theme's id onto `<html data-skin="…">` and keeps both readings in a single
 * `<style>` element. Consequences worth knowing:
 *
 * - The theme supplies a ramp for **both** readings, told apart by the `.dark` class the app
 *   already carries, so switching mode needs no re-render and no second selection. That is what
 *   `appearance` replaces: a theme says which shells its artwork holds up under, and the host
 *   pins the mode to match.
 * - Specificity is `:root[data-skin="x"]` = (0,2,0) and `:root[data-skin="x"].dark` = (0,3,0).
 *   The light block ties with `:root[data-accent="…"]`, and that tie is NOT left to source
 *   order: when a theme owns the accent the caller stops writing `data-accent` at all (see
 *   `themeOwnsAccent`).
 * - The artwork block is emitted under plain `:root`, deliberately *outside* the `data-skin`
 *   selector. The artwork has to work with the built-in appearance too, which is the absence of
 *   a theme and so has no attribute to hang off.
 *
 * The catalog itself — where a theme comes from and what it is called — lives in
 * `skin-service.ts`; this module only knows how to put one on screen.
 */
import { ownsAccent, renderSkinCss, renderWallpaperCss } from "@jadelau/skins/css";
import type { SkinRenderInput } from "@jadelau/skins/css";
import type { ThemeDescriptor } from "./skin-service";

/** Id of the single `<style>` element holding the active theme's ramp and artwork. */
export const SKIN_STYLE_ELEMENT_ID = "jiumate-skin";

/**
 * True when the theme claims the accent pair, which is what makes the appearance page disable
 * its accent picker and the caller skip `data-accent`.
 */
export function themeOwnsAccent(theme: SkinRenderInput | null): boolean {
  return theme !== null && ownsAccent(theme.tokens);
}

export interface ApplyThemeOptions {
  /** The user's surface-transparency preference; omit to render the theme's stored colours. */
  surfaceAlpha?: number | null | undefined;
  /** The user's wallpaper-scrim preference; omit to use the artwork's own value. */
  backgroundDim?: number | null | undefined;
}

/**
 * Write a theme onto the document. Returns the stylesheet it applied, so the caller can cache
 * exactly those bytes for the next load's pre-paint pass (features/skin/skin-bootstrap.ts)
 * without rendering them a second time.
 *
 * The artwork is read from the theme rather than passed alongside it: a theme owns its image, so
 * there is no way to end up with one theme's palette over another's picture. A theme with no
 * artwork is a legal theme (the two presets that match the app's own look are), and so is one
 * whose ramp is applied over the built-in appearance — the wallpaper block is emitted under
 * plain `:root` for exactly that case.
 */
export function applyTheme(theme: ThemeDescriptor | null, options: ApplyThemeOptions = {}): string {
  const root = document.documentElement;
  const css = [
    theme === null ? "" : renderSkinCss(theme, { surfaceAlpha: options.surfaceAlpha ?? null }),
    theme?.background == null
      ? ""
      : renderWallpaperCss(theme.background, { dim: options.backgroundDim ?? null }),
  ].join("");
  const existing = document.getElementById(SKIN_STYLE_ELEMENT_ID);
  if (css === "") {
    existing?.remove();
  } else {
    // Reuse the element rather than replacing it: swapping one <style> for another makes the
    // browser re-parse and re-apply every declaration, which shows up as a flash on a change.
    // Assigning textContent is a single recalc.
    const style = (existing as HTMLStyleElement | null) ?? document.createElement("style");
    if (existing === null) {
      style.id = SKIN_STYLE_ELEMENT_ID;
      document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
  }
  if (theme === null) delete root.dataset.skin;
  else root.dataset.skin = theme.id;
  return css;
}
