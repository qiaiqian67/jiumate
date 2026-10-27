/**
 * Project dialogs: create Project, Project settings
 * (member management and deletion, owner only). Invoked from the sidebar's Project switcher.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
  ApprovalMode,
  ChatDefaultsDto,
  CommandPolicyDto,
  CommandPolicyRuleDto,
  MemberInfo,
  ModelRefDto,
  ModelsResponse,
} from "@jadelau/server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import {
  PROJECT_ID_MAX_LENGTH,
  PROJECT_SUFFIX_PATTERN,
  SEMANTIC_ID_PATTERN,
} from "../../lib/semantic-id";
import {
  DEFAULT_PROJECT_ID,
  agentDisplayName,
  projectDisplayName,
  projectRoleLabel,
  useProject,
} from "../../state/project";
import { useAuth } from "../../state/auth";
import { clearDraftChatDefaults, clearDraftModelRef } from "../../features/chat/draft-cache";
import {
  dispatchChatDefaultsChanged,
  type ChatDefaultsChangedDetail,
} from "../../features/chat/chat-defaults-event";
import { ModelSelect } from "../../features/chat/model-select";
import { SELECTABLE_THINKING_LEVELS } from "../../features/chat/thinking-level";
import { WorkspaceSelect } from "../../features/chat/workspace-select";
import { sameModelRef } from "../../features/models/model-grouping";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { GEAR_ICON } from "../ui/icons";
import { FieldError, FieldHint, FieldLabel } from "../ui/field";
import { toastError, toastSuccess } from "../ui/toast";
import { Modal } from "../ui/modal";
import { ConfirmModal } from "../ui/confirm-modal";
import { Badge } from "../ui/badge";
import { InfoPopover } from "../ui/info-popover";

/** Approval modes offered by the new-chat-defaults select, in the composer menu's order. */
const APPROVAL_MODES: readonly ApprovalMode[] = [
  "always-ask",
  "read-only",
  "allow-all",
  "deny-all",
];

export function CreateProjectDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const { user } = useAuth();
  // Non-admin Project ids are forced to have a "<username>-" prefix: the input locks the prefix segment, only the rest is editable.
  const prefix = user && !user.isAdmin ? `${user.userId}-` : "";
  const [idInput, setIdInput] = useState("");
  const [name, setName] = useState("");
  // The id is the only validated field; format problems and the server's rejection (e.g. duplicate id) both land beside it.
  const [idError, setIdError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // No draft is kept: the form starts empty every time it opens.
  useEffect(() => {
    if (!open) return;
    setIdInput("");
    setName("");
    setIdError(undefined);
  }, [open]);

  const submit = async () => {
    const id = prefix + idInput.trim();
    if (!idInput.trim()) {
      setIdError(S.common.requiredField);
      return;
    }
    // Non-admin: validate the suffix segment (the hyphen is a reserved separator, appearing only once at the prefix join); admin: validate the whole string.
    const valid = prefix
      ? PROJECT_SUFFIX_PATTERN.test(idInput.trim()) && id.length <= PROJECT_ID_MAX_LENGTH
      : SEMANTIC_ID_PATTERN.test(id);
    if (!valid) {
      setIdError(prefix ? S.project.idPrefixHint : S.project.idHint);
      return;
    }
    setBusy(true);
    setIdError(undefined);
    try {
      const res = await api.createProject({
        projectId: id,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      onCreated(res.project.projectId);
    } catch (e) {
      setIdError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={S.project.createTitle}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {S.common.create}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {prefix ? (
          <div>
            <FieldLabel required>{S.project.id}</FieldLabel>
            <div className="flex items-stretch">
              <span className="flex shrink-0 items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-100 px-2 font-mono text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                {prefix}
              </span>
              <Input
                size="sm"
                className="rounded-l-none"
                value={idInput}
                invalid={Boolean(idError)}
                onChange={(e) => {
                  setIdInput(e.target.value);
                  setIdError(undefined);
                }}
                autoFocus
              />
            </div>
            {idError ? (
              <FieldError>{idError}</FieldError>
            ) : (
              <FieldHint>{S.project.idPrefixHint}</FieldHint>
            )}
          </div>
        ) : (
          <Input
            label={S.project.id}
            required
            size="sm"
            value={idInput}
            error={idError}
            onChange={(e) => {
              setIdInput(e.target.value);
              setIdError(undefined);
            }}
            hint={S.project.idHint}
            autoFocus
          />
        )}
        <Input
          label={S.project.displayName}
          hint={S.project.displayNameHint}
          size="sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
    </Modal>
  );
}

/**
 * 项目设置各页的一行：左边标题（可带一行说明），右边控件。与系统设置的 PrefRow 同一形状，
 * 因为这几页现在也挂在系统设置里，混用两种行样式会让同一个设置菜单看起来像两个产品。
 */
function SettingRow({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{title}</p>
        {description !== undefined && <p className="mt-0.5 text-xs text-gray-400">{description}</p>}
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * 管理页（原 Project settings 的「通用」）：显示名（Project 唯一可编辑的字段——id 命名
 * 目录与所有存储引用，所以不可变，只给一行只读展示）、新建项目入口，以及删除区。
 *
 * `onGone` 是删除成功后的离场回调，而不是弹窗的 onClose：弹窗时代它关弹窗，而这一页现在
 * 挂在系统设置里、删掉当前项目后已经没有"上一层"可关，必须由调用方决定去哪（设置页选择
 * 回到工作区）。
 */
export function ProjectManageSection({
  projectId,
  isOwner,
  onGone,
}: {
  projectId: string;
  isOwner: boolean;
  /** Current Project deleted: leave this page. */
  onGone?: () => void;
}) {
  const { currentProject, setCurrentProjectId, projects, reloadProjects } = useProject();
  /** The saved display name, with the same id fallback the switcher shows. */
  const savedName = currentProject ? projectDisplayName(currentProject) : "";
  /** Display-name edit buffer (owner only); saving is explicit, so it stays dirty until Save or remount. */
  const [name, setName] = useState(savedName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creating, setCreating] = useState(false);

  const saveName = async () => {
    const next = name.trim();
    if (!next || next === savedName || nameBusy) return;
    setNameBusy(true);
    setNameError(undefined);
    try {
      await api.updateProject(projectId, { name: next });
      await reloadProjects();
    } catch (e) {
      setNameError(apiErrorText(e));
    } finally {
      setNameBusy(false);
    }
  };

  const doDelete = async () => {
    try {
      await api.deleteProject(projectId);
      // 先离场再切换：onGone 可能卸载整个页面（设置页 → 工作区），而下面还要读
      // projects / reloadProjects，过早卸载会让后续的状态更新打在一个已消失的组件上。
      onGone?.();
      const next = projects.find((p) => p.projectId !== projectId);
      await reloadProjects();
      if (next) setCurrentProjectId(next.projectId);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
      {/* 新建项目：本页的入口，而不是侧边栏或用户菜单里的一处。它和"改名 / 删除"是同一件
          事的三面——都在管理**项目**本身——所以放在这里，读起来是"关于项目的操作都在这一
          页"。弹窗复用 CreateProjectDialog，所以字段、校验和建完后的切换行为与原来的入口
          完全一致，这里只决定"什么时候能打开它"。 */}
      <SettingRow title={S.project.newProject} description={S.project.newProjectInfo}>
        <Button size="sm" onClick={() => setCreating(true)}>
          {S.project.newProject}
        </Button>
      </SettingRow>
      <SettingRow title={S.project.displayName}>
        {isOwner ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-stretch gap-2">
              <Input
                size="sm"
                className="w-44"
                value={name}
                invalid={Boolean(nameError)}
                maxLength={100}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(undefined);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveName();
                }}
              />
              <Button
                size="sm"
                disabled={nameBusy || !name.trim() || name.trim() === savedName}
                onClick={() => void saveName()}
              >
                {S.common.save}
              </Button>
            </div>
            {nameError !== undefined && <FieldError>{nameError}</FieldError>}
          </div>
        ) : (
          <span className="text-sm">{savedName}</span>
        )}
      </SettingRow>
      <SettingRow title={S.project.projectIdLabel}>
        <span className="font-mono text-xs text-gray-400">{projectId}</span>
      </SettingRow>
      {isOwner &&
        (projectId === DEFAULT_PROJECT_ID ? (
          // 默认项目：两句话（"与 CLI 共用" + "目录会被递归删除"）合成一个感叹号。分开摆
          // 会占掉两行常驻文字；而后者恰恰是最该在按下按钮前被读到的那句，藏在第二行
          // 说明里等于没写。感叹号的语气也在说"先看这个"。
          <SettingRow title={S.project.deleteProject}>
            <InfoPopover label={S.project.deleteProject} tone="warn">
              {S.project.deleteDefaultForbidden}
            </InfoPopover>
          </SettingRow>
        ) : projects.length <= 1 ? (
          // Last accessible Project: deleting it would leave the account with no Project to
          // select (the page would get stuck on the skeleton screen), so the entry point is
          // hidden outright, matching the server's 409 rejection.
          <SettingRow title={S.project.deleteProject} description={S.project.deleteLastForbidden} />
        ) : (
          <SettingRow title={S.project.deleteProject} description={S.project.deleteProjectDesc}>
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
              {S.common.delete}
            </Button>
          </SettingRow>
        ))}

      {/* Create-project, opened from this page's button. Mounted here rather than at the app
          root so it unmounts with the page — the dialog is only reachable while it is up. */}
      <CreateProjectDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(newId) => {
          // 建完就切过去，和原来从侧边栏新建的行为一致：新建的用途就是马上用。列表先刷新
          // 再切，否则新项目还不在列表里、当前项目却已经指向它。
          setCreating(false);
          void reloadProjects().then(() => setCurrentProjectId(newId));
        }}
      />

      {/* Delete confirmation (shared ConfirmModal, stacked above the settings dialog). */}
      <ConfirmModal
        open={confirmDelete}
        title={S.project.deleteProject}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.project.deleteConfirm}</p>
      </ConfirmModal>
    </div>
  );
}

/**
 * Members page: the permission table (username / role / actions; owner adds and removes,
 * members read). Only the initial load shows inline (in place of the table); action
 * failures pop a toast. Mounted per tab visit, so revisiting refetches.
 */
export function MembersSection({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const { user } = useAuth();
  const [members, setMembers] = useState<MemberInfo[] | null>(null);
  const [newMemberId, setNewMemberId] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMembers(null);
    setLoadError(null);
    api
      .listMembers(projectId)
      .then((res) => {
        if (!cancelled) setMembers(res.members);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const addMember = async () => {
    if (!newMemberId.trim()) return;
    try {
      await api.addMember(projectId, { userId: newMemberId.trim() });
      setNewMemberId("");
      const res = await api.listMembers(projectId);
      setMembers(res.members);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  const doRemove = async (memberId: string) => {
    try {
      await api.removeMember(projectId, memberId);
      const res = await api.listMembers(projectId);
      setMembers(res.members);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  if (loadError) return <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>;
  if (members === null) return <p className="text-xs text-gray-400">{S.common.loading}</p>;
  return (
    // Member permission table: username / role / actions; cells never wrap. Last row
    // (owner only) = add member: small username input + add button (new members are
    // always the member role).
    <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400">
            <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">{S.common.username}</th>
            <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">{S.common.role}</th>
            <th className="w-20 whitespace-nowrap px-2.5 py-1.5 text-right font-medium">
              {S.common.actions}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
          {members.map((m) => (
            <tr key={m.userId}>
              <td className="whitespace-nowrap px-2.5 py-1.5">{m.userId}</td>
              <td className="whitespace-nowrap px-2.5 py-1.5">
                <Badge tone="gray">{projectRoleLabel(m.role)}</Badge>
              </td>
              <td className="whitespace-nowrap px-2.5 py-1 text-right">
                {isOwner && m.role !== "owner" && m.userId !== user?.userId && (
                  <Button size="sm" variant="ghost" onClick={() => void doRemove(m.userId)}>
                    {S.project.removeMember}
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {isOwner && (
            <tr>
              <td className="px-2.5 py-1.5">
                <Input
                  placeholder={S.common.username}
                  size="sm"
                  value={newMemberId}
                  onChange={(e) => setNewMemberId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addMember();
                  }}
                />
              </td>
              <td className="whitespace-nowrap px-2.5 py-1.5">
                <Badge tone="gray">member</Badge>
              </td>
              <td className="whitespace-nowrap px-2.5 py-1 text-right">
                <Button size="sm" disabled={!newMemberId.trim()} onClick={() => void addMember()}>
                  {S.project.addMember}
                </Button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * "New chat defaults" section of the Project settings dialog (below Members, above the
 * delete zone): the `[default_chat]` block (Agent / Workspace / approval mode / thinking
 * level) plus the Project's default model, laid out as a compact responsive two-column
 * grid. Workspace and model reuse the chat draft's own pickers — WorkspaceSelect (the
 * dir browser) and ModelSelect (the composer's model dropdown) — with their `form`
 * trigger variant, so the controls line up with the dialog's Input/Select while the
 * POPOVER menus stay exactly the composer's.
 * The model default is SINGLE-SOURCED with the models page — the picker renders and writes
 * the same top-level `default_model` (via the narrow PUT /models/default route), never a
 * second key; changing it also releases the draft-cached model pin exactly as the models
 * page does (shared clearDraftModelRef helper). Owner edits with ONE explicit Save for the
 * whole section (dialog convention: failures toast, success is silent — the refreshed
 * values are the confirmation); members see the values read-only. Mounted per dialog open
 * (the Modal unmounts its children when closed), so reopening always refetches.
 */
export function ChatDefaultsSection({
  projectId,
  isOwner,
}: {
  projectId: string;
  isOwner: boolean;
}) {
  const { user } = useAuth();
  const { agents } = useProject();
  /** Saved block (null while loading); edit buffers below use "" for "not set". */
  const [saved, setSaved] = useState<ChatDefaultsDto | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [approval, setApproval] = useState("");
  const [thinking, setThinking] = useState("");
  /** The default-model pick (paired reference; seeded from the models response's defaultModel). */
  const [modelRef, setModelRef] = useState<ModelRefDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getChatDefaults(projectId)
      .then((res) => {
        if (cancelled) return;
        setSaved(res);
        setAgentId(res.agentId ?? "");
        setWorkspace(res.workspace ?? "");
        setApproval(res.approvalMode ?? "");
        setThinking(res.thinkingLevel ?? "");
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      });
    api
      .getModels(projectId)
      .then((res) => {
        if (cancelled) return;
        setModels(res);
        setModelRef(res.defaultModel ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const blockDirty =
    saved !== null &&
    (agentId !== (saved.agentId ?? "") ||
      workspace.trim() !== (saved.workspace ?? "") ||
      approval !== (saved.approvalMode ?? "") ||
      thinking !== (saved.thinkingLevel ?? ""));
  const modelDirty =
    models !== null && modelRef !== null && !sameModelRef(models.defaultModel, modelRef);

  /**
   * One Save persists both writes: the `[default_chat]` block (whole-block PUT — a field
   * left "not set" is simply omitted, which clears it) and, when changed, the default
   * model via the narrow route. Failures toast and keep the edits for retry.
   *
   * Each landed write also resets the saving user's new-conversation draft so new chats
   * pick the change up instead of being shadowed by the values a previous /chat/new visit
   * pinned into the cache: the corresponding cache fields are stripped (typed text and
   * staged skills always survive), and one same-tab event carries the fresh values to any
   * MOUNTED draft view — its component state still holds the old selections and its
   * debounced persist would silently write them right back over the stripped cache.
   */
  const save = async () => {
    if (busy || (!blockDirty && !modelDirty)) return;
    setBusy(true);
    // Collected per landed write, dispatched in `finally`: when the block PUT lands but the
    // model PUT throws, the block change still happened server-side and live views must
    // still reseed from it.
    let changed: ChatDefaultsChangedDetail | null = null;
    try {
      if (blockDirty) {
        const body: ChatDefaultsDto = {
          ...(agentId ? { agentId } : {}),
          ...(workspace.trim() ? { workspace: workspace.trim() } : {}),
          ...(approval ? { approvalMode: approval as ApprovalMode } : {}),
          ...(thinking ? { thinkingLevel: thinking as ChatDefaultsDto["thinkingLevel"] } : {}),
        };
        const stored = await api.putChatDefaults(projectId, body);
        setSaved(stored);
        // Release the draft-cached Agent / Workspace / approval pins so the next
        // /chat/new seeds from the just-saved block. The model pin is deliberately NOT
        // touched here: it is the switch-becomes-default carry-over, released only below
        // when the default model itself changed.
        if (user) clearDraftChatDefaults(user.userId, projectId);
        changed = { projectId, defaults: stored };
      }
      if (modelDirty && modelRef) {
        const res = await api.putDefaultModel(projectId, {
          provider: modelRef.provider,
          modelId: modelRef.modelId,
        });
        setModels((m) => (m ? { ...m, defaultModel: res.defaultModel } : m));
        // Same follow-through as the models page: drop the draft-cached model pin so open
        // drafts pick up the new default.
        if (user) clearDraftModelRef(user.userId, projectId);
        changed = { ...(changed ?? { projectId }), defaultModel: res.defaultModel };
      }
      // Both writes landed (the try didn't throw): confirm it — the dialog stays open, so
      // without a toast a successful save is silent. `changed` is non-null whenever
      // anything was actually written (the early-return above guards the no-op case).
      if (changed) toastSuccess(S.common.saved);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      if (changed) dispatchChatDefaultsChanged(changed);
      setBusy(false);
    }
  };

  /** Read-only display values (member view). */
  const agentText = saved?.agentId
    ? (() => {
        const a = agents.find((x) => x.agentId === saved.agentId);
        return a ? agentDisplayName(a) : saved.agentId;
      })()
    : S.project.chatDefaultsNotSet;
  const defaultModelInfo = models?.models.find((m) => sameModelRef(m, models.defaultModel));

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-500">
        {S.project.chatDefaultsTitle}
        <InfoPopover label={S.project.chatDefaultsTitle}>{S.project.chatDefaultsHint}</InfoPopover>
      </p>
      {loadError ? (
        <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>
      ) : saved === null || models === null ? (
        <p className="text-xs text-gray-400">{S.common.loading}</p>
      ) : isOwner ? (
        <>
          {/* Compact responsive grid: label + control stacked per cell, two columns from sm
              up; the workspace picker spans the full row for path width. Workspace and model
              are the chat draft's own pickers, not plain form controls. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label={S.project.chatDefaultsAgent}
              size="sm"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">{S.project.chatDefaultsNotSet}</option>
              {agents.map((a) => (
                <option key={a.agentId} value={a.agentId}>
                  {agentDisplayName(a)}
                </option>
              ))}
            </Select>
            <Select
              label={S.chat.approvalMode}
              size="sm"
              value={approval}
              onChange={(e) => setApproval(e.target.value)}
            >
              <option value="">{S.project.chatDefaultsApprovalNotSet}</option>
              {APPROVAL_MODES.map((m) => (
                <option key={m} value={m}>
                  {S.chat.approvalModeNames[m] ?? m}
                </option>
              ))}
            </Select>
            {/* Plain tier names, not the composer dropdown's annotated variant: a native
                <select> paints the picked option's own text on the collapsed control, so
                annotating the rows here would also put "(xhigh)" on what is, once closed,
                a trigger. Matches the approval-mode select directly above, whose options
                are plain localized names too. */}
            <Select
              label={S.chat.thinkingLevel}
              size="sm"
              value={thinking}
              onChange={(e) => setThinking(e.target.value)}
            >
              <option value="">{S.project.chatDefaultsThinkingNotSet}</option>
              {SELECTABLE_THINKING_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {S.chat.thinkingLevelNames[l] ?? l}
                </option>
              ))}
            </Select>
            <div>
              <span className="mb-1 flex items-center gap-1">
                <FieldLabel block={false}>{S.chat.model}</FieldLabel>
                <InfoPopover label={S.chat.model}>{S.project.chatDefaultsModelHint}</InfoPopover>
              </span>
              {models.models.length > 0 ? (
                <>
                  {/* The composer's model dropdown (provider logo + name + searchable grouped
                      panel); the default row carries the S.models.default marker. */}
                  <ModelSelect
                    models={models.models}
                    value={modelRef}
                    defaultModel={models.defaultModel}
                    onChange={setModelRef}
                    disabled={busy}
                    variant="form"
                  />
                </>
              ) : (
                <p className="text-xs text-gray-400">{S.models.empty}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>{S.chat.workspace}</FieldLabel>
              {/* The draft page's dir-browser pill: browse server directories, edit the path
                  inline, or clear back to a temporary workspace. */}
              <WorkspaceSelect
                projectId={projectId}
                workspace={workspace}
                onChange={setWorkspace}
                variant="form"
              />
              <FieldHint>{S.chat.workspaceHintShort}</FieldHint>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              disabled={busy || (!blockDirty && !modelDirty)}
              onClick={() => void save()}
            >
              {S.common.save}
            </Button>
          </div>
        </>
      ) : (
        // Member view: the effective defaults, read-only (same fields, plain text).
        <div className="space-y-1 text-sm">
          {(
            [
              [S.project.chatDefaultsAgent, agentText],
              [S.chat.workspace, saved.workspace ?? S.chat.workspaceAuto],
              [
                S.chat.approvalMode,
                saved.approvalMode
                  ? (S.chat.approvalModeNames[saved.approvalMode] ?? saved.approvalMode)
                  : S.project.chatDefaultsApprovalNotSet,
              ],
              [
                S.chat.thinkingLevel,
                saved.thinkingLevel
                  ? (S.chat.thinkingLevelNames[saved.thinkingLevel] ?? saved.thinkingLevel)
                  : S.project.chatDefaultsThinkingNotSet,
              ],
              [
                S.chat.model,
                defaultModelInfo
                  ? (defaultModelInfo.displayName ?? defaultModelInfo.modelId)
                  : S.project.chatDefaultsNotSet,
              ],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-2">
              <span className="w-24 shrink-0 text-xs text-gray-500">{label}</span>
              <span className="min-w-0 flex-1 break-all">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Field-level equality for the security page's dirty check (description "" ≡ absent). */
function sameRule(a: CommandPolicyRuleDto, b: CommandPolicyRuleDto): boolean {
  return (
    a.name === b.name &&
    a.pattern === b.pattern &&
    (a.description ?? "") === (b.description ?? "") &&
    a.enabled === b.enabled
  );
}

/**
 * Buffered rule editor, shared by add and edit: local field state, the pattern validated
 * as a compilable regex on apply (the server re-checks — "saved" must equal "enforced").
 * Exported for test/command-policy-add-rule.test.ts, which renders it on its own.
 */
export function RuleEditor({
  initial,
  onApply,
  onCancel,
}: {
  initial: CommandPolicyRuleDto | null;
  onApply: (rule: CommandPolicyRuleDto) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [pattern, setPattern] = useState(initial?.pattern ?? "");
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [err, setErr] = useState<string | undefined>(undefined);

  const apply = () => {
    const n = name.trim();
    const p = pattern.trim();
    if (!n || !p) return;
    try {
      new RegExp(p);
    } catch {
      setErr(S.project.commandPolicyInvalidPattern);
      return;
    }
    const d = desc.trim();
    onApply({
      name: n,
      pattern: p,
      ...(d !== "" ? { description: d } : {}),
      enabled: initial?.enabled ?? true,
    });
  };

  return (
    <div className="space-y-2 py-3">
      {/* Name and pattern are both mandatory — Apply stays disabled without either — and the red
          "*" is what says so; the description carries no mark because it is optional. The flex
          sizing sits on the wrappers because a labelled Input renders its own <label> block
          around the control, so the control itself is not the flex item. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="sm:w-40">
          <Input
            size="sm"
            label={S.project.commandPolicyRuleName}
            required
            value={name}
            maxLength={64}
            // The editor mounts only on an explicit Add / Edit click, so taking focus is what
            // that click asked for: it puts the caret in the first field for a keyboard user,
            // and the browser's scroll-on-focus keeps the form in view on a short viewport.
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="min-w-0 flex-1">
          <Input
            size="sm"
            className="font-mono"
            label={S.project.commandPolicyRulePattern}
            required
            value={pattern}
            maxLength={512}
            {...(err !== undefined ? { error: err } : {})}
            onChange={(e) => {
              setPattern(e.target.value);
              if (err) setErr(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
          />
        </div>
      </div>
      <Input
        size="sm"
        label={S.project.commandPolicyRuleDesc}
        value={desc}
        maxLength={300}
        onChange={(e) => setDesc(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {S.common.cancel}
        </Button>
        <Button size="sm" disabled={!name.trim() || !pattern.trim()} onClick={apply}>
          {S.project.commandPolicyApplyRule}
        </Button>
      </div>
    </div>
  );
}

/**
 * Security-policy page: the `[command_policy]` block. One unified, fully editable rule
 * list — the factory rules are seeded data with no special status (edit / disable /
 * delete / add all apply), and "restore defaults" re-buffers the factory set served by the
 * API (buffered like every other edit — Save is what writes it). Owner edits buffer
 * locally with ONE explicit Save (dialog convention: failures toast, success toasts
 * saved); members see the effective state read-only. The list dims AND disables while the
 * master switch is off, but Save stays live so the toggle itself can be saved.
 */
export function SecurityPolicySection({
  projectId,
  isOwner,
}: {
  projectId: string;
  isOwner: boolean;
}) {
  const [saved, setSaved] = useState<CommandPolicyDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [rules, setRules] = useState<CommandPolicyRuleDto[]>([]);
  /** Index being edited inline, "new" for the add form, null when idle. */
  const [editing, setEditing] = useState<number | "new" | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Cleared first: the effect re-fires per project, and the error branch renders ahead of
    // the loaded one — a stale error would outlive a later successful load.
    setSaved(null);
    setLoadError(null);
    setEditing(null);
    api
      .getCommandPolicy(projectId)
      .then((res) => {
        if (cancelled) return;
        setSaved(res);
        setEnabled(res.enabled);
        setRules(res.rules);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const dirty =
    saved !== null &&
    (enabled !== saved.enabled ||
      rules.length !== saved.rules.length ||
      rules.some((r, i) => !sameRule(r, saved.rules[i]!)));

  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    try {
      const stored = await api.putCommandPolicy(projectId, { enabled, rules });
      setSaved(stored);
      setEnabled(stored.enabled);
      setRules(stored.rules);
      toastSuccess(S.common.saved);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {loadError !== null ? (
        <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>
      ) : saved === null ? (
        <p className="text-xs text-gray-400">{S.common.loading}</p>
      ) : (
        <>
          <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
            <SettingRow
              title={S.project.commandPolicyEnable}
              description={S.project.commandPolicyEnableDesc}
            >
              {isOwner ? (
                <Switch checked={enabled} onChange={setEnabled} disabled={busy} />
              ) : (
                <span className="text-xs text-gray-400">
                  {enabled ? S.project.commandPolicyOn : S.project.commandPolicyOff}
                </span>
              )}
            </SettingRow>
          </div>
          {/* The list is inert while the master switch is off. `opacity` alone would leave
              every control focusable, so each one below disables on `!enabled` as well. */}
          <div className={enabled ? "" : "opacity-50"}>
            <div className="flex items-center justify-between gap-2 border-t border-gray-100 py-1.5 dark:border-gray-800/60">
              <p className="text-xs font-medium text-gray-500">
                {S.project.commandPolicyRules} ·{" "}
                <span className="font-semibold">{rules.length}</span>
              </p>
              {isOwner && (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !enabled || editing !== null}
                    onClick={() => setRules(saved.defaultRules.map((r) => ({ ...r })))}
                  >
                    {S.project.commandPolicyRestore}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !enabled || editing !== null}
                    onClick={() => setEditing("new")}
                  >
                    {S.project.commandPolicyAddRule}
                  </Button>
                </div>
              )}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
              {/* The add form opens at the TOP of the list, right under the Add button that
                  asked for it: the factory rules alone make the list taller than the dialog's
                  scroll box, so a form appended after them would open below the fold and the
                  click would look like it did nothing. The rule it applies stays where it was
                  typed for the same reason. Deny rules are order-independent — every enabled
                  match refuses, and list order only picks which rule name the refusal
                  reports — so the head of the list is as good a home as the tail. */}
              {editing === "new" && (
                <RuleEditor
                  initial={null}
                  onApply={(nr) => {
                    setRules([nr, ...rules]);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              )}
              {rules.map((r, i) =>
                editing === i ? (
                  <RuleEditor
                    key={`edit-${i}`}
                    initial={r}
                    onApply={(nr) => {
                      setRules(rules.map((x, j) => (j === i ? nr : x)));
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div
                    key={`${r.name}-${i}`}
                    className={`flex items-center gap-3 py-2.5 ${r.enabled ? "" : "opacity-60"}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{r.name}</p>
                      {r.description !== undefined && (
                        <p className="mt-0.5 text-xs text-gray-400">{r.description}</p>
                      )}
                      <p
                        className="mt-0.5 truncate font-mono text-[11px] text-gray-400"
                        title={r.pattern}
                      >
                        {r.pattern}
                      </p>
                    </div>
                    {isOwner ? (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Switch
                          checked={r.enabled}
                          disabled={busy || !enabled}
                          onChange={(v) =>
                            setRules(rules.map((x, j) => (j === i ? { ...x, enabled: v } : x)))
                          }
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || !enabled || editing !== null}
                          onClick={() => setEditing(i)}
                        >
                          {S.project.commandPolicyEditRule}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || !enabled || editing !== null}
                          onClick={() => setRules(rules.filter((_, j) => j !== i))}
                        >
                          {S.common.delete}
                        </Button>
                      </div>
                    ) : (
                      <span className="shrink-0 text-xs text-gray-400">
                        {r.enabled ? S.project.commandPolicyOn : S.project.commandPolicyOff}
                      </span>
                    )}
                  </div>
                ),
              )}
              {rules.length === 0 && editing !== "new" && (
                <p className="py-3 text-xs text-gray-400">{S.project.commandPolicyEmpty}</p>
              )}
            </div>
          </div>
          {isOwner && (
            <div className="mt-2 flex justify-end border-t border-gray-100 pt-3 dark:border-gray-800/60">
              {/* Blocked while a rule editor is open, like every other control here: the
                  editor is keyed by index, so a save that replaced the list underneath it
                  would leave a stale draft that Apply then writes over the wrong rule. */}
              <Button
                size="sm"
                disabled={busy || !dirty || editing !== null}
                onClick={() => void save()}
              >
                {S.common.save}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
