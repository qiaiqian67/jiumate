/**
 * The bordered card every panel on the usage page sits in: a small caption row (title on the
 * left, optional controls on the right) over its content. Extracted from usage-page.tsx when the
 * year heatmap became a second consumer — two copies of the class string would drift the moment
 * either panel's spacing changed.
 */
import type React from "react";

export function ChartCard({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{title}</p>
        {extra}
      </div>
      {children}
    </div>
  );
}
