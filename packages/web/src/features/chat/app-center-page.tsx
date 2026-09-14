/**
 * App Center page (/app-center): the whole examples catalog at once, filed into category
 * tabs. Shares its data with the draft screen (EXAMPLE_FOLDERS + the user's saved
 * shortcuts) so a click does exactly what the same card does on the draft page — parks
 * anything already typed, writes a new draft cache entry, and navigates to the new-chat
 * route with the canned prompt pre-filled. The user reads, edits, and sends on the draft
 * page; nothing is sent from here.
 *
 * The catalog is shown as cards in a responsive grid rather than the draft screen's tabbed
 * folder rows: a returning user wants to scan the whole menu at once, not open a single
 * folder at a time. The cover glyph the draft screen added to each row becomes a per-card
 * thumbnail here, so the user can recognize a card without reading the title.
 *
 * Cards share the model library's two-part shape (`features/plugins/plugins-page.tsx`): the
 * main body opens a detail Modal, a paper-plane icon button on the right is the quick-start
 * that triggers the same `fillExample`/`fillShortcut` handoff the Modal's footer button does.
 * That keeps the App Center and the plugins library consistent — both are browse pages
 * where the user reads first and starts second.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { S } from "../../lib/strings";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { InfoPopover } from "../../components/ui/info-popover";
import { Tabs, type TabItem } from "../../components/ui/tabs";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { SEND_ICON } from "../../components/ui/icons";
import { ICON_SIZE } from "../../lib/icon-scale";
import { DRAFT_SESSION_ID } from "./chat-page";
import { draftKey, loadDraft, saveDraft } from "./draft-cache";
import { parkActiveDraft } from "./draft-sessions";
import {
  EXAMPLE_FOLDERS,
  EXAMPLE_TASKS,
  type ExampleFolderId,
  type ExampleTask,
  type ExampleTaskId,
} from "./example-tasks";
import { SHORTCUTS_FOLDER_ID } from "./shortcuts-folder";
import { normalizeShortcuts } from "./user-shortcuts";
import type { UserShortcut } from "./user-shortcuts";
import { ExampleDetailModal, isExampleTaskEntry, type DetailEntry } from "./example-detail";
import * as api from "../../api/endpoints";

type AppCenterTab = ExampleFolderId | typeof SHORTCUTS_FOLDER_ID;

/**
 * Build the card's meta line — the same string the detail Modal shows under the title.
 * Pulled out so the card and the Modal share one source of truth for "category + skill
 * count". Shortcuts use a fixed label instead.
 */
function metaFor(entry: DetailEntry): string {
  if (isExampleTaskEntry(entry)) {
    const folder = EXAMPLE_FOLDERS.find((f) => f.tasks.some((t) => t.id === entry.id));
    const folderLabel = folder ? S.chat.exampleFolders[folder.id] : "";
    return S.chat.appCenter.metaLine(folderLabel, entry.skills.length);
  }
  return S.chat.appCenter.shortcutMeta;
}

/**
 * The grid card for a built-in example. Two-part shape:
 *   - the main body is a button that opens the detail Modal (the model-library card pattern);
 *   - the right edge carries a single paper-plane icon button that triggers the same
 *     `fillExample` handoff the Modal's footer uses, so both affordances are reachable from
 *     a single card without leaving the page.
 */
function ExampleCard({
  task,
  disabled,
  onDetailOpen,
  onInvoke,
}: {
  task: ExampleTask;
  /** Mirrors the draft screen's "wait for installed skills" gate: a fill without the agent's
        installed skills would silently drop the skill pins the example asked for. */
  disabled: boolean;
  onDetailOpen: () => void;
  onInvoke: () => void;
}) {
  const copy = S.chat.exampleTasks[task.id as ExampleTaskId];
  const cover = task.cover ?? S.chat.appCenter.coverFallback;
  return (
    <div className="flex items-stretch gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-colors duration-150 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-gray-800/60">
      {/* Main body — same composition as the previous tile, but now a `button` that opens the
            detail Modal rather than firing the fillExample directly. Disabled state lifted out:
            the body always opens the read-only preview, only the quick-start button gates on
            the agent's installed skills. */}
      <button
        type="button"
        onClick={onDetailOpen}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
        title={copy.desc}
      >
        {/* 56px square thumbnail — large enough to read the glyph at a glance, small enough
            that two per row on a laptop keeps each tile readable. Brand-tinted in light,
            muted brand in dark; a single character, so it inherits size and centers on its
            own baseline. */}
        <span
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-gray-100 text-3xl leading-none dark:bg-gray-800"
        >
          {cover}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-sm font-medium text-gray-900 dark:text-gray-100">
            {copy.label}
          </span>
          <span className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{copy.desc}</span>
          <span className="mt-0.5 truncate text-[11px] text-gray-400 dark:text-gray-500">
            {metaFor(task)}
          </span>
        </span>
      </button>

      {/* Right edge: paper-plane quick-start. The Modal's footer button calls the same handoff;
            the icon button here is the single-press alternative when the user already knows
            what they want. `disabled` gates both: opening it without the agent's installed
            skills would silently drop the example's skill pins. */}
      <div className="flex shrink-0 items-center justify-center">
        <Button
          size="sm"
          className="h-8 w-8 shrink-0 justify-center p-0"
          aria-label={`${S.chat.appCenter.invokeHint} ${copy.label}`}
          title={S.chat.appCenter.invokeHint}
          disabled={disabled}
          onClick={onInvoke}
        >
          <GlyphIcon d={SEND_ICON} size={ICON_SIZE.iconButton} />
        </Button>
      </div>
    </div>
  );
}

/**
 * Card for a saved shortcut — same shape as `ExampleCard` but the cover is a fixed ⚡ (the
 * shortcut folder's glyph), so the tab switches by visual rhythm rather than by reading
 * titles. Editing the shortcut still happens in the draft screen; this page is read-only.
 */
function ShortcutCard({
  shortcut,
  onDetailOpen,
  onInvoke,
}: {
  shortcut: UserShortcut;
  onDetailOpen: () => void;
  onInvoke: () => void;
}) {
  return (
    <div className="flex items-stretch gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-colors duration-150 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-gray-800/60">
      <button
        type="button"
        onClick={onDetailOpen}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
        title={shortcut.title}
      >
        <span
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-gray-100 text-3xl leading-none dark:bg-gray-800"
        >
          ⚡
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-sm font-medium text-gray-900 dark:text-gray-100">
            {shortcut.title}
          </span>
          <span className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
            {shortcut.prompt}
          </span>
          <span className="mt-0.5 truncate text-[11px] text-gray-400 dark:text-gray-500">
            {metaFor(shortcut)}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center justify-center">
        <Button
          size="sm"
          className="h-8 w-8 shrink-0 justify-center p-0"
          aria-label={`${S.chat.appCenter.invokeHint} ${shortcut.title}`}
          title={S.chat.appCenter.invokeHint}
          onClick={onInvoke}
        >
          <GlyphIcon d={SEND_ICON} size={ICON_SIZE.iconButton} />
        </Button>
      </div>
    </div>
  );
}

export function AppCenterPage() {
  useDocumentTitle(S.chat.appCenter.pageTitle);
  const { user } = useAuth();
  const { currentProject, agents, currentAgent, setCurrentAgentId } = useProject();
  const navigate = useNavigate();

  /** Default to the first built-in folder; switching persists for the session. */
  const [activeTab, setActiveTab] = useState<AppCenterTab>(EXAMPLE_FOLDERS[0].id);

  /** Shortcuts are server state per user; fetched lazily when the tab is opened so the
       first paint of the page never blocks on a prefs read. */
  const [shortcutsLoaded, setShortcutsLoaded] = useState(false);
  const [shortcuts, setShortcuts] = useState<UserShortcut[]>([]);
  useEffect(() => {
    if (activeTab !== SHORTCUTS_FOLDER_ID || !user || !currentProject) return;
    let cancelled = false;
    setShortcutsLoaded(false);
    void api
      .getPrefs()
      .then((res) => {
        if (!cancelled) setShortcuts(normalizeShortcuts(res.prefs.draftShortcuts));
      })
      .catch(() => {
        if (!cancelled) setShortcuts([]);
      })
      .finally(() => {
        if (!cancelled) setShortcutsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, user, currentProject]);

  /** Detail Modal entry (null = closed): the example or shortcut the user opened. */
  const [detailEntry, setDetailEntry] = useState<DetailEntry | null>(null);

  /** Wait until the Agent's installed skills are known so the preselect in saveDraft doesn't
       silently drop an example's skills. The draft screen gates on the same flag. */
  const skillsLoaded = currentAgent !== undefined;

  /** Card click handler: mirror plugins-page.quickInvoke — park whatever is in the active
       draft, write a new draft cache entry with the canned prompt + skills, then navigate
       to the new-chat route on the current agent. The user reads, edits, and sends there. */
  const fillExample = (task: ExampleTask) => {
    if (!user || !currentProject) return;
    const agentId = currentAgent?.agentId ?? agents[0]?.agentId;
    if (!agentId) return;
    parkActiveDraft(user.userId, currentProject.projectId);
    const key = draftKey(user.userId, currentProject.projectId);
    saveDraft(key, {
      ...loadDraft(key),
      agentId,
      text: S.chat.exampleTasks[task.id].prompt,
      skills: [...task.skills],
      handoffAgentId: undefined,
    });
    setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, { state: { agentId } });
  };
  const fillShortcut = (shortcut: UserShortcut) => {
    if (!user || !currentProject) return;
    const agentId = currentAgent?.agentId ?? agents[0]?.agentId;
    if (!agentId) return;
    parkActiveDraft(user.userId, currentProject.projectId);
    const key = draftKey(user.userId, currentProject.projectId);
    saveDraft(key, {
      ...loadDraft(key),
      agentId,
      text: shortcut.prompt,
      skills: [],
      handoffAgentId: undefined,
    });
    setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, { state: { agentId } });
  };

  /** Modal footer handoff — same flow as the card's quick-start icon, just triggered from
       inside the Modal so the user can read first and decide. */
  const invokeDetail = (entry: DetailEntry) => {
    if (isExampleTaskEntry(entry)) fillExample(entry);
    else fillShortcut(entry);
  };

  /** Tab items: built-in folders from the registry, then the user's shortcuts tab. The
       registry carries the same folder ids the draft screen uses, so copy is reused
       verbatim from `S.chat.exampleFolders`. */
  const tabItems: TabItem<AppCenterTab>[] = useMemo(
    () => [
      ...EXAMPLE_FOLDERS.map<TabItem<AppCenterTab>>((folder) => ({
        key: folder.id,
        label: S.chat.exampleFolders[folder.id],
      })),
      { key: SHORTCUTS_FOLDER_ID, label: S.chat.shortcuts.folder },
    ],
    [],
  );

  const activeFolder =
    activeTab === SHORTCUTS_FOLDER_ID
      ? null
      : (EXAMPLE_FOLDERS.find((f) => f.id === activeTab) ?? null);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="flex items-center gap-1.5 text-xl font-semibold">
          {S.chat.appCenter.pageTitle}
          <InfoPopover label={S.chat.appCenter.pageTitle}>{S.chat.appCenter.pageDesc}</InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{S.chat.appCenter.pageDesc}</p>

        <div className="mt-6">
          <Tabs items={tabItems} active={activeTab} onChange={setActiveTab} />
        </div>

        <div className="mt-4">
          {activeFolder !== null ? (
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {activeFolder.tasks.map((task) => (
                <li key={task.id}>
                  <ExampleCard
                    task={task}
                    disabled={!skillsLoaded}
                    onDetailOpen={() => setDetailEntry(task)}
                    onInvoke={() => fillExample(task)}
                  />
                </li>
              ))}
            </ul>
          ) : shortcutsLoaded ? (
            shortcuts.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                {S.chat.appCenter.shortcutsEmpty}
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {shortcuts.map((shortcut) => (
                  <li key={shortcut.id}>
                    <ShortcutCard
                      shortcut={shortcut}
                      onDetailOpen={() => setDetailEntry(shortcut)}
                      onInvoke={() => fillShortcut(shortcut)}
                    />
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {S.chat.appCenter.shortcutsLoading}
            </p>
          )}
        </div>
      </div>

      {detailEntry !== null && (
        <ExampleDetailModal
          entry={detailEntry}
          disabled={!skillsLoaded}
          onClose={() => setDetailEntry(null)}
          onInvoke={() => {
            const entry = detailEntry;
            setDetailEntry(null);
            if (entry) invokeDetail(entry);
          }}
        />
      )}
    </div>
  );
}

// Reference EXAMPLE_TASKS so tree-shaking does not strip the catalog when the page is the
// only consumer (plugins-page imports the registry too; this anchor keeps it honest).
const _APP_CENTER_CATALOG_ANCHOR = EXAMPLE_TASKS;
