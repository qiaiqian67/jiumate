/**
 * Appearance context: light/dark theme (mode = light / dark / system) + font
 * size + theme color (accent) + skin.
 * - Theme: html.dark class + Tailwind dark: variant; system mode tracks prefers-color-scheme
 *   live. Dark mode defaults to pure black (styles.css overrides the neutral gray scale).
 * - Font size: scales the root font-size (rem-based text-* utilities scale along with it).
 * - Theme color: html[data-accent] overrides --accent-bg/--accent-fg; defaults to neutral
 *   (gray/white, follows light/dark).
 * - Skin: html[data-skin] + one injected <style> carrying the skin's token overrides. A skin
 *   serves ONE mode, so light and dark are selected independently and the resolved one is
 *   written to the attribute — see features/skin/skin-runtime.ts. A skin that declares the
 *   accent pair OWNS the accent, and then data-accent is not written at all rather than being
 *   left to lose a specificity tie.
 * - Terminal theme: its own light/dark/follow-the-app setting, following the app unless
 *   explicitly pinned — see TerminalThemeMode. It drives no class or variable here; the
 *   terminal reads `terminalDark` and paints itself, because Tailwind's dark: variant is
 *   anchored on html.dark and cannot express a light subtree inside a dark app.
 *
 * Everything except the skin selection persists to localStorage alone. The skin selection is
 * the one that also lives in the server's `ui_prefs`, so it follows the account across
 * browsers and hosts; localStorage holds a copy purely so the first paint has the right
 * colours before `/api/me/prefs` has answered. A `prefs_changed` announcement (the `pet` tool
 * and any other window writing the same row) makes this re-read them.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as api from "../api/endpoints";
import { subscribePrefsChanged } from "../features/pet/prefs-events";
import { applyTheme, themeOwnsAccent } from "../features/skin/skin-runtime";
import { DEFAULT_SKIN_SURFACE_ALPHA } from "@jiumate/skins/css";
import { SKIN_BOOTSTRAP_VERSION, writeSkinBootstrap } from "../features/skin/skin-bootstrap";
import { builtinThemes, listThemes, resolveThemeIn } from "../features/skin/skin-service";
import type { ThemeDescriptor } from "../features/skin/skin-service";

export type ThemeMode = "light" | "dark" | "system";
export type FontScale = "sm" | "md" | "lg";
export type Accent = "neutral" | "blue" | "green" | "violet" | "rose" | "amber";
/**
 * The terminal's appearance. By default it follows the app ("app"): switching the app
 * between light and dark carries the terminal along. Pinning "light" or "dark" decouples
 * the two — for people whose prompts, colour schemes and TUIs are tuned for one screen
 * regardless of the app around it. An absent stored value reads as "app", so only an
 * explicit pin ever overrides the coupling.
 */
export type TerminalThemeMode = "light" | "dark" | "app";
/**
 * A skin selection: the id of an installed or bundled skin, or null for the built-in
 * appearance. Light and dark are stored separately because a package serves one mode, so the
 * two are independent choices that may come from different authors.
 */
export type SkinSelection = string | null;
/** Display currency (prices are always stored as USD/million Tokens; conversion happens only for display and input). */
export type Currency = "USD" | "CNY";
/** 1 USD ≈ 7 CNY (fixed conversion rate). */
export const USD_TO_CNY = 7;

const MODE_KEY = "jiumate.mode";
const FONT_KEY = "jiumate.fontScale";
const ACCENT_KEY = "jiumate.accent";
const SKIN_ALPHA_KEY = "jiumate.theme.surfaceAlpha";
const SKIN_DIM_KEY = "jiumate.theme.backgroundDim";
/**
 * The selected theme. One key, because a theme is one thing: it carries its own palette and its
 * own artwork, and `appearance` says which shell it holds up under.
 */
const THEME_KEY = "jiumate.theme";
const CURRENCY_KEY = "jiumate.currency";
const TERMINAL_KEY = "jiumate.terminal.theme";

/** Font size tier → root font-size (px): overall slightly larger than the system default for readability. */
const FONT_PX: Record<FontScale, string> = { sm: "16px", md: "18px", lg: "20px" };

interface ThemeContextValue {
  mode: ThemeMode;
  /** Resolved effective theme (system mode already resolved against the system preference). */
  dark: boolean;
  setMode: (mode: ThemeMode) => void;
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => void;
  accent: Accent;
  setAccent: (accent: Accent) => void;
  /**
   * The theme in effect, or null for the app's own appearance. One selection, because a theme
   * carries its palette and its artwork together.
   */
  theme: ThemeDescriptor | null;
  /** Every theme the picker can offer: the bundled gallery plus the installed catalog. */
  themes: readonly ThemeDescriptor[];
  /** The stored selection (null = none). */
  activeTheme: SkinSelection;
  setTheme: (id: SkinSelection) => void;
  /**
   * The mode the theme pins the app to, or null when it follows the user's own setting. A
   * single-shell theme pins: its artwork is only correct against the shell it was drawn for.
   */
  pinnedMode: ThemeMode | null;
  /**
   * Alpha applied to the active skin's declared surfaces, or null for the built-in default
   * (`DEFAULT_SKIN_SURFACE_ALPHA`). 1 means opaque surfaces — the position that hides the
   * wallpaper behind the panels again.
   */
  skinSurfaceAlpha: number | null;
  /** Scrim over the wallpaper, or null to use the value the skin's own manifest states. */
  skinBackgroundDim: number | null;
  setSkinSurfaceAlpha: (value: number | null) => void;
  setSkinBackgroundDim: (value: number | null) => void;
  /** Re-read the installed catalog (after an import or a delete). */
  refreshSkins: () => Promise<void>;
  /**
   * True when the skin in effect declares the accent pair, in which case the accent picker is
   * inert and the stored choice is kept but not applied.
   */
  skinOwnsAccent: boolean;
  /** Display currency for prices (shared by Cost Center and Model Library; always stored as USD). */
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  terminalMode: TerminalThemeMode;
  setTerminalMode: (mode: TerminalThemeMode) => void;
  /** Resolved terminal appearance ("app" already resolved against the app's own). */
  terminalDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialMode(): ThemeMode {
  const stored = localStorage.getItem(MODE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

/**
 * Default font tier for a first visit: the smallest of the three. The scale is a *preference*,
 * and the two larger tiers are the ones a user has to come back and pick — starting at the
 * middle meant everyone who never opened Appearance was reading a size they never chose.
 */
/**
 * Minimal storage interface (the subset of localStorage read here). Injectable for the same
 * reason `initialNavGroupCollapsed` is: vitest runs in Node with no `localStorage`, so a default
 * is the only thing a test could otherwise not reach.
 */
export interface PreferenceStorage {
  getItem(key: string): string | null;
}

/**
 * Default font tier for a first visit: the smallest of the three. The scale is a *preference*,
 * and the two larger tiers are the ones a user has to come back and pick — starting at the
 * middle meant everyone who never opened Appearance was reading a size they never chose.
 *
 * A stored tier always wins, including one equal to the old default: this decides what an
 * untouched install shows, not what anyone already chose.
 */
export function initialFontScale(storage?: PreferenceStorage): FontScale {
  const stored = (storage ?? localStorage).getItem(FONT_KEY);
  if (stored === "sm" || stored === "md" || stored === "lg") return stored;
  return "sm";
}

function initialAccent(): Accent {
  const stored = localStorage.getItem(ACCENT_KEY);
  if (
    stored === "neutral" ||
    stored === "blue" ||
    stored === "green" ||
    stored === "violet" ||
    stored === "rose" ||
    stored === "amber"
  ) {
    return stored;
  }
  return "neutral";
}

function initialTerminalMode(): TerminalThemeMode {
  const stored = localStorage.getItem(TERMINAL_KEY);
  if (stored === "light" || stored === "dark" || stored === "app") return stored;
  return "app";
}

/**
 * A stored skin id, or null. Not validated against the catalog here: the catalog is resolved
 * asynchronously (installed packages arrive from the server), and the resolver already treats
 * an unknown id as "no skin", so an id that is merely not loaded yet must not be thrown away.
 */
function initialSkin(key: string): SkinSelection {
  const stored = localStorage.getItem(key);
  return stored === null || stored === "" ? null : stored;
}

/** Write the first-paint cache. Kept in step with the server value by `adoptSkinSelection`. */
function cacheSkin(key: string, value: SkinSelection): void {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}

/**
 * A stored 0..1 preference, or null for "unset" — which means the built-in default rather than
 * zero, so an absent key and a deliberate `0` are different states.
 */
function initialOpacity(key: string): number | null {
  const stored = localStorage.getItem(key);
  if (stored === null || stored === "") return null;
  const value = Number.parseFloat(stored);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function cacheOpacity(key: string, value: number | null): void {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, String(value));
}

/**
 * Default display currency for a first visit: CNY. Prices are always *stored* as USD per million
 * Tokens and converted only for display, so this changes nothing but which figure a user sees
 * first — and several of the catalog's gateway groups quote their preset prices in CNY, which is
 * what a fresh install is most likely to be reading.
 *
 * Read as "is USD the stored choice" rather than "is CNY": the question is which value was
 * explicitly picked, and every other answer — including no answer — falls to the default.
 */
export function initialCurrency(storage?: PreferenceStorage): Currency {
  return (storage ?? localStorage).getItem(CURRENCY_KEY) === "USD" ? "USD" : "CNY";
}

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [sysDark, setSysDark] = useState(systemDark);
  const [fontScale, setFontScaleState] = useState<FontScale>(initialFontScale);
  const [accent, setAccentState] = useState<Accent>(initialAccent);
  const [activeTheme, setThemeState] = useState<SkinSelection>(() => initialSkin(THEME_KEY));
  const [surfaceAlpha, setSurfaceAlphaState] = useState<number | null>(() =>
    initialOpacity(SKIN_ALPHA_KEY),
  );
  const [backgroundDim, setBackgroundDimState] = useState<number | null>(() =>
    initialOpacity(SKIN_DIM_KEY),
  );
  // Seeded with the bundled gallery so the very first render can already apply a theme; the
  // installed catalog arrives a moment later and replaces the list.
  const [themes, setThemes] = useState<readonly ThemeDescriptor[]>(builtinThemes);
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);
  const [terminalMode, setTerminalModeState] = useState<TerminalThemeMode>(initialTerminalMode);

  /**
   * A single-shell theme pins the mode; `auto` follows whatever the user chose.
   *
   * The pin is not decoration. The parts of the window this host does not paint — native
   * scrollbars, form controls, `color-scheme` — render against the shell, so a dark artwork
   * under a light shell has the two fighting. Upstream is emphatic that claiming `auto` for a
   * single-shell image is a defect rather than a preference, and this is the mechanism that
   * makes the claim mean something.
   */
  const theme = useMemo(() => resolveThemeIn(themes, activeTheme), [themes, activeTheme]);
  const pinnedMode: ThemeMode | null =
    theme === null || theme.appearance === "auto" ? null : theme.appearance;
  const dark =
    pinnedMode === null ? (mode === "system" ? sysDark : mode === "dark") : pinnedMode === "dark";
  const terminalDark = terminalMode === "app" ? dark : terminalMode === "dark";

  const themeClaimsAccent = themeOwnsAccent(theme);

  const refreshSkins = useCallback(async () => {
    try {
      setThemes(await listThemes());
    } catch {
      // Keep the list already on screen: a theme is appearance, and blanking the picker
      // because one request failed is worse than showing a list that is a moment stale.
    }
  }, []);

  useEffect(() => {
    void refreshSkins();
  }, [refreshSkins]);

  /**
   * Adopt the server's selection without writing it back: this is the authoritative value
   * arriving, not a user action. Only a key the row actually carries is adopted — an absent
   * one means the account has never chosen, and the localStorage value (this browser's own
   * last choice) stands.
   */
  const readPrefs = useCallback(() => {
    void api
      .getPrefs()
      .then(({ prefs }) => {
        if ("skinSurfaceAlpha" in prefs) {
          const next = prefs.skinSurfaceAlpha ?? null;
          cacheOpacity(SKIN_ALPHA_KEY, next);
          setSurfaceAlphaState(next);
        }
        if ("skinBackgroundDim" in prefs) {
          const next = prefs.skinBackgroundDim ?? null;
          cacheOpacity(SKIN_DIM_KEY, next);
          setBackgroundDimState(next);
        }
        if ("activeTheme" in prefs) {
          const next = prefs.activeTheme ?? null;
          cacheSkin(THEME_KEY, next);
          setThemeState(next);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    readPrefs();
  }, [readPrefs]);

  // The `pet` tool (and any other window) writes the same prefs row server-side. The event
  // stream that announces it has one subscriber by design, fanned out through this bus.
  useEffect(() => subscribePrefsChanged(readPrefs), [readPrefs]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    document.documentElement.style.fontSize = FONT_PX[fontScale];
  }, [fontScale]);

  // Applies the theme AND caches what was applied, in one effect: the pre-paint script in
  // index.html has to reproduce the exact attributes and stylesheet, and rendering the CSS a
  // second time just to cache it would be a copy that can drift from what is on screen.
  useEffect(() => {
    const css = applyTheme(theme, {
      // An unset preference means the built-in default, not "off": `null` reaching the renderer
      // would leave the theme's own colours, which for an imported theme is opaque and would
      // silently undo the whole feature.
      surfaceAlpha: surfaceAlpha ?? DEFAULT_SKIN_SURFACE_ALPHA,
      backgroundDim,
    });
    writeSkinBootstrap({
      v: SKIN_BOOTSTRAP_VERSION,
      dark,
      skin: theme?.id ?? null,
      accent,
      ownsAccent: themeClaimsAccent,
      font: FONT_PX[fontScale],
      css,
    });
  }, [dark, theme, accent, themeClaimsAccent, fontScale, surfaceAlpha, backgroundDim]);

  useEffect(() => {
    // neutral relies on the CSS default (follows light/dark) and sets no data-accent.
    // A theme that owns the accent suppresses data-accent entirely rather than competing with
    // it: both selectors are (0,2,0), so which one won would depend on stylesheet order.
    if (accent === "neutral" || themeClaimsAccent) delete document.documentElement.dataset.accent;
    else document.documentElement.dataset.accent = accent;
  }, [accent, themeClaimsAccent]);

  // system mode: track system preference changes.
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSysDark(e.matches);
    setSysDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    localStorage.setItem(MODE_KEY, next);
    setModeState(next);
  }, []);

  const setFontScale = useCallback((next: FontScale) => {
    localStorage.setItem(FONT_KEY, next);
    setFontScaleState(next);
  }, []);

  const setAccent = useCallback((next: Accent) => {
    localStorage.setItem(ACCENT_KEY, next);
    setAccentState(next);
  }, []);

  const setTheme = useCallback((next: SkinSelection) => {
    // The stored accent is deliberately left in place when a theme takes over the accent:
    // removing the theme must bring the user's earlier choice back, not reset it.
    cacheSkin(THEME_KEY, next);
    setThemeState(next);
    void api.putPrefs({ activeTheme: next }).catch(() => undefined);
  }, []);

  const setSkinSurfaceAlpha = useCallback((next: number | null) => {
    cacheOpacity(SKIN_ALPHA_KEY, next);
    setSurfaceAlphaState(next);
    void api.putPrefs({ skinSurfaceAlpha: next }).catch(() => undefined);
  }, []);

  const setSkinBackgroundDim = useCallback((next: number | null) => {
    cacheOpacity(SKIN_DIM_KEY, next);
    setBackgroundDimState(next);
    void api.putPrefs({ skinBackgroundDim: next }).catch(() => undefined);
  }, []);

  const setCurrency = useCallback((next: Currency) => {
    localStorage.setItem(CURRENCY_KEY, next);
    setCurrencyState(next);
  }, []);

  const setTerminalMode = useCallback((next: TerminalThemeMode) => {
    localStorage.setItem(TERMINAL_KEY, next);
    setTerminalModeState(next);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        mode,
        dark,
        setMode,
        fontScale,
        setFontScale,
        accent,
        setAccent,
        theme,
        themes,
        activeTheme,
        setTheme,
        pinnedMode,
        skinSurfaceAlpha: surfaceAlpha,
        skinBackgroundDim: backgroundDim,
        setSkinSurfaceAlpha,
        setSkinBackgroundDim,
        refreshSkins,
        skinOwnsAccent: themeClaimsAccent,
        currency,
        setCurrency,
        terminalMode,
        setTerminalMode,
        terminalDark,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

/** Display swatches for theme color presets (neutral uses a neutral gray). */
export const ACCENT_SWATCHES: ReadonlyArray<{ value: Accent; color: string }> = [
  { value: "neutral", color: "#6b7280" },
  { value: "blue", color: "#2563eb" },
  { value: "green", color: "#15803d" },
  { value: "violet", color: "#7c3aed" },
  { value: "rose", color: "#be123c" },
  { value: "amber", color: "#b45309" },
];
