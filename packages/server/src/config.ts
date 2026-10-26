/**
 * Server runtime config (ServerConfig) — parsed from environment variables.
 *
 * The data root directory is shared with the SDK / CLI (`resolveRoot()`:
 * JIUMATE_HOME or ~/.jiumate/data); the SQLite index database defaults to
 * `<root>/web.db` (overridable via JIUMATE_WEB_DB, tests use ":memory:").
 * In production, the SPA is served statically once the frontend build output
 * directory (JIUMATE_WEB_DIST, the bundled web-dist/, or ../web/dist) is
 * detected to exist.
 * Docs: /docs/configuration § "Environment variables".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SERVER_PORT, resolveRoot } from "@jiumate/core";

export interface ServerConfig {
  /** Local data root directory (shared with the SDK/CLI). */
  root: string;
  /** HTTP listen address and port (defaults to 127.0.0.1:7364, deliberately avoiding common ports like 3000/8080). */
  host: string;
  /**
   * Listen port. `0` asks the OS for an ephemeral port (the desktop shell always does),
   * in which case the value is only a request: index.ts writes the ACTUAL bound port back
   * here once listening, because preview URLs are built from the server's own port rather
   * than the browser's (dev serves the SPA on a different port; see resolvePreviewTarget).
   */
  port: number;
  /** SQLite database path; ":memory:" for test injection. */
  dbPath: string;
  /** Frontend static assets directory; whether it's enabled is decided by checking existence when the app is assembled. */
  webDist: string;
  /**
   * Origin that serves Workspace HTML previews (JIUMATE_PREVIEW_ORIGIN), e.g.
   * `https://preview.example.com`. It must differ from the App origin by **hostname** —
   * cookies ignore ports, so a second port would still share the session cookie. Unset
   * is the norm locally: the loopback counterpart (`127.0.0.1` <-> `localhost`) is
   * derived per request instead.
   */
  previewOrigin: string | null;
  /**
   * Fixed initial password for the seeded built-in admin (JIUMATE_SEED_ADMIN_PASSWORD),
   * used by automated tests and e2e. Null is the norm: the seed then generates a random
   * password that is hashed and discarded unseen, and the account is claimed through the
   * first-login link instead.
   */
  seedAdminPassword: string | null;
  /** Login session validity period (30 days). */
  authSessionTtlMs: number;
  /**
   * Sliding renewal threshold: a session validated with less than this much left is renewed to
   * the full TTL. Set one day below the TTL, so any session used at least a day after it was
   * issued renews — in practice a session in regular use never expires, and the TTL is the
   * idle timeout.
   */
  authSessionRenewMs: number;
  /**
   * Desktop mode (JIUMATE_DESKTOP_TOKEN): the per-launch token minted by the desktop
   * shell. Non-null enables the one-shot claim link and the Bearer-token shutdown
   * endpoints and requires a loopback HOST — desktop mode passes the token through a
   * URL, which must never leave the machine.
   */
  desktopToken: string | null;
  /**
   * Whether `jiumate server|web` supervises this process (JIUMATE_SUPERVISED=1) and relaunches
   * it when it exits with core's SERVER_RESTART_EXIT_CODE — what makes the web UI's "restart
   * to update" possible. False under a direct server start, a dev run, or the desktop shell.
   */
  supervised: boolean;
  /**
   * Port announcement file (JIUMATE_PORT_FILE): after the listener is up, the actual
   * bound port is written here — the supervising process's way to learn the port when
   * it starts the server with PORT=0.
   */
  portFile: string | null;
  /**
   * Trust `x-forwarded-proto` from the request (JIUMATE_TRUST_PROXY=1). Off by default:
   * the header is caller-supplied, so on a non-loopback bind an untrusted caller could
   * set it to `https` to walk through the hot-update network gate (hmr/routes.ts) while
   * actually speaking plaintext — or get session cookies stamped `Secure` over plain HTTP,
   * which the browser then never sends back (a sign-in that never takes). Enable this only
   * behind a reverse proxy that terminates TLS and either sets or strips the header itself
   * before it reaches this process; an HTTPS deployment that leaves it off issues session
   * cookies WITHOUT the `Secure` flag (auth/middleware.ts cookieOptions).
   */
  trustProxy: boolean;
  /**
   * Absolute path to the Pandoc binary, or null when none was found. Resolution
   * honours JIUMATE_PANDOC (absolute path or a name resolvable on PATH) and falls
   * back to scanning PATH for `pandoc`. Null means DOCX/EPUB/RTF/TXT exports are
   * disabled — the capabilities endpoint reports it as `pandoc.available = false`
   * and the menu greys those entries out.
   */
  pandocPath: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Default frontend build output directory, first match wins:
 * - `<this package>/web-dist`: npm package layout — the release workflow copies the built
 *   web assets into the published package, so an `npm install` gets the Web UI too;
 * - `<this package>/../web/dist`: monorepo layout (resolves the same whether running
 *   from src or dist), also the fallback when neither exists.
 */
function defaultWebDist(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.resolve(here, "..", "web-dist");
  if (fs.existsSync(bundled)) return bundled;
  return path.resolve(here, "..", "..", "web", "dist");
}

/**
 * Validates JIUMATE_PREVIEW_ORIGIN into a bare origin, or throws. An unparseable value
 * is a hard failure rather than a silent fallback: falling back would quietly serve
 * previews same-origin, which is the configuration this variable exists to avoid.
 */
function normalizePreviewOrigin(raw: string | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`Invalid JIUMATE_PREVIEW_ORIGIN=${raw} (expected an absolute origin)`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid JIUMATE_PREVIEW_ORIGIN=${raw} (only http/https are supported)`);
  }
  return url.origin;
}

/** Parses server config from environment variables (PORT / HOST / JIUMATE_HOME / JIUMATE_WEB_DIST / JIUMATE_WEB_DB / JIUMATE_PREVIEW_ORIGIN / JIUMATE_SEED_ADMIN_PASSWORD / JIUMATE_DESKTOP_TOKEN / JIUMATE_PORT_FILE / JIUMATE_TRUST_PROXY). */
export function resolveServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const root = env.JIUMATE_HOME ?? resolveRoot();
  // An empty PORT string is treated as unset (the common `.env` case of an empty
  // `PORT=`): Number("") === 0 would pass the range check and bind to a random
  // port; this matches the CLI's resolvePort convention.
  const port = Number(env.PORT || DEFAULT_SERVER_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port configuration PORT=${env.PORT}`);
  }
  const host = env.HOST ?? "127.0.0.1";
  const desktopToken = env.JIUMATE_DESKTOP_TOKEN?.trim() || null;
  // Desktop mode redeems its token through a URL: never allow it off loopback.
  if (desktopToken !== null && host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Desktop mode requires a loopback HOST (got HOST=${host})`);
  }
  return {
    root,
    host,
    port,
    dbPath: env.JIUMATE_WEB_DB ?? path.join(root, "web.db"),
    webDist: env.JIUMATE_WEB_DIST ?? defaultWebDist(),
    previewOrigin: normalizePreviewOrigin(env.JIUMATE_PREVIEW_ORIGIN),
    // An empty/whitespace value is treated as unset, which leaves the seed to generate one.
    seedAdminPassword: env.JIUMATE_SEED_ADMIN_PASSWORD?.trim() || null,
    authSessionTtlMs: 30 * DAY_MS,
    authSessionRenewMs: 29 * DAY_MS,
    desktopToken,
    portFile: env.JIUMATE_PORT_FILE?.trim() || null,
    trustProxy: env.JIUMATE_TRUST_PROXY === "1",
    supervised: env.JIUMATE_SUPERVISED === "1",
    pandocPath: resolvePandocPath(env),
  };
}

/**
 * Locate the Pandoc binary. Resolution order:
 *   1. `JIUMATE_PANDOC` — if absolute and exists, used as-is; otherwise treated as a name
 *      and resolved against PATH.
 *   2. PATH scan for the literal name `pandoc` (with `.exe` on Windows).
 *
 * Returns null on any miss. The caller treats null as "exports disabled" rather than a
 * hard failure: the server still starts, and the capabilities endpoint tells the UI so.
 */
function resolvePandocPath(env: NodeJS.ProcessEnv): string | null {
  const override = env.JIUMATE_PANDOC?.trim();
  if (override) {
    if (path.isAbsolute(override) && fs.existsSync(override)) return override;
    const resolved = whichOnPath(override, env.PATH);
    if (resolved !== null) return resolved;
  }
  return whichOnPath("pandoc", env.PATH);
}

function whichOnPath(bin: string, pathEnv: string | undefined): string | null {
  if (!pathEnv) return null;
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    const exe = process.platform === "win32" && !/\.[a-z0-9]+$/i.test(bin) ? `${bin}.exe` : bin;
    const full = path.join(dir, exe);
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch {
      // ENOENT / EACCES — try the next entry.
    }
  }
  return null;
}
