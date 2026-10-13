/**
 * Tools tab's "MCP Server" block: a table of configured servers (name / transport /
 * target) with vault-style immediate persistence — Add/Edit happens in a modal whose
 * fields follow the chosen transport, deletion sits behind a confirmation. Every
 * operation PUTs the whole `mcpServers` list through the config route; the server
 * re-validates each entry via the core transport resolver, so a rejected save surfaces
 * inside the modal instead of half-applying.
 *
 * Connectivity testing mirrors the models page: the modal carries a standalone
 * "test connection" button in a top action row (result as a toast, tool count +
 * latency — the models dialog idiom), and the section header offers a bulk test that
 * probes every configured server sequentially behind a confirm dialog, writing a
 * tone-colored badge onto each row as its result lands (the group speed-test idiom).
 *
 * The permission control mirrors the builtin tool table's, with a third `auto` state: it
 * decides which of the server's tool calls stop for approval, and nothing about what the
 * remote server is able to do.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { MCPServerConfig } from "@prismshadow/jiumate-core/interfaces";
import * as api from "../../api/endpoints";
import type { McpServerTestResponse } from "@prismshadow/jiumate-server/api";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { PENCIL_ICON, TRASH_ICON } from "../../components/ui/session-row-menu";
import { ICON_SIZE } from "../../lib/icon-scale";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { SettingsEmpty } from "../../components/ui/empty-state";
import { CONNECTOR_ICON } from "../../components/ui/icons";
import { SkillTile } from "../skills/skill-icon-view";
import { LibraryCard } from "../plugins/library-card";
import { Skeleton } from "../../components/ui/skeleton";
import { OptionMenu, type OptionMenuChoice } from "../../components/ui/option-menu";
import { Segmented } from "../../components/ui/segmented";
import { toastError, toastSuccess } from "../../components/ui/toast";
import {
  emptyMcpForm,
  formToServer,
  permissionOf,
  serverToForm,
  transportOf,
  type McpFormError,
  type McpFormField,
  type McpPermissionMode,
  type McpServerFormState,
  type McpTransportKind,
} from "./mcp-servers-form";
import { toneInk } from "../../lib/tone";
import { InfoPopover } from "../../components/ui/info-popover";

/** Maps a validation error code to its localized message. */
function errorText(err: McpFormError | undefined): string | undefined {
  if (!err) return undefined;
  switch (err.code) {
    case "required":
      return S.common.requiredField;
    case "name_charset":
      return S.agent.mcpNameInvalid;
    case "url_invalid":
      return S.agent.mcpUrlInvalid;
    case "kv_line":
      return S.agent.mcpLineInvalid(err.line ?? 1);
    case "number":
      return S.agent.mcpNumberInvalid;
    case "duplicate":
      return S.agent.mcpDuplicateName;
  }
}

/**
 * 连接器详情弹窗。
 *
 * 刻意做成一个独立组件，而不是在列表组件里内联一段 JSX：弹窗的 footer 是 JSX 节点，
 * 在传给 Modal 之前就会被求值，不管弹窗开没开。之前把 `servers[detailIndex!]` 写在
 * footer 的属性里，detailIndex 为 null 时直接抛错，第一次渲染就整页白屏——连接器页
 * 每次打开都会崩。现在条目只解析一次，闭包里也只读这个稳定的入参。
 *
 * 展示的是已存条目，不是编辑表单的草稿：表单是另一个带未保存状态的弹窗，打开详情是
 * 想看这个连接器「是什么」，不该看到没人保存过的改动。
 */
function DetailModal({
  entry,
  result,
  busy,
  editable,
  onClose,
  onTest,
}: {
  entry: MCPServerConfig;
  result: RowTestResult | undefined;
  busy: boolean;
  /** 只读成员可以看详情，但没有「测试连接」这个会发请求的动作。 */
  editable: boolean;
  onClose: () => void;
  onTest: () => void;
}) {
  return (
    <Modal
      open
      title={entry.name}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{S.common.close}</Button>
          {editable && (
            <Button variant="primary" disabled={busy || result === "pending"} onClick={onTest}>
              {result === "pending" ? S.agent.mcpTestPending : S.agent.mcpTest}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <SkillTile name={entry.name} fallback={CONNECTOR_ICON} size={48} glyph={26} />
          <div className="min-w-0 flex-1">
            <span className="block truncate font-mono text-sm font-semibold">{entry.name}</span>
            <span className="block text-xs text-gray-400 dark:text-gray-500">
              {transportOf(entry)} · {permissionOf(entry)}
            </span>
          </div>
        </div>
        {/* 连接地址完整展示、不截断：这是读者唯一需要看全的字段——被截断的命令没法复制、
            也没法排查。 */}
        {targetOf(entry) !== "" && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {S.agent.mcpTarget}
            </p>
            <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs break-all text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              {targetOf(entry)}
            </p>
          </div>
        )}
        {result !== undefined && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <TestBadge result={result} />
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Table cell summary: the spawn line for stdio, the URL for http/sse. */
function targetOf(entry: MCPServerConfig): string {
  const c = entry.config;
  if (typeof c["url"] === "string") return c["url"];
  const command = typeof c["command"] === "string" ? c["command"] : "";
  const args = Array.isArray(c["args"]) ? c["args"].map((a) => String(a)).join(" ") : "";
  return args ? `${command} ${args}` : command;
}

/**
 * Everything about an entry that is worth searching on: its name plus its connection target.
 *
 * Exported so the tab's search box matches on the same text the card shows. The alternative —
 * each caller reading `entry.config` for `command`/`url`/`args` — is how a search ends up
 * matching fields the user cannot see, and then finding nothing that is on screen.
 */
export function mcpSearchText(entry: MCPServerConfig): string {
  return `${entry.name} ${targetOf(entry)}`.toLowerCase();
}

/** One row's bulk-test outcome ("pending" while its turn runs). */
type RowTestResult = McpServerTestResponse | "pending";

/** Row badge for the bulk test (the model card's speed-badge idiom: small, tone-colored, reason on hover). */
function TestBadge({ result }: { result: RowTestResult | undefined }) {
  if (result === undefined) return null;
  if (result === "pending") {
    return (
      <span className="text-[11px] whitespace-nowrap text-gray-400">{S.agent.mcpTestPending}</span>
    );
  }
  if (result.ok) {
    return (
      <span className={`text-[11px] font-medium whitespace-nowrap ${toneInk.success}`}>
        {S.agent.mcpTestBadge(result.tools?.length ?? 0, result.latencyMs)}
      </span>
    );
  }
  return (
    <span
      title={result.error}
      className={`text-[11px] font-medium whitespace-nowrap ${toneInk.danger}`}
    >
      {S.agent.mcpTestBadgeFail}
    </span>
  );
}

/**
 * Where a list of MCP servers is stored and how one is probed. The section renders and
 * edits the same table either way; only these things differ, which is what lets the
 * Agent's Tools tab and the Project's connectors tab share one implementation instead of
 * growing two that drift.
 */
export interface McpSectionTarget {
  /** Persist the full list; resolves with the stored list (server-side normalize/validate). */
  save(servers: MCPServerConfig[]): Promise<MCPServerConfig[]>;
  /** Probe one entry's reachability (nothing persisted). */
  test(entry: MCPServerConfig): Promise<McpServerTestResponse>;
  /** Toast shown after a successful save — the two surfaces say different things about when it applies. */
  savedMessage: string;
  /** Renders the table without any way to change it (a member who cannot write the registry). */
  readOnly?: boolean;
  /**
   * The Project's MCP registry, present only on an Agent's Tools tab. Setting it adds a
   * "add from registry" affordance that copies a registered entry in. It is deliberately
   * absent on the connectors tab: that surface *is* the registry, so there is nothing to
   * pick from — adding there means writing a new definition, not choosing an existing one.
   */
  registry?: () => Promise<MCPServerConfig[]>;
  /**
   * How the list is laid out. `table` is the Agent's Tools tab, where the servers sit among
   * other tabled settings; `cards` is the connectors tab, which is a browsing surface and
   * follows the library's card grid. Same state, same handlers, same modals either way.
   */
  layout?: "table" | "cards";
  /**
   * Hides the section's own add button, for callers that put one in their own toolbar.
   *
   * **On the connectors tab the page owns that button.** It sits in the same header slot as every
   * other tab's add button, so the one inside this section was a second entry to one dialog —
   * indistinguishable from two different actions, and labelled differently from each other
   * (「添加连接器」 up top, 「添加 MCP Server」 down here) which is worse: the same action under two
   * names. The page's button drives the same form through `addNonce`.
   *
   * Separate from `readOnly`, which removes the button because the user *cannot* add; this removes
   * it because the user *already has* one, a few lines up.
   */
  hideAddButton?: boolean;
}

/**
 * The Agent-scoped target: reads and writes the Agent's own `tools.mcpServers` copy, and
 * probes through the Agent config route (which needs the Agent only for authorization).
 * It also carries the Project registry, so an Agent can pick a server instead of retyping
 * one — the pick is copied in, which is what keeps an Agent self-contained.
 */
export function agentMcpTarget(projectId: string, agentId: string): McpSectionTarget {
  return {
    save: async (servers) => {
      const res = await api.putAgentConfig(projectId, agentId, { config: { mcpServers: servers } });
      return res.config.mcpServers;
    },
    test: (entry) => api.testAgentMcpServer(projectId, agentId, entry),
    savedMessage: S.agent.savedTakesEffect,
    registry: () => api.getMcpServers(projectId),
  };
}

export function McpServersSection({
  initial,
  target,
  filter,
  hideAddButton = false,
  addNonce = 0,
}: {
  initial: MCPServerConfig[];
  target: McpSectionTarget;
  /**
   * Narrows which entries are **displayed**, by name and connection target.
   *
   * A filter rather than a filtered `initial` on purpose: the section holds the whole list and
   * saves the whole list (`persist` replaces the registry), so handing it a subset would make any
   * edit — even one to a visible entry — write back only what was shown and silently delete every
   * entry the query had hidden. The predicate is applied to the view, so the state being edited
   * stays whole whatever is on screen.
   */
  filter?: (entry: MCPServerConfig) => boolean;
  /** The caller's own toolbar already holds an add button — see `McpSectionTarget`. */
  hideAddButton?: boolean;
  /**
   * Incremented by the caller's toolbar to open this section's add form.
   *
   * **Only meaningful with `hideAddButton`.** Together they are "the add button lives in the
   * caller's header": this prop is how that button reaches the one form, which lives here because
   * here is the registry it writes. Without the pairing the caller has a button that does nothing
   * and this section has one of its own — which is the state both were in before.
   */
  addNonce?: number;
}) {
  const [servers, setServers] = useState<MCPServerConfig[]>(initial);
  const [busy, setBusy] = useState(false);
  const readOnly = target.readOnly ?? false;
  /** `servers` narrowed for display only; every edit, index and save still refers to `servers`. */
  const visible = useMemo(
    () => (filter === undefined ? servers : servers.filter(filter)),
    [servers, filter],
  );
  // Modal state: editIndex null = adding, a number = editing that row; closed when form is null.
  const [form, setForm] = useState<McpServerFormState | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<McpFormField, McpFormError>>>({});
  // Server-side rejection (transport validation 400) rendered at the modal's foot.
  const [modalError, setModalError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  // Connectivity probe: runs the current form state through POST /config/mcp-test
  // (server-side connect + discovery, nothing saved); the result pops as a toast.
  const [testing, setTesting] = useState(false);
  // Bulk test: confirm dialog open / run in progress / per-row results keyed by server name.
  const [testAllOpen, setTestAllOpen] = useState(false);
  const [testAllRunning, setTestAllRunning] = useState(false);
  const [rowResults, setRowResults] = useState<Map<string, RowTestResult>>(new Map());
  /** Open detail modal (index into `servers`, null = closed): the browsing layout's card click. */
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  // Registry picker: open flag, the fetched list (null while loading), and a fetch error.
  const [pickOpen, setPickOpen] = useState(false);
  const [registry, setRegistry] = useState<MCPServerConfig[] | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  // http leads (the Add modal's default), stdio second, legacy sse last.
  const transportOptions: ReadonlyArray<{ value: McpTransportKind; label: string }> = [
    { value: "http", label: "http" },
    { value: "stdio", label: "stdio" },
    { value: "sse", label: "sse" },
  ];
  const transportHints: Record<McpTransportKind, string> = {
    http: S.agent.mcpTransportHttp,
    stdio: S.agent.mcpTransportStdio,
    sse: S.agent.mcpTransportSse,
  };
  // auto leads (the default); an explicit level below it overrides every tool's readOnlyHint.
  const permissionOptions: ReadonlyArray<OptionMenuChoice<McpPermissionMode>> = [
    {
      value: "auto",
      triggerLabel: S.agent.mcpPermissionAuto,
      label: S.agent.mcpPermissionAutoLabel,
      description: S.agent.mcpPermissionAutoDescription,
    },
    {
      value: "r",
      triggerLabel: "r",
      label: S.agent.permissionReadLabel,
      description: S.agent.mcpPermissionReadDescription,
    },
    {
      value: "rw",
      triggerLabel: "rw",
      label: S.agent.permissionReadWriteLabel,
      description: S.agent.mcpPermissionReadWriteDescription,
    },
  ];

  /** Persist the full list (immediate, vault-style); returns null on success or an error message. */
  const persist = async (next: MCPServerConfig[]): Promise<string | null> => {
    setBusy(true);
    try {
      setServers(await target.save(next));
      toastSuccess(target.savedMessage);
      return null;
    } catch (e) {
      return apiErrorText(e);
    } finally {
      setBusy(false);
    }
  };

  const openAdd = () => {
    setForm(emptyMcpForm());
    setEditIndex(null);
    setFieldErrors({});
    setModalError(null);
  };

  // The caller's toolbar button, arriving as a counter rather than a boolean so that pressing it
  // twice opens the form twice — a boolean would see `true` both times and do nothing the second.
  // Skipped on the first render, where the nonce has never changed and the form is closed anyway.
  const lastAddNonce = useRef(addNonce);
  useEffect(() => {
    if (addNonce === lastAddNonce.current) return;
    lastAddNonce.current = addNonce;
    openAdd();
  }, [addNonce]);

  /**
   * Opens the registry picker, loading the registry fresh on every open — the list is
   * edited on another page (Plugins · Skills → Connectors), so a cached copy would go
   * stale the moment the user switches tabs.
   */
  const openPicker = async () => {
    const fetchRegistry = target.registry;
    if (!fetchRegistry) return;
    setPickOpen(true);
    setRegistry(null);
    setPickError(null);
    try {
      setRegistry(await fetchRegistry());
    } catch (e) {
      setPickError(apiErrorText(e));
    }
  };

  /**
   * Copies a registered entry into this Agent's own list. Deep-copied on purpose: the Agent
   * stores its own copy (see McpSectionTarget.registry), and the picker's list is still on
   * screen for a second pick — sharing one `config` object between the two lists would let
   * an edit to one show up in the other before either is saved.
   */
  const pickFromRegistry = async (entry: MCPServerConfig) => {
    if (servers.some((s) => s.name === entry.name)) return;
    const next = [...servers, { name: entry.name, config: structuredClone(entry.config) }];
    const err = await persist(next);
    if (err !== null) toastError(err);
    else setPickOpen(false);
  };

  const openEdit = (index: number) => {
    const entry = servers[index];
    if (!entry) return;
    setForm(serverToForm(entry));
    setEditIndex(index);
    setFieldErrors({});
    setModalError(null);
  };

  /**
   * Probes one stored entry ("连接" on the detail modal): the same route the form's own test
   * uses, on the saved config rather than unsaved form state. The verdict lands in
   * `rowResults`, so the card and the table row show it the same way.
   */
  const testOne = async (entry: MCPServerConfig) => {
    setRowResults((prev) => new Map(prev).set(entry.name, "pending"));
    const started = Date.now();
    try {
      const res = await target.test(entry);
      setRowResults((prev) =>
        new Map(prev).set(entry.name, {
          ...res,
          latencyMs: res.latencyMs ?? Date.now() - started,
        }),
      );
    } catch (e) {
      setRowResults((prev) => new Map(prev).set(entry.name, { ok: false, error: apiErrorText(e) }));
    }
  };

  const closeModal = () => {
    setForm(null);
    setEditIndex(null);
  };

  const patchForm = (patch: Partial<McpServerFormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setFieldErrors({});
    setModalError(null);
  };

  /** Probes the current form state (unsaved values on purpose: verify before persisting). */
  const testConnection = async () => {
    if (!form) return;
    const built = formToServer(form);
    if (!built.ok) {
      setFieldErrors(built.errors);
      return;
    }
    setTesting(true);
    try {
      const res = await target.test(built.server);
      if (res.ok) toastSuccess(S.agent.mcpTestOk(res.tools?.length ?? 0, res.latencyMs));
      else toastError(S.agent.mcpTestFail(res.error ?? S.common.unknownError));
    } catch (e) {
      toastError(S.agent.mcpTestFail(apiErrorText(e)));
    } finally {
      setTesting(false);
    }
  };

  /**
   * Bulk test (section-level): every configured server through the same probe, strictly
   * sequential — parallel probes would spawn every stdio child at once — with each row's
   * badge updating as its result lands.
   */
  const runTestAll = async () => {
    setTestAllRunning(true);
    try {
      for (const entry of servers) {
        setRowResults((prev) => new Map(prev).set(entry.name, "pending"));
        let result: McpServerTestResponse;
        try {
          result = await target.test(entry);
        } catch (e) {
          result = { ok: false, error: apiErrorText(e) };
        }
        setRowResults((prev) => new Map(prev).set(entry.name, result));
      }
    } finally {
      setTestAllRunning(false);
    }
  };

  const submitModal = async () => {
    if (!form) return;
    const built = formToServer(form);
    if (!built.ok) {
      setFieldErrors(built.errors);
      return;
    }
    // Same-name collision against the other rows (the edited row may keep its own name);
    // rendered under the name field itself, like every other validation error.
    const clash = servers.some((s, i) => i !== editIndex && s.name === built.server.name);
    if (clash) {
      setFieldErrors({ name: { code: "duplicate" } });
      return;
    }
    const next =
      editIndex === null
        ? [...servers, built.server]
        : servers.map((s, i) => (i === editIndex ? built.server : s));
    const err = await persist(next);
    if (err !== null) {
      setModalError(err);
      return;
    }
    closeModal();
  };

  const confirmDelete = async () => {
    if (deleting === null) return;
    const err = await persist(servers.filter((_, i) => i !== deleting));
    if (err !== null) toastError(err);
    setDeleting(null);
  };

  // The form's target field (command / url) — the same gate the models dialog uses for its
  // test button (disabled until the identity is filled in).
  const targetFilled =
    form !== null &&
    (form.transport === "stdio" ? form.command.trim() !== "" : form.url.trim() !== "");
  const showBadges = rowResults.size > 0;

  return (
    <div className="space-y-4">
      {/* The section's own heading, on the Agent's Tools tab only.
          **Omitted on the connectors tab**, where the tab is already called 连接器 and the
          surrounding chrome says what the list is; a second "MCP Server" label under a tab named
          连接器 is the same fact stated twice, and the user who just clicked the tab has been told
          it already. The tab is the heading there, exactly as the plugin and skills tabs are their
          own headings. */}
      {target.layout !== "cards" && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
          {S.agent.mcpServers}
          <InfoPopover label={S.agent.mcpServers}>{S.agent.mcpDesc}</InfoPopover>
        </p>
      )}

      {visible.length === 0 ? (
        <SettingsEmpty>{S.agent.mcpEmpty}</SettingsEmpty>
      ) : target.layout === "cards" ? (
        /* The browsing layout: one card per server, following the library's grid. The
           description is the entry's real connection target — an MCP server has no blurb to
           show, and the target is the thing that tells two servers apart. */
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((entry) => {
            // The index into the **full** list, not the visible one: every edit, delete and
            // detail below addresses a position, and a filtered index would silently act on a
            // neighbouring entry — the worst kind of wrong, since the right card opens.
            const index = servers.indexOf(entry);
            return (
              <LibraryCard
                key={entry.name}
                name={entry.name}
                fallbackIcon={CONNECTOR_ICON}
                description={targetOf(entry)}
                meta={`${transportOf(entry)} · ${permissionOf(entry)}`}
                onOpen={() => setDetailIndex(index)}
                /* The same overlay the plugin and skill cards use, for the same reason: a group
                   this wide on a card a third of the page would otherwise cost the name a third of
                   its width. Without it the two buttons sat inline and pushed 「http · auto」 onto a
                   second line — which is what made this card read as a different system from the
                   plugin one rather than the same card in a different list. */
                actionOverlay
                action={
                  /* 28px squares with glyphs, the plugin card's scale. The words 「编辑」「删除」 in
                     ghost buttons were both too wide for a row of controls and one of the two
                     names this same action carries elsewhere (删除, on the plugin card) — so the
                     connectors list had a Delete that did not look like the Delete beside it. */
                  <div className="flex shrink-0 items-center gap-1">
                    {!readOnly && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 w-7 shrink-0 justify-center p-0"
                          aria-label={`${S.common.edit} ${entry.name}`}
                          title={S.common.edit}
                          disabled={busy}
                          onClick={() => openEdit(index)}
                        >
                          <GlyphIcon d={PENCIL_ICON} size={ICON_SIZE.iconButton} />
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 w-7 shrink-0 justify-center p-0"
                          aria-label={`${S.agent.mcpRemove} ${entry.name}`}
                          title={S.agent.mcpRemove}
                          disabled={busy}
                          onClick={() => setDeleting(index)}
                        >
                          <GlyphIcon d={TRASH_ICON} size={ICON_SIZE.iconButton} />
                        </Button>
                      </>
                    )}
                  </div>
                }
              />
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto overflow-y-clip rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                <th className="px-3 py-2.5">{S.agent.mcpName}</th>
                <th className="px-3 py-2.5">{S.agent.mcpTransport}</th>
                <th className="px-3 py-2.5">{S.agent.mcpPermission}</th>
                <th className="px-3 py-2.5">{S.agent.mcpTarget}</th>
                {/* Bulk-test badge column appears only once results exist (no headline). */}
                {showBadges && <th className="px-3 py-2.5" />}
                {/* Bulk test lives in the table's own header bar, over the actions column. */}
                <th className="px-3 py-1 text-right font-normal whitespace-nowrap">
                  {!readOnly && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || testAllRunning}
                      onClick={() => setTestAllOpen(true)}
                    >
                      {testAllRunning ? S.agent.mcpTestPending : S.agent.mcpTest}
                    </Button>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => {
                // Index into the full list, as on the cards branch: the edit/remove buttons below
                // address positions, and a filtered index edits the wrong row.
                const index = servers.indexOf(entry);
                return (
                  <tr
                    key={entry.name}
                    className="border-b border-gray-100 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40"
                  >
                    <td className="px-3 py-2 font-mono text-xs">{entry.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                      {transportOf(entry)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                      {permissionOf(entry)}
                    </td>
                    <td className="max-w-[360px] truncate px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                      {targetOf(entry)}
                    </td>
                    {showBadges && (
                      <td className="px-3 py-2 text-right">
                        <TestBadge result={rowResults.get(entry.name)} />
                      </td>
                    )}
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {!readOnly && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => openEdit(index)}
                          >
                            {S.common.edit}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setDeleting(index)}
                          >
                            {S.agent.mcpRemove}
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && !hideAddButton && (
        <div className="flex items-center gap-2">
          {target.registry !== undefined && (
            <Button size="sm" disabled={busy} onClick={() => void openPicker()}>
              {S.agent.mcpPick}
            </Button>
          )}
          <Button size="sm" variant="primary" disabled={busy} onClick={openAdd}>
            {S.agent.mcpAdd}
          </Button>
        </div>
      )}

      {/* Registry picker: a list, not a form — it copies an entry the Project already
          defines. Entries already on this Agent stay visible but inert, so the list does
          not silently change shape as things get added. */}
      <Modal
        open={pickOpen}
        title={S.agent.mcpPickTitle}
        onClose={() => setPickOpen(false)}
        footer={<Button onClick={() => setPickOpen(false)}>{S.common.close}</Button>}
      >
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.agent.mcpPickDesc}</p>
        {pickError !== null ? (
          <SettingsEmpty>{pickError}</SettingsEmpty>
        ) : registry === null ? (
          <Skeleton className="h-24 w-full" />
        ) : registry.length === 0 ? (
          <SettingsEmpty>{S.agent.mcpPickEmpty}</SettingsEmpty>
        ) : (
          <div className="divide-y divide-gray-200 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {registry.map((entry) => {
              const added = servers.some((s) => s.name === entry.name);
              return (
                <div key={entry.name} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm text-gray-900 dark:text-gray-100">
                      {entry.name}
                    </p>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {targetOf(entry)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={added ? "ghost" : "primary"}
                    disabled={busy || added}
                    onClick={() => void pickFromRegistry(entry)}
                  >
                    {added ? S.agent.mcpPickAdded : S.agent.mcpPickAdd}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        {registry !== null &&
          registry.length > 0 &&
          servers.length > 0 &&
          registry.every((entry) => servers.some((s) => s.name === entry.name)) && (
            <p className="text-xs text-gray-400 dark:text-gray-500">{S.agent.mcpPickAllAdded}</p>
          )}
      </Modal>

      {/* The entry the dialog is about, resolved ONCE. The footer below is a JSX node, so it
          is evaluated on every render whether or not the dialog is open — indexing `servers`
          with a nullable index there threw on the very first render and took the whole tab
          with it. One local binding, read by everything including the callbacks, since a
          narrowing on a prop of the JSX does not survive into a closure. */}
      {detailIndex !== null && servers[detailIndex] !== undefined && (
        <DetailModal
          entry={servers[detailIndex]}
          result={rowResults.get(servers[detailIndex].name)}
          busy={busy}
          editable={!readOnly}
          onClose={() => setDetailIndex(null)}
          onTest={() => {
            const entry = detailIndex === null ? undefined : servers[detailIndex];
            if (entry !== undefined) void testOne(entry);
          }}
        />
      )}

      <Modal
        open={form !== null}
        title={editIndex === null ? S.agent.mcpAdd : S.agent.mcpEditTitle}
        onClose={closeModal}
        footer={
          <>
            <Button onClick={closeModal}>{S.common.cancel}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void submitModal()}>
              {S.common.save}
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-3">
            {/* Transport first, as tab-style switches — the choice decides every field below. */}
            <div className="space-y-1">
              <Segmented
                options={transportOptions}
                value={form.transport}
                onChange={(v) => patchForm({ transport: v })}
              />
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {transportHints[form.transport]}
              </p>
            </div>
            {/* Entry-level action right under the tabs — the models dialog idiom: a standalone
                test button, enabled once the target (command / url) is filled in; the result
                pops as a toast. */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={testing || busy || !targetFilled}
                onClick={() => void testConnection()}
              >
                {testing ? S.agent.mcpTesting : S.agent.mcpTest}
              </Button>
            </div>
            <Input
              size="sm"
              label={S.agent.mcpName}
              required
              hint={S.agent.mcpNameHint}
              error={errorText(fieldErrors.name)}
              value={form.name}
              onChange={(e) => patchForm({ name: e.target.value })}
              className="font-mono"
              placeholder="filesystem"
              autoComplete="off"
            />
            {form.transport === "stdio" ? (
              <>
                <Input
                  size="sm"
                  label={S.agent.mcpCommand}
                  required
                  error={errorText(fieldErrors.command)}
                  value={form.command}
                  onChange={(e) => patchForm({ command: e.target.value })}
                  className="font-mono"
                  placeholder="npx"
                  autoComplete="off"
                />
                <Textarea
                  size="sm"
                  mono
                  label={S.agent.mcpArgs}
                  hint={S.agent.mcpArgsHint}
                  rows={3}
                  value={form.argsText}
                  onChange={(e) => patchForm({ argsText: e.target.value })}
                  placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."}
                />
                <Textarea
                  size="sm"
                  mono
                  label={S.agent.mcpEnv}
                  hint={S.agent.mcpEnvHint}
                  error={errorText(fieldErrors.env)}
                  rows={2}
                  value={form.envText}
                  onChange={(e) => patchForm({ envText: e.target.value })}
                  placeholder="API_TOKEN=..."
                />
                <Input
                  size="sm"
                  label={S.agent.mcpCwd}
                  hint={S.agent.mcpCwdHint}
                  value={form.cwd}
                  onChange={(e) => patchForm({ cwd: e.target.value })}
                  className="font-mono"
                  autoComplete="off"
                />
              </>
            ) : (
              <>
                <Input
                  size="sm"
                  label={S.agent.mcpUrl}
                  required
                  error={errorText(fieldErrors.url)}
                  value={form.url}
                  onChange={(e) => patchForm({ url: e.target.value })}
                  className="font-mono"
                  placeholder="https://example.com/mcp"
                  autoComplete="off"
                />
                <Textarea
                  size="sm"
                  mono
                  label={S.agent.mcpHeaders}
                  hint={S.agent.mcpHeadersHint}
                  error={errorText(fieldErrors.headers)}
                  rows={2}
                  value={form.headersText}
                  onChange={(e) => patchForm({ headersText: e.target.value })}
                  placeholder="Authorization: Bearer ..."
                />
              </>
            )}
            <div className="space-y-1">
              <OptionMenu
                mono
                size="sm"
                fullWidth
                label={S.agent.mcpPermission}
                options={permissionOptions}
                value={form.permission}
                onChange={(v) => patchForm({ permission: v })}
              />
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {S.agent.mcpPermissionHint}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input
                size="sm"
                label={S.agent.mcpConnectTimeout}
                error={errorText(fieldErrors.connectTimeoutMs)}
                value={form.connectTimeoutMs}
                inputMode="numeric"
                onChange={(e) => patchForm({ connectTimeoutMs: e.target.value })}
                className="font-mono"
                autoComplete="off"
              />
              <Input
                size="sm"
                label={S.agent.toolTimeout}
                error={errorText(fieldErrors.timeoutMs)}
                value={form.timeoutMs}
                inputMode="numeric"
                onChange={(e) => patchForm({ timeoutMs: e.target.value })}
                className="font-mono"
                autoComplete="off"
              />
              <Input
                size="sm"
                label={S.agent.toolMaxOutput}
                error={errorText(fieldErrors.maxOutputLength)}
                value={form.maxOutputLength}
                inputMode="numeric"
                onChange={(e) => patchForm({ maxOutputLength: e.target.value })}
                className="font-mono"
                autoComplete="off"
              />
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">{S.agent.mcpBudgetsHint}</p>
            {modalError && <p className="text-xs text-red-600 dark:text-red-400">{modalError}</p>}
          </div>
        )}
      </Modal>

      {/* Bulk-test confirm (the group speed-test idiom): explain what will run, then go. */}
      <Modal
        open={testAllOpen}
        title={S.agent.mcpTest}
        onClose={() => setTestAllOpen(false)}
        footer={
          <>
            <Button onClick={() => setTestAllOpen(false)}>{S.common.cancel}</Button>
            <Button
              variant="primary"
              onClick={() => {
                setTestAllOpen(false);
                void runTestAll();
              }}
            >
              {S.agent.mcpTestAllStart}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.agent.mcpTestAllConfirm(servers.length)}
        </p>
      </Modal>

      <ConfirmModal
        open={deleting !== null}
        title={S.agent.mcpDeleteTitle}
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting !== null ? S.agent.mcpDeleteConfirm(servers[deleting]?.name ?? "") : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}
