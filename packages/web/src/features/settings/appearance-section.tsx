/**
 * Appearance page: the look-and-feel preferences that used to sit as rows in the sidebar
 * user menu. Everything applies on the spot (the theme store persists per browser), so
 * there is no Save button. The terminal keeps its own theme row because plenty of people
 * pin a dark terminal inside a light app; it follows the app unless pinned (see
 * TerminalThemeMode).
 *
 * Skins are a gallery with one group per mode rather than a single list. That is not
 * decoration: a package serves exactly one mode, so the two selections are genuinely
 * independent and a user may mix authors. Collapsing them into one list that follows the
 * current mode would make it appear to change on its own every time the theme is toggled. See
 * `skin-gallery.tsx` for why a card also moves the theme.
 */
import { S } from "../../lib/strings";
import { Segmented } from "../../components/ui/segmented";
import { DEFAULT_SKIN_BACKGROUND_DIM, DEFAULT_SKIN_SURFACE_ALPHA } from "@jadelau/skins/css";
import { useTheme } from "../../state/theme";
import type { FontScale, TerminalThemeMode, ThemeMode } from "../../state/theme";
import { AccentPicker, PrefRow } from "./setting-row";
import { SkinGallery } from "./skin-gallery";
import { SkinPackagesSection } from "./skin-packages";

export function AppearanceSection() {
  const {
    mode,
    setMode,
    fontScale,
    setFontScale,
    accent,
    setAccent,
    theme,
    skinSurfaceAlpha,
    skinBackgroundDim,
    setSkinSurfaceAlpha,
    setSkinBackgroundDim,
    skinOwnsAccent,
    terminalMode,
    setTerminalMode,
  } = useTheme();

  // What the two transparency rows can actually act on. The rows stay on screen regardless;
  // these decide whether they are live. A theme's surfaces and its artwork are separate
  // questions — a palette-only theme has the first and not the second.
  const hasSurfaces = (theme?.surfaces?.light?.length ?? 0) > 0;
  const hasArtwork = theme?.background != null;

  const themeOptions: ReadonlyArray<{ value: ThemeMode; label: string }> = [
    { value: "light", label: S.settings.themeLight },
    { value: "dark", label: S.settings.themeDark },
    { value: "system", label: S.settings.followSystem },
  ];
  // Follow-the-app first: it is the default, and the pinned modes are the opt-out.
  const terminalThemeOptions: ReadonlyArray<{ value: TerminalThemeMode; label: string }> = [
    { value: "app", label: S.settings.followAppTheme },
    { value: "light", label: S.settings.themeLight },
    { value: "dark", label: S.settings.themeDark },
  ];
  const fontOptions: ReadonlyArray<{ value: FontScale; label: string }> = [
    { value: "sm", label: S.settings.fontSmall },
    { value: "md", label: S.settings.fontMedium },
    { value: "lg", label: S.settings.fontLarge },
  ];

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
      <PrefRow label={S.settings.mode} info={S.settings.modeInfo}>
        <Segmented options={themeOptions} value={mode} onChange={setMode} />
      </PrefRow>
      <PrefRow label={S.settings.terminalTheme} info={S.settings.terminalThemeInfo}>
        <Segmented options={terminalThemeOptions} value={terminalMode} onChange={setTerminalMode} />
      </PrefRow>
      <PrefRow label={S.settings.fontSize} info={S.settings.fontSizeInfo}>
        <Segmented options={fontOptions} value={fontScale} onChange={setFontScale} />
      </PrefRow>
      <SkinGallery />
      <PrefRow
        label={S.settings.accent}
        info={S.settings.accentInfo}
        {...(skinOwnsAccent && theme !== null
          ? { hint: S.settings.themeOwnsAccent(theme.name) }
          : {})}
      >
        <AccentPicker value={accent} onChange={setAccent} disabled={skinOwnsAccent} />
      </PrefRow>
      {/* Both rows exist to serve the theme's artwork, but they are disabled rather than hidden
          when the active theme gives them nothing to act on — the AccentPicker rule: a row that
          disappears reads as the feature having been removed, and the user cannot tell whether
          it is absent because their theme has no artwork or because the setting is gone. */}
      <PrefRow
        label={S.settings.themeSurfaceAlpha}
        info={S.settings.themeSurfaceAlphaInfo}
        {...(hasSurfaces ? {} : { hint: S.settings.themeSurfaceAlphaInactive })}
      >
        <OpacitySlider
          value={skinSurfaceAlpha ?? DEFAULT_SKIN_SURFACE_ALPHA}
          onChange={setSkinSurfaceAlpha}
          label={S.settings.themeSurfaceAlpha}
          disabled={!hasSurfaces}
        />
      </PrefRow>
      <PrefRow
        label={S.settings.themeBackgroundDim}
        info={S.settings.themeBackgroundDimInfo}
        {...(hasArtwork ? {} : { hint: S.settings.themeBackgroundDimInactive })}
      >
        <OpacitySlider
          value={skinBackgroundDim ?? theme?.background?.dim ?? DEFAULT_SKIN_BACKGROUND_DIM}
          onChange={setSkinBackgroundDim}
          label={S.settings.themeBackgroundDim}
          disabled={!hasArtwork}
        />
      </PrefRow>
      <SkinPackagesSection />
    </div>
  );
}

/**
 * A 0..1 preference. A native `range` input rather than a hand-drawn track: it brings keyboard
 * and assistive-technology behaviour with it, and `accent-color` is enough to make it match the
 * rest of the page in both modes.
 *
 * The readout is a percentage because that is how people talk about opacity, and it is
 * `aria-hidden` — the input already announces its own value, and a second one would be read out
 * twice.
 */
function OpacitySlider({
  value,
  onChange,
  label,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`h-1.5 w-36 accent-gray-900 dark:accent-gray-100 ${
          disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
        }`}
      />
      <span
        className={`w-9 shrink-0 text-right text-xs tabular-nums ${
          disabled ? "text-gray-400 dark:text-gray-600" : "text-gray-500 dark:text-gray-400"
        }`}
        aria-hidden
      >
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}
