/**
 * 添加技能弹窗：三种把技能放到本机的方式。
 *
 * **三个页签而不是一个下拉表单。** 三种来源除了「最后都变成磁盘上的文件」之外毫无共同之处：URL 是
 * 敲进去的，压缩包是选出来并在浏览器里读过的，本机目录是**被找到**的——用户起初并不知道它存在，
 * 是扫描结果告诉他的。一个表单就得同时渲染一个对其中两个页签毫无意义的上传框，和两个对第三个页签
 * 毫无意义的结果列表，于是每个人都会看到两个对自己所选方式不生效的控件。
 *
 * **每个页签都说清楚它到底会做什么**，因为「添加」本身是一个用户无法核对的承诺。URL 页签写明将要
 * 请求的地址；目录页签写明将要复制的**来源**目录，以及更实用的——副本落在哪里。用户正在对自己的
 * 机器做一个决定，诚实的那个对话框会把两端涉及的目录都写出来。
 *
 * **添加不是安装。** 这三个页签把技能放进本机技能库；装进某个 Agent、启用它，是卡片上另外的按钮。
 * 成功提示里特意点明这一点，免得用户添加完发现某个 Agent 里没有、以为自己被误导了——那句话本来就
 * 写在成功提示里。
 *
 * **分类在这里选，而不是在添加之后。** 技能一落地就带着分类，比让用户添加完再去每张卡片上补一遍要
 * 省事得多；而且分类是本地的用户级数据，添加时顺手定下来的那个，之后仍然可以改。
 *
 * **文件选择器读不到这台机器。** `<input type="file">` 给浏览器的只有一个 File，没有「它从哪儿来」，
 * 所以目录页签是一个文本框加扫描出来的候选，而不是一个「浏览…」按钮。
 */
import { useCallback, useEffect, useState } from "react";
import {
  addMachineSkillsFromArchive,
  addMachineSkillsFromDirectory,
  addMachineSkillsFromUrl,
  deleteMachineSkill,
  getMachineSkills,
  scanMachineSkills,
  type MachineSkill,
  type MachineSkillAddResult,
} from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Tabs } from "../../components/ui/tabs";
import { SkeletonList } from "../../components/ui/skeleton";
import { Select } from "../../components/ui/select";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import type { Category } from "./extension-model";

type Source = "url" | "archive" | "directory";

/** 与服务端一致的上传上限。 */
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;

export function AddSkillDialog({
  categories,
  onFiled,
  onClose,
}: {
  categories: readonly Category[];
  /** 新技能落地后用它登记分类；名字 → 分类 id 或 null（未分类）。 */
  onFiled: (names: readonly string[], categoryId: string | null) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Source>("url");
  // null = 未分类，而不是空串：空串是「选了一个叫空串的分类」。
  const [category, setCategory] = useState<string | null>(null);

  return (
    <Modal open title={S.plugins.addSkill} onClose={onClose} widthClass="sm:max-w-2xl">
      <Tabs
        variant="pill"
        active={source}
        onChange={setSource}
        items={[
          { key: "url", label: S.plugins.addFromUrl },
          { key: "archive", label: S.plugins.addFromArchive },
          { key: "directory", label: S.plugins.addFromLocal },
        ]}
      />

      {/* Present on every tab, because "which category" is the same question whichever way the
          skills arrive. A select with no categories renders nothing — one option that does nothing
          is a control that cannot be used, not a placeholder. */}
      {categories.length > 0 && (
        <div className="mt-3">
          <CategoryPicker categories={categories} value={category} onChange={setCategory} />
        </div>
      )}

      <div className="mt-4">
        {source === "url" && <UrlSource onDone={(names) => onFiled(names, category)} />}
        {source === "archive" && <ArchiveSource onDone={(names) => onFiled(names, category)} />}
        {source === "directory" && <DirectorySource onDone={(names) => onFiled(names, category)} />}
      </div>
    </Modal>
  );
}

/** 分类选择器，置顶一项是「不分类」。 */
function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: readonly Category[];
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="font-medium text-gray-700 dark:text-gray-200">
        {S.plugins.addSkillCategory}
      </span>
      <Select
        className="mt-1"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      >
        <option value="">{S.plugins.categoryNone}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

/**
 * 添加完成后的统一处理：报成功、把名字交给上层登记分类，然后关掉弹窗。
 *
 * **失败与部分成功都如实说。** `failed` 非空时不能报「添加成功」——那一批里有一个技能没落盘，而
 * 用户会以为整批都在了；所以成功的部分照报，失败的部分单独点名。
 */
function useAdder(onDone: (names: readonly string[]) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (action: () => Promise<MachineSkillAddResult>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        const names = result.added.map((s) => s.name);
        if (names.length === 0) {
          // 一次都没有成功，而服务端没有报错——这必须是一个看得见的失败，而不是一个静默的空操作。
          setError(S.plugins.addSkillNoneAdded);
          return false;
        }
        if (result.failed.length > 0) {
          toastError(`${result.failed.map((f) => `${f.name}（${f.reason}）`).join("、")}`);
        }
        toastSuccess(S.plugins.addSkillDone(names.length, names.join("、")));
        onDone(names);
        return true;
      } catch (e) {
        // Inline rather than toast-only: 失败的是用户敲进去或挑出来的东西，而一条会消失的提示
        // 只会让他对着同一个表单再发一次呆。
        setError(apiErrorText(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onDone],
  );
  return { busy, error, setError, run };
}

/** 三个页签共用的失败提示行，放在一处，读起来才像同一个对话框。 */
function AddError({ error }: { error: string | null }) {
  if (error === null) return null;
  return (
    <p className="mt-2.5 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
      {error}
    </p>
  );
}

/**
 * ① 从仓库 URL。
 *
 * 在浏览器里也校验一次 http(s)，这不是安全措施——是为了让按钮在一个 `ftp://` 粘贴上直接不可点，
 * 而不是让用户等一个注定被拒的请求回来。
 *
 * **任何形状都行**：仓库本体、带 `.git` 的、`/tree/main` 的、深链到某个文件的，服务器都解析成同一
 * 个分支归档。所以这里的提示刻意举这三个例子——它们是用户真正会粘出来的样子。
 */
function UrlSource({ onDone }: { onDone: (names: readonly string[]) => void }) {
  const [url, setUrl] = useState("");
  const { busy, error, setError, run } = useAdder(onDone);

  const valid = useCallback((): boolean => {
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }, [url]);

  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{S.plugins.addSkillUrlHint}</p>
      <label className="mt-2.5 block text-xs font-medium text-gray-700 dark:text-gray-200">
        {S.plugins.addFromUrlLabel}
      </label>
      <Input
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setError(null);
        }}
        placeholder="https://github.com/owner/repo"
        className="mt-1"
      />
      {url.trim() !== "" && !valid() && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text:text-amber-400">
          {S.plugins.addSkillUrlInvalid}
        </p>
      )}
      <Button
        className="mt-3"
        variant="primary"
        disabled={busy || url.trim() === "" || !valid()}
        onClick={() => void run(() => addMachineSkillsFromUrl(url.trim()))}
      >
        {busy ? S.common.saving : S.plugins.addFromUrl}
      </Button>
      <AddError error={error} />
    </div>
  );
}

/**
 * ② 从压缩包。
 *
 * **只收 .zip，且大小在客户端先挡一次。** 服务端也会拒，但让用户等一个几十兆的请求往返只为听到
 * 「太大了」是浪费他的时间；而一个非 zip 的文件传到服务端才被拒，会让他以为是自己哪里写错了。
 */
function ArchiveSource({ onDone }: { onDone: (names: readonly string[]) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const { busy, error, setError, run } = useAdder(onDone);

  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{S.plugins.addSkillArchiveHint}</p>
      <label className="mt-2.5 block text-xs font-medium text-gray-700 dark:text-gray-200">
        {S.plugins.addFromArchive}
      </label>
      <input
        type="file"
        accept=".zip,application/zip"
        onChange={(e) => {
          setError(null);
          setFile(e.target.files?.[0] ?? null);
        }}
        className="mt-1 block w-full text-xs text-gray-600 file:mr-2 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-2.5 file:py-1 file:text-xs dark:text-gray-300 dark:file:border-gray-700 dark:file:bg-gray-900"
      />
      {file !== null && file.size > MAX_ARCHIVE_BYTES && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          {S.plugins.addSkillArchiveTooBig}
        </p>
      )}
      {file !== null && (
        <p className="mt-1 truncate text-[11px] text-gray-400" title={file.name}>
          {file.name}
        </p>
      )}
      <Button
        className="mt-3"
        variant="primary"
        disabled={busy || file === null || file.size > MAX_ARCHIVE_BYTES}
        onClick={() => {
          if (file !== null) void run(() => addMachineSkillsFromArchive(file));
        }}
      >
        {busy ? S.common.saving : S.plugins.addFromArchive}
      </Button>
      <AddError error={error} />
    </div>
  );
}

/**
 * ③ 从本机另一个智能体的技能目录。
 *
 * **扫出来的每个 Agent 一组，点「应用」整组添加**——因为「添加的其实是目录」：同一个 Agent 的一组技
 * 能是一起被加进来的，让用户逐个勾选反而是在问他一个他没有问过的问题。
 *
 * **已经在本机技能库里的技能标出来，并且默认跳过。** 同名技能覆盖是有后果的（原来那份可能是用户
 * 改过的），所以「应用」按钮只在有还没添加过的技能时才亮——用户要覆盖就得先勾上它，而这一个勾选
 * 动作正好是他做这个决定的那一刻。
 *
 * 空结果的 Agent 也要列出来：扫过了但它没装，与根本没扫，在界面上是两件能分辨的事。
 */
function DirectorySource({ onDone }: { onDone: (names: readonly string[]) => void }) {
  const [groups, setGroups] = useState<
    { agentId: string; agentPath: string; projectId: string; skills: { name: string }[] }[] | null
  >(null);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Record<string, Set<string>>>({});
  const [applying, setApplying] = useState<string | null>(null);
  const { busy, error, setError, run } = useAdder(onDone);

  // 扫一次即可，但本机技能库要跟着重读：它会随上面的两个页签变化，而「哪些已经添加过了」正是
  // 这里要显示的东西。
  const load = useCallback(() => {
    setGroups(null);
    void Promise.all([scanMachineSkills(), getMachineSkills()])
      .then(([scan, mine]) => {
        setGroups(scan.groups);
        setKnown(new Set(mine.skills.map((s) => s.name)));
      })
      .catch((e: unknown) => setError(apiErrorText(e)));
  }, [setError]);

  useEffect(() => {
    load();
  }, [load]);

  const applyGroup = async (agentId: string) => {
    const group = groups?.find((g) => g.agentId === agentId);
    if (group === undefined) return;
    const selected = picked[agentId];
    const names = group.skills
      .filter((s) => (selected ? selected.has(s.name) : !known.has(s.name)))
      .map((s) => s.name);
    if (names.length === 0) return;
    setApplying(agentId);
    // 逐个添加而不是整目录一次性：目录里可能有一半已经在库里，整目录覆盖会悄悄改掉用户
    // 已经改过的那些。
    for (const name of names) {
      const done = await run(async () =>
        addMachineSkillsFromDirectory(joinPath(group.agentPath, "skills", name)),
      );
      if (!done) break;
    }
    setApplying(null);
    load();
  };

  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{S.plugins.addSkillDirectoryHint}</p>
      <Button className="mt-2.5" onClick={load} disabled={busy}>
        {S.plugins.scanAgents}
      </Button>

      {error !== null && <AddError error={error} />}
      {groups === null && <SkeletonList rows={3} />}

      {groups !== null && groups.length === 0 && (
        <p className="mt-3 rounded-md bg-gray-50 px-3 py-2.5 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
          {S.plugins.scanAgentsNone}
        </p>
      )}

      {groups !== null && groups.length > 0 && (
        <ul className="mt-3 space-y-2">
          {groups.map((group) => {
            const fresh = group.skills.filter((s) => !known.has(s.name));
            const selected = picked[group.agentId];
            const target = selected ? [...selected] : fresh.map((s) => s.name);
            const all = target.length > 0;
            return (
              <li
                key={`${group.projectId}/${group.agentId}`}
                className="rounded-md border border-gray-200 p-2.5 dark:border-gray-800"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {group.agentId}
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    className="shrink-0"
                    disabled={!all || busy || applying === group.agentId}
                    title={all ? undefined : S.plugins.applyNeedsUnadded}
                    onClick={() => void applyGroup(group.agentId)}
                  >
                    {applying === group.agentId ? S.common.saving : S.plugins.applyToLibrary}
                  </Button>
                </div>
                <p
                  className="mt-0.5 truncate font-mono text-[11px] text-gray-400"
                  title={group.agentPath}
                >
                  {group.agentPath}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  {group.skills.length === 0 && (
                    <span className="text-[11px] text-gray-400">{S.plugins.scanAgentEmpty}</span>
                  )}
                  {group.skills.map((skill) => {
                    const already = known.has(skill.name);
                    const isPicked = selected?.has(skill.name) ?? !already;
                    return (
                      <label
                        key={skill.name}
                        className={`flex items-center gap-1 text-[11px] ${
                          already ? "text-gray-400" : "text-gray-600 dark:text-gray-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isPicked}
                          onChange={(e) => {
                            const next = new Set(selected ?? fresh.map((s) => s.name));
                            if (e.target.checked) next.add(skill.name);
                            else next.delete(skill.name);
                            setPicked((prev) => ({ ...prev, [group.agentId]: next }));
                          }}
                        />
                        {skill.name}
                        {already && (
                          <span className="text-gray-400">（{S.plugins.alreadyInLibrary}）</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * 拼一个路径。分片之间用 `/`，不依赖 `node:path`——浏览器里没有它。
 *
 * 命名成 `joinPath` 而不是 `path`：后者会遮蔽全局 `path`，而这个文件里任何一处不小心用到全局
 * `path`（比如某个临时调试输出）都会静默变成这个函数，而不是编译报错。
 */
function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p !== "")
    .join("/")
    .replace(/\/{2,}/g, "/");
}
