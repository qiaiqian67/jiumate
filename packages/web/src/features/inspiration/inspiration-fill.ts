/**
 * Invoking an inspiration case: what lands in the composer, on which Agent, and where the user
 * ends up.
 *
 * ## The click fills, it never sends
 *
 * A case's prompt goes into the composer verbatim and nothing is sent. The user reads what arrived,
 * edits it, and presses Send. Two consequences, both deliberate:
 *
 * - **The prompt takes the whole text body.** Whatever was typed is cleared first, so the box holds
 *   the prompt and nothing else. Appending behind a draft was tried and reverted: it left the user
 *   to find and delete the leftover half themselves. A click asks for *this* prompt, so that is what
 *   the box gets, and the caret parks at the top of it — a long prompt scrolled to its last line
 *   reads as broken.
 * - **The case's skills join the selection instead of replacing it**, and only those the chosen
 *   Agent actually has installed. The composer wraps the selection into a `[use_skills]` block at
 *   send time, so pressing Send produces exactly the message the case describes; an uninstalled name
 *   would pin a Skill that is not there, and dropping the existing selection would throw away a pick
 *   the user had already made. The selection is additive where the text is not, because it cannot
 *   tell an earlier case's pin from the user's own choice — text has no such ambiguity.
 *
 * The prompt itself goes in verbatim. Building the `[use_skills]` block here instead would put a
 * marker block in the textarea, which is not something a user can sensibly edit — and the send path
 * would wrap it a second time.
 *
 * ## Two ways in, and why they handle skills differently
 *
 * The **draft screen's picker** fills a composer that is already mounted, so it can see the live
 * selection and the installed list, and it merges through {@link buildInspirationFill}.
 *
 * The **gallery** has no composer: it parks the active draft, writes a new draft cache entry and
 * navigates, and the composer mounts holding the case's skills. It therefore writes them
 * *unfiltered* — it has no installed list to filter against — and relies on the composer's own
 * pruning effect, which drops any name the Agent turns out not to have (see `chat-input.tsx`). The
 * two are the same outcome by different routes: what the user sees is the case's skills that exist,
 * and nothing that does not.
 *
 * ## The suggested Agent is a hint, not a reference
 *
 * A case is server-global content and an Agent is per-Project, so a case naming an Agent can only
 * mean "this one, if it is here". {@link resolveInvokeAgent} therefore falls back to the Agent the
 * user is already on, and then to the Project's first: a case imported from another deployment lands
 * on something usable instead of failing.
 */
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { draftKey, loadDraft, saveDraft } from "../chat/draft-cache";
import { parkActiveDraft } from "../chat/draft-sessions";
import type { InspirationCase } from "@prismshadow/linsight-inspirations";

export interface InspirationFill {
  /** The composer's new body text: the case's prompt, alone. */
  text: string;
  /** The new skill selection: what was already selected, plus the case's installed skills. */
  skills: string[];
}

export function buildInspirationFill(args: {
  /** The case's prompt, read for the active language. */
  prompt: string;
  /** Skill names the case pins. */
  caseSkills: readonly string[];
  /** Skill names installed on the chosen Agent. */
  installedSkills: readonly string[];
  /** Skill names currently selected in the composer. */
  selectedSkills: readonly string[];
}): InspirationFill {
  const added = args.caseSkills.filter(
    (name) => args.installedSkills.includes(name) && !args.selectedSkills.includes(name),
  );
  return { text: args.prompt, skills: [...args.selectedSkills, ...added] };
}

/**
 * Which Agent the case runs on: its own suggestion when that Agent exists in this Project,
 * otherwise the one the user is already on, otherwise the Project's first.
 *
 * Null only when the Project has no Agent at all, which is the one case where there is nowhere to
 * put the prompt.
 */
export function resolveInvokeAgent(args: {
  suggested: string | null;
  currentAgentId: string | null;
  projectAgentIds: readonly string[];
}): string | null {
  if (args.suggested !== null && args.projectAgentIds.includes(args.suggested)) {
    return args.suggested;
  }
  if (args.currentAgentId !== null && args.projectAgentIds.includes(args.currentAgentId)) {
    return args.currentAgentId;
  }
  return args.projectAgentIds[0] ?? null;
}

/**
 * The gallery's handoff: park the active draft, write a new draft cache entry carrying the prompt
 * and the case's skills, then open the new-chat route on the chosen Agent.
 *
 * Parking first is what makes browsing safe from a half-typed message: the draft the user was
 * working on is stored under its own session id and reappears in the sidebar, rather than being
 * overwritten by the case's prompt. The cached draft is read *before* parking because parking is
 * what clears it — the new entry keeps the model and Workspace the user had selected, which is the
 * part of a draft that is about the session rather than about the message.
 */
export function useInspirationInvoke(): (one: InspirationCase, localizedPrompt: string) => void {
  const { user } = useAuth();
  const { currentProject, agents, currentAgent, setCurrentAgentId } = useProject();
  const navigate = useNavigate();

  return useCallback(
    (one, localizedPrompt) => {
      if (!user || !currentProject) return;
      const agentId = resolveInvokeAgent({
        suggested: one.agentId,
        currentAgentId: currentAgent?.agentId ?? null,
        projectAgentIds: agents.map((agent) => agent.agentId),
      });
      if (agentId === null) return;
      const key = draftKey(user.userId, currentProject.projectId);
      const cached = loadDraft(key);
      parkActiveDraft(user.userId, currentProject.projectId);
      saveDraft(key, {
        ...cached,
        agentId,
        text: localizedPrompt,
        // Unfiltered on purpose: this path has no installed-skills list, and the composer prunes
        // the selection against the Agent's own when it mounts (see this module's doc).
        skills: [...one.skills],
        handoffAgentId: undefined,
      });
      setCurrentAgentId(agentId);
      navigate(`/chat/${DRAFT_SESSION_ID}`, { state: { agentId } });
    },
    [user, currentProject, agents, currentAgent, setCurrentAgentId, navigate],
  );
}
