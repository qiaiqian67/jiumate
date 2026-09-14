/**
 * App Center example detail Modal — opened by clicking an example card's main body (the model
 * library's card-detail pattern, mirrored from `features/plugins/plugin-detail.tsx`). It carries
 * the example's cover, full description, metadata line and preselected skills, then renders the
 * canned prompt as the body the parent would have sent itself — a read-only preview, not a
 * composer. The footer button hands the same `fillExample`/`fillShortcut` handoff the card's
 * quick-start icon button already calls (park + saveDraft + navigate /chat/new), so opening
 * the draft from here lands the user on the same composer state as a one-click fill.
 *
 * The Modal's chrome (header bar, footer) sits inside the standard `<Modal>` shell; only the
 * body is custom. Like `PluginDetailModal`, this is rendered open-only when the card wants it —
 * a mounted-when-closed shell would still capture Escape and block the page beneath.
 */
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { SEND_ICON } from "../../components/ui/icons";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { EXAMPLE_FOLDERS, type ExampleFolderId, type ExampleTask } from "./example-tasks";
import type { UserShortcut } from "./user-shortcuts";

/**
 * Either side of the App Center catalog can be previewed: a built-in `ExampleTask` or one of
 * the user's saved shortcuts. The Modal narrows the union at the boundary: a task carries a
 * label/desc/prompt triple from `S.chat.exampleTasks[id]` plus a skills list; a shortcut only
 * has a title and a prompt and pins no Skills (see `user-shortcuts.ts`). The header / footer
 * chrome are the same either way.
 */
export type DetailEntry = ExampleTask | UserShortcut;

/** Is this entry a built-in example? True iff it carries `skills`. The discriminator is structural. */
export function isExampleTaskEntry(entry: DetailEntry): entry is ExampleTask {
  return (entry as ExampleTask).skills !== undefined;
}

/** Build the meta line under the title — category + skill count for a built-in, fixed for a shortcut. */
function metaFor(entry: DetailEntry): string {
  if (isExampleTaskEntry(entry)) {
    // Reverse-lookup the folder this task sits in: task ids are scoped to their folder, but
    // ExampleTask doesn't carry the folder id itself — EXAMPLE_FOLDERS does.
    const folder = EXAMPLE_FOLDERS.find((f) => f.tasks.some((t) => t.id === entry.id));
    const folderLabel = folder ? S.chat.exampleFolders[folder.id as ExampleFolderId] : "";
    return S.chat.appCenter.metaLine(folderLabel, entry.skills.length);
  }
  return S.chat.appCenter.shortcutMeta;
}

/** The prompt text shown in the body — the canned message the example would have sent. */
function promptFor(entry: DetailEntry): string {
  if (isExampleTaskEntry(entry)) {
    return S.chat.exampleTasks[entry.id as keyof typeof S.chat.exampleTasks].prompt;
  }
  return entry.prompt;
}

/** Cover glyph shown at the left of the header (sized larger than the card's 56px so it reads as a preview). */
function coverFor(entry: DetailEntry): string {
  if (isExampleTaskEntry(entry)) return entry.cover ?? S.chat.appCenter.coverFallback;
  return "⚡";
}

/** Title text under the cover (label for an example; the shortcut's user-given title otherwise). */
function labelFor(entry: DetailEntry): string {
  if (isExampleTaskEntry(entry)) {
    return S.chat.exampleTasks[entry.id as keyof typeof S.chat.exampleTasks].label;
  }
  return entry.title;
}

/** Description paragraph under the title (full desc for an example; the prompt-as-preview for a shortcut). */
function descFor(entry: DetailEntry): string {
  if (isExampleTaskEntry(entry)) {
    return S.chat.exampleTasks[entry.id as keyof typeof S.chat.exampleTasks].desc;
  }
  // Shortcuts carry no separate description — the prompt itself is what the user typed.
  return entry.prompt;
}

export function ExampleDetailModal({
  entry,
  onClose,
  onInvoke,
  /** Mirrors the draft screen's "wait for installed skills" gate: a quick start without the
   *  agent's installed skills would silently drop the skill pins, so the button stays inert. */
  disabled,
}: {
  entry: DetailEntry;
  onClose: () => void;
  /** Triggers the same park + saveDraft + navigate /chat/new flow the card's icon button uses. */
  onInvoke: () => void;
  disabled: boolean;
}) {
  const isTask = isExampleTaskEntry(entry);
  const skills = isTask ? entry.skills : [];

  return (
    <Modal
      open
      title={S.chat.appCenter.detailTitle}
      onClose={onClose}
      widthClass="sm:max-w-2xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {S.common.cancel}
          </Button>
          <Button
            disabled={disabled}
            onClick={onInvoke}
            aria-label={S.chat.appCenter.invokeHint}
            title={S.chat.appCenter.invokeHint}
          >
            <GlyphIcon d={SEND_ICON} size={ICON_SIZE.iconButton} />
            {S.chat.appCenter.invoke}
          </Button>
        </div>
      }
    >
      {/* Header: cover tile (the preview reads as a thumbnail the card teased) + label + full
          description + the meta line. Same composition as `PluginDetailModal`'s header, minus
          the hooks badges — examples don't ship hook points. */}
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-gray-100 text-3xl leading-none dark:bg-gray-800"
        >
          {coverFor(entry)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {labelFor(entry)}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            {descFor(entry)}
          </p>
          <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">{metaFor(entry)}</p>
        </div>
      </div>

      {/* Skill chips: examples pin the skills they need; shortcuts pin none. The list is the
          same list the fillExample handoff writes into the draft cache — what would have been
          preselected silently on the composer is now visible for the user to confirm. */}
      <div className="mt-4">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {S.chat.appCenter.skillsLabel}
        </p>
        {skills.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {skills.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                {skill}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
            {S.chat.appCenter.noSkillsHint}
          </p>
        )}
      </div>

      {/* Prompt body: the canned message the card would have sent. Read-only — the user edits
          on the draft screen after invoking. Padded pre, not a code block: prompt is plain text
          the Agent reads, not source the reader scans with syntax highlighting. */}
      <div className="mt-4">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {S.chat.appCenter.promptLabel}
        </p>
        <pre className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 text-sm leading-relaxed text-gray-800 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-100">
          {promptFor(entry)}
        </pre>
      </div>
    </Modal>
  );
}
