/**
 * AI companion placement row (System settings → General): a 4-segment picker that lets
 * the user pick where the AI companion lives — [Off | Banner | Widget | Floating].
 *
 * Replaces the previous Switch: instead of one boolean, the user picks one of four
 * placements persisted as `ui_prefs.companionPlacement: "off" | "banner" | "widget" |
 * "floating"`. Banner (composer top) and Widget (right rail) are web-only; Floating
 * (Electron desktop pet) is desktop-only — the row grey-disables the option in the
 * Vite dev build and shows a toast pointing to the desktop app.
 *
 * State lives in `useCompanionStore`; flipping a segment applies instantly and the
 * provider's fire-and-forget `putPrefs` persists. A lost write only costs persistence
 * — the next mount hydrates the stored value back.
 */
import { S } from "../../lib/strings";
import { Segmented } from "../../components/ui/segmented";
import { PrefRow } from "./setting-row";
import { useCompanionStore, isDevBuild, type CompanionPlacement } from "../chat/companion-store";
import { toastInfo } from "../../components/ui/toast";

/** Two pieces of state ride together on every pick: the persisted placement (for the
 *  server gate and the next-mount hydrate) and the visible label (only the labels that
 *  actually exist as placements, so the picker has exactly four segments). */
function useSegmentedValue(): {
  value: CompanionPlacement;
  set: (next: CompanionPlacement) => void;
} {
  const { placement, setPlacement } = useCompanionStore();
  return { value: placement ?? "off", set: setPlacement };
}

export function CompanionModeRow() {
  const { value, set } = useSegmentedValue();
  const dev = isDevBuild();

  /** Build the option list at render time so `disabled` reflects the current dev
   *  flag without re-mounting the picker when `import.meta.env.DEV` toggles. */
  const options: ReadonlyArray<{
    value: CompanionPlacement;
    label: string;
    disabled?: boolean;
    onSelect?: () => void;
  }> = [
    { value: "off", label: S.settings.companionModeOff },
    { value: "banner", label: S.settings.companionModeBanner },
    { value: "widget", label: S.settings.companionModeWidget },
    {
      value: "floating",
      label: S.settings.companionModeFloating,
      disabled: dev,
      onSelect: () => toastInfo(S.settings.companionModeFloatingDevHint),
    },
  ];

  /** Intercept the segment click so we can show a toast when the user tries to pick
   *  Floating in the dev build (the Segmented control itself can't easily render a
   *  per-option disabled state without a richer contract). */
  const onChange = (next: CompanionPlacement) => {
    if (dev && next === "floating") {
      toastInfo(S.settings.companionModeFloatingDevHint);
      return;
    }
    set(next);
  };

  return (
    <PrefRow label={S.settings.companionModeTitle} info={S.settings.companionModeInfo}>
      <div
        className={
          // Reserve the same width whether or not a label is truncated — without this
          // the row would shift on language change. The store reports `null` until the
          // first prefs fetch lands; we render an inert copy that mirrors the picker
          // geometry so the layout doesn't jump when hydration completes.
          dev ? "w-[260px]" : "w-[220px]"
        }
      >
        <Segmented<CompanionPlacement>
          options={options}
          value={value}
          onChange={onChange}
          cols={4}
        />
      </div>
    </PrefRow>
  );
}
