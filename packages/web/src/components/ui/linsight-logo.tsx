/**
 * Brand logo (colored linsight emblem): source asset is public/linsight-logo.svg
 * (an important asset, do not modify — the same file also serves as the favicon).
 * The original image is a square on a white background, with className controlling
 * size and rounded-corner cropping — it blends into the page background in light
 * theme, and reads as an app-icon-style white rounded square in dark theme. Purely
 * decorative, hidden from screen readers.
 */
export function LinsightLogo({ className }: { className?: string }) {
  return (
    <img
      src="/linsight-logo.svg"
      alt=""
      aria-hidden
      draggable={false}
      className={`select-none ${className ?? "h-9 w-9 rounded-lg"}`}
    />
  );
}
