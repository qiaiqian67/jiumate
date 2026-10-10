/**
 * Adding a plugin that is not in the shipped library (server/http/routes/plugin-import.ts): from a
 * URL, from an uploaded archive, or from a plugin already on this machine.
 *
 * **All three land in the same place, as `<name>@local`.** An added plugin is written to
 * `<root>/plugins/<name>@local/`, and `pluginRoots()` (core/plugins/index.ts) reads that directory
 * alongside the npm-resolved built-ins — so an imported plugin appears in the library listing, the
 * detail view and the install rows with no special-casing anywhere downstream. A distinct
 * marketplace is also what keeps `foo@local` from colliding with `foo@jiumate-builtin`: installs
 * are addressed by id, so an upgrade or an uninstall of one cannot reach the other.
 *
 * **A local copy overrides a built-in of the same name, deliberately.** The user went and imported
 * it, and a library entry shadowed by the thing it was copied from is the one case where importing
 * a plugin silently does nothing.
 *
 * **The three sources differ in what can go wrong, and each is answered where it can be.**
 *
 * - *Archive* — bytes neither the user nor the server authored. Validated for path traversal,
 *   symlinks, file count and expanded size **before a single file is written**
 *   (core/state/plugin-import.ts), and unpacked to a staging directory so a zip that turns out not
 *   to be a plugin leaves nothing behind.
 * - *Local path* — a directory the user pointed at. Read, never written, symlinks skipped rather
 *   than followed. Copying is what makes it ours; pointing at it would make every later edit of the
 *   source silently change an installed plugin.
 * - *URL* — the only source that touches the network. `http`/`https` only, the redirect chain
 *   followed here rather than by `fetch`, so a redirect into another scheme is unreachable, and the
 *   body read with a running total so a server that never stops sending is cut off.
 *
 * **Adding is not installing.** These routes add a plugin to the machine's library. Installing it
 * into a given Agent is the existing, separate action — a user who adds a plugin and a user who
 * installs it into five Agents are making two decisions, and a dialog that made both at once could
 * not be trusted to do either.
 *
 * **Every route is a Project-member operation**, including `/discover`: it reads nothing of the
 * Project, but it enumerates directories on the host, and a logged-out caller has no business
 * learning which of them exist.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import {
  PluginArchiveError,
  RepoUrlError,
  assertPluginId,
  canUpgrade,
  describeDiscovered,
  describeInDirectory,
  discoverPlugins,
  isNewerVersion,
  libraryPlugin,
  listInstalledPlugins,
  loadLibraryPlugins,
  localPluginId,
  localPluginsDir,
  readProvenance,
  removeLocalPlugin,
  resolveRepoUrl,
  stripSingleRootDir,
  unpackPluginArchive,
  writePluginArchive,
  writeProvenance as writeProvenanceFile,
} from "@prismshadow/jiumate-core";
import type { AppDeps } from "../../app.js";
import type { AppEnv } from "../../auth/middleware.js";
import type {
  PluginImportArchiveResponse,
  PluginImportDiscoverResponse,
  PluginImportLocalResponse,
  PluginImportResult,
  PluginImportUrlResponse,
  PluginImportBatchResponse,
  PluginDeleteResponse,
  PluginUpgradeResponse,
} from "../../api/types.js";
import { HttpError } from "../errors.js";
import { badRequest, readJson, requireString, requireValidId } from "../validate.js";

/** Ceiling on one downloaded plugin archive, matching the unpack budget. */
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;

/** Ceiling on redirect hops. Five is generous for a real repository; more is a loop. */
const MAX_REDIRECTS = 5;

/**
 * Which Agents currently have a plugin installed.
 *
 * Read before a machine-wide delete, because the delete removes the library copy and this is the
 * only place that knows who was relying on it. Enabled state is deliberately **not** filtered: a
 * disabled plugin is still installed, and reporting "nobody uses this" when three Agents have it
 * switched off would be a lie that only surfaces after the delete.
 */
async function agentsUsingPlugin(deps: AppDeps, projectId: string, id: string): Promise<string[]> {
  const out: string[] = [];
  for (const agent of await deps.agentService.listAgents(projectId)) {
    const installed = await listInstalledPlugins(deps.config.root, projectId, agent.agentId);
    if (installed.some((p) => p.id === id)) out.push(agent.agentId);
  }
  return out;
}

/**
 * The version of a plugin inside an archive, read without writing anything into the store.
 *
 * Unzipped to a scratch directory and cleaned up afterwards, because the alternative is unpacking
 * the candidate over a working plugin and *then* discovering it is older — which is exactly the
 * 「没有则不升级」 case the version check exists to prevent.
 *
 * A null means no version could be read, and the caller treats that as "cannot upgrade": an upgrade
 * that overwrites a working plugin on the strength of a guess is the wrong trade.
 */
/**
 * The version of a plugin inside an archive, read without writing anything into the store.
 *
 * Unpacked to a scratch directory that is removed afterwards, because the alternative is unpacking
 * the candidate over a working plugin and *then* discovering it is older — which is exactly the
 * 「没有则不升级」 case the version check exists to prevent.
 *
 * A null means no version could be read, and the caller treats that as "cannot upgrade": an upgrade
 * that overwrites a working plugin on the strength of a guess is the wrong trade.
 */
async function versionOfArchive(bytes: Buffer): Promise<string | null> {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "jiumate-upgrade-"));
  try {
    await writePluginArchive(stripSingleRootDir(unpackPluginArchive(bytes)), scratch);
    // One directory means one plugin; several would leave no single version to compare against, and
    // that case answers null too — do not upgrade.
    const dirs = (await fs.readdir(scratch, { withFileTypes: true })).filter((d) => d.isDirectory());
    if (dirs.length !== 1) return null;
    const manifest = JSON.parse(
      await fs.readFile(path.join(scratch, dirs[0]!.name, "plugin.json"), "utf8"),
    ) as { version?: string };
    return manifest.version ?? null;
  } catch {
    return null;
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

/** Where a plugin the user added is written. */
function storeDir(deps: AppDeps): string {
  return localPluginsDir(deps.config.root);
}

/** The directory one added plugin occupies in the store. */
function pluginStoreDir(deps: AppDeps, id: string): string {
  return path.join(storeDir(deps), id);
}

/**
 * Records where a plugin came from, next to it in the store.
 *
 * A failure here is not fatal. The plugin is already written and already in the library; what is
 * lost is the ability to check it for updates later, which is a smaller loss than refusing an import
 * that otherwise worked — and a user who hits that later can simply re-add it.
 */
async function writeProvenance(
  deps: AppDeps,
  id: string,
  info: { sourceUrl?: string; sourceRepo?: string; sourceBranch?: string; sourcePath?: string },
): Promise<void> {
  try {
    await writeProvenanceFile(pluginStoreDir(deps, id), { ...info, addedAt: Date.now() });
  } catch {
    // See above: the import succeeded, and an upgrade check can be re-established by re-adding.
  }
}

/**
 * Every plugin name currently in the library, for marking a discovery as already present.
 *
 * Read fresh on every call, never cached: the set changes the moment an import succeeds, and a
 * cached copy would keep offering the plugin that was just added — the one case where the dialog
 * would be actively wrong rather than merely stale.
 *
 * A library that cannot be read yields an empty set rather than an error. Discovery is a listing
 * convenience, and a broken built-in plugin should leave the import dialog working instead of
 * taking it down — at worst the user is offered something already present, which re-importing
 * simply overwrites.
 */
function libraryNames(): Set<string> {
  try {
    return new Set(loadLibraryPlugins().map((p) => p.name));
  } catch {
    return new Set();
  }
}

/**
 * Rejects a plugin name that cannot be a directory.
 *
 * Checked on the bare name rather than only through `assertPluginId` so the message names the field
 * the user typed. The name comes from a manifest on disk — it is still untrusted input, because
 * that manifest may have arrived in a zip the user downloaded from somewhere.
 */
function assertImportableName(name: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
    throw badRequest(
      `A plugin name must be letters, digits, "-" or "_" (got ${JSON.stringify(name)}).`,
    );
  }
}

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

/** Every file under `dir`, as `{rel, data}`, with symlinks skipped rather than followed. */
async function collectFiles(dir: string): Promise<{ rel: string; data: Uint8Array }[]> {
  const out: { rel: string; data: Uint8Array }[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), rel);
      } else if (entry.isFile()) {
        // `isFile()` is false for a symlink, so a link into the user's home is skipped rather than
        // read: a plugin package is scripts and text and has no use for one.
        out.push({ rel, data: await fs.readFile(path.join(current, entry.name)) });
      }
    }
  };
  await walk(dir, "");
  return out;
}

/**
 * The plugin's name, read from its manifest rather than from its directory.
 *
 * The manifest is the authority — the same precedence `readPluginDir` uses — so a plugin whose
 * folder and manifest disagree installs under one name in both the library and `plugins/<id>`.
 */
async function readPluginName(dir: string): Promise<string> {
  const candidates = [
    path.join(dir, "plugin.json"),
    path.join(dir, ".claude-plugin", "plugin.json"),
  ];
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    let parsed: unknown;
    try {
      // A leading BOM is stripped: Windows editors write one, and a plugin someone hand-wrote on
      // Windows would otherwise be refused as "not a plugin" — the author never meant to put those
      // bytes there, and the file is plainly valid JSON apart from them.
      const text = await fs.readFile(candidate, "utf8");
      parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch {
      throw new PluginArchiveError(
        `${path.basename(candidate)} is not valid JSON — this is not a plugin.`,
        "not_a_plugin",
      );
    }
    const name = (parsed as { name?: unknown } | null)?.name;
    if (typeof name === "string" && name !== "") return name;
  }
  throw new PluginArchiveError(
    "No plugin.json (or .claude-plugin/plugin.json) with a name — this is not a plugin.",
    "not_a_plugin",
  );
}

/**
 * Copies a plugin's files into the store as `<name>@local`, and confirms it reads back.
 *
 * **The confirmation is the point of this function.** `libraryPlugin(name)` is the same reader the
 * library listing uses, so a plugin that was written but cannot be parsed — a manifest missing a
 * version, a skill directory that is not a skill — fails here, at the door, instead of being
 * reported as a successful import and then appearing in the library as half-empty.
 */
async function copyIntoStore(deps: AppDeps, sourceDir: string): Promise<{ id: string; name: string }> {
  // Every path out of here is a 400 — the user's directory or their archive is not a plugin this
  // can install — so the translation is done once, here, rather than at each of the two call sites.
  try {
    return await copyIntoStoreChecked(deps, sourceDir);
  } catch (e) {
    if (e instanceof PluginArchiveError) throw new HttpError(400, e.code, e.message);
    throw e;
  }
}

/** The write itself; {@link copyIntoStore} is the boundary that turns its refusals into HTTP. */
async function copyIntoStoreChecked(
  deps: AppDeps,
  sourceDir: string,
): Promise<{ id: string; name: string }> {
  const name = await readPluginName(sourceDir);
  assertImportableName(name);
  const id = localPluginId(name);
  assertPluginId(id);

  const dest = path.join(storeDir(deps), id);
  // Replaced rather than merged: a stale file from a previous version of this plugin would survive
  // a merge and ship in the new one, which is a bug a user cannot see or undo.
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  await writePluginArchive(await collectFiles(sourceDir), dest);

  let stored;
  try {
    stored = libraryPlugin(name);
  } catch (e) {
    // Leave nothing behind that the library cannot read: a directory that makes `pluginRoots()`
    // throw would take the whole plugin page down.
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    throw new HttpError(
      400,
      "not_a_plugin",
      `The plugin was written but could not be read: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (stored === undefined) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    throw new HttpError(
      500,
      "import_incomplete",
      `The plugin was written but did not appear in the library: ${name}.`,
    );
  }
  return { id, name };
}

/**
 * Unpacks an archive into a staging directory and imports it, always removing the staging after.
 *
 * **`PluginArchiveError` is translated here, not at the route.** The whole point of that error type
 * is to carry a code the client can act on; thrown raw it becomes a 500, which tells the user their
 * archive broke the server rather than that their archive is not a plugin — and, because a 500 is
 * not retryable and not attributable, it looks like a bug in the app rather than a bad upload.
 * Translating it once, where every archive arrives, is what keeps that promise for all three
 * sources.
 */
async function importArchive(deps: AppDeps, bytes: Buffer): Promise<{ id: string; name: string }> {
  let entries: ReturnType<typeof stripSingleRootDir>;
  try {
    entries = stripSingleRootDir(unpackPluginArchive(bytes));
  } catch (e) {
    if (e instanceof PluginArchiveError) {
      throw new HttpError(400, e.code, e.message);
    }
    throw e;
  }
  const staging = path.join(storeDir(deps), ".staging");
  const dir = path.join(staging, `import-${Date.now().toString(36)}-${process.pid}`);
  try {
    await writePluginArchive(entries, dir);
    return await copyIntoStore(deps, dir);
  } catch (e) {
    // A refusal from the write path (a name that is not a safe directory) is the same class of
    // problem as one from the parse path, and gets the same 400.
    if (e instanceof PluginArchiveError) {
      throw new HttpError(400, e.code, e.message);
    }
    throw e;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    // `.staging` is left in place: it is cheap, and removing it could race another concurrent
    // import that is mid-write. It is skipped by `localPluginRoots` because its name starts with a dot.
  }
}

/** Parses a URL and rejects any scheme other than http(s) before it is used. */
function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("That is not a URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw badRequest(`Only http and https URLs are supported (got ${url.protocol}).`);
  }
  return url;
}

/**
 * Fetches a URL's bytes, following redirects here rather than delegating to `fetch`.
 *
 * Manual redirect handling is what makes the scheme check hold across the whole chain: `fetch`
 * would follow a `https://` URL that redirects to `file://` or `data:`, and each hop is checked
 * with the same rule the first one is. The running byte total is the other half — a declared
 * `content-length` can be absent or a lie, so the ceiling is enforced on what actually arrives.
 */
async function download(url: URL): Promise<Buffer> {
  const seen = new Set<string>();
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") {
      throw badRequest(`Only http and https URLs are supported (got ${current.protocol}).`);
    }
    const key = current.toString();
    if (seen.has(key)) throw badRequest("The URL redirects in a loop.");
    seen.add(key);

    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
      headers: { accept: "*/*", "user-agent": "jiumate-plugin-import" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null) throw badRequest("The server sent a redirect with no target.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      throw new HttpError(502, "download_failed", `The server returned ${response.status}.`);
    }
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
      throw badRequest("The download is larger than the 64MB limit.");
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        throw badRequest("The download is larger than the 64MB limit.");
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw badRequest(`The URL redirected more than ${MAX_REDIRECTS} times.`);
}

/** Decodes a base64 body, rejecting anything that is not usable as an archive. */
function decodeArchive(body: Record<string, unknown>): Buffer {
  const dataBase64 = requireString(body, "dataBase64", { minLen: 1, maxLen: 200 * 1024 * 1024 });
  const archive = Buffer.from(dataBase64, "base64");
  if (archive.byteLength === 0) throw badRequest("The archive is empty.");
  return archive;
}

export function pluginImportRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * Plugin packages found on this machine, plus the directories that were probed.
   *
   * `path` is optional and accepts either a plugin directory or a folder holding several. The
   * probed directories come back even when they hold nothing, so a user whose Agent installs
   * somewhere else is told which places were checked instead of being left to guess why the list
   * is empty.
   */
  app.get("/discover", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const manual = c.req.query("path");
    const result = discoverPlugins(manual === undefined || manual === "" ? undefined : manual);
    // A plugin already in the library is not offered: importing it would produce a second copy
    // under a different marketplace holding the same skills, which the user could not explain.
    const known = new Set(libraryNames());
    return c.json({
      plugins: result.plugins.map((p) => ({ ...p, alreadyInstalled: known.has(p.name) })),
      probes: result.probes,
    } satisfies PluginImportDiscoverResponse);
  });

  /**
 * Import **every** plugin in a directory on this machine, in one press.
 *
 * **Adding a directory adds the directory's plugins, and nothing else.** A user who points at a
 * folder of plugins means "use these", not "use whichever one of these happens to sort first" — so
 * every plugin in it is imported, and the response lists them all rather than only the first.
 *
 * **Each one lands 待启用: installed on this machine, into no Agent.** That is the whole point of
 * separating this from `启用`: the copy is here, ready, and it costs nothing until an Agent is
 * actually pointed at it. A bulk import that quietly switched five plugins on for whichever Agent
 * happened to be selected would be a very large surprise from a very small action.
 *
 * **Per-plugin failures are reported, not thrown.** A folder of ten plugins where one has an
 * unreadable manifest should import nine and say which one did not — refusing all ten because of
 * one would make the button useless on any real collection.
 */
app.post("/local/batch", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const dir = requireString(await readJson(c), "path", { minLen: 1, maxLen: 1024 });
    const resolved = path.resolve(dir);
    try {
      if (!(await fs.stat(resolved)).isDirectory()) throw badRequest("That path is not a directory.");
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw badRequest(`No such directory: ${resolved}`);
    }

    // The directory itself may be a single plugin, or a folder holding several. Both are what the
    // user meant by "this directory", so both are accepted (the same rule the scanner follows).
    const candidates = describeDiscovered({ name: path.basename(resolved), path: resolved, origin: "manual" });
    const targets =
      candidates !== null
        ? [{ name: candidates.name, path: resolved }]
        : describeInDirectory(resolved);

    const added: PluginImportResult[] = [];
    const failed: { name: string; reason: string }[] = [];
    for (const target of targets) {
      try {
        const result = await copyIntoStore(deps, target.path);
        // Each plugin records the directory it came from, so an upgrade can say why there is
        // nothing to check and a user can find the original later.
        await writeProvenance(deps, result.id, { sourcePath: target.path });
        added.push(result);
      } catch (e) {
        // One bad plugin does not abort the rest — see the note above.
        failed.push({
          name: target.name,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // A directory with nothing in it is a refusal, not an empty success: the user asked for their
    // plugins and got none, and a silent `200 {added: []}` reads as a bug.
    if (added.length === 0) {
      throw badRequest(
        targets.length === 0
          ? `No plugins found in ${resolved}. A plugin needs a plugin.json with a name and version.`
          : `Nothing in ${resolved} could be imported: ${failed.map((f) => `${f.name} (${f.reason})`).join("; ")}`,
      );
    }

    return c.json(
      { added, failed } satisfies PluginImportBatchResponse,
      201,
    );
  });

  /** Import a plugin from a directory already on this machine. */
  app.post("/local", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const dir = requireString(await readJson(c), "path", { minLen: 1, maxLen: 1024 });
    const resolved = path.resolve(dir);
    try {
      if (!(await fs.stat(resolved)).isDirectory()) throw badRequest("That path is not a directory.");
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw badRequest(`No such directory: ${resolved}`);
    }
    const result = await copyIntoStore(deps, resolved);
    // Recorded so the UI can say where it came from, and so an upgrade can explain that a
    // folder-sourced plugin has no update to check (see `canUpgrade`).
    await writeProvenance(deps, result.id, { sourcePath: resolved });
    return c.json(result, 201);
  });

  /** Import a plugin from an uploaded zip. */
  app.post("/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const result = await importArchive(deps, decodeArchive(await readJson(c)));
    return c.json(result satisfies PluginImportArchiveResponse, 201);
  });

  /**
   * Import a plugin from a repository URL.
   *
   * **Every shape a user pastes is accepted.** `https://github.com/o/r`, the same with `.git`,
   * `.../tree/main`, a deep link into a file — all of them name the same repository to the person
   * pasting them, so all of them resolve to the same branch archive (`resolveRepoUrl`). A URL that
   * has to be reshaped by hand before it works is a URL the user will get wrong, and `/tree/main`
   * is the one they are *most* likely to paste, because it is what copying from a browser gives.
   *
   * **The resolved archive URL is recorded beside the plugin.** A plugin added from a repository
   * can only be checked for updates by asking that repository, and the address is not recoverable
   * from the archive afterwards — so 升级 would have nothing to fetch. See `writeProvenance`.
   */
  app.post("/url", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const raw = requireString(await readJson(c), "url", { minLen: 1, maxLen: 2048 });

    let resolved;
    try {
      resolved = resolveRepoUrl(raw);
    } catch (e) {
      // The user's typo, not a server fault, and the message names the shapes that would have
      // worked — which is the thing they are actually asking for.
      if (e instanceof RepoUrlError) throw new HttpError(400, "bad_repo_url", e.message);
      throw e;
    }

    const bytes = await download(new URL(resolved.archiveUrl));
    const result = await importArchive(deps, bytes);
    await writeProvenance(deps, result.id, {
      sourceUrl: resolved.archiveUrl,
      sourceRepo: resolved.name,
      sourceBranch: resolved.branch,
    });
    return c.json({ ...result, sourceUrl: resolved.archiveUrl } satisfies PluginImportUrlResponse, 201);
  });

  /**
   * Delete an added plugin from this machine.
   *
   * **Machine-wide, and the response says which Agents it is currently in use by.** Those are two
   * different deletions and only this one is destructive: taking one Agent's use of a plugin away
   * is `setPluginEnabled(id, false)`, which leaves the files. So the body reports the affected
   * Agents rather than the client having to ask for it first — the user is about to press a button
   * that says 「删除本插件」 and the list of who will lose access is the thing that makes that
   * confirmable rather than scary.
   *
   * Returns the Agent ids it was installed on, so the caller can reload what it has to.
   */
  app.delete("/:id", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const id = c.req.param("id");
    assertPluginId(id);

    // Read the usage before the delete, because afterwards there is nothing left to read.
    const affected = await agentsUsingPlugin(deps, projectId, id);
    try {
      await removeLocalPlugin(deps.config.root, id);
    } catch (e) {
      // Refusing to delete a built-in plugin is a refusal of the *request*, not a fault in the server.
      throw badRequest(e instanceof Error ? e.message : `Cannot delete ${id}.`);
    }
    return c.json({ id, affectedAgents: affected } satisfies PluginDeleteResponse, 200);
  });

  /**
   * Check an added plugin for a newer version, and upgrade it if there is one.
   *
   * **Goes back to where it was installed from.** `升级` is defined as verifying against the original
   * installation method, so the recorded provenance (`.provenance.json`) is what this reads — an
   * archive carries no address of its own, which is why it is written at import time.
   *
   * **A plugin added from a folder reports `upgradable: false` rather than failing.** There is no
   * remote to ask, and "no update available" would be a claim we cannot support. Re-adding the
   * folder is how a user updates one of those, and it is an explicit act.
   *
   * **No newer version is a 200 with `upgraded: false`,** not an error — 「没有则不升级」 is the
   * specified behaviour, and reporting it as a failure would make a correct outcome look broken.
   */
  app.post("/:id/upgrade", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const id = c.req.param("id");
    assertPluginId(id);

    const dir = pluginStoreDir(deps, id);
    const provenance = await readProvenance(dir);
    const sourceUrl = provenance?.sourceUrl;
    // No recorded source — a plugin added from a folder — so there is nothing to ask. `false` rather
    // than "up to date", which would be a claim we cannot support either way.
    if (!canUpgrade(provenance) || sourceUrl === undefined) {
      return c.json({ id, upgraded: false, upgradable: false } satisfies PluginUpgradeResponse, 200);
    }

    // The manifest holds the installed version, which is the thing a newer one is compared against.
    let installedVersion = "";
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(dir, "manifest.json"), "utf8"),
      ) as { version?: string };
      installedVersion = manifest.version ?? "";
    } catch {
      // No readable manifest: treat the version as unknown, which `isNewerVersion` treats as
      // "not newer", so this degrades to reporting no update rather than overwriting blindly.
    }

    const bytes = await download(new URL(sourceUrl));
    // The version in the fetched archive, compared against the installed one **before** anything is
    // written — so a failed version check leaves the working plugin exactly as it was.
    const candidate = await versionOfArchive(bytes);
    if (candidate === null || !isNewerVersion(candidate, installedVersion)) {
      return c.json({ id, upgraded: false, upgradable: true } satisfies PluginUpgradeResponse, 200);
    }

    await importArchive(deps, bytes);
    await writeProvenance(deps, id, {
      sourceUrl,
      sourceRepo: provenance?.sourceRepo,
      sourceBranch: provenance?.sourceBranch,
    });
    return c.json(
      { id, upgraded: true, upgradable: true, version: candidate } satisfies PluginUpgradeResponse,
      200,
    );
  });

  return app;
}