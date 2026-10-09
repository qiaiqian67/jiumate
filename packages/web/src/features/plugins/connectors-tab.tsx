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
import { Input } from "../../components/ui/input";

export function ConnectorsTab() {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";

  const [servers, setServers] = useState<MCPServerConfig[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Narrows the cards by name and connection target — the registry is a flat list, so this is the only narrowing there is. */
  const [query, setQuery] = useState("");

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
      {/* The skills page's toolbar: search on the left of the pair, the count beside it, and the
          add button last — the same order and the same components, so switching tabs does not
          move anything. */}
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
        <div className="w-40 sm:w-56">
          <Input
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={S.plugins.searchConnectorsPlaceholder}
            aria-label={S.plugins.searchConnectorsLabel}
          />
        </div>
        {visibleCount !== null && (
          <span className="shrink-0 whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
            {S.plugins.connectorsCount(visibleCount)}
          </span>
        )}
        {/* Add lives in the section below, which owns the modal; a duplicate here would open the
            same dialog twice with no way to tell which button did it. */}
      </div>
      <div className="mt-4">
        {servers === null ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              {isOwner ? S.plugins.connectorsDesc : S.plugins.connectorsReadOnly}
            </p>
            <McpServersSection initial={servers} target={target} filter={matches} />
          </>
        )}
      </div>
    </div>
  );
}
