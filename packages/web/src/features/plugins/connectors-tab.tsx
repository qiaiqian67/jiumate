/**
 * Connectors tab of the plugin/skills page: the Project's MCP server registry.
 *
 * The registry is the one place an MCP server is defined; an agent's Tools tab picks from
 * it. This tab is the editing surface for that list, so it is the only place with add /
 * edit / delete — everywhere else is a picker.
 *
 * The table, the add/edit modal, the delete confirmation and both connectivity probes are
 * the same ones the agent's Tools tab uses (`McpServersSection`); only the storage target
 * differs. Writing is owner-only (the server enforces it), so a member sees the same table
 * read-only rather than buttons that would 403.
 *
 * **Layout matches the skills page on purpose.** The registry is a *configured* list — every
 * entry in it is connected by definition — so where the skills page offers a marketplace and
 * reaches the inventory through a count, this tab is the inventory itself: the count sits in
 * the same slot as the skills one, and "add" sits beside it in the same button, so the two pages
 * are read the same way instead of asking the eye to switch conventions between tabs.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MCPServerConfig } from "@prismshadow/jiumate-core/interfaces";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useProject } from "../../state/project";
import { McpServersSection, mcpSearchText } from "../agents/mcp-servers-section";
import type { McpSectionTarget } from "../agents/mcp-servers-section";
import { Skeleton } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/ui/empty-state";
import { OriginFilterTabs } from "./extension-ui";
import { filtersFor, type ExtensionFilter } from "./extension-model";

export function ConnectorsTab({
  query,
  originFilter,
  setOriginFilter,
  addNonce = 0,
}: {
  /**
   * The page's search text, passed in rather than held here. The one search box lives in the top
   * toolbar; owning a second copy meant typing in one silently did nothing to the list the other
   * one controlled.
   */
  query: string;
  originFilter: ExtensionFilter;
  setOriginFilter: (next: ExtensionFilter) => void;
  /**
   * Incremented by the page's add button, forwarded to the section to open its add form.
   *
   * **The section owns the dialog**, because it owns the registry that dialog writes. This tab has
   * no form of its own, and a second one would give two places that could disagree about what a
   * valid server is — the validation being the interesting part of that form, not an afterthought.
   *
   * Forwarded, not handled here: this prop used to arrive and be dropped, which left the page's
   * button doing nothing while the section drew its own. That is the state this replaced.
   */
  addNonce?: number;
}) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";

  const [servers, setServers] = useState<MCPServerConfig[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setServers(null);
    setError(null);
    api
      .getMcpServers(projectId)
      .then((list) => {
        if (!cancelled) setServers(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Filtered here rather than inside McpServersSection so the count in the header and the cards
  // on screen are always the same number — a count describing an unfiltered list while the list
  // below it is filtered is the "19 against 11" confusion in a smaller dress.
  const matches = useCallback(
    (entry: MCPServerConfig) => mcpSearchText(entry).includes(query.trim().toLowerCase()),
    [query],
  );
  const visibleCount = useMemo(() => {
    if (servers === null) return null;
    return query.trim() === "" ? servers.length : servers.filter(matches).length;
  }, [servers, query, matches]);

  /**
   * Origin counts. Every registry entry is **user-added**: the registry is a Project config file,
   * not product content, so there is no built-in connector to count. The built-in tab is still
   * rendered, at zero — a tab that is hidden reads as "not applicable", whereas a tab showing 0
   * states the fact ("there are none") and is the honest answer to "how do I tell them apart?".
   */
  const originCounts = useMemo(() => {
    const n = visibleCount ?? 0;
    return { all: n, builtin: 0, user: n, bundled: 0 };
  }, [visibleCount]);

  if (!projectId) return null;
  if (error !== null) return <EmptyState title={error} />;

  const target: McpSectionTarget = {
    save: (next) => api.putMcpServers(projectId, next),
    test: (entry) => api.testMcpRegistryServer(projectId, entry),
    savedMessage: S.plugins.connectorsSavedToast,
    readOnly: !isOwner,
    layout: "cards",
  };

  return (
    <div>
      {/* The page's top bar already carries the one search box (it is bound to the same `query`),
          so this row holds only what is specific to this tab: the count and the origin filter. A
          second search box here was rendering a third identical 「搜索技能」 field on the same
          screen — one control, one job, one place. */}
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
        {visibleCount !== null && (
          <span className="shrink-0 whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
            {S.plugins.connectorsCount(visibleCount)}
          </span>
        )}
        {/* Origin tabs, same control as the other two tabs. A connector in the registry is
            user-added by definition — it is a Project config file, not product content — so the
            「系统内置」 tab is shown with its count rather than hidden, which is what makes the
            absence meaningful instead of merely unlisted. */}
        <OriginFilterTabs
          value={originFilter}
          onChange={setOriginFilter}
          filters={filtersFor(false)}
          counts={originCounts}
        />
      </div>
      <div className="mt-4">
        {servers === null ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              {isOwner ? S.plugins.connectorsDesc : S.plugins.connectorsReadOnly}
            </p>
            <McpServersSection
              initial={servers}
              target={target}
              filter={matches}
              // The page toolbar owns the add button here (see `addNonce`), so this surface must not
              // draw a second one — two entries to one dialog under two different names.
              hideAddButton
              addNonce={addNonce}
            />
          </>
        )}
      </div>
    </div>
  );
}
