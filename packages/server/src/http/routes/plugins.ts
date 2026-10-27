/**
 * Plugin library & Agent-installed hook packages:
 *   GET    /api/plugins                                   # the library by category (any logged-in user)
 *   GET    /api/plugins/:plugin/files                     # the files a plugin ships, for the detail view's browser (any logged-in user)
 *   POST   /api/projects/:p/agents/:a/plugins             # install plugins from the library (any member)
 *   GET    /api/projects/:p/agents/:a/hooks               # installed hook packages (any member)
 *   DELETE /api/projects/:p/agents/:a/hooks/:name         # uninstall one (any member)
 * Installing a plugin writes each of its skills to agent_state/skills/<name>/ and its hook
 * package to agent_state/hooks/<plugin>/ (hooks.json + scripts); reinstalling overwrites with
 * library content (i.e. an update). Installed skills keep their own routes (skills.ts).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import {
  hooksDir,
  installPlugin,
  listInstalledHooks,
  listInstalledPlugins,
  listInstalledSkills,
  pluginNameOf,
  readMachineDisabled,
  removeHook,
  setMachinePluginEnabled,
  setPluginEnabled,
  libraryPlugin,
  loadPluginGroups,
} from "@jadelau/core";
import type {
  AgentHooksResponse,
  AgentPluginsInstallResponse,
  PluginFilesResponse,
  PluginLibraryResponse,
  PluginMachineEnabledResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { HttpError } from "../errors.js";
import {
  badRequest,
  optionalStringArray,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";
import {
  pluginFiles,
  resolveLibraryPlugins,
  toHookItem,
  toPluginItem,
  toSkillItem,
} from "../../services/plugin-library.js";

/**
 * Library listing: the files are the source of truth — read fresh on every request (small files,
 * infrequent requests, no caching).
 *
 * The machine-level switch is resolved here rather than in the projection, because it is a read of
 * one file against every plugin in the library: doing it once per group would re-read the same file
 * a dozen times, and doing it in `toPluginItem` would give that function a side effect it has no
 * business having.
 */
function libraryResponse(disabled: ReadonlySet<string>): PluginLibraryResponse {
  return {
    groups: loadPluginGroups().map((group) => ({
      id: group.id,
      title: group.title,
      ...(group.titleZh !== undefined ? { titleZh: group.titleZh } : {}),
      plugins: group.plugins.map((plugin) => toPluginItem(plugin, !disabled.has(plugin.name))),
    })),
  };
}

/** GET /api/plugins (any logged-in user; no Project check). */
export function pluginLibraryRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/", async (c) => {
    const disabled = await readMachineDisabled(deps.config.root);
    return c.json(libraryResponse(disabled));
  });
  // Everything one plugin ships, as text keyed by path, for the library detail view's file
  // browser (the listing never carries bodies or scripts).
  app.get("/:plugin/files", (c) => {
    const pluginName = c.req.param("plugin");
    const plugin = libraryPlugin(pluginName);
    if (!plugin) {
      throw new HttpError(404, "unknown_plugin", `Plugin is not in the library: ${pluginName}`);
    }
    return c.json({ files: pluginFiles(plugin) } satisfies PluginFilesResponse);
  });

  /**
   * POST /api/plugins/enabled — switches a plugin on or off **everywhere it is installed**.
   *
   * **One switch, two things written.** The machine-level entry in `<root>/plugin-state.json` gates
   * new installs and every Agent; each Agent's own `manifest.json` is set to match, so every Agent
   * holding the plugin agrees with it. Both are written because they are read *together* — a plugin
   * runs only where both say on — and writing just one leaves a state no single switch can
   * describe: "off on the machine, on in the manifest" is not something a user can ask for, and
   * "off in one manifest, on in another" is exactly what made two switches on one card useless.
   *
   * **Writing every manifest is the point, not a side effect.** Machine entry only would mean
   * turning the plugin back on has to *restore* whatever each Agent individually wanted, which is a
   * decision the one switch no longer carries.
   *
   * **Every Project's runtimes are invalidated**: the Skills are read from disk on every Session
   * build, but a live Session already assembled its prompt, so a cached runtime would keep serving
   * the plugin until it happened to be evicted — and there is no single Project to scope to.
   *
   * **No Project check.** The answer is machine-wide; gating it per Project would let one machine
   * hold two contradictory answers.
   */
  app.post("/enabled", async (c) => {
    const body = await readJson(c);
    const pluginId = requireString(body, "id");
    const enabled = body.enabled;
    if (typeof enabled !== "boolean") {
      throw badRequest("enabled must be a boolean.");
    }
    // Accepts a bare name or a full id, because the card holds both and a switch that rejected the
    // form the card carries would be a switch the card cannot use.
    const name = pluginNameOf(pluginId);
    const written = await setMachinePluginEnabled(deps.config.root, name, enabled);
    // Bring every Agent's own copy into line, so the two readings can never disagree.
    await setPluginEnabledEverywhere(deps, name, enabled);
    // Unconditional: the switch is installed-but-unusable now, and a user who turns a plugin back
    // on expects the Agents they already gave it to to be able to use it again.
    deps.manager.invalidateAllRuntimes();
    return c.json({ id: pluginId, enabled: written } satisfies PluginMachineEnabledResponse);
  });
  return app;
}

/**
 * Sets one plugin's switch on every Agent that has it installed, across every Project.
 *
 * **Best-effort per Agent.** One unwritable manifest must not leave the machine switch written
 * while some Agent disagrees with it — but it also must not roll the machine switch back, since
 * that would make a single locked file silently undo the user's decision everywhere else. So the
 * failures are swallowed and the machine entry stands: it is the wider of the two, and it is what
 * the next install reads.
 *
 * Walking `<root>/<project>/agents/<agent>/agent_state/plugins` rather than asking the database is
 * deliberate: the manifests are the answer (see `setPluginEnabled`), and a Project whose Agent has
 * the plugin installed but no database row would still be found, which a query would miss.
 */
async function setPluginEnabledEverywhere(
  deps: AppDeps,
  name: string,
  enabled: boolean,
): Promise<void> {
  let projects: import("node:fs").Dirent[];
  try {
    projects = await fs.readdir(deps.config.root, { withFileTypes: true });
  } catch {
    return; // Never created — nothing is installed anywhere.
  }
  const jobs: Promise<unknown>[] = [];
  for (const project of projects) {
    if (!project.isDirectory() || project.name.startsWith(".")) continue;
    const agentsRoot = path.join(deps.config.root, project.name, "agents");
    let agents: import("node:fs").Dirent[];
    try {
      agents = await fs.readdir(agentsRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const agent of agents) {
      if (!agent.isDirectory() || agent.name.startsWith(".")) continue;
      const installed = await listInstalledPlugins(deps.config.root, project.name, agent.name);
      // Matched on the **name**, not the id: the id carries an `@marketplace` suffix that depends
      // on which copy this machine resolves, and the switch is about the plugin, not the copy.
      const hit = installed.find((p) => pluginNameOf(p.id) === name);
      if (hit === undefined) continue;
      jobs.push(
        setPluginEnabled(deps.config.root, project.name, agent.name, hit.id, enabled).catch(
          () => false,
        ),
      );
    }
  }
  await Promise.all(jobs);
}

/** /api/projects/:p/agents/:a/plugins: install is a Project-member operation. */
export function agentPluginsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const names = optionalStringArray(await readJson(c), "names") ?? [];
    if (names.length === 0) throw badRequest("names must be a non-empty array.");
    // Verify every name up front before writing anything: an unknown name rejects the whole
    // request rather than leaving a half-installed state.
    const plugins = resolveLibraryPlugins(names);
    // A plugin switched off for this machine cannot be installed onto an Agent. Checked here,
    // next to the library lookup rather than inside `installPlugin`, because core is the SDK and
    // also serves the CLI: the rule belongs to this product's two-level switch, and a caller
    // writing the install tree directly is not going through the UI this guards. The whole batch is
    // rejected rather than filtered, so a request naming two plugins never half-succeeds and leave
    // the caller guessing which one was refused.
    const disabled = await readMachineDisabled(deps.config.root);
    const refused = plugins.filter((plugin) => disabled.has(plugin.name)).map((p) => p.name);
    if (refused.length > 0) {
      throw new HttpError(
        409,
        "plugin_disabled",
        `These plugins are switched off for this machine and cannot be installed: ${refused.join(", ")}. Switch one on first.`,
      );
    }
    for (const plugin of plugins) {
      await installPlugin(deps.config.root, projectId, agentId, plugin);
    }
    // Hook packages are bound when a core Session is built (skills are read from disk on
    // demand, hooks are not): a runtime cached for this Agent would keep running the old
    // set — or none — until it was evicted, so its next idle access re-resumes it.
    deps.manager.invalidateAgentRuntimes(projectId, agentId);
    const [skills, hooks] = await Promise.all([
      listInstalledSkills(deps.config.root, projectId, agentId),
      listInstalledHooks(deps.config.root, projectId, agentId),
    ]);
    return c.json(
      {
        skills: skills.map(toSkillItem),
        hooks: hooks.map(toHookItem),
      } satisfies AgentPluginsInstallResponse,
      201,
    );
  });

  return app;
}

/** /api/projects/:p/agents/:a/hooks: read and uninstall are Project-member operations. */
export function agentHooksRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const hooks = await listInstalledHooks(deps.config.root, projectId, agentId);
    return c.json({ hooks: hooks.map(toHookItem) } satisfies AgentHooksResponse);
  });

  app.delete("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const name = requireValidId(c, "name");
    // Installed-check uses the same criterion as listInstalledHooks: hooks/<name>/hooks.json exists.
    try {
      await fs.access(
        path.join(hooksDir(deps.config.root, projectId, agentId), name, "hooks.json"),
      );
    } catch {
      throw new HttpError(404, "not_found", `Hook package is not installed: ${name}`);
    }
    await removeHook(deps.config.root, projectId, agentId, name);
    deps.manager.invalidateAgentRuntimes(projectId, agentId);
    return c.body(null, 204);
  });

  return app;
}
