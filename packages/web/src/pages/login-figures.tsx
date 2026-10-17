/**
 * The four watchers: the left half of the login page, watching whoever is signing in.
 *
 * ## Why figures rather than an illustration
 *
 * A static picture of four faces gives the user nothing to look at while they think about what
 * to type. These are plain CSS boxes with eyes that follow the pointer, so the panel reacts:
 * it looks at the cursor, glances at the username as it is typed, turns away while a password
 * is being entered (nothing to see there), and looks startled if they submit nothing at all.
 * The reactions are the point — a login page is a screen people sit and stare at, so it is
 * worth giving them something to stare back with.
 *
 * ## Structure
 *
 * Each figure is a `div` with a color and a shape (a tall rectangle, a shorter one, two domes),
 * holding two eyes and a mouth positioned absolutely inside it. Nothing here is an image or an
 * SVG path: a figure is `width`/`height` plus a `border-radius`, so it scales with the panel
 * and needs no assets.
 *
 * ## State comes in as props, not as internal listeners
 *
 * The page owns `usernameTyped` / `passwordTyped` / `surprised` because those are facts about
 * the form and it already knows them. This component subscribes to the pointer itself, because
 * nobody else needs it, and doing it here keeps the page from holding refs to eight pupils.
 */
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import "./login-figures.css";

/** Which of the four figures; also the CSS custom-property suffix its colors come from. */
type FigureKey = "purple" | "black" | "yellow" | "orange";

interface FigureSpec {
  key: FigureKey;
  /** Height as a share of the panel's. A percentage so the composition holds at any panel height. */
  height: string;
  /** Placement within the panel, as percentages — the panel is `position: relative`. */
  top: string;
  left: string;
  /**
   * Blink period in seconds. Deliberately different per figure: a shared period would make all
   * four blink in unison, which reads as one figure blinking four times rather than four figures
   * blinking.
   */
  blink: number;
}

/**
 * The four, arranged to read as a group rather than a row: the two tall ones behind, the two
 * small ones in front, so the shapes overlap and the panel gains depth.
 *
 * `height` is a percentage of the panel's, not a pixel count. The panel's height comes from the
 * card (lg:h-[600px] in login.tsx) and can be shorter on a laptop screen; pixel heights sized for
 * 600px left the taller figures either hanging off the bottom of a short panel or leaving the top
 * half of a tall one empty. As a share of the panel they keep the same composition at either size,
 * and `top` — already a percentage — then lines up with them exactly, so the figures stay on the
 * same ground line rather than drifting apart as the window changes.
 *
 * `left` is a percentage for the same reason.
 */
const FIGURES: readonly FigureSpec[] = [
  { key: "purple", height: "44%", top: "50%", left: "38%", blink: 4 },
  { key: "black", height: "32%", top: "58%", left: "55%", blink: 4.2 },
  { key: "yellow", height: "21%", top: "63.5%", left: "65%", blink: 3.8 },
  { key: "orange", height: "14%", top: "67%", left: "22%", blink: 4.5 },
];

/**
 * How far a pupil may travel from the centre of its eye, as a share of the pupil's own width.
 *
 * The pupil is a scaled circle inside a larger white one, so the room it has to move is the gap
 * between the two radii. At `scale(0.62)` on a 10px eye that gap is about 1.9px a side, and a
 * share of 0.55 of the pupil's 6.2px comes to roughly 3.4px — which the geometry checks confirm
 * stays inside.
 *
 * It reads as 0.55 rather than a number near 1 because the constraint is one-directional: a pupil
 * may move at most the gap, and a value above that pushes it through the edge of the white. Half
 * of the gap is used, which is as far as a glance reads without looking broken.
 *
 * This was 0.3, chosen as though the eye and the pupil were the same size — they are not, the
 * pupil is the scaled one — so the travel came out at about 1.5px. That is invisible at any panel
 * size, which is what "the eyes don't follow the cursor" turned out to be.
 */
const PUPIL_TRAVEL = 0.55;

/**
 * Pointer distance at which the pupil reaches full travel, px.
 *
 * The original demo divided the distance by 6 and capped the result at 8px — a cap its own eye
 * geometry could not accommodate, so pupils pinned to the edge of the white while the cursor was
 * still halfway across the panel. Normalising to a bearing and scaling to a limit small enough
 * to fit gives the same "looking at it" read, in the range the geometry can actually show.
 *
 * This one stays in px on purpose: it is a distance across the *panel*, which has no scale of its
 * own — a pointer 24px away is near whether the figure beside it is large or small.
 */
const POINTER_RANGE = 24;

export interface WatchFiguresProps {
  /** Username field has text: the purple one leans in to read it. */
  usernameTyped: boolean;
  /** Password field has text: everyone looks away, which is the point of a password. */
  passwordTyped: boolean;
  /** Submit with both fields empty: everyone leans back, mouths open. */
  surprised: boolean;
}

export function WatchFigures({ usernameTyped, passwordTyped, surprised }: WatchFiguresProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Every pupil inside the panel.
   *
   * Queried from the DOM rather than collected through refs. A ref array would have to survive
   * React's detach/reattach on every render (the callback fires with `null` and then with the
   * element again), which either grows forever or needs bookkeeping to stay in sync — for a
   * fixed set of eight elements that the panel owns outright. `panelRef` already gives us the
   * subtree, so a query on demand is both shorter and impossible to get out of step.
   */
  const pupils = (): HTMLSpanElement[] => {
    const panel = panelRef.current;
    if (panel === null) return [];
    return Array.from(panel.querySelectorAll<HTMLSpanElement>(".watch-pupil"));
  };

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;

    /**
     * Point every pupil at the pointer, or recentre it when there is no pointer.
     *
     * The pointer's position is converted to panel coordinates once and then compared against
     * each pupil's own centre — one event moves eight pupils, and each needs the distance to
     * *itself*, which differs.
     */
    const paint = (pointer: { x: number; y: number } | null) => {
      for (const pupil of pupils()) {
        if (pointer === null) {
          pupil.style.translate = "0 0";
          continue;
        }
        const box = pupil.getBoundingClientRect();
        const dx = pointer.x - (box.left + box.width / 2);
        const dy = pointer.y - (box.top + box.height / 2);
        const dist = Math.hypot(dx, dy);
        // Normalise to a bearing, then scale: a pupil for a far pointer reaches the same place
        // as one for a near pointer at the same bearing. Without this, moving the mouse across
        // the panel would jolt the pupils instead of leading them.
        //
        // The reach is a share of the pupil's own size, not a pixel count: the figures scale with
        // the panel (their heights are percentages of it), so a fixed 3px would be a third of the
        // eye on the smallest figure and barely a nudge on the largest — and on the small one it
        // would carry the pupil past the edge of its white.
        const reach = Math.min(
          box.width * PUPIL_TRAVEL,
          (dist / POINTER_RANGE) * box.width * PUPIL_TRAVEL,
        );
        const ux = dist === 0 ? 0 : dx / dist;
        const uy = dist === 0 ? 0 : dy / dist;
        // `translate`, not `transform`: the stylesheet's `transform: scale(0.5)` is what makes the
        // pupil visible inside its white, and writing `transform` here would replace it, snapping
        // every pupil to full size the moment the pointer moved.
        pupil.style.translate = `${ux * reach}px ${uy * reach}px`;
      }
    };

    const onMove = (e: PointerEvent) => {
      const box = panel.getBoundingClientRect();
      paint({ x: e.clientX - box.left, y: e.clientY - box.top });
    };
    /** Pointer left the panel: recentre, so the eyes do not stay locked on wherever it exited. */
    const onLeave = () => paint(null);

    panel.addEventListener("pointermove", onMove);
    panel.addEventListener("pointerleave", onLeave);
    return () => {
      panel.removeEventListener("pointermove", onMove);
      panel.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  /**
   * The pointer must not steer the eyes while a password is being typed: the panel is the one
   * thing a user might rest the cursor on while reading what they typed, and having it track
   * there would be the opposite of discreet. React re-runs this when `passwordTyped` flips, and
   * the cleanup recentres — so the eyes return to centre the moment the password starts.
   */
  useEffect(() => {
    if (passwordTyped) {
      for (const pupil of pupils()) pupil.style.translate = "0 0";
    }
  }, [passwordTyped]);

  return (
    <div
      ref={panelRef}
      // Decorative: nothing here is announced, and a screen reader reading "four watchers" at the
      // login form would be noise. The form is the content; this is the wallpaper.
      aria-hidden
      // `h-full` is load-bearing, not decoration: the figures are `position: absolute` and are
      // placed with percentage `top` values, so they need a parent with a resolved height to be
      // positioned against — and being absolutely positioned, they contribute none themselves.
      // Without it the panel's height is 0, every `top: 50%` resolves to 0, and the card's
      // `overflow-hidden` clips all four figures away: the half of the page that was supposed to
      // hold them renders as blank gray. The card sets the height (lg:h-[600px]); this fills it.
      className="watch-panel relative hidden h-full w-full overflow-hidden bg-gray-100 lg:block dark:bg-gray-900"
    >
      {FIGURES.map((f) => (
        <Figure
          key={f.key}
          spec={f}
          usernameTyped={usernameTyped}
          passwordTyped={passwordTyped}
          surprised={surprised}
        />
      ))}
    </div>
  );
}

/**
 * One figure: the coloured body, two eyes, a mouth.
 *
 * `leaning` is decided per figure so the purple one can react to the username while the others
 * react to the password; that asymmetry is what makes the two inputs read as two different events.
 */
function Figure({
  spec,
  usernameTyped,
  passwordTyped,
  surprised,
}: {
  spec: FigureSpec;
  usernameTyped: boolean;
  passwordTyped: boolean;
  surprised: boolean;
}) {
  /** Lean toward the username (purple alone), or back with the startled group (all four). */
  const leaning = surprised || (spec.key === "purple" && usernameTyped && !passwordTyped);

  return (
    <div
      className={`watch-figure absolute -translate-y-1/2 ${spec.key}`}
      style={{
        top: spec.top,
        left: spec.left,
        height: spec.height,
        /*
         * No font-size here on purpose. An earlier version set it to the height as a percentage
         * and sized everything in `em`, which is wrong twice over: `font-size: 44%` resolves
         * against the parent's inherited font size (about 16px), not against any height, so the em
         * basis was ~7px and every dimension collapsed — the figures rendered as thin lines with no
         * eyes or mouths. The stylesheet now uses `cqh` against the panel's container height,
         * which is the unit that actually means what the numbers need to mean.
         *
         * The blink period is per figure (see FigureSpec.blink). Handed to CSS as a custom
         * property rather than as an inline `animation` shorthand, so the keyframes in the
         * stylesheet stay the single definition of what a blink is.
         */
        "--watch-blink": `${spec.blink}s`,
      } as CSSProperties}
      // Set as attributes rather than class names so the CSS can key off the state itself; a
      // class would have to be recomputed here and could drift from what the panel knows.
      data-leaning={leaning || undefined}
      data-surprised={surprised || undefined}
    >
      <div className="watch-eyes" data-look-away={passwordTyped || undefined}>
        <span className="watch-eye">
          <span className="watch-pupil" data-look-away={passwordTyped || undefined} />
        </span>
        <span className="watch-eye">
          <span className="watch-pupil" data-look-away={passwordTyped || undefined} />
        </span>
      </div>
      <span className="watch-mouth" data-surprised={surprised || undefined} />
    </div>
  );
}