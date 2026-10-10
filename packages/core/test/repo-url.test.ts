/**
 * Repository URLs a person actually pastes (core/state/repo-url.ts).
 *
 * **The URLs in the first test are the ones from the feature request, verbatim.** Not
 * illustrations — the exact three strings a user was said to give: the bare repo, the `.git` clone
 * form, and a `/tree/main` browse URL. If any of those three does not resolve to the same archive,
 * the feature does not do what was asked for, and this file says so.
 */
import { describe, expect, it } from "vitest";
import { RepoUrlError, pluginNameFromRepo, resolveRepoUrl, looksLikeArchive } from "../src/state/index.js";

/** Every form a user pastes for one repository, all of which must mean the same thing. */
const BERD_FORMS = [
  "https://github.com/block/berd",
  "https://github.com/block/berd.git",
  "https://github.com/block/berd/tree/main",
];

describe("resolveRepoUrl", () => {
  it("resolves all three pasted forms of one repository to the same archive", () => {
    // The requirement, stated as a test: these are the URLs a user gives, and whichever one they
    // paste, the plugin that gets installed is the same plugin.
    const resolved = BERD_FORMS.map((u) => resolveRepoUrl(u));
    const archives = new Set(resolved.map((r) => r.archiveUrl));
    expect(archives.size).toBe(1);
    expect(resolved[0]!.archiveUrl).toBe("https://github.com/block/berd/archive/refs/heads/main.zip");
    for (const r of resolved) {
      expect(r.name).toBe("block/berd");
      expect(r.branch).toBe("main");
    }
  });

  it("passes an already-archive URL through untouched", () => {
    // The form GitHub's own "Download ZIP" button copies. Reshaping it would be reshaping something
    // that is already exactly right.
    const direct = "https://github.com/block/berd/archive/refs/heads/main.zip";
    expect(resolveRepoUrl(direct).archiveUrl).toBe(direct);
  });

  it("takes the branch from a browse URL rather than assuming main", () => {
    // `/tree/develop` is a statement about which branch the user was looking at. Substituting `main`
    // would install the wrong code and report success.
    const r = resolveRepoUrl("https://github.com/block/berd/tree/develop");
    expect(r.branch).toBe("develop");
    expect(r.archiveUrl).toContain("/heads/develop.zip");
  });

  it("ignores the file path in a deep link, keeping only the branch", () => {
    // Copying the URL from a file view gives /blob/<branch>/<path...>; the branch is segment 4, and
    // the rest is a location inside it.
    const r = resolveRepoUrl("https://github.com/block/berd/blob/develop/src/index.ts");
    expect(r.branch).toBe("develop");
    expect(r.archiveUrl).toBe("https://github.com/block/berd/archive/refs/heads/develop.zip");
  });

  it("keeps a branch containing a slash as one branch", () => {
    // `release/2.0` is one branch. GitHub's own /tree/ URL writes the first segment only, so
    // there is no way to tell `release/2.0` from "the folder 2.0 inside branch release" — and
    // guessing the join would install a branch that may not exist. Taking the first segment is
    // the honest reading of what the URL actually says, and GitHub answers a wrong branch with a
    // 404 rather than silently installing something else.
    const r = resolveRepoUrl("https://github.com/block/berd/tree/release/2.0");
    expect(r.branch).toBe("release");
  });

  it("handles the other browse links, reading a branch where the link names one", () => {
    // /commits/<branch> names its branch exactly as /tree/<branch> does; the release, tag and
    // commit links name something else and carry no branch, so they fall back.
    expect(resolveRepoUrl("https://github.com/block/berd/commits/develop").branch).toBe("develop");
    for (const tail of ["releases", "tags", "commit/abc1234"]) {
      // A commit sha is not a branch: its archive lives under a different prefix, so treating it
      // as one would ask for a branch that cannot exist.
      const r = resolveRepoUrl(`https://github.com/block/berd/${tail}`);
      expect(r.branch, `${tail} names no branch, so it should fall back to the default`).toBe("main");
      expect(r.archiveUrl).toBe("https://github.com/block/berd/archive/refs/heads/main.zip");
    }
  });

  it("strips .git from the name so the plugin is not called berd.git", () => {
    expect(pluginNameFromRepo(resolveRepoUrl("https://github.com/block/berd.git"))).toBe("berd");
  });

  it("gives one plugin name for every form of one repository", () => {
    // Pasting /tree/main instead of the bare repo must not create a second plugin the user then
    // has to work out why is a duplicate.
    const names = new Set(BERD_FORMS.map((u) => pluginNameFromRepo(resolveRepoUrl(u))));
    expect(names.size).toBe(1);
    expect([...names]).toEqual(["berd"]);
  });

  it("falls back to main when the URL names no branch", () => {
    expect(resolveRepoUrl("https://github.com/block/berd").branch).toBe("main");
  });

  it("leaves a non-GitHub URL alone, because its archive layout is not ours to guess", () => {
    // A wrong guess about someone else's layout fails in a way the user cannot diagnose; passing
    // their URL through can only fail if it was not an archive.
    const self = "https://git.example.com/tools/thing/archive/v1.zip";
    const r = resolveRepoUrl(self);
    expect(r.archiveUrl).toBe(self);
    expect(r.name).toBe("tools/thing");
  });

  it("refuses a scheme that is not http(s)", () => {
    // The reason redirects are followed manually rather than by fetch: each hop is checked with the
    // same rule, so a redirect out of https cannot reach file:// or data:.
    expect(() => resolveRepoUrl("file:///C:/Windows")).toThrow(RepoUrlError);
    expect(() => resolveRepoUrl("ftp://example.com/x.zip")).toThrow(/Only http and https/);
  });

  it("refuses something that is not a URL at all, with a message that says what to paste", () => {
    expect(() => resolveRepoUrl("berd")).toThrow(/not a URL/);
    expect(() => resolveRepoUrl("")).toThrow(/enter a repository URL/);
  });

  it("refuses a GitHub URL that names no repository", () => {
    expect(() => resolveRepoUrl("https://github.com/block")).toThrow(/not a repository/);
  });
});

describe("looksLikeArchive", () => {
  it("recognises the archive extensions a host serves", () => {
    for (const url of [
      "https://github.com/o/r/archive/refs/heads/main.zip",
      "https://x/y.tar.gz",
      "https://x/y.tgz",
      "https://x/y.tar",
    ]) {
      expect(looksLikeArchive(url)).toBe(true);
    }
  });

  it("rejects a browse URL, which downloads a web page rather than a zip", () => {
    // The failure this exists to catch: the URL 200s, it is HTML, and unzipping it reports "not a
    // zip" instead of "that URL was the wrong shape".
    expect(looksLikeArchive("https://github.com/block/berd/tree/main")).toBe(false);
    expect(looksLikeArchive("https://github.com/block/berd")).toBe(false);
  });
});