/**
 * The "installed skills" page: what this Project has, grouped by **install unit**.
 *
 * The grouping is the whole point of the page. A Plugin is an install unit that can bring several
 * Skills (and hook packages); a Skill can also be installed on its own, and neither fact is
 * visible on disk — `installPlugin` writes members through the same call a standalone install
 * uses. So this is the first place the two can be told apart, and the layout makes the
 * distinction the first thing a reader sees rather than a footnote:
 *
 *   - a **Plugin** is one card, naming the Skills it brought — so 4 Skills on one card is 1
 *     install, not 4;
 *   - a **standalone** Skill is one card, because it is one install;
 *   - Skills the library does not ship are the user's own, whichever way the record reads.
 *
 * Hook packages stay on the plugin card rather than getting a section of their own, because a
 * plugin may carry both and a mixed plugin would then be counted twice.
 *
 * `inferred` is shown rather than hidden. Anything installed before provenance tracking was
 * recorded has no authoritative answer, and a badge is more honest than a card that reads like a
 * record.
 */
import { useState } from "react";
import type { InstalledPluginItem, InstalledSkillItem } from "@jiumate/server/api";
import type { RenamableSkill } from "../../api/endpoints";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { LibraryCard } from "./library-card.js";
import { S } from "../../lib/strings.js";
import { useLocale } from "../../state/locale";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { BOOK_ICON, localizedText } from "../chat/skill-use";

/**
 * The bottom line of a plugin card: what it brought, and whether that is all of it.
 *
 * Partial is stated rather than left to be inferred from a count, because "3 skills" next to
 * "4 skills" elsewhere on the page is exactly the ambiguity this page exists to remove.
 */
function pluginMeta(plugin: InstalledPluginItem, agentNames: string[]): string {
  const present = plugin.skills.length;
  const parts: string[] = [];
  if (present === 0) {
    parts.push(S.plugins.pluginHooks(plugin.hooks.length));
  } else if (present < plugin.skillCount) {
    parts.push(S.plugins.pluginPartial(present, plugin.skillCount));
  } else {
    parts.push(S.plugins.pluginSkills(present));
  }
  if (plugin.hooks.length > 0 && present > 0)
    parts.push(S.plugins.pluginHooks(plugin.hooks.length));
  if (agentNames.length > 0) parts.push(agentNames.join("、"));
  if (plugin.inferred) parts.push(S.plugins.inferredBadge);
  return parts.join(" · ");
}

/** One installed plugin: the Skills it brought, and the mark when its origin was deduced. */
function InstalledPluginRow({
  plugin,
  agentNames,
}: {
  plugin: InstalledPluginItem;
  agentNames: string[];
}) {
  const members = plugin.skills.map((s) => s.name).join("、");
  const { locale } = useLocale();
  const description = localizedText(locale, plugin.description, plugin.descriptionZh);
  // The members ride on the description's `title` rather than on the card: a plugin's member list
  // is the fact that makes it a plugin instead of a name, and four names do not fit in two lines.
  // "推断" is a word in the meta line, not a key mark — the key glyph means a credential is
  // missing, and reusing it here would make a deduction look like a failed check.
  return (
    <LibraryCard
      icon={plugin.icon}
      name={plugin.name}
      fallbackIcon={BOOK_ICON}
      description={description}
      descriptionTitle={members.length > 0 ? `${description}\n\n${members}` : undefined}
      meta={pluginMeta(plugin, agentNames)}
    />
  );
}

/** One installed Skill that came on its own. */
function InstalledSkillRow({
  skill,
  agentNames,
}: {
  skill: InstalledSkillItem;
  agentNames: string[];
}) {
  const needsKey = (skill.requiredEnv?.length ?? 0) > 0;
  const { locale } = useLocale();
  return (
    <LibraryCard
      icon={skill.icon}
      name={skill.name}
      fallbackIcon={BOOK_ICON}
      description={localizedText(locale, skill.description, skill.shortDescriptionZh)}
      meta={agentNames.length > 0 ? agentNames.join("、") : undefined}
      keyState={needsKey ? (skill.requiredEnvReady ? "ready" : "unset") : undefined}
      keyLabel={needsKey ? S.plugins.needsEnv(skill.requiredEnv!) : undefined}
    />
  );
}

/** A section with its heading, or nothing when the group is empty. */
function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="mb-2.5 text-sm font-medium text-gray-700 dark:text-gray-200">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Runs one rename and reports exactly what happened.
 *
 * **Partial success is reported, not smoothed over.** The server moves the Skill on every Agent
 * that holds it and returns per-Agent results; an Agent whose new name is already taken is
 * skipped rather than merged. Collapsing that into one toast would claim a rename that did not
 * happen on every Agent, which is the one thing the user could not then check for themselves.
 */
async function doRename(
  projectId: string,
  item: RenamableSkill,
  agentNamesOf: (ids: readonly string[]) => string[],
) {
  try {
    const res = await api.renameProjectSkill(projectId, item.from, item.to);
    const names = agentNamesOf(res.moved);
    if (res.skipped.length > 0) {
      toastError(
        S.plugins.legacyRenamePartial(
          item.from,
          item.to,
          agentNamesOf(res.skipped.map((s) => s.agentId)).join("、"),
        ),
      );
    } else {
      toastSuccess(S.plugins.legacyRenameDone(item.from, item.to, names.join("、")));
    }
  } catch (e) {
    toastError(`${S.plugins.legacyRenameFailed(item.from)}: ${apiErrorText(e)}`);
  }
}

/**
 * Skills still installed under a name the library has since renamed, offered as a fix rather than
 * left to be discovered on their own.
 *
 * A banner rather than a per-card button, for one reason: the rename applies to **every** Agent
 * that holds the Skill at once, so a control sitting on one card would imply it only affects that
 * one. It also explains why the Skill looks wrong — a pre-rebrand copy is filed as the user's own
 * import and its plugin reads as incomplete, which is otherwise a puzzle with no visible cause.
 */
function LegacyRenameBanner({
  projectId,
  items,
  agentNamesOf,
  onRenamed,
}: {
  projectId: string;
  items: readonly RenamableSkill[];
  agentNamesOf: (ids: readonly string[]) => string[];
  /** Re-read the catalog after a rename, so the result is shown rather than assumed. */
  onRenamed?: () => void;
}) {
  const [pending, setPending] = useState<RenamableSkill | null>(null);
  if (items.length === 0) return null;

  const agentsOf = (item: RenamableSkill) => agentNamesOf(item.agents).join("、");

  return (
    <>
      <div
        role="status"
        className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-950/30"
      >
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          {S.plugins.legacyTitle(items.length)}
        </p>
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li
              key={item.from}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-amber-900 dark:text-amber-200"
            >
              <span className="min-w-0 flex-1">
                {S.plugins.legacyBody(item.from, item.to)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                onClick={() => setPending(item)}
              >
                {S.plugins.legacyRenameAction(item.to)}
              </Button>
            </li>
          ))}
        </ul>
      </div>
      {pending !== null && (
        <ConfirmModal
          open
          title={S.plugins.legacyRenameConfirmTitle(pending.from, pending.to)}
          confirmLabel={S.plugins.legacyRenameAction(pending.to)}
          onClose={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            void doRename(projectId, pending, agentNamesOf);
            // Re-read regardless of outcome: a partial success still moved something, and the
            // listing has to show the result rather than leave the old name on screen.
            onRenamed?.();
          }}
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {S.plugins.legacyRenameConfirmBody(pending.from, pending.to, agentsOf(pending))}
          </p>
        </ConfirmModal>
      )}
    </>
  );
}

/** The whole page body, given the resolved view and a name resolver for Agent ids. */
export function InstalledSkillsView({
  plugins,
  skills,
  agentNamesOf,
  projectId,
  legacy,
  onRenamed,
}: {
  plugins: InstalledPluginItem[];
  skills: InstalledSkillItem[];
  agentNamesOf: (ids: readonly string[]) => string[];
  /** The Project these Skills belong to — the rename's scope, so needed only when `legacy` is set. */
  projectId?: string;
  /** Installed Skills the library has renamed; drives the banner. Absent = none known. */
  legacy?: readonly RenamableSkill[];
  /** Called after a rename attempt, so the caller re-reads the catalog either way. */
  onRenamed?: () => void;
}) {
  // The one split needing explanation: a Skill is the user's own when the library does not ship
  // it. Decided by the library's contents rather than by the record, so a stale record cannot make
  // a user's own file look built-in.
  const own = skills.filter((s) => s.origin === "import");
  const library = skills.filter((s) => s.origin === "library");
  return (
    <div>
      {legacy !== undefined && projectId !== undefined && (
        <LegacyRenameBanner
          projectId={projectId}
          items={legacy}
          agentNamesOf={agentNamesOf}
          onRenamed={onRenamed}
        />
      )}
      <Group title={S.plugins.groupPluginsCount(plugins.length)} count={plugins.length}>
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {plugins.map((plugin) => (
            <li key={plugin.name} className="flex">
              <div className="flex w-full">
                <InstalledPluginRow plugin={plugin} agentNames={agentNamesOf(plugin.agents)} />
              </div>
            </li>
          ))}
        </ul>
      </Group>
      <Group title={S.plugins.groupStandaloneCount(library.length)} count={library.length}>
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {library.map((skill) => (
            <li key={skill.name} className="flex">
              <div className="flex w-full">
                <InstalledSkillRow skill={skill} agentNames={agentNamesOf(skill.agents)} />
              </div>
            </li>
          ))}
        </ul>
      </Group>
      <Group title={S.plugins.groupImportedCount(own.length)} count={own.length}>
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {own.map((skill) => (
            <li key={skill.name} className="flex">
              <div className="flex w-full">
                <InstalledSkillRow skill={skill} agentNames={agentNamesOf(skill.agents)} />
              </div>
            </li>
          ))}
        </ul>
      </Group>
    </div>
  );
}
