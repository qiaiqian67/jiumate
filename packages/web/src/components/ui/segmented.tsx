/** Segmented control (for 2- to 6-way choices like theme/language/messaging channel/proactive interval): small grayscale style. Shared by the sidebar user menu, the login page and the binding editor. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  cols = 3,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  cols?: 2 | 3 | 4 | 5 | 6;
}) {
  return (
    <div
      // Spelled out rather than interpolated: Tailwind scans for whole class names, and a
      // `grid-cols-${n}` built at runtime is never emitted into the stylesheet.
      className={`grid ${gridColsClass(cols)} gap-0.5 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800`}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded px-1 py-1 text-xs transition-colors duration-150 ${
            value === opt.value
              ? "bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100"
              : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Pick the Tailwind grid class for a column count. Split out so the literal lookup
 *  table is the only place that names each column count — the JSDoc above (cols:
 *  2..6) stays the contract. */
function gridColsClass(cols: 2 | 3 | 4 | 5 | 6): string {
  switch (cols) {
    case 2:
      return "grid-cols-2";
    case 3:
      return "grid-cols-3";
    case 4:
      return "grid-cols-4";
    case 5:
      return "grid-cols-5";
    case 6:
      return "grid-cols-6";
  }
}
