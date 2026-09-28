/**
 * Brand logo (the jiumate emblem): source asset is public/jiumate-logo.svg (an important
 * asset, do not modify — the same file also serves as the favicon).
 *
 * The mark is a vector squircle that carries its own rounded corners and its own dark
 * background inside the SVG, so it reads as an app tile in both themes and needs no CSS
 * radius. Do not add a fixed `rounded-*` to it: a fixed radius is a larger share of a small
 * box than the artwork's own corner and clips the squircle. `className` controls size only.
 * Purely decorative, hidden from screen readers.
 */
export function JiuMateLogo({ className }: { className?: string }) {
  return (
    <img
      src="/jiumate-logo.svg"
      alt=""
      aria-hidden
      draggable={false}
      className={`select-none ${className ?? "h-9 w-9"}`}
    />
  );
}
