/**
 * Turning a URL a person pasted into the archive that holds the plugin.
 *
 * **The problem this solves.** A repository URL is not one string; it is six or seven depending on
 * where it was copied from, and a user pasting from their browser produces the most decorated of
 * them. `https://github.com/block/berd` is the repository. `https://github.com/block/berd.git` is
 * what `git clone` takes. `https://github.com/block/berd/tree/main` is what you get after clicking
 * into a folder in the web UI — and pasting it straight into a downloader fetches an HTML page, not
 * a zip, which is the single most likely way this feature fails on first use. All of them mean the
 * same thing to a user, so all of them have to work.
 *
 * **What is returned is an archive URL, not a clone.** GitHub and every other host we target serve
 * the tree of a branch as a zip without a git dependency, which is what lets this stay a download
 * rather than a `git clone` (no git on the target host, no history, no credentials on disk). The
 * branch is taken from the path when the user gave one, because `/tree/main` is a statement about
 * *which* branch they are looking at, and silently substituting `main` for `develop` would install
 * the wrong code.
 *
 * **GitHub and the general case are handled separately on purpose.** GitHub's layout is
 * `/archive/refs/heads/<branch>.zip`; that is a fact about GitHub, not about archives. For any
 * other host the original URL is used unchanged — a guess about someone else's URL layout would
 * fail in a way the user cannot diagnose, whereas passing their URL through can only fail if it was
 * not an archive to begin with.
 */

/** What a repository URL resolved to. */
export interface ResolvedRepo {
  /** The archive to download. */
  archiveUrl: string;
  /** `owner/name`, for naming the plugin and for error messages. */
  name: string;
  /** The branch the archive is taken from. */
  branch: string;
  /** The host, so callers can say which URL was refused and why. */
  host: string;
}

/** Thrown for a URL this cannot resolve. The message is meant to be shown to the user. */
export class RepoUrlError extends Error {
  constructor(
    message: string,
    readonly input: string,
  ) {
    super(message);
    this.name = "RepoUrlError";
  }
}

/**
 * The branch used when the URL says nothing about one.
 *
 * `main` because it is what a repository created since 2020 defaults to, and because a wrong guess
 * fails loudly at the download (GitHub answers a missing branch with a 404) rather than silently
 * installing something unexpected.
 */
const DEFAULT_BRANCH = "main";

/**
 * Path segments that mean "this is a browse URL, not a download URL", with what follows them.
 *
 * `/tree/main` and `/blob/main/x/y` are what a browser gives you; `/tree/` is followed by a branch,
 * `/blob/` by a branch and then a file path. `/archive/` is already a download.
 */
const BROWSE_SEGMENTS = new Set(["tree", "blob", "commits", "releases", "tags"]);

/**
 * Resolves a pasted repository URL to the archive that holds the plugin.
 *
 * Accepts every shape a user actually pastes — the bare repo, a `.git` clone URL, a `/tree/branch`
 * browse URL, a deep link to a file — and normalises all of them to the branch archive.
 */
export function resolveRepoUrl(raw: string): ResolvedRepo {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new RepoUrlError("Please enter a repository URL.", raw);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new RepoUrlError(
      "That is not a URL. It should look like https://github.com/owner/repo.",
      raw,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new RepoUrlError(`Only http and https URLs are supported (got ${url.protocol}).`, raw);
  }

  const host = url.hostname.toLowerCase();
  // The three shapes below are GitHub's, and GitHub is the host this is overwhelmingly aimed at;
  // every other host gets the URL unchanged, because their archive layouts differ and a wrong
  // guess about someone else's layout is worse than trying what they gave us.
  if (host === "github.com" || host === "www.github.com") {
    return resolveGithub(url, trimmed);
  }
  return { archiveUrl: trimmed, name: nameFromPath(url) ?? host, branch: DEFAULT_BRANCH, host };
}

/** GitHub: `/owner/repo`, with any `.git`, `/tree/...`, `/blob/...` or `/archive/...` tail removed. */
function resolveGithub(url: URL, input: string): ResolvedRepo {
  const segments = url.pathname.split("/").filter((s) => s !== "");
  if (segments.length < 2) {
    throw new RepoUrlError(
      "That GitHub URL is not a repository. It should be https://github.com/owner/repo.",
      input,
    );
  }
  const owner = segments[0]!;
  let repo = segments[1]!;
  // `.git` is the clone suffix, never part of the name. A repo genuinely named `foo.git` is not a
  // thing GitHub serves, so stripping unconditionally is safe.
  if (repo.toLowerCase().endsWith(".git")) repo = repo.slice(0, -4);

  // The first segment after the repo may be a browse target: `/tree/main`, `/blob/main/src/a.ts`,
  // `/commits/main`, `/releases`, and so on. `/archive/...` means the URL is *already* a download
  // and is passed through untouched.
  const third = segments[2];
  if (third === "archive") {
    // Already an archive URL — `https://github.com/o/r/archive/refs/heads/main.zip`. Keep it.
    const tail = segments.slice(3).join("/");
    const branch = tail.replace(/^refs\/heads\//, "").replace(/\.zip$/, "") || DEFAULT_BRANCH;
    return {
      archiveUrl: url.toString(),
      name: `${owner}/${repo}`,
      branch,
      host: url.hostname,
    };
  }

  let branch = DEFAULT_BRANCH;
  if (third !== undefined && BROWSE_SEGMENTS.has(third)) {
    const given = segments[3];
    // A branch is one path segment; anything else after it is a file or folder path within the
    // branch, which does not change which branch to fetch.
    if (given !== undefined && given !== "") branch = decodeURIComponent(given);
  } else if (third === "commit") {
    // `/commit/<sha>` names a commit, not a branch. Its archive lives under a different prefix on
    // GitHub, and treating the sha as a branch would ask for a branch that cannot exist — so this
    // falls back to the default rather than joining the two prefixes into something invalid.
    return {
      archiveUrl: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/archive/refs/heads/${encodeBranch(DEFAULT_BRANCH)}.zip`,
      name: `${owner}/${repo}`,
      branch: DEFAULT_BRANCH,
      host: url.hostname,
    };
  }

  return {
    archiveUrl: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/archive/refs/heads/${encodeBranch(branch)}.zip`,
    name: `${owner}/${repo}`,
    branch,
    host: url.hostname,
  };
}

/** `owner/repo` from a non-GitHub path, when it has one. */
function nameFromPath(url: URL): string | null {
  const segments = url.pathname.split("/").filter((s) => s !== "");
  if (segments.length < 2) return null;
  const repo = segments[1]!.toLowerCase().endsWith(".git")
    ? segments[1]!.slice(0, -4)
    : segments[1]!;
  return `${segments[0]}/${repo}`;
}

/**
 * A branch name, percent-encoded as one path segment.
 *
 * Encoded because a branch can contain a slash (`release/2.0`) and `#`/`?`, each of which would
 * otherwise truncate or re-parse the URL — GitHub takes the whole remaining path as the branch, so
 * the segment has to survive as a segment.
 */
function encodeBranch(branch: string): string {
  return branch
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
}

/**
 * Whether a resolved archive URL looks like a zip rather than an HTML page.
 *
 * **Not a security check and not the only one** — it is a check for the specific, very common way
 * this feature misfires: a browse URL resolves to a 200 that is a web page, and unzipping that
 * fails with a confusing "not a zip" instead of saying the URL was the wrong shape. Content type is
 * not consulted because the host may not send one; this reads the path, which every host that
 * serves archives makes unambiguous.
 */
export function looksLikeArchive(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return (
      path.endsWith(".zip") ||
      path.endsWith(".tar.gz") ||
      path.endsWith(".tgz") ||
      path.endsWith(".tar") ||
      path.endsWith(".tar.bz2") ||
      path.endsWith(".tar.xz")
    );
  } catch {
    return false;
  }
}

/**
 * What a plugin is called, from a repository URL.
 *
 * **The repository name, never the path segment after it.** `https://github.com/o/r/tree/main` and
 * `https://github.com/o/r` must produce the same plugin name, or pasting one URL instead of the
 * other would create a second plugin that the user then has to work out why is a duplicate.
 */
export function pluginNameFromRepo(resolved: ResolvedRepo): string {
  const name = resolved.name.includes("/")
    ? resolved.name.slice(resolved.name.indexOf("/") + 1)
    : resolved.name;
  return name.trim().toLowerCase();
}
