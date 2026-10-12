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
  listInstalledSkills,
  pluginNameOf,
  readMachineDisabled,
  removeHook,
  setMachinePluginEnabled,
  libraryPlugin,
  loadPluginGroups,
} from "@prismshadow/jiumate-core";
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
   * POST /api/plugins/enabled — switches a plugin on or off **for this machine**.
   *
   * The wider of the two switches, and answerable for a plugin no Agent has installed, which is the
   * point: "should this plugin be available on this computer" has to be decidable before anything
   * is installed anywhere, and a per-Agent manifest cannot answer it for a plugin it has no
   * directory for.
   *
   * **Every Project's runtimes are invalidated**, not one Agent's. The Skills are read from disk on
   * every Session build, but a live Session already assembled its prompt, so each cached runtime
   * would keep serving the plugin until it happened to be evicted — and this is a machine-level
   * switch, so there is no single Project to scope the blast radius to.
   *
   * **No Project check.** The state is machine-wide, and a user who is a member of some Project but
   * not another can still switch a plugin off for a machine they share with nobody in particular;
   * gating it per Project would let the same machine hold both answers at once.
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
    const written = await setMachinePluginEnabled(
      deps.config.root,
      pluginNameOf(pluginId),
      enabled,
    );
    // Unconditional: the switch is installed-but-unusable now, and a user who turns a plugin back
    // on expects the Agents they already gave it to to be able to use it again.
    deps.manager.invalidateAllRuntimes();
    return c.json({ id: pluginId, enabled: written } satisfies PluginMachineEnabledResponse);
  });
  return app;
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
