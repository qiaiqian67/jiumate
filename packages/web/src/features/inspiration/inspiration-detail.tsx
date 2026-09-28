/**
 * One inspiration case, read in full: what it is, what it needs, and what it produces.
 *
 * The card-detail pattern the plugins library and the old App Center page share — the body opens
 * this Modal, and its footer button is the same one-click handoff the card's quick-start icon
 * performs, so reading first and starting second are the same gesture with one extra click.
 *
 * ## The preview runs in a sandbox, and that is the whole safety story
 *
 * A case's preview is a self-contained HTML document an admin pasted or captured. It is rendered in
 * an iframe with `sandbox="allow-scripts"` and **without** `allow-same-origin`, which puts it in a
 * unique opaque origin: its scripts run (a preview that cannot animate is not a preview), but it
 * cannot read this app's cookies or `localStorage`, cannot reach into the parent document, and its
 * own requests are cross-origin — so the session cookie does not ride along. That is what bounds
 * what an admin-authored document can do, and it is why the server stores the markup verbatim
 * instead of rewriting it.
 *
 * The document is loaded by URL rather than inlined as `srcdoc`: it can be a megabyte, and a
 * same-origin URL is what lets the browser cache it across openings.
 *
 * ## What the case asks for, shown rather than applied
 *
 * The suggested Agent, the Skills and the tools are listed as chips. Skills are *preselected* on
 * invoke when the chosen Agent has them; tools are only ever shown, never installed — naming a tool
 * is a statement of what the case expects, and quietly wiring one up would be the app making a
 * configuration decision on the user's behalf.
 */
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { HEART_ICON, SEND_ICON } from "../../components/ui/icons";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { kindLabel, localizedCase } from "./inspiration-service";
import type { InspirationCatalogView } from "./inspiration-service";
import type { InspirationCase } from "@prismshadow/jiumate-inspirations";
import type { Locale } from "../../state/locale";

/** One `label: value` line of the requirement list. */
function RequirementRow({ label, values }: { label: string; values: readonly string[] }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      {values.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              {value}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">{S.inspiration.noneHint}</p>
      )}
    </div>
  );
}

export function InspirationDetailModal({
  one,
  catalog,
  locale,
  favorite,
  disabled,
  onClose,
  onToggleFavorite,
  onInvoke,
}: {
  one: InspirationCase;
  catalog: InspirationCatalogView;
  locale: Locale;
  favorite: boolean;
  /** True until the selected Agent's installed skills are known. */
  disabled: boolean;
  onClose: () => void;
  onToggleFavorite: () => void;
  onInvoke: () => void;
}) {
  const copy = localizedCase(locale, one);
  const category = catalog.categories.find((candidate) => candidate.id === one.categoryId);
  const categoryName =
    category === undefined
      ? one.categoryId
      : locale === "zh" && category.nameZh
        ? category.nameZh
        : category.name;

  return (
    <Modal
      open
      title={copy.title}
      onClose={onClose}
      widthClass="sm:max-w-3xl"
      footer={
        <>
          <Button onClick={onClose}>{S.common.close}</Button>
          <Button variant="primary" disabled={disabled} onClick={onInvoke}>
            <span className="flex items-center gap-1.5">
              {S.inspiration.invoke}
              <GlyphIcon d={SEND_ICON} size={ICON_SIZE.iconButton} />
            </span>
          </Button>
        </>
      }
    >
      <div className="space-y-1">
        <div className="flex items-start gap-2">
          <p className="flex-1 text-sm text-gray-600 dark:text-gray-300">{copy.description}</p>
          <button
            type="button"
            aria-pressed={favorite}
            aria-label={favorite ? S.inspiration.unfavorite : S.inspiration.favorite}
            title={favorite ? S.inspiration.unfavorite : S.inspiration.favorite}
            onClick={onToggleFavorite}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded transition-colors duration-150 ${
              favorite
                ? "text-red-500 dark:text-red-400"
                : "text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400"
            }`}
          >
            <GlyphIcon d={HEART_ICON} size={ICON_SIZE.iconButton} filled={favorite} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Badge>{kindLabel(one.kind)}</Badge>
          {one.source === "builtin" && <Badge tone="brand">{S.inspiration.official}</Badge>}
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            {S.inspiration.metaLine(categoryName)}
          </span>
        </div>
      </div>

      {/* The preview, when there is one. Bounded height and its own scroll: the document is an
          app, not a poster, and letting it size the dialog would push the footer off screen. */}
      {one.previewFilename !== null && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
            {S.inspiration.previewLabel}
          </p>
          <iframe
            title={`${S.inspiration.previewLabel} — ${copy.title}`}
            src={`/api/inspirations/${encodeURIComponent(one.id)}/preview`}
            // No `allow-same-origin`: see this module's doc. Scripts run in an opaque origin, which
            // is what keeps an admin-authored document away from the session cookie.
            sandbox="allow-scripts"
            loading="lazy"
            className="h-80 w-full rounded-md border border-gray-200 bg-white dark:border-gray-700"
          />
        </div>
      )}

      <RequirementRow label={S.inspiration.skillsLabel} values={one.skills} />
      <RequirementRow label={S.inspiration.toolsLabel} values={one.tools} />
      {one.agentId !== null && (
        <RequirementRow label={S.inspiration.agentLabel} values={[one.agentId]} />
      )}

      {copy.prompt !== "" && (
        <div className="mt-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {S.inspiration.promptLabel}
          </p>
          {/* Padded pre, not a code block: the prompt is plain text the Agent reads, not source
              the reader scans with syntax highlighting. */}
          <pre className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 text-sm leading-relaxed text-gray-800 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-100">
            {copy.prompt}
          </pre>
        </div>
      )}
    </Modal>
  );
}
