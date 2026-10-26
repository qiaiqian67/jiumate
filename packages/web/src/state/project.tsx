/**
 * Current Project / Agent context:
 * - Project list (owned + authorized); the current selection is remembered in localStorage and
 *   synced to server-side prefs (lastProjectId, best-effort);
 * - the current Project's Agent list and current Agent (switched via the top-bar breadcrumb
 *   dropdown; remembered per Project).
 *
 * State lives in a zustand vanilla store (one instance per Provider mount, so an unmount
 * still resets everything); the Provider is a thin lifecycle component that triggers the
 * initial fetches and republishes the store's state through the same context value as before.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AgentSummary, ProjectRole, ProjectSummary } from "@jiumate/server/api";
import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";
import * as api from "../api/endpoints";
import { S } from "../lib/strings";

const PROJECT_KEY = "jiumate.lastProjectId";
const agentKey = (projectId: string) => `jiumate.lastAgentId.${projectId}`;

interface ProjectContextValue {
  projects: ProjectSummary[];
  projectsLoading: boolean;
  currentProject: ProjectSummary | null;
  setCurrentProjectId: (projectId: string) => void;
  reloadProjects: () => Promise<void>;

  agents: AgentSummary[];
  agentsLoading: boolean;
  currentAgent: AgentSummary | null;
  setCurrentAgentId: (agentId: string) => void;
  reloadAgents: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

/**
 * The built-in Project's id — a compile-time constant the server owns (`core/src/state/paths.ts`,
 * `DEFAULT_PROJECT_ID`). The web app names it for itself because core's subpath exports exist for
 * **web-safe, dependency-free** modules and `paths.ts` imports `node:os` and `node:path`; pulling
 * it from there would drag Node builtins into the browser bundle. The literal was already spelled
 * out in two other files (project-dialogs.tsx compares against it, admin-users-page.tsx builds
 * `<username>-default_project`); this is its one home, with three readers.
 */
export const DEFAULT_PROJECT_ID = "default_project";

/**
 * Project display name: the name the owner set, else the built-in Project's label, else the id.
 *
 * The middle case exists because the admin's `default_project` is provisioned with **no** display
 * name (the server inserts the row with just id/owner/createdAt), so the raw id used to surface in
 * the switcher. Labelling it here rather than seeding a name keeps UI language out of stored data:
 * a name written at signup would be frozen in whatever language that install happened to run in,
 * and it is data the owner can edit afterwards either way.
 *
 * A non-admin's `<username>-default_project` is unaffected — the server does give those a name
 * (the username), so they take the first branch.
 */
export function projectDisplayName(p: ProjectSummary): string {
  if (p.name !== undefined && p.name !== "") return p.name;
  if (p.projectId === DEFAULT_PROJECT_ID) return S.project.defaultProjectName;
  return p.projectId;
}

/**
 * A Project-level role as the switcher's badge shows it. `owner` is 管理员, matching the
 * server-level role the user-management page already uses for the same word.
 */
export function projectRoleLabel(role: ProjectRole): string {
  return role === "owner" ? S.project.roleOwner : S.project.roleMember;
}

/** Agent display name fallback: falls back to agentId when name is absent. */
export function agentDisplayName(a: AgentSummary): string {
  return a.name ?? a.agentId;
}

/** Store state: the context value's raw ingredients (currentProject/currentAgent are derived in the Provider) plus the mutation functions. */
interface ProjectStoreState {
  projects: ProjectSummary[];
  projectsLoading: boolean;
  currentProjectId: string | null;

  agents: AgentSummary[];
  agentsLoading: boolean;
  currentAgentId: string | null;

  setCurrentProjectId: (projectId: string) => void;
  reloadProjects: () => Promise<void>;
  setCurrentAgentId: (agentId: string) => void;
  reloadAgents: () => Promise<void>;
}

function createProjectStore() {
  return createStore<ProjectStoreState>((set, get) => ({
    projects: [],
    projectsLoading: true,
    currentProjectId: null,

    agents: [],
    agentsLoading: true,
    currentAgentId: null,

    reloadProjects: async () => {
      set({ projectsLoading: true });
      try {
        const res = await api.listProjects();
        const wanted = get().currentProjectId ?? localStorage.getItem(PROJECT_KEY);
        const found = res.projects.find((p) => p.projectId === wanted);
        set({
          projects: res.projects,
          currentProjectId: (found ?? res.projects[0])?.projectId ?? null,
        });
      } finally {
        set({ projectsLoading: false });
      }
    },

    setCurrentProjectId: (projectId) => {
      // If the selection is already the current Project, return immediately. Otherwise the
      // code below would clear agents and set loading back to true while currentProjectId
      // stays unchanged — the Provider's reloadAgents effect depends on it and wouldn't rerun,
      // so the Agent list (and the Session list mounted under it) would disappear for good
      // (reproducible by clicking the already-current Project in the dropdown).
      if (projectId === get().currentProjectId) return;
      localStorage.setItem(PROJECT_KEY, projectId);
      // Clear the Agent list in sync: avoids a transient render with "new projectId + old
      // Project's agents" that would make downstream consumers (Sessions) fetch with the
      // wrong Agent set (which could create spurious Sessions under the new Project).
      set({
        currentProjectId: projectId,
        currentAgentId: null,
        agents: [],
        agentsLoading: true,
      });
      // Sync server-side prefs (best-effort; failure doesn't affect the local experience).
      void api.putPrefs({ lastProjectId: projectId }).catch(() => undefined);
    },

    reloadAgents: async () => {
      const currentProjectId = get().currentProjectId;
      if (!currentProjectId) return;
      set({ agentsLoading: true });
      try {
        const res = await api.listAgents(currentProjectId);
        const wanted = get().currentAgentId ?? localStorage.getItem(agentKey(currentProjectId));
        const found = res.agents.find((a) => a.agentId === wanted);
        // Default to conversing with default_agent.
        const fallback =
          res.agents.find((a) => a.agentId === "default_agent") ?? res.agents[0] ?? null;
        set({ agents: res.agents, currentAgentId: (found ?? fallback)?.agentId ?? null });
      } finally {
        set({ agentsLoading: false });
      }
    },

    setCurrentAgentId: (agentId) => {
      const currentProjectId = get().currentProjectId;
      if (currentProjectId) localStorage.setItem(agentKey(currentProjectId), agentId);
      set({ currentAgentId: agentId });
    },
  }));
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createProjectStore);
  const state = useStore(store);

  useEffect(() => {
    void store.getState().reloadProjects();
  }, [store]);

  const { currentProjectId } = state;
  useEffect(() => {
    store.setState({ agents: [] });
    void store.getState().reloadAgents();
  }, [store, currentProjectId]);

  const value = useMemo<ProjectContextValue>(() => {
    const currentProject =
      state.projects.find((p) => p.projectId === state.currentProjectId) ?? null;
    const currentAgent = state.agents.find((a) => a.agentId === state.currentAgentId) ?? null;
    return {
      projects: state.projects,
      projectsLoading: state.projectsLoading,
      currentProject,
      setCurrentProjectId: state.setCurrentProjectId,
      reloadProjects: state.reloadProjects,
      agents: state.agents,
      agentsLoading: state.agentsLoading,
      currentAgent,
      setCurrentAgentId: state.setCurrentAgentId,
      reloadAgents: state.reloadAgents,
    };
  }, [state]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within a ProjectProvider");
  return ctx;
}
