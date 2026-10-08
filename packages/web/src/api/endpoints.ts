/**
 * API endpoint wrappers: one function per API.
 * DTO types come from @prismshadow/jiumate-server/api (**type import only**, resolved via
 * tsconfig paths to the server contract file types.ts; must not be a value import — server
 * code must not enter the browser bundle).
 */
import type { MCPServerConfig } from "@prismshadow/jiumate-core/interfaces";
import type {
  AdminPasswordResetRequest,
  AdminUserCreateRequest,
  AdminUserCreateResponse,
  AdminUsersResponse,
  AgentConfigResponse,
  AgentConfigUpdateRequest,
  AgentCreateRequest,
  AgentCreateResponse,
  AgentImportRequest,
  AgentImportResponse,
  AgentKernelUpdateResponse,
  AgentSchedulesConfigDto,
  AgentSkillsConfigDto,
  AgentHooksResponse,
  AgentPluginsInstallResponse,
  AgentSkillsResponse,
  AgentVaultConfigDto,
  AgentsResponse,
  ApprovalDecisionRequest,
  AuthLoginRequest,
  AuthResponse,
  BenchmarkCasesResponse,
  BenchmarksResponse,
  CaseMaterial,
  ChatDefaultsDto,
  CommandPolicyDto,
  CommandPolicyRuleDto,
  DefaultModelResponse,
  DefaultModelUpdateRequest,
  DirectorySkillsResponse,
  DirListResponse,
  EndpointModelListRequest,
  EndpointModelListResponse,
  FeishuBindingPutRequest,
  FeishuBindingResponse,
  FeishuTestRequest,
  FeishuTestResponse,
  FilesStatRequest,
  FilesStatResponse,
  GoalResponse,
  InstallResponse,
  McpServerTestResponse,
  MeResponse,
  MemberAddRequest,
  MemberAddResponse,
  MembersResponse,
  MemoryFileResponse,
  MemoryFilesResponse,
  MemoryImportRequest,
  MemoryImportResponse,
  MemoryOverviewResponse,
  MemoryScopeExport,
  MessagesResponse,
  MessagingBindingsResponse,
  MessagingChannel,
  MessagingTestMessageResponse,
  ModelOAuthCodeResponse,
  ModelOAuthStartRequest,
  ModelOAuthStartResponse,
  ModelOAuthStatusResponse,
  ModelProtocolDetectRequest,
  ModelProtocolDetectResponse,
  MachinesResponse,
  ModelsResponse,
  ModelsUpdateRequest,
  ModelTestRequest,
  ModelTestResponse,
  ModelVisionDetectRequest,
  ModelVisionDetectResponse,
  PasswordChangeRequest,
  PrefsResponse,
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectUpdateRequest,
  ProjectUpdateResponse,
  ProjectsResponse,
  ScheduleItem,
  SchedulesResponse,
  ScheduleUpsertRequest,
  ServerSettingsResponse,
  ServerSettingsUpdateRequest,
  SessionCategory,
  SessionContextResponse,
  SessionCreateRequest,
  SessionCreateResponse,
  SessionForkRequest,
  SessionForkResponse,
  SessionPatchRequest,
  SessionResponse,
  SessionProcessesResponse,
  SessionsResponse,
  SessionTracesResponse,
  SkillArchiveInstallRequest,
  SkillCatalogResponse,
  InstalledSkillsResponse,
  PluginFilesResponse,
  PluginInstallRequest,
  PluginLibraryResponse,
  QQBindingPutRequest,
  QQBindingResponse,
  QQScanPollResponse,
  QQScanStartResponse,
  QQTestRequest,
  QQTestResponse,
  WeChatBindingPutRequest,
  WeChatBindingResponse,
  WeChatScanPollResponse,
  WeChatScanStartResponse,
  WeChatTestResponse,
  RecalledMessageResponse,
  RetryNowResponse,
  SteerRequest,
  SubagentMessageResponse,
  TaskCreateRequest,
  TaskCreateResponse,
  TelegramBindingPutRequest,
  TelegramBindingResponse,
  TelegramTestRequest,
  TelegramTestResponse,
  TraceAnalysisResponse,
  TraceEventsResponse,
  TraceImportRequest,
  TraceImportResponse,
  UiPrefs,
  UpdateCheckResponse,
  UpdateJobStatus,
  RestartResponse,
  ServerCapabilities,
  ServerExportFormat,
  DesktopUpdateStatusResponse,
  UsageErrorKind,
  UsageErrorsClearResponse,
  UsageErrorsPage,
  UsageGranularity,
  UsageGroupBy,
  UsageModelTotals,
  UsageResponse,
  VaultResponse,
  VaultUpdateRequest,
  VersionResponse,
  WorkspaceFilesResponse,
} from "@prismshadow/jiumate-server/api";
import type { DocumentPreview } from "@prismshadow/jiumate-core/documents";
import { apiFetch, apiFetchWithMeta, postBinary } from "./client";
// Auth & user -----------------------------------------------------------------

export const login = (body: AuthLoginRequest) =>
  apiFetch<AuthResponse>("/api/auth/login", { method: "POST", body });

export const logout = () => apiFetch<void>("/api/auth/logout", { method: "POST", body: {} });

/**
 * The data root's install identity (public — no session needed, which is the point: the web
 * app asks before it knows whether anyone is signed in). See lib/install-scope.ts.
 */
export const getInstall = () => apiFetch<InstallResponse>("/api/install");

export const getMe = () => apiFetch<MeResponse>("/api/me");

export const changePassword = (body: PasswordChangeRequest) =>
  apiFetch<void>("/api/me/password", { method: "PUT", body });

export const getPrefs = () => apiFetch<PrefsResponse>("/api/me/prefs");

export const putPrefs = (prefs: UiPrefs) =>
  apiFetch<PrefsResponse>("/api/me/prefs", { method: "PUT", body: prefs });

// Admin user management (admin only) -----------------------------------------------------

export const adminListUsers = () => apiFetch<AdminUsersResponse>("/api/admin/users");

export const adminCreateUser = (body: AdminUserCreateRequest) =>
  apiFetch<AdminUserCreateResponse>("/api/admin/users", { method: "POST", body });

export const adminResetPassword = (userId: string, body: AdminPasswordResetRequest) =>
  apiFetch<void>(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
    method: "POST",
    body,
  });

export const adminDeleteUser = (userId: string) =>
  apiFetch<void>(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });

/** Server-global settings (admin only): currently the "use system HTTP proxy" switch. */
export const adminGetSettings = () => apiFetch<ServerSettingsResponse>("/api/admin/settings");

/** Omitted fields keep their current value; applies immediately (no restart). */
export const adminPutSettings = (body: ServerSettingsUpdateRequest) =>
  apiFetch<ServerSettingsResponse>("/api/admin/settings", { method: "PUT", body });

// Project & members --------------------------------------------------------------

export const listProjects = () => apiFetch<ProjectsResponse>("/api/projects");

export const createProject = (body: ProjectCreateRequest) =>
  apiFetch<ProjectCreateResponse>("/api/projects", { method: "POST", body });

/** Rename a Project's display name (owner); the id is immutable. */
export const updateProject = (projectId: string, body: ProjectUpdateRequest) =>
  apiFetch<ProjectUpdateResponse>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body,
  });

export const deleteProject = (projectId: string) =>
  apiFetch<void>(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });

export const listMembers = (projectId: string) =>
  apiFetch<MembersResponse>(`/api/projects/${encodeURIComponent(projectId)}/members`);

export const addMember = (projectId: string, body: MemberAddRequest) =>
  apiFetch<MemberAddResponse>(`/api/projects/${encodeURIComponent(projectId)}/members`, {
    method: "POST",
    body,
  });

export const removeMember = (projectId: string, username: string) =>
  apiFetch<void>(
    `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );

/** New-chat defaults ([default_chat]): member-readable prefill for the draft page. */
export const getChatDefaults = (projectId: string) =>
  apiFetch<ChatDefaultsDto>(`/api/projects/${encodeURIComponent(projectId)}/chat-defaults`);

/** Whole-block replace (owner): an omitted key clears it; returns the stored block. */
export const putChatDefaults = (projectId: string, body: ChatDefaultsDto) =>
  apiFetch<ChatDefaultsDto>(`/api/projects/${encodeURIComponent(projectId)}/chat-defaults`, {
    method: "PUT",
    body,
  });

/** Sandbox command policy ([command_policy]): member-readable; carries the factory set for "restore defaults". */
export const getCommandPolicy = (projectId: string) =>
  apiFetch<CommandPolicyDto>(`/api/projects/${encodeURIComponent(projectId)}/command-policy`);

/**
 * Project MCP registry (`[[mcp_servers]]`): the centrally managed server list that each
 * Agent's `tools.mcpServers` selects from. Member-readable — an Agent's picker shows it too.
 */
export const getMcpServers = (projectId: string) =>
  apiFetch<MCPServerConfig[]>(`/api/projects/${encodeURIComponent(projectId)}/mcp-servers`);

/** Whole-registry replace (owner): the full list is required and gets materialized into the config. */
export const putMcpServers = (projectId: string, servers: MCPServerConfig[]) =>
  apiFetch<MCPServerConfig[]>(`/api/projects/${encodeURIComponent(projectId)}/mcp-servers`, {
    method: "PUT",
    body: { mcp_servers: servers },
  });

/** Probe one registry entry's reachability before saving it (nothing is persisted). */
export const testMcpRegistryServer = (projectId: string, server: MCPServerConfig) =>
  apiFetch<McpServerTestResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/mcp-servers/test`,
    { method: "POST", body: { name: server.name, config: server.config } },
  );

/** Whole-block replace (owner): the full rule list is required and gets materialized into the config. */
export const putCommandPolicy = (
  projectId: string,
  body: { enabled: boolean; rules: CommandPolicyRuleDto[] },
) =>
  apiFetch<CommandPolicyDto>(`/api/projects/${encodeURIComponent(projectId)}/command-policy`, {
    method: "PUT",
    body,
  });

// Model configuration -------------------------------------------------------------------

export const getModels = (projectId: string) =>
  apiFetch<ModelsResponse>(`/api/projects/${encodeURIComponent(projectId)}/models`);

export const putModels = (projectId: string, body: ModelsUpdateRequest) =>
  apiFetch<ModelsResponse>(`/api/projects/${encodeURIComponent(projectId)}/models`, {
    method: "PUT",
    body,
  });

/** Narrow default-model switch (owner): flips the same default_model the models page maintains, without resending the table. */
export const putDefaultModel = (projectId: string, body: DefaultModelUpdateRequest) =>
  apiFetch<DefaultModelResponse>(`/api/projects/${encodeURIComponent(projectId)}/models/default`, {
    method: "PUT",
    body,
  });

/** Connectivity test: model reference (provider, modelId) is passed in the request body (may include an unsaved apiKey / baseUrl). */
export const testModel = (projectId: string, body: ModelTestRequest) =>
  apiFetch<ModelTestResponse>(`/api/projects/${encodeURIComponent(projectId)}/models/test`, {
    method: "POST",
    body,
  });

/** Protocol auto-detection for a custom base URL: probes openai-responses → ant-messages → openai-chat and returns the first protocol the endpoint serves. */
export const detectProtocol = (projectId: string, body: ModelProtocolDetectRequest) =>
  apiFetch<ModelProtocolDetectResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/models/detect`,
    { method: "POST", body },
  );

/** Endpoint model listing: given a base URL plus the protocol /detect reported, returns every model id the endpoint serves (the add-group import). */
export const listEndpointModels = (projectId: string, body: EndpointModelListRequest) =>
  apiFetch<EndpointModelListResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/models/list`,
    { method: "POST", body },
  );

/** Vision probe: sends one 1x1 image on this model's credential and reports whether it was accepted (a real, billed completion — unlike the protocol probes). */
export const detectVision = (projectId: string, body: ModelVisionDetectRequest) =>
  apiFetch<ModelVisionDetectResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/models/detect-vision`,
    { method: "POST", body },
  );

// Provider key minting (owner) ----------------------------------------------------------

/**
 * Opens an authorization flow for a provider group that publishes one, and returns the page
 * to send the user to. The PKCE verifier and the key it eventually mints stay on the server;
 * this side only ever holds the flow id.
 */
export const startModelOAuth = (projectId: string, body: ModelOAuthStartRequest) =>
  apiFetch<ModelOAuthStartResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/model-oauth/start`,
    { method: "POST", body },
  );

/** Where a flow stands; 404 once it has expired. */
export const getModelOAuthStatus = (projectId: string, flowId: string) =>
  apiFetch<ModelOAuthStatusResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/model-oauth/${encodeURIComponent(flowId)}`,
  );

/** Redeems a code the user pasted, for when the provider's redirect cannot reach the harness. */
export const submitModelOAuthCode = (projectId: string, flowId: string, code: string) =>
  apiFetch<ModelOAuthCodeResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/model-oauth/${encodeURIComponent(flowId)}/code`,
    { method: "POST", body: { code } },
  );

// Vault environment variables (Agent-level) -------------------------------------------------------

export const getVault = (projectId: string, agentId: string) =>
  apiFetch<VaultResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/vault`,
  );

export const putVault = (projectId: string, agentId: string, body: VaultUpdateRequest) =>
  apiFetch<VaultResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/vault`,
    { method: "PUT", body },
  );

/** Inserts the {{VAULT}} placeholder into the agent's prompt template — migrating a legacy hardcoded # Vault section verbatim when one is present (idempotent, owner-only). */
export const insertVaultPlaceholder = (projectId: string, agentId: string) =>
  apiFetch<AgentVaultConfigDto>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/vault/template-placeholder`,
    { method: "POST", body: {} },
  );

/** Inserts the {{SKILLS}} placeholder into the agent's prompt template — migrating a legacy hardcoded # Skills section verbatim when one is present (idempotent). */
export const insertSkillsPlaceholder = (projectId: string, agentId: string) =>
  apiFetch<AgentSkillsConfigDto>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/skills/template-placeholder`,
    { method: "POST", body: {} },
  );

/** Inserts the {{SCHEDULES}} placeholder into the agent's prompt template (idempotent, owner-only; Schedules has no legacy section to migrate). */
export const insertSchedulesPlaceholder = (projectId: string, agentId: string) =>
  apiFetch<AgentSchedulesConfigDto>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/schedules/template-placeholder`,
    { method: "POST", body: {} },
  );

// Memory (Agent-level, agent_state/memory/) -------------------------------------------------

/** Base path of an Agent's Memory API; the scope key and file name are single path segments (never a path). */
const memoryBase = (projectId: string, agentId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/memory`;

const memoryFilesBase = (projectId: string, agentId: string, scopeKey: string) =>
  `${memoryBase(projectId, agentId)}/scopes/${encodeURIComponent(scopeKey)}/files`;

export const getMemoryOverview = (projectId: string, agentId: string) =>
  apiFetch<MemoryOverviewResponse>(memoryBase(projectId, agentId));

/** Inserts the {{MEMORY}} placeholder into the agent's prompt template (idempotent) — the explicit adoption path for an agent created before Memory. */
export const insertMemoryPlaceholder = (projectId: string, agentId: string) =>
  apiFetch<MemoryOverviewResponse>(`${memoryBase(projectId, agentId)}/template-placeholder`, {
    method: "POST",
    body: {},
  });

export const getMemoryFiles = (projectId: string, agentId: string, scopeKey: string) =>
  apiFetch<MemoryFilesResponse>(memoryFilesBase(projectId, agentId, scopeKey));

export const getMemoryFile = (projectId: string, agentId: string, scopeKey: string, name: string) =>
  apiFetch<MemoryFileResponse>(
    `${memoryFilesBase(projectId, agentId, scopeKey)}/${encodeURIComponent(name)}`,
  );

export const deleteMemoryFile = (
  projectId: string,
  agentId: string,
  scopeKey: string,
  name: string,
) =>
  apiFetch<void>(`${memoryFilesBase(projectId, agentId, scopeKey)}/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });

const memoryScopeBase = (projectId: string, agentId: string, scopeKey: string) =>
  `${memoryBase(projectId, agentId)}/scopes/${encodeURIComponent(scopeKey)}`;

/**
 * One scope as a transfer document. Fetched as ordinary JSON rather than followed as a download
 * link so a failure arrives as an ApiError and reaches the user as a toast — a bare `<a download>`
 * would save the error body as a file (the skills tab hit the same wall). The server still sets
 * Content-Disposition, for anyone opening the URL directly.
 */
export const exportMemoryScope = (projectId: string, agentId: string, scopeKey: string) =>
  apiFetch<MemoryScopeExport>(`${memoryScopeBase(projectId, agentId, scopeKey)}/export`);

/** Writes a transfer document into one scope (owner only); `confirm` is required by the modes that would destroy something. */
export const importMemoryScope = (
  projectId: string,
  agentId: string,
  scopeKey: string,
  body: MemoryImportRequest,
) =>
  apiFetch<MemoryImportResponse>(`${memoryScopeBase(projectId, agentId, scopeKey)}/import`, {
    method: "POST",
    body,
  });

// Agent & its configuration ----------------------------------------------------------------

export const listAgents = (projectId: string) =>
  apiFetch<AgentsResponse>(`/api/projects/${encodeURIComponent(projectId)}/agents`);

export const createAgent = (projectId: string, body: AgentCreateRequest) =>
  apiFetch<AgentCreateResponse>(`/api/projects/${encodeURIComponent(projectId)}/agents`, {
    method: "POST",
    body,
  });

export const getAgentConfig = (projectId: string, agentId: string) =>
  apiFetch<AgentConfigResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/config`,
  );

export const putAgentConfig = (
  projectId: string,
  agentId: string,
  body: AgentConfigUpdateRequest,
) =>
  apiFetch<AgentConfigResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/config`,
    { method: "PUT", body },
  );

/** Probes one MCP Server entry's reachability (server-side connect + tool discovery; nothing is saved). */
export const testAgentMcpServer = (projectId: string, agentId: string, body: MCPServerConfig) =>
  apiFetch<McpServerTestResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/config/mcp-test`,
    { method: "POST", body },
  );

/** Overwrite system_config.yaml with the current defaults (keeps only name/description/version). */
export const resetAgentConfig = (projectId: string, agentId: string) =>
  apiFetch<AgentConfigResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/config/reset`,
    { method: "POST" },
  );

/** Smart-merge the config up to the current defaults generation (customizations kept and reported); non-destructive sibling of resetAgentConfig. */
export const kernelUpdateAgentConfig = (projectId: string, agentId: string) =>
  apiFetch<AgentKernelUpdateResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/config/kernel-update`,
    { method: "POST" },
  );

// Session ---------------------------------------------------------------------

/**
 * Optional paging (absent = full unfiltered list): the store requests `limit+1` per page to
 * detect "has more". `category` filters server-side (paging applies within the category);
 * `workspaceGroup` narrows the same way to one Workspace group, so a group can page its own
 * stream; `withCounts` asks for per-category totals over the whole list alongside the page.
 */
export const listSessions = (
  projectId: string,
  agentId: string,
  opts?: {
    offset: number;
    limit: number;
    category?: SessionCategory;
    /** One Workspace group's rows only: its path, or the merged temporary group's sentinel (session-grouping.ts). */
    workspaceGroup?: string;
    withCounts?: boolean;
  },
) => {
  const qs = opts
    ? `?limit=${opts.limit}&offset=${opts.offset}` +
      (opts.category ? `&category=${opts.category}` : "") +
      (opts.workspaceGroup ? `&workspaceGroup=${encodeURIComponent(opts.workspaceGroup)}` : "") +
      (opts.withCounts ? "&counts=1" : "")
    : "";
  return apiFetch<SessionsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/sessions${qs}`,
  );
};

/** Server directory browsing: `path` is an absolute path; empty means start from the server's home directory. */
export const listDirs = (projectId: string, path = "") =>
  apiFetch<DirListResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/dirs?path=${encodeURIComponent(path)}`,
  );

/**
 * Skills a directory carries under `.agents/skills` / `.claude/skills`: what picking it at Agent
 * creation would offer to install. `path` must be absolute.
 */
export const listDirectorySkills = (projectId: string, path: string) =>
  apiFetch<DirectorySkillsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/dir-skills?path=${encodeURIComponent(path)}`,
  );

export const createSession = (projectId: string, agentId: string, body: SessionCreateRequest) =>
  apiFetch<SessionCreateResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/sessions`,
    { method: "POST", body },
  );

export const forkSession = (sessionId: string, body: SessionForkRequest) =>
  apiFetch<SessionForkResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/fork`, {
    method: "POST",
    body,
  });

export const getSession = (sessionId: string) =>
  apiFetch<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`);

export const patchSession = (sessionId: string, body: SessionPatchRequest) =>
  apiFetch<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body,
  });

export const deleteSession = (sessionId: string) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });

// Messaging bindings ----------------------------------------------------------

/** The channel-agnostic read: every saved channel config + status (the channel-aware editor's load + poll). */
export const getMessagingBinding = (sessionId: string) =>
  apiFetch<MessagingBindingsResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/messaging`);

/** Saves Feishu credentials only — the connection toggle is setMessagingBindingState (an enabled binding restarts on save so config and connection never diverge). */
export const putFeishuBinding = (sessionId: string, body: FeishuBindingPutRequest) =>
  apiFetch<FeishuBindingResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/feishu`,
    { method: "PUT", body },
  );

/** Saves the Telegram token only — the same save/enable split as the Feishu PUT. */
export const putTelegramBinding = (sessionId: string, body: TelegramBindingPutRequest) =>
  apiFetch<TelegramBindingResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/telegram`,
    { method: "PUT", body },
  );

/** Saves the QQ App ID / App Secret pair only — the same save/enable split as the Feishu PUT. */
export const putQQBinding = (sessionId: string, body: QQBindingPutRequest) =>
  apiFetch<QQBindingResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/messaging/qq`, {
    method: "PUT",
    body,
  });

/**
 * Saves the WeChat delivery preferences. No credential rides along: this channel's token
 * comes only from a scan, so a PUT before one answers 400 `wechat_token_required`.
 */
export const putWeChatBinding = (sessionId: string, body: WeChatBindingPutRequest) =>
  apiFetch<WeChatBindingResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/wechat`,
    { method: "PUT", body },
  );

/** The connection toggle, which is also the bind/unbind: enable connects with the STORED credentials (409 `another_channel_enabled` while the other channel is enabled, 409 `account_enabled_elsewhere` while another conversation has this bot enabled), disable releases the account. */
export const setMessagingBindingState = (
  sessionId: string,
  channel: MessagingChannel,
  enabled: boolean,
) =>
  apiFetch<FeishuBindingResponse | TelegramBindingResponse | QQBindingResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/${channel}/state`,
    { method: "POST", body: { enabled } },
  );

/** Feishu credential probe with the form's draft values; omitted fields fall back to the stored binding. */
export const testFeishuBinding = (sessionId: string, body: FeishuTestRequest) =>
  apiFetch<FeishuTestResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/feishu/test`,
    { method: "POST", body },
  );

/** Telegram credential probe (`getMe`); success additionally names the bot's @username. */
export const testTelegramBinding = (sessionId: string, body: TelegramTestRequest) =>
  apiFetch<TelegramTestResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/telegram/test`,
    { method: "POST", body },
  );

/**
 * Starts a QQ scan-to-connect flow. The response carries the URL to render as a QR code and
 * a task handle — never the AES key that decrypts the App Secret, which stays on the server.
 */
export const startQQScan = (sessionId: string) =>
  apiFetch<QQScanStartResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/qq/scan`,
    {
      method: "POST",
      body: {},
    },
  );

/** One poll of a scan. `completed` means the server already decrypted and SAVED the credentials. */
export const pollQQScan = (sessionId: string, taskId: string) =>
  apiFetch<QQScanPollResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/qq/scan/poll`,
    { method: "POST", body: { taskId } },
  );

/** Drops a scan the user walked away from, so its key is forgotten rather than left to expire. */
export const cancelQQScan = (sessionId: string, taskId: string) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}/messaging/qq/scan/cancel`, {
    method: "POST",
    body: { taskId },
  });

/**
 * Starts a WeChat scan-to-connect flow — the ONLY way to bind this channel. The response
 * carries the URL to render as a QR code and a task handle; the platform's own poll handle,
 * which is what collects the bot token, stays on the server.
 */
export const startWeChatScan = (sessionId: string) =>
  apiFetch<WeChatScanStartResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/wechat/scan`,
    { method: "POST", body: {} },
  );

/** One poll of a scan. `completed` means the server has already SAVED the credential. */
export const pollWeChatScan = (sessionId: string, taskId: string) =>
  apiFetch<WeChatScanPollResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/wechat/scan/poll`,
    { method: "POST", body: { taskId } },
  );

/**
 * Submits the pairing code WeChat showed on the phone. It rides the NEXT poll rather than a
 * request of its own, so this only records it — a wrong code surfaces as the poll asking again.
 */
export const verifyWeChatScan = (sessionId: string, taskId: string, verifyCode: string) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}/messaging/wechat/scan/verify`, {
    method: "POST",
    body: { taskId, verifyCode },
  });

/** Drops a scan the user walked away from, so its handle is forgotten rather than left to expire. */
export const cancelWeChatScan = (sessionId: string, taskId: string) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}/messaging/wechat/scan/cancel`, {
    method: "POST",
    body: { taskId },
  });

/** WeChat credential probe of the STORED binding; there is no draft to send and no account label back. */
export const testWeChatBinding = (sessionId: string) =>
  apiFetch<WeChatTestResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/wechat/test`,
    { method: "POST", body: {} },
  );

/** QQ credential probe (the access-token exchange); the platform names no account, so success carries no label. */
export const testQQBinding = (sessionId: string, body: QQTestRequest) =>
  apiFetch<QQTestResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/messaging/qq/test`, {
    method: "POST",
    body,
  });

/** Short fixed text to the binding's last known chat (409 `feishu_no_chat` / `telegram_no_chat` / `qq_no_chat` before one exists; on QQ the send can still fail with 502 when no recent QQ message can be replied to). */
export const sendMessagingTestMessage = (sessionId: string, channel: MessagingChannel) =>
  apiFetch<MessagingTestMessageResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/${channel}/test-message`,
    { method: "POST", body: {} },
  );

/** Windowed history request: the newest N units (tail), or the N units before a cursor. */
export type MessagesPageQuery =
  { kind: "tail"; limit: number } | { kind: "before"; cursor: string; limit: number };

/**
 * History rebuild. Carries the server's clock at read time (see ApiFetchMeta.serverNowMs)
 * alongside the messages: a Task still running has no Trace entry for the event currently in
 * flight, so its elapsed can only be measured by differencing this against the Task's first
 * message timestamp — both server-side values, so no client clock offset enters the result
 * (see pushMessages).
 *
 * With `page`, requests a WINDOW instead of the full transcript (tail-first loading /
 * scroll-up backfill — see stream-controller): the response then carries
 * `MessagesResponse.page`. Omitted = the legacy full read (the resync fallback path).
 */
export const getMessages = (sessionId: string, page?: MessagesPageQuery) => {
  const qs =
    page === undefined
      ? ""
      : page.kind === "tail"
        ? `?tailLimit=${page.limit}`
        : `?before=${encodeURIComponent(page.cursor)}&limit=${page.limit}`;
  return apiFetchWithMeta<MessagesResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs}`,
  ).then(({ data, serverNowMs }) => ({ ...data, serverNowMs }));
};

// Task execution, approval, abort, compaction ------------------------------------------------------

export const postTask = (sessionId: string, body: TaskCreateRequest) =>
  apiFetch<TaskCreateResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/tasks`, {
    method: "POST",
    body,
  });

export const getGoal = (sessionId: string) =>
  apiFetch<GoalResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/goal`);

export const postApproval = (
  sessionId: string,
  toolCallId: string,
  body: ApprovalDecisionRequest,
) =>
  apiFetch<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(toolCallId)}`,
    { method: "POST", body },
  );

export const postAbort = (sessionId: string) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
    method: "POST",
    body: {},
  });

/** "Retry now" on the reconnect countdown: skips the remaining backoff wait server-side (skipped:false is the benign "no wait in progress" case — e.g. the timer elapsed in a race — never an error). */
export const postRetryNow = (sessionId: string) =>
  apiFetch<RetryNowResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/retry-now`, {
    method: "POST",
    body: {},
  });

/** Background processes the conversation started (details popover list); an evicted/never-loaded runtime reports an empty list. */
export const getSessionProcesses = (sessionId: string) =>
  apiFetch<SessionProcessesResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/processes`);

/** Stops one background process (404 process_not_found when it already exited or the runtime is gone — callers just refresh). */
export const killSessionProcess = (sessionId: string, processId: string) =>
  apiFetch<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/processes/${encodeURIComponent(processId)}/kill`,
    { method: "POST", body: {} },
  );

/** Removes one EXITED background process entry from the list (409 process_running while it still runs — stopping is the kill route's job; 404 when it is already gone — callers just refresh). */
export const removeSessionProcess = (sessionId: string, processId: string) =>
  apiFetch<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/processes/${encodeURIComponent(processId)}`,
    { method: "DELETE" },
  );

/** Mid-run steering: queues a message for the running Task (delivered between turns as a standalone `[user_steering]` user message); 409 not_running when no Task is in progress. */
export const postSteer = (sessionId: string, body: SteerRequest) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}/steer`, {
    method: "POST",
    body,
  });

/** Panel message to one subagent child (#272) — a user input on the child, whatever its state: steered mid-run, started on an idle child, resumed when the released session was revived (the child runs at its own Session's thinking level; pin it with patchSession). 404 subagent_gone when nothing can be revived, 409 subagent_busy when the child cannot take it right now. */
export const messageSubagent = (sessionId: string, childSessionId: string, text: string) =>
  apiFetch<SubagentMessageResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(childSessionId)}/message`,
    { method: "POST", body: { text } },
  );

/** Panel stop for one subagent child (#272): aborts only its CURRENT run — the session survives for follow-ups (202 aborted; 204 when already idle/unknown). */
export const abortSubagent = (sessionId: string, childSessionId: string) =>
  apiFetch<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(childSessionId)}/abort`,
    { method: "POST", body: {} },
  );

/** Recall an undelivered steering message back to the composer (#287): returns its original content; 409 not_pending once it was delivered to the model. */
export const recallSteer = (sessionId: string, steerId: string) =>
  apiFetch<RecalledMessageResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/steer/${encodeURIComponent(steerId)}`,
    { method: "DELETE" },
  );

/** Recall a queued follow-up task back to the composer (#287): returns its original content (+ queued thinking level); 409 follow_up_started once it already auto-started. */
export const recallFollowUp = (sessionId: string, followUpId: string) =>
  apiFetch<RecalledMessageResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/follow-ups/${encodeURIComponent(followUpId)}`,
    { method: "DELETE" },
  );

export const postCompact = (sessionId: string) =>
  // Same shape as tasks: the response carries the actual current session_id (a new id after self-healing; the frontend updates its route accordingly).
  apiFetch<TaskCreateResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/compact`, {
    method: "POST",
    body: {},
  });

/**
 * Composition of the Session's current model context (the chat page's context-ring detail panel).
 * A snapshot read from the newest Trace shard on each call, not a live counter: the figures are
 * estimates whose value is the *shares* they give the measured occupancy.
 */
export const getSessionContext = (sessionId: string) =>
  apiFetch<SessionContextResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/context`);

// Trace browsing & performance analysis -----------------------------------------------------------

export const getSessionTraces = (sessionId: string) =>
  apiFetch<SessionTracesResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/traces`);

export const getTraceEvents = (sessionId: string, index: number, offset: number, limit: number) =>
  apiFetch<TraceEventsResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/traces/${index}`, {
    query: { offset, limit },
  });

export const getTraceAnalysis = (sessionId: string, index: number) =>
  apiFetch<TraceAnalysisResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/traces/${index}/analysis`,
  );

// Agent-level Trace details (read-only, independent of sessions-table registration): the Trace
// page's directory tree comes from an Agent-level scan (including subagent child Sessions and
// Sessions created by the CLI); details go through the Agent-level endpoint to avoid 404s for
// unregistered sessions.

export const getAgentTraceEvents = (
  projectId: string,
  agentId: string,
  sessionId: string,
  index: number,
  offset: number,
  limit: number,
) =>
  apiFetch<TraceEventsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/traces/${encodeURIComponent(sessionId)}/${index}`,
    { query: { offset, limit } },
  );

export const getAgentTraceAnalysis = (
  projectId: string,
  agentId: string,
  sessionId: string,
  index: number,
) =>
  apiFetch<TraceAnalysisResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/traces/${encodeURIComponent(sessionId)}/${index}/analysis`,
  );

/** Trace file download URL: the server sets Content-Disposition attachment, usable directly in <a download>. */
export const agentTraceDownloadUrl = (
  projectId: string,
  agentId: string,
  sessionId: string,
  index: number,
): string =>
  `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
  `/traces/${encodeURIComponent(sessionId)}/${index}/download`;

/** Imports a Trace JSONL file (owner only); the response says where the file landed (sessionId / index / date). */
export const importAgentTrace = (projectId: string, agentId: string, body: TraceImportRequest) =>
  apiFetch<TraceImportResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/traces/import`,
    { method: "POST", body },
  );

// Usage statistics ----------------------------------------------------------------------

/**
 * One page of the cost center's error table (newest first). The dashboard response already
 * carries the first page; this is for paging back to earlier ones without refetching the
 * whole aggregate. Takes the dashboard's date/agent filter only — the model filter never
 * applied to errors.
 */
export const getUsageErrors = (
  projectId: string,
  params: {
    offset: number;
    limit: number;
    from?: string;
    to?: string;
    agentId?: string;
    /** Narrow to one category; the cost-center badge asks for `unexpected` with `limit: 1`. */
    kind?: UsageErrorKind;
  },
) =>
  apiFetch<UsageErrorsPage>(`/api/projects/${encodeURIComponent(projectId)}/usage/errors`, {
    query: {
      offset: String(params.offset),
      limit: String(params.limit),
      from: params.from,
      to: params.to,
      agentId: params.agentId,
      kind: params.kind,
    },
  });

/**
 * Empties the cost center's error table for the filter the panel is showing — the same
 * date/agent pair the reads take, so what goes is what was on screen. Owner only, and errors
 * with no Project attribution are never included. Answers how many rows were deleted.
 */
export const clearUsageErrors = (
  projectId: string,
  params: { from?: string; to?: string; agentId?: string },
) =>
  apiFetch<UsageErrorsClearResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/usage/errors`,
    {
      method: "DELETE",
      query: { from: params.from, to: params.to, agentId: params.agentId },
    },
  );

/**
 * Lifetime Token total per Model, unfiltered. The models page shows each card what it has
 * spent; it is a separate request from the model list so a stats failure costs the figure and
 * not the page.
 */
export const getUsageModelTotals = (projectId: string) =>
  apiFetch<UsageModelTotals>(`/api/projects/${encodeURIComponent(projectId)}/usage/model-totals`);

export const getUsage = (
  projectId: string,
  params: {
    from?: string;
    to?: string;
    /** Trailing-window bounds (ISO timestamps, together or not at all): refine the range down to instants; required for minute granularity. */
    fromTs?: string;
    toTs?: string;
    groupBy: UsageGroupBy;
    /** Time-series precision for the response's `series`; the server defaults to day. */
    granularity?: UsageGranularity;
    agentId?: string;
    /** Model filter is always a whole pair — both fields or neither; a model is never referenced by id alone. */
    provider?: string;
    modelId?: string;
  },
) =>
  apiFetch<UsageResponse>(`/api/projects/${encodeURIComponent(projectId)}/usage`, {
    query: {
      from: params.from,
      to: params.to,
      fromTs: params.fromTs,
      toTs: params.toTs,
      groupBy: params.groupBy,
      granularity: params.granularity,
      agentId: params.agentId,
      provider: params.provider,
      modelId: params.modelId,
    },
  });

// Agent deletion & Workspace files --------------------------------------------------

export const deleteAgent = (projectId: string, agentId: string) =>
  apiFetch<void>(`/api/projects/${projectId}/agents/${agentId}`, { method: "DELETE" });

export const listWorkspaceFiles = (sessionId: string, path: string) =>
  apiFetch<WorkspaceFilesResponse>(`/api/sessions/${sessionId}/files`, { query: { path } });

/** File content URL (inline preview / download=1 triggers download; usable directly in <a>/<img>/fetch). */
export const workspaceFileUrl = (sessionId: string, path: string, download = false): string =>
  `/api/sessions/${sessionId}/files/content?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

/**
 * "Open in a new tab" for a Workspace html file: an App-origin link that mints a signed
 * token and 302s to the separate preview origin, where the page gets a real origin with
 * working storage, cookies and third-party embeds.
 *
 * A link (not a fetch + `window.open`) on purpose — opening a tab after an await trips
 * popup blockers, and a script-opened window keeps an `opener` handle back to the App,
 * which is precisely the reference the separate origin exists to deny. Use it with
 * `rel="noopener noreferrer"`.
 *
 * Falls back server-side to the sandboxed same-origin preview when the deployment has no
 * usable preview origin; `previewIsolated` from /api/me says so in advance.
 */
export const workspaceFilePreviewUrl = (sessionId: string, path: string): string =>
  `/api/sessions/${sessionId}/files/preview-redirect?path=${encodeURIComponent(path)}`;

/**
 * The converted form of a workspace document, for the preview pane.
 *
 * A fetch rather than an iframe src because the answer is structured — HTML for a .docx, cells for
 * a workbook, slides for a deck — and the pane decides how to draw each. PDF is not served here:
 * the browser renders it natively and the pane embeds the file directly.
 *
 * The ETag comes back alongside the payload so a cell edit can be sent under If-Match without a
 * second request just to stat the file. It is the same weak ETag the file read returns.
 */
export const documentPreview = (
  sessionId: string,
  path: string,
): Promise<{ payload: DocumentPreview; etag?: string }> =>
  apiFetchWithMeta<DocumentPreview>(
    `/api/sessions/${sessionId}/files/document-preview?path=${encodeURIComponent(path)}`,
  ).then(({ data, etag }) => ({ payload: data, etag: etag ?? undefined }));

/**
 * Applies cell edits to a workbook.
 *
 * Only the changes travel, not the file. The browser never parsed the workbook, so sending a whole
 * file back would mean sending a lossy reconstruction of the one on disk — which is the fidelity
 * loss the surgical server-side write exists to avoid. The delta goes over; the server applies it
 * to the real bytes.
 *
 * `ifMatch` is the ETag from the read, and the server answers 409 when the file has moved on —
 * the same contract the Markdown editor saves under, and more important here, because a stale cell
 * delta applied silently is a wrong number in a document someone may already have sent.
 */
/**
 * Writes an edited document back as a .docx.
 *
 * `bytes` is the document the editor serialized — a complete OOXML package, not a rendering of one.
 * The engine builds it in the browser, so nothing is reconstructed on the way in and nothing the user
 * did not touch is rewritten: the styles, headers, images and any markup the engine does not model
 * travel through untouched. An earlier version sent HTML for Pandoc to rebuild the document from,
 * which is how a save came back looking like a different document.
 *
 * `targetPath` is required and not inferred: the choice between a new file and replacing the original
 * belongs to the user.
 *
 * `ifMatch` is sent when overwriting. The server refuses an existing target that has no If-Match,
 * so a "save as a new file" can never silently clobber another document. Pass `"*"` to overwrite
 * regardless — the If-Match wildcard, sent when the user has answered the conflict dialog.
 *
 * The bytes go in the body and the paths in the query, rather than both in a JSON envelope: the body
 * is the document, and base64-ing a document to fit it in JSON would inflate every save by a third.
 *
 * The content type is the generic binary one rather than the .docx media type, because the write
 * guard admits a fixed list and the .docx type is not on it. Widening a guard to name one file
 * format is the wrong trade; the guard's job is to refuse the types an HTML form can send, and this
 * is not one of them.
 */
export const writeDocumentDocx = (
  sessionId: string,
  sourcePath: string,
  bytes: ArrayBuffer,
  targetPath: string,
  ifMatch?: string,
): Promise<void> =>
  apiFetch<void>(
    `/api/sessions/${sessionId}/files/document-docx?path=${encodeURIComponent(sourcePath)}&target=${encodeURIComponent(targetPath)}`,
    {
      method: "PUT",
      rawBody: new Blob([bytes], { type: "application/octet-stream" }),
      contentType: "application/octet-stream",
      ...(ifMatch === undefined ? {} : { headers: { "if-match": ifMatch } }),
    },
  );

export const documentCellEdits = (
  sessionId: string,
  path: string,
  edits: { sheet: string; address: string; value: string | number | null }[],
  ifMatch?: string,
): Promise<void> =>
  apiFetch<void>(
    `/api/sessions/${sessionId}/files/document-cells?path=${encodeURIComponent(path)}`,
    {
      method: "PUT",
      body: JSON.stringify({ edits }),
      ...(ifMatch === undefined ? {} : { headers: { "if-match": ifMatch } }),
    },
  );

/**
 * Save a workspace file. When `ifMatch` is supplied, the write is rejected with 409 if
 * the file's mtime on disk no longer matches — the caller's read was on a stale version
 * (most commonly: the Agent wrote to the same file while the user was editing). The
 * caller is expected to read the file again (or accept the loss) before retrying. The
 * returned ETag is the file's new mtime as a weak ETag (`W/"<mtimeMs>"`); pass it as
 * `ifMatch` on the next save.
 */
export const uploadWorkspaceFile = async (
  sessionId: string,
  path: string,
  dataBase64: string,
  ifMatch?: string,
): Promise<string | null> => {
  const { etag } = await apiFetchWithMeta<void>(`/api/sessions/${sessionId}/files/content`, {
    method: "PUT",
    body: { dataBase64 },
    query: { path },
    ...(ifMatch !== undefined ? { headers: { "If-Match": ifMatch } } : {}),
  });
  return etag;
};

/** Batch file-existence check (message file cards): both out-of-bounds and missing paths simply don't appear in `existing`; always returns 200. */
export const statSessionFiles = (sessionId: string, paths: string[]) =>
  apiFetch<FilesStatResponse>(`/api/sessions/${sessionId}/files/stat`, {
    method: "POST",
    body: { paths } satisfies FilesStatRequest,
  });

// Scheduled tasks ----------------------------------------------------------------------

export const listSchedules = (projectId: string, agentId: string) =>
  apiFetch<SchedulesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/schedules`,
  );

export const createSchedule = (
  projectId: string,
  agentId: string,
  body: ScheduleUpsertRequest & { name: string },
) =>
  apiFetch<ScheduleItem>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/schedules`,
    { method: "POST", body },
  );

export const updateSchedule = (
  projectId: string,
  agentId: string,
  name: string,
  body: ScheduleUpsertRequest,
) =>
  apiFetch<ScheduleItem>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/schedules/${encodeURIComponent(name)}`,
    { method: "PUT", body },
  );

export const deleteSchedule = (projectId: string, agentId: string, name: string) =>
  apiFetch<void>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/schedules/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );

// Plugin library, and an Agent's installed skills and hook packages ----------------------------

/** Plugin library (available to any logged-in user): groups, each plugin's manifest and the metadata of its skills — never SKILL.md bodies or hook scripts. */
export const getPluginLibrary = () => apiFetch<PluginLibraryResponse>("/api/plugins");

/** Everything one library plugin ships as text keyed by path (skills' files, hook scripts), for the plugin detail view's file browser. */
export const getPluginFiles = (plugin: string) =>
  apiFetch<PluginFilesResponse>(`/api/plugins/${encodeURIComponent(plugin)}/files`);

/**
 * Installs whole library plugins — each one's skills and hook package; an already-installed
 * plugin is overwritten with the library content (i.e. updated). 201 returns the Agent's
 * refreshed installed lists.
 */
export const installAgentPlugins = (projectId: string, agentId: string, names: string[]) =>
  apiFetch<AgentPluginsInstallResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/plugins`,
    { method: "POST", body: { names } satisfies PluginInstallRequest },
  );

export const getAgentSkills = (projectId: string, agentId: string) =>
  apiFetch<AgentSkillsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/skills`,
  );

/**
 * Every skill in the Project, unioned over its Agents.
 *
 * Not the same answer as `getAgentSkills`: a skill lives in one Agent's directory, so that one
 * reports only what one Agent has, and a skill installed on two Agents is listed twice across the
 * per-Agent calls. This is what a page showing "all skills" must read.
 */
export const getSkillCatalog = (projectId: string) =>
  apiFetch<SkillCatalogResponse>(`/api/projects/${encodeURIComponent(projectId)}/skills/catalog`);

/**
 * What this Project has installed, grouped by **install unit** — the Plugins that brought Skills,
 * and the Skills installed on their own.
 *
 * Read this rather than `getSkillCatalog` when the page has to say where a Skill came from: the
 * catalog scans the filesystem and cannot know it, because a Plugin's member and a standalone Skill
 * are byte-identical on disk. Items whose unit was deduced rather than recorded carry
 * `inferred: true`.
 */
export const getInstalledSkills = (projectId: string) =>
  apiFetch<InstalledSkillsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/skills/installed`,
  );

/**
 * Removes one plugin install from one Agent: its Skills, its hook package if any, and its record
 * entry.
 *
 * Per-Agent because a plugin is installed per Agent — the same scope `installPlugin` has.
 */
export const uninstallPlugin = (projectId: string, agentId: string, name: string) =>
  apiFetch<{ plugin: string; removedSkills: string[]; removedHooks: string[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/skills/plugins/uninstall`,
    { method: "POST", body: JSON.stringify({ name }) },
  );

export const getAgentHooks = (projectId: string, agentId: string) =>
  apiFetch<AgentHooksResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/hooks`,
  );

/** Uninstalls one hook package (deletes agent_state/hooks/<name>/ whole); 204, 404 not_found when it is not installed. */
export const uninstallAgentHook = (projectId: string, agentId: string, name: string) =>
  apiFetch<void>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/hooks/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );

/** Installs one skill from an uploaded zip (base64); 409 skill_exists unless overwrite; 201 returns the latest installed list. */
export const installAgentSkillArchive = (
  projectId: string,
  agentId: string,
  body: SkillArchiveInstallRequest,
) =>
  apiFetch<AgentSkillsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/skills/archive`,
    { method: "POST", body },
  );

/** Zip download URL for one installed skill (server sets Content-Disposition attachment); the export round-trips through installAgentSkillArchive. */
export const agentSkillArchiveUrl = (projectId: string, agentId: string, name: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
  `/skills/${encodeURIComponent(name)}/archive`;

export const removeAgentSkill = (projectId: string, agentId: string, name: string) =>
  apiFetch<void>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/skills/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );

// Benchmark scoring (read-only display) -------------------------------------------------------

export const listBenchmarks = (projectId: string, agentId: string) =>
  apiFetch<BenchmarksResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/benchmarks`,
  );

export const listBenchmarkCases = (projectId: string, agentId: string, benchmarkId: string) =>
  apiFetch<BenchmarkCasesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/benchmarks/${encodeURIComponent(benchmarkId)}/cases`,
  );

const benchmarkCaseFilesPath = (
  projectId: string,
  agentId: string,
  benchmarkId: string,
  caseId: string,
  material: CaseMaterial,
) =>
  `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
  `/benchmarks/${encodeURIComponent(benchmarkId)}/cases/${encodeURIComponent(caseId)}` +
  `${material === "rubric" ? "/rubric" : ""}/files`;

export const listBenchmarkCaseFiles = (
  projectId: string,
  agentId: string,
  benchmarkId: string,
  caseId: string,
  path: string,
  material: CaseMaterial,
) =>
  apiFetch<WorkspaceFilesResponse>(
    benchmarkCaseFilesPath(projectId, agentId, benchmarkId, caseId, material),
    { query: { path } },
  );

export const benchmarkCaseFileUrl = (
  projectId: string,
  agentId: string,
  benchmarkId: string,
  caseId: string,
  path: string,
  material: CaseMaterial,
  options?: { download?: boolean; preview?: boolean },
): string => {
  const base = `${benchmarkCaseFilesPath(
    projectId,
    agentId,
    benchmarkId,
    caseId,
    material,
  )}/content?path=${encodeURIComponent(path)}`;
  return (
    base +
    (options?.download ? "&download=1" : "") +
    (options?.preview && !options.download ? "&preview=1" : "")
  );
};

// Agent State snapshot export / import ------------------------------------------------------

/** Snapshot bundle (tar.gz) download URL: the server sets Content-Disposition attachment, usable directly in <a download>. */
export const agentExportUrl = (projectId: string, agentId: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/export`;

export const importAgent = (projectId: string, agentId: string, body: AgentImportRequest) =>
  apiFetch<AgentImportResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/import`,
    { method: "POST", body },
  );

// Machines (admin only) ----------------------------------------------------------------

/**
 * The server's ssh hosts, the version it would install, and the running or last install
 * job. The Machines page polls this while a job runs — the progress lines live on the job,
 * not on the event channel, because they belong to the one page that is waiting for them.
 */
export const getMachines = (projectId: string) =>
  apiFetch<MachinesResponse>(`/api/projects/${encodeURIComponent(projectId)}/machines`);

/**
 * Starts an install (202, long-running) and gives the machine to this Project; the returned
 * body already carries the new job.
 */
export const installOnMachine = (projectId: string, machineId: string) =>
  apiFetch<MachinesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/machines/${encodeURIComponent(machineId)}/install`,
    { method: "POST", body: {} },
  );

// Version & self-update ----------------------------------------------------------------

export const getVersion = () => apiFetch<VersionResponse>("/api/version");

/** `force` (the manual "check for updates" action) bypasses the server's TTL cache. */
export const checkUpdate = (force = false) =>
  apiFetch<UpdateCheckResponse>(`/api/version/update-check${force ? "?force=1" : ""}`);

/** Admin only: the self-update job's status — polled while it runs. */
export const getUpdateJob = () => apiFetch<UpdateJobStatus>("/api/version/update");

/** Admin only: starts the self-update job (`jiumate update` on the server host, in the background) and answers with its status. */
export const startUpdateJob = () =>
  apiFetch<UpdateJobStatus>("/api/version/update", { method: "POST", body: {} });

/** Admin only: asks the supervised server process to restart into the installed release. */
export const restartServer = () =>
  apiFetch<RestartResponse>("/api/version/restart", { method: "POST", body: {} });

// Desktop client update (desktop-shell sessions only) ----------------------------------

export const getDesktopUpdate = () => apiFetch<DesktopUpdateStatusResponse>("/api/desktop/update");

export const desktopUpdateCheck = () =>
  apiFetch<void>("/api/desktop/update/check", { method: "POST", body: {} });

export const desktopUpdateDownload = () =>
  apiFetch<void>("/api/desktop/update/download", { method: "POST", body: {} });

export const desktopUpdateInstall = () =>
  apiFetch<void>("/api/desktop/update/install", { method: "POST", body: {} });

// Workspace-file export ----------------------------------------------------------------

/**
 * Capability snapshot read from `GET /api/version/capabilities`. Drives the Export
 * menu's disabled state: a missing Pandoc binary greys out DOCX/EPUB/RTF/TXT; a CLI
 * (non-desktop) runtime greys out PDF. The web fetches this once per dropdown open —
 * a session that never opens the menu pays no round-trip.
 */
export const getServerCapabilities = () =>
  apiFetch<ServerCapabilities>("/api/version/capabilities");

/**
 * Render an already-serialized HTML body to one of PDF / DOCX / EPUB / RTF / TXT.
 * The web pre-renders Markdown → HTML (with Mermaid → SVG and KaTeX CSS) before
 * calling; the server picks the format-specific path (Pandoc sub-process or the
 * desktop shell's printToPDF). MD and HTML never go through this — they are handled
 * client-side.
 */
export const exportWorkspaceFile = (
  sessionId: string,
  path: string,
  format: ServerExportFormat,
  html: string,
): Promise<Blob> =>
  postBinary(`/api/sessions/${encodeURIComponent(sessionId)}/files/export`, {
    path,
    format,
    html,
  });

export type { ServerCapabilities, ServerExportFormat };
