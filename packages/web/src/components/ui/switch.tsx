/**
 * iOS-style toggle switch: a `button` with `role="switch"` + `aria-checked` (a native
 * button is keyboard-operable out of the box — Space/Enter activate it — and is labelable
 * content, so clicking an enclosing `<label>`'s text toggles it too). Sliding knob with an
 * ease-out color/transform transition; the on-state follows the theme accent variable (same
 * source as Button primary), the off-state is gray.
 *
 * Geometry (all integer pixels, per size — see `GEOMETRY` below): the knob is inset 1px on every
 * side and travels between the two end-cap centres, so at either end it is concentric with the
 * track's end-cap circle and the gap along the arcs matches the straight runs. The track draws a
 * 1px inset hairline; the knob's hairline is a *border* — inside its own box — not an outer ring:
 * an outer ring would fill the gap on the near arc
 * and stack on the track hairline as one heavier line, reading as unequal spacing. Net
 * clearance between knob edge and outline is thus a uniform 1px all around. No offset
 * shadow (it reads as vertical asymmetry at this size); the hairlines keep the edges
 * defined on any surface (the dark neutral accent is near-white, where the white knob would
 * otherwise vanish); dark-mode aware; disabled dims and blocks. The focus ring is
 * accent-tinted and `focus-visible`-only, so keyboard focus shows it but a mouse click
 * doesn't leave a lingering halo. `base` (36x20 track, 16px knob) is the default for a
 * labelled form row; `sm` (28x16 track, 12px knob) is for an unlabelled control sharing a
 * row with icon buttons, where a base switch would stand taller than every neighbour.
 */
import type { ButtonHTMLAttributes } from "react";

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "type" | "role"
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /**
   * `base` (36x20 track, 16px knob) is the labelled-form-row default.
   *
   * `sm` (28x16 track, 12px knob) exists for a control with no label beside it — a card's corner,
   * where a base switch would be taller than the icon buttons it shares a row with. The geometry
   * scales rather than being scaled by CSS: the knob and the travel are both derived from the
   * track, so shrinking the box cannot leave the knob overhanging the track's end-cap.
   */
  size?: "sm" | "base";
}

/** Per-size geometry. Inset stays 1px and the knob stays concentric with each end-cap, which is
 *  what keeps the gap along the arcs equal to the straight runs. */
const GEOMETRY = {
  base: { track: "h-5 w-9", knob: "size-4", off: "translate-x-0.5", on: "translate-x-[18px]" },
  sm: { track: "h-4 w-7", knob: "size-3", off: "translate-x-px", on: "translate-x-[15px]" },
} as const;

export function Switch({
  checked,
  onChange,
  disabled,
  size = "base",
  className,
  ...rest
}: SwitchProps) {
  const g = GEOMETRY[size];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex items-center rounded-full " +
        g.track +
        " shrink-0 " +
        "inset-ring inset-ring-black/10 dark:inset-ring-white/10 " +
        "transition-colors duration-200 ease-out " +
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-bg)]/40 " +
        "disabled:cursor-not-allowed disabled:opacity-60 " +
        (checked ? "bg-[var(--accent-bg)]" : "bg-gray-200 dark:bg-gray-700") +
        ` ${className ?? ""}`
      }
      {...rest}
    >
      <span
        aria-hidden
        className={`inline-block rounded-full border border-black/10 bg-white transition-transform duration-200 ease-out ${g.knob} ${
          checked ? g.on : g.off
        }`}
      />
    </button>
  );
}
