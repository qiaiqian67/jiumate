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
 * between the two radii: at `scale(0.45)` on a 14px eye that is 3.85px a side, and half of that
 * is what this share produces.
 *
 * It sits at 0.5 rather than the 0.55 tried first because 0.55 lands within 0.4px of the limit,
 * and the render test caught a pupil poking outside its white by 1.5px once the figures were
 * rendered at a non-integer scale — sub-pixel rounding eats the margin entirely. Half the gap
 * leaves the rounding somewhere to go, and is as far as a glance reads without looking broken.
 *
 * This was 0.3, chosen as though the eye and the pupil were the same size — they are not, the
 * pupil is the scaled one — so the travel came out at about 1.5px. That is invisible at any panel
 * size, which is what "the eyes don't follow the cursor" turned out to be.
 */
const PUPIL_TRAVEL = 0.5;

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
  /**
   * Whether the pointer should be ignored entirely because a password is being typed.
   *
   * Held as a ref rather than read from the closure so the window listener can consult it without
   * being torn down and re-bound on every keystroke — re-binding on each character of a password
   * would drop and re-add the listener mid-typing. The `data-look-away` attribute on the markup
   * carries the same fact to the stylesheet, which is what actually turns the eyes left; this
   * only has to make sure the script stops overwriting it.
   */
  const lookingAway = useRef(passwordTyped);
  useEffect(() => {
    lookingAway.current = passwordTyped;
    // The pupils were moved by the pointer before the password started; the stylesheet's own
    // `data-look-away` offset takes over from here, but the inline transform is still whatever the
    // last pointer move left behind and would fight it. Clearing it hands the eyes to CSS.
    if (passwordTyped) {
      for (const pupil of pupils()) pupil.style.translate = "0 0";
    }
  }, [passwordTyped]);
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

  /**
   * The white a pupil sits in, as it is drawn right now.
   *
   * The white is the pupil's parent, and its size is what the pupil has to stay inside. It is
   * read live rather than computed from the panel's size because the white's *height* is not
   * fixed: it animates, collapsing to a sliver while the figure blinks. A white measured once
   * would be a white measured at some other moment than the one the pupil is drawn in.
   */
  const eyeOf = (pupil: HTMLSpanElement): DOMRect | null => {
    const eye = pupil.parentElement;
    if (eye === null || !eye.classList.contains("watch-eye")) return null;
    return eye.getBoundingClientRect();
  };

  /**
   * Keep an offset within the room available on that axis.
   *
   * The sign is preserved: a pupil that should go up still goes up, it just does not go further
   * than the white allows.
   */
  const clamp = (offset: number, room: number): number => {
    if (room === Infinity) return offset;
    if (offset > room) return room;
    if (offset < -room) return -room;
    return offset;
  };

  useEffect(() => {
    /*
     * Point every pupil at the pointer, or recentre it when there is no pointer.
     *
     * Viewport coordinates throughout: the listener is on the window, so no conversion is needed
     * and each pupil's own rect — also viewport-relative — can be compared to it directly. One
     * event moves eight pupils, and each needs the distance to *itself*, which differs.
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
        // Each axis gets its own room, because the white is not square and does not stay square:
        // the eye's *height* collapses to a sliver while it blinks, and the room the pupil's centre
        // has vertically collapses with it. The reach above is the pupil's travel — a distance, and
        // a distance has no direction, so it is the same on both axes — but the room does: the
        // pupil may move until its own edge meets the white's edge, which is half the difference
        // between the two, on that axis. Clamping each axis to its own room is what keeps a
        // blinking eye from showing a pupil hanging outside it.
        //
        // The eye is the parent's box, and the pupil fills it (the stylesheet's `inset: 0`) before
        // it is scaled down, so the white's size is the pupil's unscaled size — recovered here from
        // the scaled rect by the same factor the stylesheet scales by.
        const white = eyeOf(pupil);
        const roomX = white === null ? Infinity : Math.max(0, (white.width - box.width) / 2);
        const roomY = white === null ? Infinity : Math.max(0, (white.height - box.height) / 2);
        // `translate`, not `transform`: the stylesheet's `transform: scale(0.45)` is what makes
        // the pupil visible inside its white, and writing `transform` here would replace it,
        // snapping every pupil to full size the moment the pointer moved.
        pupil.style.translate = `${clamp(ux * reach, roomX)}px ${clamp(uy * reach, roomY)}px`;
      }
    };

    const onMove = (e: PointerEvent) => {
      // Viewport coordinates, matching what `getBoundingClientRect` returns for each pupil. No
      // conversion through the panel, because the listener is on the window rather than the panel
      // (see the note on where this is bound).
      if (lookingAway.current) {
        // A password is being typed. Leave every pupil alone so the stylesheet's `data-look-away`
        // offset survives — writing here would overwrite it on the next pointer move, which is why
        // the eyes did not turn left.
        return;
      }
      paint({ x: e.clientX, y: e.clientY });
    };

    /*
     * Bound to the window, not the panel.
     *
     * The watchers track the cursor across the whole window — that is the effect — so listening on
     * the panel meant the eyes froze the moment the cursor crossed onto the form, which is where
     * the cursor spends most of its time on this page. The red box in the screenshot was the
     * region that worked, and it was half the card.
     *
     * The window's `pointerout` (rather than the panel's `pointerleave`) covers the case of the
     * cursor leaving the window entirely, so the eyes do not stay locked on wherever it went.
     */
    window.addEventListener("pointermove", onMove);
    // `pointerout` with no `relatedTarget` means the cursor left the window entirely (into another
    // application, or off the screen edge). With a relatedTarget it is just moving between elements
    // inside, which `pointermove` already covers — recentring on that would make the eyes snap back
    // every time the cursor crossed an edge.
    const onExit = (e: PointerEvent) => {
      if (e.relatedTarget === null) paint(null);
    };
    window.addEventListener("pointerout", onExit);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onExit);
    };
    // `lookingAway` is a ref, not a dependency: the effect is bound once for the panel's lifetime
    // and reads the ref's current value on every event, so it neither re-binds on each keystroke
    // nor closes over a stale `passwordTyped`.
  }, []);

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
      style={
        {
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
        } as CSSProperties
      }
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
