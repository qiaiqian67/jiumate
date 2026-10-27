/**
 * 「近期使用」的工作区排序：从会话里推出最近被用过的工作区，最近的在前。
 *
 * ## 为什么不能用注册顺序
 *
 * 注册表（lib/workspace-registry.ts）记的是"手动添加过哪些工作区"，它的顺序是**添加
 * 顺序**。而"近期使用"问的是另一个问题——**最近在里面聊过天的是哪几个**。这两个顺序几乎
 * 总是不一样：一个人先建了 A 后建了 B，之后一直在 A 里工作，注册顺序会把 B 排在前面。
 *
 * ## 数据来源与它的边界
 *
 * 唯一可靠的"用过"证据是会话的 `createdAt`：一个工作区最近有会话，就是最近在用它。会话
 * 列表是分页懒加载的，所以这个列表只反映**已经加载过的那几页**——这是有意的：为了一个
 * 下拉菜单去拉全部历史，会在每次打开菜单时打一串请求，而绝大多数工作区在头几页里就已经
 * 露出来了。想要完整的排序，用户应该按工作区分组看侧边栏（那里本来就是这个顺序）。
 *
 * 没有会话的工作区（比如刚建好还没聊过）因此不会出现。它们由注册表兜底补在后面，并按添加
 * 顺序排——"没用过但存在"总比"存在但看不见"好。
 *
 * 临时工作区不在列表里：它不是一个目录，而是"没选目录"的状态，选它等于什么都不选。
 */
import { isTempWorkspace } from "./session-grouping";

/** The slice of a Session this module reads. */
export interface WorkspaceUse {
  workspace: string;
  /** ISO-8601 UTC (server: `new Date().toISOString()`), so plain string comparison is chronological. */
  createdAt: string;
}

/** How many entries the menu shows. Six covers "recent" without turning the list into a directory. */
export const RECENT_WORKSPACE_LIMIT = 6;

/**
 * The Workspaces to offer as "recently used", most recent first.
 *
 * `registered` is appended after the used ones (in its own order) so a freshly created
 * Workspace is reachable before its first conversation exists. Duplicates are collapsed: a
 * Workspace both used and registered appears once, at the position its latest Session earned
 * it — that is strictly better than either source alone.
 */
export function recentWorkspaces(
  sessions: readonly WorkspaceUse[],
  registered: readonly string[],
  limit = RECENT_WORKSPACE_LIMIT,
): string[] {
  // Newest Session per Workspace wins. `>` on ISO strings is a chronological comparison, and
  // ties are impossible in practice; a tie would keep the first seen, which is fine.
  const newest = new Map<string, string>();
  for (const s of sessions) {
    const path = s.workspace.trim();
    // A temp-shaped workspace is a state, not a directory: offering it here would mean
    // "choose nothing", which the empty trigger already means.
    if (path === "" || isTempWorkspace(path)) continue;
    const best = newest.get(path);
    if (best === undefined || s.createdAt > best) newest.set(path, s.createdAt);
  }

  // Secondary key on the path, so equal timestamps cannot reorder between renders: `Map`
  // preserves insertion order, which follows the order Sessions arrived in, and that order
  // changes with pagination. Without this, two Workspaces created in the same minute swap
  // places when the list refetches.
  const used = [...newest.entries()]
    .sort((a, b) => {
      if (a[1] !== b[1]) return b[1] < a[1] ? -1 : 1;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .map(([path]) => path);

  const out = used.slice(0, limit);
  if (out.length < limit) {
    const seen = new Set(out);
    for (const path of registered) {
      if (out.length >= limit) break;
      const trimmed = path.trim();
      if (trimmed === "" || isTempWorkspace(trimmed) || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}
