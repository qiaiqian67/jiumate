/**
 * Workspace picker, extracted from draft-view.tsx so the Project settings dialog's
 * "new chat defaults" section can offer the same dir-browser popover the chat draft uses.
 * Two trigger variants, one menu:
 * - "pill" (default): the draft page's pill trigger with viewport-docked in-flow menu —
 *   moved verbatim, unchanged markup/classes/behavior;
 * - "form": the shared FormPicker (full-width Input/Select-styled trigger, portaled menu) —
 *   a dialog's overflow-y-auto content area would clip an in-flow panel, and the portal
 *   tier (z-[60]) clears the Modal overlay.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { DirListResponse } from "@prismshadow/jiumate-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { Chevron } from "../../components/ui/chevron";
import { Dropdown } from "../../components/ui/dropdown";
import { FormPicker } from "../../components/ui/form-picker";
import { noAutofill } from "../../components/ui/input";
import { toastError } from "../../components/ui/toast";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { FOLDER_ICON } from "../../components/ui/group-list";
import { CHECK_ICON, SEARCH_ICON } from "../../components/ui/icons";
import { ICON_SIZE } from "../../lib/icon-scale";

/** Shared style for pill trigger buttons (ChatGPT project button style: small rounded pill + icon + short name + collapse arrow). */
export const pillClass =
  "flex max-w-64 items-center gap-1.5 rounded-full border border-gray-300 bg-white py-1 pl-1.5 pr-2 " +
  "text-xs text-gray-600 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-900 " +
  "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100";

/**
 * Workspace selection (pill dropdown): the button shows the selected directory name (empty =
 * a temporary workspace). The menu browses server-side directories: **the current path can be
 * edited directly** at the top (Enter/blur commits it, an invalid directory toasts and reverts
 * to the previous path), the list omits hidden directories, and the hint text sits at the bottom
 * of the menu; only loads on first expand. On narrow screens the menu docks to whichever side
 * of the pill keeps it inside the viewport (measured on open — see menuDock).
 */
export function WorkspaceSelect({
  projectId,
  workspace,
  onChange,
  variant = "pill",
  trigger,
  fieldLabel,
  emptyLabel,
  menuHint,
  clearLabel,
  recent,
}: {
  projectId: string;
  workspace: string;
  onChange: (path: string) => void;
  /** Trigger style: the draft page's pill (default), or a dialog form control (see the header comment). */
  variant?: "pill" | "form";
  /**
   * Caller-rendered trigger (the sidebar's workspace create button): replaces the pill and
   * switches the panel to the shared body portal — the sidebar's scroller would clip an in-flow
   * panel. The same browse menu, byte for byte.
   */
  trigger?: (open: boolean, toggle: () => void) => ReactNode;
  /**
   * Copy overrides for a host that browses for a directory which is not going to be a Workspace —
   * the Agent create dialog picks one to read Skills out of, where "temporary workspace" would
   * describe something this field does not do. `fieldLabel` names the field itself: it is the
   * accessible name of both triggers and of the path input, and the label the tooltip puts in
   * front of the picked path, so a host that overrides the visible copy is not left announcing
   * itself as "Workspace".
   */
  fieldLabel?: string;
  emptyLabel?: string;
  menuHint?: string;
  /** Copy for the "back to a temporary workspace" link, which for a non-Workspace host just clears the field. */
  clearLabel?: string;
  /**
   * Already-known Workspaces offered at the top of the menu as a one-click list, before the
   * user starts browsing. The sidebar passes its registry; the chat composer passes none, since
   * it only knows the one Workspace its draft uses — showing a single entry there would be a
   * list of one wearing a heading.
   *
   * Paths, already normalized by the registry. A path that no longer exists on disk is still
   * listed: selecting it navigates the browser there and surfaces the server's own error, which
   * is a better answer than silently dropping a Workspace the user registered.
   */
  recent?: readonly string[];
}) {
  const fieldName = fieldLabel ?? S.chat.workspace;
  const [open, setOpen] = useState(false);
  /**
   * Menu docking, measured on each open: the pill follows the agent pill in a wrapping row, so
   * its left offset varies with the agent's name — a statically left-anchored 20rem panel can
   * cross the viewport's right edge on phones (measured ~143px past a 390px viewport). Keep the
   * desktop left anchoring whenever the panel fits; otherwise dock to whichever side of the
   * pill has more room, capping the width to that room via menuStyle. On desktop the panel
   * always fits, so nothing changes there.
   */
  const [menuDock, setMenuDock] = useState<{ right: boolean; maxWidth?: number }>({
    right: false,
  });
  const browsedRef = useRef(false);

  const [dir, setDir] = useState<DirListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Edit draft for the path row: synced with the browsing position, reverts on a failed commit. */
  const [pathDraft, setPathDraft] = useState("");
  /** Search text over the directory list. See `matchesFilter` for what it matches against. */
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setPathDraft(dir?.path ?? "");
  }, [dir]);

  /**
   * Monotonic id of the newest loadDir request. Only the newest request may publish its
   * result: navigations race (rows stay visible while a fetch is in flight, and the path row
   * accepts commits at any time), and without the guard a slow older response would overwrite
   * a newer one — silently relocating the browsing position — or clear `loading` while the
   * newer request is still in flight.
   */
  const loadSeq = useRef(0);

  /**
   * Browses level by level (clicking a directory/parent); an empty string means the server's
   * home directory (the default starting point). `onError` overrides the default error-row
   * handling (the path-edit commit toasts and reverts instead); it only ever fires for the
   * newest request, like every other outcome.
   */
  const loadDir = useCallback(
    (abs: string, opts?: { onError?: () => void }) => {
      const seq = ++loadSeq.current;
      setLoading(true);
      setError(null);
      api
        .listDirs(projectId, abs)
        .then((res) => {
          if (seq === loadSeq.current) setDir(res);
        })
        .catch((e: unknown) => {
          if (seq !== loadSeq.current) return;
          if (opts?.onError) opts.onError();
          else setError(apiErrorText(e));
        })
        .finally(() => {
          if (seq === loadSeq.current) setLoading(false);
        });
    },
    [projectId],
  );

  // Only loads on first expand: an already-filled absolute path is used as the starting point, otherwise the server falls back to the home directory.
  const loadOnFirstOpen = (next: boolean) => {
    if (next) {
      // 搜索词每次打开都清空：菜单是一次性的选择过程，上一次的筛选留在里面会让新一次
      // 打开时列表莫名其妙是空的（"为什么搜不到"），而用户并没有在搜任何东西。
      setFilter("");
      if (!browsedRef.current) {
        browsedRef.current = true;
        const ws = workspace.trim();
        loadDir(ws.startsWith("/") ? ws : "");
      }
    }
  };

  /** Form-variant open handler (FormPicker owns the trigger): portaled, so no dock measurement — just open + lazy load. */
  const setFormOpen = (next: boolean) => {
    setOpen(next);
    loadOnFirstOpen(next);
  };

  /** Pill-variant trigger: measures viewport room to dock the in-flow panel left/right before opening. */
  const toggle = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const next = !open;
    if (next) {
      const r = e.currentTarget.getBoundingClientRect();
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const margin = 12; // breathing room against the viewport edge
      // The panel's effective width: w-80 capped by its max-w-[calc(100vw-2rem)] class
      // (rem-derived — the root font size is not 16px here).
      const width = Math.min(20 * rem, window.innerWidth - 2 * rem);
      const roomRight = window.innerWidth - margin - r.left; // room for a left-anchored panel
      const roomLeft = r.right - margin; // room for a right-anchored panel
      if (roomRight >= width) setMenuDock({ right: false });
      else if (roomLeft > roomRight)
        setMenuDock({ right: true, ...(roomLeft < width ? { maxWidth: roomLeft } : {}) });
      else setMenuDock({ right: false, maxWidth: roomRight });
    }
    setOpen(next);
    loadOnFirstOpen(next);
  };

  /**
   * Commits the edited path: navigates to it if it exists, otherwise toasts and reverts to
   * the current browsing position. Routed through loadDir so the commit shows the loading
   * row and participates in the same request sequencing as row clicks — a raw listDirs here
   * used to race them and could land after (and clobber) a newer navigation.
   */
  const commitPathEdit = () => {
    const p = pathDraft.trim();
    if (!p || p === dir?.path) {
      setPathDraft(dir?.path ?? "");
      return;
    }
    loadDir(p, {
      onError: () => {
        toastError(S.chat.workspaceDirInvalid);
        setPathDraft(dir?.path ?? "");
      },
    });
  };

  const trimmed = workspace.trim();
  // Pill short name: the last segment of the directory name (root gives "/"); shows "temporary workspace" when empty.
  const label = trimmed
    ? (trimmed.split("/").filter(Boolean).pop() ?? "/")
    : (emptyLabel ?? S.chat.workspaceAuto);

  /**
   * The desktop shell's native folder chooser, or null in a plain browser.
   *
   * A browser cannot ask the OS for a directory: `listDirs` resolves paths on the SERVER, so
   * a web-only deployment has no way to name a folder on the user's own disk — the entry is
   * hidden there rather than shown as a control that cannot work.
   */
  const pickLocal = window.workspace?.pickFolder ?? null;

  /**
   * 打开本地文件夹: ask the OS for a directory and use it.
   *
   * The returned path goes through `onChange` like any other choice, so a host registers it in
   * its own way (the sidebar adds it to the Workspace registry). It is NOT verified here: the
   * picker returns a directory the OS says exists, and the host's own flow reports a problem
   * with one it cannot use.
   */
  const openLocalFolder = async () => {
    if (!pickLocal) return;
    let picked: string | null;
    try {
      picked = await pickLocal();
    } catch {
      // The dialog failed to open (no window to parent it to, say). Nothing was chosen, so
      // this reads the same as a cancel; the menu stays open with everything still selectable.
      picked = null;
    }
    // A cancel leaves `picked` null and must not touch the current selection or close the menu.
    if (picked === null) return;
    onChange(picked);
    setOpen(false);
  };
  const parentPath = dir?.parent ?? null;
  // Hidden directories (starting with .) are excluded from the list.
  const allEntries = (dir?.entries ?? []).filter((e) => !e.name.startsWith("."));
  /**
   * The directory list under the search box.
   *
   * Filtering happens on the CURRENT level only — the search box narrows what is on screen,
   * it does not become a recursive filesystem search. A recursive one would have to guess
   * whether a match is a directory or a file (the listing carries no such flag), so it would
   * have to walk the whole tree on every keystroke to answer a question the user did not ask.
   * The path row above already offers "type the exact path" for anything off this level.
   *
   * Matching is case-insensitive and hits the directory NAME, not the absolute path: the level
   * being shown is already fixed, so the path prefix is identical on every row and matching it
   * would only make the needle longer to type.
   */
  const needle = filter.trim().toLowerCase();
  const entries = needle
    ? allEntries.filter((e) => e.name.toLowerCase().includes(needle))
    : allEntries;
  /** Folder glyph shared by both triggers. */
  const folderIcon = (extraClass: string) => (
    <GlyphIcon d={FOLDER_ICON} size={ICON_SIZE.rowLead} className={`text-gray-400 ${extraClass}`} />
  );
  const menu = (
    <div className="space-y-1.5 px-2.5 pb-2.5 pt-2">
      {/* 搜索框：过滤下面这一层的目录。它在路径输入之上而不是之下，因为「找」和「直接写
          完整路径」是两种不同的找法，先看到能搜的那一个。放在最上面也和常见的选择器一致，
          用户不需要先往下滚才知道可以搜。 */}
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
        >
          <GlyphIcon d={SEARCH_ICON} size={ICON_SIZE.rowLead} />
        </span>
        <input
          value={filter}
          placeholder={S.chat.workspaceSearch}
          aria-label={S.chat.workspaceSearch}
          {...noAutofill}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-7 pr-2 text-xs text-gray-700 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:placeholder:text-gray-500 dark:focus:border-gray-600"
        />
      </div>
      {/* 近期使用：已注册的工作区一键选中，省去重新一层层翻目录。搜索有输入时隐藏——那时
          用户在找当前层的东西，混进一个跨层的列表只会让筛选结果对不上他输入的字。 */}
      {needle === "" && recent !== undefined && recent.length > 0 && (
        <div>
          <p className="px-1 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {S.chat.workspaceRecent}
          </p>
          <ul className="max-h-32 overflow-y-auto">
            {recent.map((path) => {
              const name = path.split("/").filter(Boolean).pop() ?? "/";
              return (
                <li key={path}>
                  <button
                    type="button"
                    // 选一个已注册的工作区就是选中它（并按宿主的规则登记）；它可能已经在用，
                    // 所以照样给 aria-pressed 而不是 disabled——再点一次应当什么都不发生，
                    // 而不是变成一个点不动的灰行。
                    aria-pressed={path === trimmed}
                    onClick={() => {
                      onChange(path);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors duration-150 ${
                      path === trimmed
                        ? "bg-gray-200/70 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                        : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    }`}
                  >
                    {folderIcon("")}
                    <span className="min-w-0 flex-1 truncate" title={path}>
                      {name}
                    </span>
                    {path === trimmed && (
                      <span aria-hidden className="shrink-0 text-gray-500 dark:text-gray-400">
                        <GlyphIcon d={CHECK_ICON} size={ICON_SIZE.rowLead} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="rounded-md border border-gray-200 dark:border-gray-800">
        {/* Current path (editable: Enter/blur commits, Escape discards) + "Use this directory" (closes the menu once selected) */}
        <div className="flex items-center gap-1.5 border-b border-gray-100 px-1.5 py-1 dark:border-gray-800">
          <input
            value={pathDraft}
            placeholder="…"
            aria-label={fieldName}
            {...noAutofill}
            onChange={(e) => setPathDraft(e.target.value)}
            onBlur={commitPathEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commitPathEdit();
              } else if (e.key === "Escape") {
                // Discard the edit: only reverts the draft; Escape bubbles up to Dropdown, which closes the menu.
                setPathDraft(dir?.path ?? "");
              }
            }}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs text-gray-600 focus:border-gray-300 focus:outline-none dark:text-gray-300 dark:focus:border-gray-600"
          />
          <button
            type="button"
            disabled={!dir}
            onClick={() => {
              if (!dir) return;
              onChange(dir.path);
              setOpen(false);
            }}
            className="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-700 transition-colors duration-150 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {S.chat.workspaceUseThis}
          </button>
        </div>
        {/* Directory list (excludes hidden directories) */}
        <ul className="max-h-40 overflow-y-auto py-1">
          {/* Rows are disabled while a load is in flight: they still show the PREVIOUS
                directory until the response lands, so clicks during the window would resend
                stale targets (N clicks on "parent" all resending the same dir.parent). */}
          {parentPath !== null && (
            <li>
              <button
                type="button"
                disabled={loading}
                onClick={() => loadDir(parentPath)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                ↰ {S.chat.workspaceUp}
              </button>
            </li>
          )}
          {entries.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                disabled={loading}
                onClick={() => loadDir(entry.path)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs text-gray-700 transition-colors duration-150 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <GlyphIcon d={FOLDER_ICON} className="text-gray-400" />
                <span className="min-w-0 flex-1 truncate" title={entry.name}>
                  {entry.name}
                </span>
              </button>
            </li>
          ))}
          {dir && entries.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-gray-400">
              {/* 有搜索词时的「空」和没搜索词时的「空」不是一回事：前者是"这个筛选没匹配
                  到"，后者是"这一层确实没有子目录"。混用同一句话会让用户以为自己看错了
                  目录，实际上只是打错了一个字。 */}
              {needle !== "" ? S.chat.workspaceSearchEmpty : S.chat.workspaceNoSubdirs}
            </li>
          )}
          {loading && <li className="px-2.5 py-1.5 text-xs text-gray-400">{S.common.loading}</li>}
          {/* Load failure (e.g. the cached starting directory was deleted): provide "retry" to fall back to the home directory, avoiding getting stuck in an error state. */}
          {error && (
            <li className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-red-500">
              <span className="min-w-0 flex-1 truncate" title={error}>
                {error}
              </span>
              <button
                type="button"
                disabled={loading}
                onClick={() => loadDir("")}
                className="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-700 transition-colors duration-150 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {S.common.retry}
              </button>
            </li>
          )}
        </ul>
      </div>
      {/* 打开本地文件夹：桌面端用操作系统自己的目录选择框，浏览器里没有这个能力——此时
          整块不渲染，而不是渲染一个灰掉的按钮。一个点不动的控件在菜单里看起来像是坏了，
          而"看不见"传达的是"这里没有这件事"，那才是真的。 */}
      {pickLocal !== null && (
        <button
          type="button"
          onClick={() => void openLocalFolder()}
          title={S.chat.workspaceOpenLocalHint}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-gray-700 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {folderIcon("")}
          <span className="min-w-0 flex-1 truncate">{S.chat.workspaceOpenLocal}</span>
        </button>
      )}
      {/* When a directory has been specified, offer a one-click way back to a temporary workspace */}
      {trimmed && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
          className="text-xs text-gray-500 underline decoration-gray-300 underline-offset-2 transition-colors duration-150 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {clearLabel ?? S.chat.workspaceClear}
        </button>
      )}
      {/* Hint text (bottom of the menu) */}
      <p className="px-0.5 text-xs leading-5 text-gray-400 dark:text-gray-500">
        {menuHint ?? S.chat.workspaceHint}
      </p>
    </div>
  );

  // Custom trigger (sidebar header): portaled panel, right-aligned under the trigger —
  // placement and flipping are the portal's job, so no dock measurement here. w-64
  // (the Dropdown default menu width): the pill/form variants' w-80 overhung the
  // sidebar; long entry names truncate with their full text in the row tooltip.
  if (trigger) {
    return (
      <Dropdown
        open={open}
        setOpen={setFormOpen}
        portal={{ direction: "down", align: "right" }}
        menuClass="w-64"
        button={trigger(open, () => setFormOpen(!open))}
      >
        {menu}
      </Dropdown>
    );
  }

  // Form: the shared full-width trigger (its label goes mono once a real path is set).
  if (variant === "form") {
    return (
      <FormPicker
        open={open}
        setOpen={setFormOpen}
        leading={folderIcon("")}
        label={label}
        {...(trimmed ? { labelClassName: "font-mono" } : {})}
        title={trimmed ? `${fieldName}：${trimmed}` : (menuHint ?? S.chat.workspaceHint)}
        ariaLabel={fieldName}
        ariaHaspopup="dialog"
        menuClass="w-80"
      >
        {menu}
      </FormPicker>
    );
  }

  // Pill: the composer's compact toolbar trigger, with the in-flow panel docked left/right by `toggle`'s measurement.
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass={`top-full mt-1 w-80 max-w-[calc(100vw-2rem)] ${
        menuDock.right ? "right-0 origin-top-right" : "left-0 origin-top-left"
      }`}
      {...(menuDock.maxWidth !== undefined ? { menuStyle: { maxWidth: menuDock.maxWidth } } : {})}
      button={
        <button
          type="button"
          title={trimmed ? `${fieldName}：${trimmed}` : (menuHint ?? S.chat.workspaceHint)}
          aria-label={fieldName}
          onClick={toggle}
          className={pillClass}
        >
          {folderIcon("ml-0.5")}
          <span className={`min-w-0 truncate ${trimmed ? "font-mono" : ""}`}>{label}</span>
          <Chevron open={open} size={12} className="shrink-0 text-gray-400" />
        </button>
      }
    >
      {menu}
    </Dropdown>
  );
}
