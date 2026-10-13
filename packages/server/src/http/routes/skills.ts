/**
 * An Agent's installed Skills:
 *   GET      /api/projects/:p/agents/:a/skills            # installed list (any member)
 *   POST     /api/projects/:p/agents/:a/skills/template-placeholder  # insert/migrate the {{SKILLS}} placeholder (any member)
 *   POST     /api/projects/:p/agents/:a/skills/archive    # install one skill from an uploaded zip (any member)
 *   GET      /api/projects/:p/agents/:a/skills/:name/archive  # export one installed skill as a zip (any member)
 *   DELETE   /api/projects/:p/agents/:a/skills/:name      # uninstall (any member)
 * Installing from the library goes through the plugin routes (plugins.ts), which write each
 * of a plugin's skills to agent_state/skills/<name>/. The archive routes are symmetric: POST
 * writes every zip file under skills/<name>/ (replace semantics with `overwrite`), GET packs
 * the whole directory back under a single top-level <name>/ so the download round-trips
 * through the POST unchanged. The scope is small enough to skip a service layer — routes
 * call core's disk-writing functions directly.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8, zipSync } from "fflate";
import { Hono } from "hono";
import {
  listInstalledSkills,
  libraryPlugin,
  hooksDir,
  loadLibraryPlugins,
  readInstalls,
  updateInstalls,
  recordSkillInstall,
  removePluginInstall,
  removeSkill,
  installSkill,
  isMachineSkillEnabled,
  readMachineSkillFiles,
  renameSkill,
  backupSkillDirectory,
  replaceSkillDirectory,
  skillsDir,
  assertPluginId,
  builtinPluginId,
  listInstalledPlugins,
  migrateFlatBundledSkills,
  setPluginEnabled,
  parseSkillFrontmatter,
  LEGACY_SKILL_NAMES,
  PLUGIN_NAME_PATTERN,
} from "@prismshadow/jiumate-core";
import { buildInstalledSkillsView } from "../../services/installed-skills-view.js";
import type {
  AgentSkillsResponse,
  SkillCatalogItem,
  SkillCatalogResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { HttpError } from "../errors.js";
import { badRequest, readJson, requireString, requireValidId } from "../validate.js";
import { toSkillItem } from "../../services/plugin-library.js";
import {
  MAX_ARCHIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  skillTooLarge,
} from "../../services/skill-import-limits.js";

/** Decoded zip cap: aligned with the Agent snapshot import (stays within the 20MB body limit after base64). */
const MAX_ARCHIVE_BYTES = 14 * 1024 * 1024;

/**
 * Validates one zip entry path (zip-slip guard): rejects absolute paths (leading "/" or a
 * drive letter), backslashes and any ".." segment — a malicious archive must never write
 * outside the target Skill directory.
 */
function assertSafeEntryPath(name: string): void {
  if (name.includes("\\")) throw badRequest(`Invalid zip entry path (backslash): ${name}`);
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw badRequest(`Invalid zip entry path (absolute): ${name}`);
  }
  if (name.split("/").some((segment) => segment === "..")) {
    throw badRequest(`Invalid zip entry path (traversal): ${name}`);
  }
}

/** A skill decoded from an uploaded zip: name + file bytes keyed by path relative to the skill directory. */
interface ArchiveSkill {
  name: string;
  files: Map<string, Uint8Array>;
}

/**
 * Decodes and validates an uploaded skill zip. Accepted layouts: SKILL.md at the zip root
 * (name comes from frontmatter), or exactly one top-level directory containing SKILL.md
 * (the directory name is the Skill name, consistent with listInstalledSkills where the
 * directory name always wins). Directory entries are ignored (paths recreate them); every
 * file path is zip-slip-checked and the count/size limits enforced before anything is
 * returned. Frontmatter must parse to a non-null name, and the resolved Skill name must
 * match PLUGIN_NAME_PATTERN.
 */
function parseSkillArchive(archive: Buffer): ArchiveSkill {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(archive));
  } catch {
    throw badRequest("dataBase64 is not a valid zip archive.");
  }
  const files = Object.entries(entries).filter(([name]) => !name.endsWith("/"));
  if (files.length === 0) throw badRequest("The zip archive contains no files.");
  if (files.length > MAX_ARCHIVE_FILES) {
    throw badRequest(`The zip archive exceeds the ${MAX_ARCHIVE_FILES}-file limit.`);
  }
  let total = 0;
  for (const [name, data] of files) {
    assertSafeEntryPath(name);
    if (data.byteLength > MAX_FILE_BYTES) {
      throw badRequest(`Zip entry exceeds the 5MB uncompressed limit: ${name}`);
    }
    total += data.byteLength;
    if (total > MAX_TOTAL_BYTES) {
      throw badRequest("The zip archive exceeds the 20MB uncompressed limit.");
    }
  }
  const names = files.map(([name]) => name);
  let prefix = "";
  let dirName: string | undefined;
  if (!names.includes("SKILL.md")) {
    const topLevels = new Set(names.map((name) => name.split("/", 1)[0]!));
    dirName = topLevels.size === 1 ? [...topLevels][0] : undefined;
    if (dirName === undefined || !names.includes(`${dirName}/SKILL.md`)) {
      throw badRequest(
        "The zip must contain SKILL.md at its root, or exactly one top-level directory containing SKILL.md.",
      );
    }
    prefix = `${dirName}/`;
  }
  const meta = parseSkillFrontmatter(strFromU8(entries[`${prefix}SKILL.md`]!));
  if (meta === null) {
    throw badRequest("SKILL.md must start with a frontmatter block that sets `name`.");
  }
  const name = dirName ?? meta.name;
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    throw badRequest(
      `Invalid skill name ${JSON.stringify(name)}: only letters, digits, "_" and "-" are allowed.`,
    );
  }
  return { name, files: new Map(files.map(([n, data]) => [n.slice(prefix.length), data])) };
}

/**
 * Recursively collects an installed skill directory as zip entries under a single
 * top-level `<name>/` directory (subpaths preserved, "/" separators), so the export
 * round-trips through the POST archive route unchanged. Symlinks and other non-regular
 * entries are skipped (nothing outside the directory can leak). The import caps apply
 * on the way out too — a directory exceeding them couldn't be re-imported anyway.
 */
async function collectSkillArchive(dir: string, name: string): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  let count = 0;
  let total = 0;
  const walk = async (abs: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
      const absChild = path.join(abs, entry.name);
      const relChild = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(absChild, relChild);
        continue;
      }
      if (!entry.isFile()) continue;
      count += 1;
      const data = new Uint8Array(await fs.readFile(absChild));
      total += data.byteLength;
      if (
        count > MAX_ARCHIVE_FILES ||
        data.byteLength > MAX_FILE_BYTES ||
        total > MAX_TOTAL_BYTES
      ) {
        throw skillTooLarge();
      }
      out[relChild] = data;
    }
  };
  await walk(dir, name);
  return out;
}

/**
 * Version for the export filename: only a frontmatter `version:` that is a real
 * `YYYY-MM-DD.N` yields a `-v<version>` filename suffix — a missing or malformed field (the
 * parser reads either as "") must not be baked into a filename as if declared.
 */
function explicitSkillVersion(skillMd: string): string | null {
  return parseSkillFrontmatter(skillMd)?.version || null;
}

/**
 * Every skill in the Project, unioned over its Agents.
 *
 * This exists because the per-Agent list cannot answer "what skills are there". A skill lives in
 * one Agent's directory, so a skill added to one Agent was invisible to any page reading another
 * Agent's list, and a skill installed on two Agents showed up twice — the same complaint from two
 * directions. The catalog scans every Agent once and merges by skill name, and each entry carries
 * the Agents it is on so a card can draw real install state rather than a guess.
 *
 * Merge rule: the first Agent that has a skill wins its metadata. Two copies of one skill name are
 * the same skill by definition (the directory name is its identity), and the copies can differ only
 * by a local edit to one Agent's — taking the first keeps the response deterministic instead of
 * dependent on scan order.
 */
async function projectSkillCatalog(
  deps: AppDeps,
  projectId: string,
): Promise<SkillCatalogResponse> {
  const agents = await deps.agentService.listAgents(projectId);
  const agentIds = agents.map((one) => one.agentId).sort();
  // Read in parallel: the scan is I/O-bound and the Agents are independent, and an unreadable
  // skills directory yields [] in core rather than throwing, so one Agent cannot fail the catalog.
  const perAgent = await Promise.all(
    agentIds.map((agentId) => listInstalledSkills(deps.config.root, projectId, agentId)),
  );
  const merged = new Map<string, SkillCatalogItem>();
  perAgent.forEach((skills, index) => {
    const agentId = agentIds[index]!;
    for (const skill of skills) {
      const existing = merged.get(skill.name);
      if (existing === undefined) {
        merged.set(skill.name, {
          ...toSkillItem(skill),
          agents: [agentId],
          // Both flags are fixed below, once the union is complete: at this point the skill is
          // known to be on at least one Agent, but not yet on all of them.
          uninstalled: false,
          onAllAgents: false,
          agentCount: agentIds.length,
        });
      } else {
        existing.agents.push(agentId);
      }
    }
  });
  return {
    skills: [...merged.values()]
      .map((one) => ({
        ...one,
        agents: one.agents.sort(),
        onAllAgents: agentIds.length > 0 && one.agents.length === agentIds.length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    agentCount: agentIds.length,
  };
}

/**
 * /api/projects/:p/skills — the Project-level skill catalog.
 *
 * Mounted beside the per-Agent router rather than inside it: this answer has no Agent in it, and
 * a path that names an Agent it does not use would be worse than a second mount point.
 */
export function projectSkillsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/catalog", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await projectSkillCatalog(deps, projectId));
  });

  /**
   * GET /api/projects/:p/skills/installed — what this Project has installed, grouped by install
   * unit.
   *
   * The grouping is computed here and returned as structure rather than left to the browser on
   * purpose: "which plugin is this Skill part of" is a question with one right answer, and the
   * failure mode of a client that works it out is a plausible-looking wrong layout rather than an
   * error.
   *
   * `inferred: true` on an item means its install unit was deduced from which Skills are present
   * rather than read from `agent_state/.installs.json` — true for anything installed before that
   * file existed, and true permanently if a write failed. The UI shows it rather than presenting
   * a deduction as a record.
   */
  app.get("/installed", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const agents = await deps.agentService.listAgents(projectId);
    const agentIds = agents.map((a) => a.agentId).sort();
    // Migrate before reading, so the first request after the upgrade already sees the new layout.
    // Best-effort per Agent and never fatal: a Skill that cannot be moved stays readable from the
    // flat tree (both are read), so the worst case is that nothing moved — not that the page fails.
    //
    // Membership comes from the **library**, not `.installs.json`: the record is absent on every
    // install made before it shipped, which is exactly the population that needs migrating.
    const library = loadLibraryPlugins();
    const libraryMembers = new Map(
      library.map((p) => [p.name, p.skills.map((s) => s.name)] as const),
    );
    await Promise.all(
      agentIds.map(async (agentId) => {
        try {
          await migrateFlatBundledSkills(deps.config.root, projectId, agentId, libraryMembers);
        } catch {
          // Best-effort: the worst case is that nothing moved, never that a Skill is lost.
        }
      }),
    );
    const skillsByAgent = new Map(
      await Promise.all(
        agentIds.map(async (agentId) => {
          const skills = await listInstalledSkills(deps.config.root, projectId, agentId);
          return [agentId, skills] as const;
        }),
      ),
    );
    return c.json(
      await buildInstalledSkillsView(deps.config.root, projectId, agentIds, skillsByAgent),
    );
  });

  /**
   * The installed skills this build can rename, discovered rather than declared: an old-name copy
   * is one whose library counterpart exists under a new name and the old one is absent from the
   * library. That is the whole definition of "pre-rebrand", and deriving it means a future rename
   * is covered by shipping the new library rather than by editing a list that has to be remembered.
   *
   * `agentNames` is empty for a skill that has been renamed everywhere already, which is what
   * makes this idempotent: asking twice answers the second time with nothing to do rather than
   * failing.
   */
  app.get("/renamable", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const catalog = await projectSkillCatalog(deps, projectId);
    const libraryNames = new Set(loadLibraryPlugins().flatMap((p) => p.skills.map((s) => s.name)));
    const items = catalog.skills
      .filter((one) => !libraryNames.has(one.name) && LEGACY_SKILL_NAMES.has(one.name))
      .map((one) => ({
        from: one.name,
        to: LEGACY_SKILL_NAMES.get(one.name)!,
        agents: one.agents,
      }));
    return c.json({ items });
  });

  /**
   * POST /api/projects/:p/skills/rename — move one skill to its current library name, on every
   * Agent that has it, backing the old directory up first.
   *
   * The copy before the rename is the point: an installed copy may have been hand-edited, and
   * neither this nor a later reinstall can tell an edit from an old version of the library's own
   * text. Backing up means the outcome is recoverable either way.
   *
   * The body content is left alone. Upgrading the text is the library's job (reinstall), and
   * mixing it in here would overwrite whatever the backup exists to preserve — the rename's
   * purpose is the name, and the two changes should be separable.
   */
  app.post("/rename", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    const from = requireString(body, "from");
    const to = requireString(body, "to");
    // The rename has to be one this build knows about, rather than any pair of ids: it is what
    // stops a caller turning this into a free "move any skill anywhere" operation.
    if (LEGACY_SKILL_NAMES.get(from) !== to) {
      throw badRequest(`Not a known pre-rebrand rename: ${from} -> ${to}`);
    }
    const libraryNames = new Set(loadLibraryPlugins().flatMap((p) => p.skills.map((s) => s.name)));
    if (!libraryNames.has(to)) throw badRequest(`The library has no skill named ${to}`);
    const agents = await deps.agentService.listAgents(projectId);
    const moved: string[] = [];
    const skipped: { agentId: string; reason: string }[] = [];
    for (const agent of agents) {
      const dir = skillsDir(deps.config.root, projectId, agent.agentId);
      const fromDir = path.join(dir, from);
      const toDir = path.join(dir, to);
      const hasFrom = await fs.access(path.join(fromDir, "SKILL.md")).then(
        () => true,
        () => false,
      );
      if (!hasFrom) continue;
      const hasTo = await fs.access(path.join(toDir, "SKILL.md")).then(
        () => true,
        () => false,
      );
      if (hasTo) {
        // Renaming onto an existing directory would merge two skills' files or fail; report it
        // per Agent instead of picking one and losing the other.
        skipped.push({ agentId: agent.agentId, reason: "target_exists" });
        continue;
      }
      await backupSkillDirectory(deps.config.root, projectId, agent.agentId, from);
      await renameSkill(deps.config.root, projectId, agent.agentId, from, to);
      // The name moved, so the record has to move with it: a rename that left the old entry
      // would make the skill read as "unknown origin" the moment it was successfully renamed.
      await recordRenamedSkill(deps.config.root, projectId, agent.agentId, from, to);
      moved.push(agent.agentId);
    }
    return c.json({ from, to, moved, skipped });
  });
  return app;
}

/**
 * Moves a Skill's install record from one name to another after a rename.
 *
 * Without this the renamed Skill would read as "unknown origin" immediately after a rename that
 * had succeeded — the record would still name the directory that no longer exists. A member of a
 * plugin install moves the plugin's list rather than becoming standalone.
 */
async function recordRenamedSkill(
  root: string,
  projectId: string,
  agentId: string,
  from: string,
  to: string,
): Promise<void> {
  const file = await readInstalls(root, projectId, agentId);
  const standalone = file.skills[from];
  const owningPlugin = Object.entries(file.plugins).find(([, record]) =>
    record.skills.includes(from),
  )?.[0];
  if (standalone === undefined && owningPlugin === undefined) return;
  await updateInstalls(root, projectId, agentId, file, (next) => {
    if (standalone !== undefined) {
      delete next.skills[from];
      next.skills[to] = standalone;
    }
    if (owningPlugin !== undefined) {
      next.plugins[owningPlugin] = {
        ...next.plugins[owningPlugin]!,
        skills: next.plugins[owningPlugin]!.skills.map((n) => (n === from ? to : n)).sort(),
      };
    }
  });
}

/** /api/projects/:p/agents/:a/skills: read, import/export and uninstall are all Project-member operations. */
export function agentSkillsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * POST /plugins/uninstall — remove one plugin install from this Agent.
   *
   * The per-Skill delete could express "remove three of a plugin's four Skills" but never "remove
   * the plugin", which left a record claiming a plugin that held nothing. Going through this
   * instead drops the record entry too.
   *
   * Registered before `/:name` so the literal segment wins over the Skill-delete wildcard — a
   * Skill can never be named "plugins", but relying on that would be a route that silently
   * changes meaning if the name rule ever loosens.
   */
  app.post("/plugins/uninstall", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const pluginName = requireString(await readJson(c), "name");
    if (!/^[A-Za-z0-9_-]+$/.test(pluginName)) {
      throw badRequest(`Invalid plugin name: ${pluginName}`);
    }
    const before = (await readInstalls(deps.config.root, projectId, agentId)).plugins[pluginName];
    // With no record — an install from before it shipped — fall back to the library's own list,
    // otherwise uninstalling a legacy plugin would silently do nothing and look like a bug.
    const library = libraryPlugin(pluginName);
    const skillNames = before?.skills ?? library?.skills.map((s) => s.name) ?? [];
    const hookNames = before?.hooks ?? (library?.hooks !== undefined ? [pluginName] : []);
    // The id is what the plugins tree is keyed by; a bare name is accepted and resolved here so a
    // pre-migration caller can still uninstall, and so the response keeps reporting the bare name
    // the UI already knows the plugin by.
    const installed = await listInstalledPlugins(deps.config.root, projectId, agentId);
    const pluginId =
      installed.find((p) => p.name === pluginName)?.id ?? builtinPluginId(pluginName);
    const removed = await removePluginInstall(deps.config.root, projectId, agentId, pluginId);
    // Members the library names but the record did not (a legacy install whose record was lost)
    // still have to go, or "uninstall" would leave the plugin's Skills behind.
    for (const name of skillNames) {
      if (removed.removedSkills.includes(name)) continue;
      await removeSkill(deps.config.root, projectId, agentId, name);
    }
    for (const name of hookNames) {
      if (removed.removedHooks.includes(name)) continue;
      await fs.rm(path.join(hooksDir(deps.config.root, projectId, agentId), name), {
        recursive: true,
        force: true,
      });
    }
    // Hook packages are bound when a core Session is built, so a runtime cached for this Agent
    // would keep running the removed hook until it was evicted.
    if (removed.removedHooks.length > 0 || hookNames.length > 0) {
      deps.manager.invalidateAgentRuntimes(projectId, agentId);
    }
    return c.json({
      plugin: pluginName,
      removedSkills: [...new Set([...removed.removedSkills, ...skillNames])].sort(),
      removedHooks: [...new Set([...removed.removedHooks, ...hookNames])].sort(),
    });
  });

  /**
   * Switches a plugin on or off for one Agent.
   *
   * The first endpoint where disabling is *real* rather than a stored preference: the Skills are
   * read from disk on every Session build, so a plugin with `enabled: false` contributes nothing to
   * the prompt. The runtime is invalidated because a live Session's system prompt was assembled
   * while the plugin was still on — without this the Agent would keep offering a skill the user has
   * just switched off until it happened to be evicted.
   */
  app.post("/plugins/enabled", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const body = await readJson(c);
    const pluginId = requireString(body, "id");
    try {
      assertPluginId(pluginId);
    } catch {
      throw badRequest(`Invalid plugin id: ${pluginId}`);
    }
    const enabled = body.enabled;
    if (typeof enabled !== "boolean") {
      throw badRequest("enabled must be a boolean.");
    }
    const before = await listInstalledPlugins(deps.config.root, projectId, agentId);
    if (!before.some((p) => p.id === pluginId)) {
      throw new HttpError(404, "not_found", `Plugin is not installed: ${pluginId}`);
    }
    const written = await setPluginEnabled(deps.config.root, projectId, agentId, pluginId, enabled);
    deps.manager.invalidateAgentRuntimes(projectId, agentId);
    return c.json({ id: pluginId, enabled: written });
  });

  /** Every plugin installed on the Agent, with the state of its switch. */
  app.get("/plugins/installed", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const plugins = await listInstalledPlugins(deps.config.root, projectId, agentId);
    return c.json({ plugins });
  });

  const listResponse = async (
    projectId: string,
    agentId: string,
  ): Promise<AgentSkillsResponse> => ({
    skills: (await listInstalledSkills(deps.config.root, projectId, agentId)).map(toSkillItem),
  });

  app.get("/", async (c) => {
    // Defensive id validation happens before any path construction: prevents path traversal for cross-Project privilege escalation.
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return c.json(await listResponse(projectId, agentId));
  });

  /**
   * GET /api/projects/:p/agents/:a/skills/catalog — see {@link projectSkillsRoutes}. Kept here as
   * a sibling rather than only on the project-level router so the two answers cannot drift: both
   * call `projectSkillCatalog`, and this one is scoped to the Agent in the path as a convenience
   * for callers that are already on that Agent's page.
   */
  app.get("/catalog", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return c.json(await projectSkillCatalog(deps, projectId));
  });

  // Insert (or migrate a legacy hardcoded # Skills section to) the {{SKILLS}} placeholder —
  // the explicit adoption path mirroring memory's endpoint; idempotent config write,
  // member-level like every other mutation on this router.
  app.post("/template-placeholder", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const view = await deps.agentConfigService.insertTemplatePlaceholder(
      projectId,
      agentId,
      "skills",
    );
    return c.json(view.config.skills);
  });

  // Install one skill from an uploaded zip. Like a library install this touches only the
  // files (no runtime invalidation): skills are read from disk on demand, so the next
  // prompt assembly already sees the new content.
  app.post("/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const body = await readJson(c);
    const dataBase64 = requireString(body, "dataBase64", { minLen: 1, maxLen: 20 * 1024 * 1024 });
    const overwrite = body.overwrite === true;
    let archive: Buffer;
    try {
      archive = Buffer.from(dataBase64, "base64");
    } catch {
      throw badRequest("dataBase64 is not valid base64.");
    }
    if (archive.byteLength === 0) throw badRequest("The zip archive is empty.");
    if (archive.byteLength > MAX_ARCHIVE_BYTES) {
      throw badRequest("The zip archive exceeds the 14MB limit.");
    }
    const skill = parseSkillArchive(archive);
    const dir = path.join(skillsDir(deps.config.root, projectId, agentId), skill.name);
    // Installed-check uses the same criterion as listInstalledSkills: skills/<name>/SKILL.md exists.
    if (!overwrite) {
      const installed = await fs.access(path.join(dir, "SKILL.md")).then(
        () => true,
        () => false,
      );
      if (installed) {
        throw new HttpError(409, "skill_exists", `Skill is already installed: ${skill.name}`);
      }
    }
    // Replace semantics (same as reinstalling from the library): the archive's files are
    // staged and swapped in, so no stale file survives and an interrupted import leaves no
    // half-written Skill behind (subdirectories kept).
    await replaceSkillDirectory(dir, skill.files);
    // Recorded as an import, and as a version-less entry: an uploaded archive carries its own
    // frontmatter version but no library version to compare against, so there is nothing here for
    // an upgrade to act on — which is exactly what separates it from a library skill.
    await recordSkillInstall(deps.config.root, projectId, agentId, skill.name, null, "import");
    return c.json(await listResponse(projectId, agentId), 201);
  });

  // Export one installed skill as a zip: served verbatim as an attachment (same shape as
  // the snapshot export / trace download — a direct binary body, not a JSON envelope), so
  // what's downloaded can be re-imported byte-compatibly via the POST archive route.
  app.get("/:name/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const name = requireValidId(c, "name");
    const dir = path.join(skillsDir(deps.config.root, projectId, agentId), name);
    // Installed-check uses the same criterion as listInstalledSkills: skills/<name>/SKILL.md exists.
    try {
      await fs.access(path.join(dir, "SKILL.md"));
    } catch {
      throw new HttpError(404, "not_found", `Skill is not installed: ${name}`);
    }
    const archiveFiles = await collectSkillArchive(dir, name);
    // A -v<version> suffix only when the frontmatter declares one explicitly (the header
    // is the authority on the filename — the web tab reads it from Content-Disposition).
    const version = explicitSkillVersion(strFromU8(archiveFiles[`${name}/SKILL.md`]!));
    const fileName = version === null ? `${name}.zip` : `${name}-v${version}.zip`;
    const zip = zipSync(archiveFiles);
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        // The name is id-validated ([A-Za-z0-9_-]+), so the encoded filename is itself.
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  /**
   * Mount a machine-store Skill onto one Agent — 管理安装's 「安装」.
   *
   * **Only from the machine store.** A Skill reaches this machine by one of the three add paths, so
   * the store is the one place every installable Skill is guaranteed to be; this route therefore
   * has no "search the library for a body to send" branch, and that absence is deliberate — it
   * means the name has to be something the user actually added, not something a client invented.
   *
   * The Skill's files are copied whole, including the auxiliary files its SKILL.md references, and
   * recorded in `.installs.json` as an import — the same shape as an archive install, because by the
   * time it lands on an Agent it *is* an import from the Agent's point of view.
   *
   * **Idempotent**: mounting a Skill the Agent already has replaces that directory outright, so a
   * re-mount brings the current content and drops files the new copy no longer ships, rather than
   * merging the two into a directory that never existed.
   */
  app.post("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const name = requireValidId(c, "name");

    // The machine switch is the wider of the two, and it is read the same way `listInstalledSkills`
    // reads it: a Skill switched off for this machine cannot be mounted anywhere.
    const machineOff = await isMachineSkillEnabled(deps.config.root, name);
    if (!machineOff) {
      throw new HttpError(
        409,
        "skill_disabled",
        `Skill is disabled for this machine — enable it before installing: ${name}`,
      );
    }

    const files = await readMachineSkillFiles(deps.config.root, name);
    if (files === null) {
      throw new HttpError(
        404,
        "not_found",
        `Skill is not in the machine store: ${name}. Add it first.`,
      );
    }
    const content = files["SKILL.md"];
    if (content === undefined) {
      // `readMachineSkillFiles` returning non-null means a SKILL.md was read; the check is here
      // because the install below must not write a Skill directory without one.
      throw new HttpError(400, "bad_skill", `Skill has no SKILL.md: ${name}`);
    }
    const { ["SKILL.md"]: _skillMd, ...auxiliary } = files;
    await installSkill(deps.config.root, projectId, agentId, {
      name,
      content,
      ...(Object.keys(auxiliary).length > 0 ? { files: auxiliary } : {}),
    });
    // Recorded as an import with no version: the machine store is the source now, and it carries
    // its own, which is what 升级 reads (see the machine store's `.source.json`).
    await recordSkillInstall(deps.config.root, projectId, agentId, name, null, "import");
    // Skills are read from disk per session build, so the next prompt already sees it; no runtime
    // invalidation is needed for a mount (same as the archive install beside it).
    return c.json({ name, installed: true }, 201);
  });

  app.delete("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const name = requireValidId(c, "name");
    // Installed-check uses the same criterion as listInstalledSkills: skills/<name>/SKILL.md exists.
    const file = path.join(skillsDir(deps.config.root, projectId, agentId), name, "SKILL.md");
    try {
      await fs.access(file);
    } catch {
      throw new HttpError(404, "not_found", `Skill is not installed: ${name}`);
    }
    await removeSkill(deps.config.root, projectId, agentId, name);
    return c.body(null, 204);
  });

  return app;
}
