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
 */
import { useEffect, useState } from "react";
import type { MCPServerConfig } from "@prismshadow/jiumate-core/interfaces";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useProject } from "../../state/project";
import { McpServersSection } from "../agents/mcp-servers-section";
import type { McpSectionTarget } from "../agents/mcp-servers-section";
import { Skeleton } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/ui/empty-state";

export function ConnectorsTab() {
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

  if (!projectId) return null;
  if (error !== null) return <EmptyState title={error} />;
  if (servers === null) return <Skeleton className="h-40 w-full" />;

  const target: McpSectionTarget = {
    save: (next) => api.putMcpServers(projectId, next),
    test: (entry) => api.testMcpRegistryServer(projectId, entry),
    savedMessage: S.plugins.connectorsSavedToast,
    readOnly: !isOwner,
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {isOwner ? S.plugins.connectorsDesc : S.plugins.connectorsReadOnly}
      </p>
      <McpServersSection initial={servers} target={target} />
    </div>
  );
}
