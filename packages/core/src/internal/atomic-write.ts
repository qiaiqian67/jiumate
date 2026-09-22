/**
 * Atomic file replacement: the shared writer for every file the Harness keeps on disk.
 *
 * A plain `writeFile` truncates the target before it writes, so a crash or a full disk part-way
 * through leaves the file half-written. For a state file that is worse than losing the write —
 * a truncated `system_config.yaml` can still parse as YAML (the cut lands inside the
 * `system_prompt` block scalar) and the Agent then boots with everything after it silently
 * missing. Writing to a temporary file in the same directory and renaming it over the target
 * makes the replacement a single atomic step: a reader sees the old bytes or the new ones.
 */
import path from "node:path";
import { chmod, readlink, rename, rm, writeFile } from "node:fs/promises";

/**
 * Cap on symlink hops when resolving a write target, matching the kernel's own `ELOOP`
 * budget (Linux allows 40): a link cycle has to end as an error rather than a hang.
 */
const MAX_SYMLINK_HOPS = 40;

/**
 * Backoff before rename retry N (0-based), then give up. Just under a second in total.
 *
 * Windows refuses `rename` over a file another process holds open, and reports it as a bare
 * `EPERM` — the same code a real permissions problem returns. The holder is nearly always
 * transient: a virus scanner reading the file that was just written, the search indexer, or a
 * browser the user is viewing the page in. Those clear in milliseconds, so a bounded retry turns
 * a hard tool failure into a slightly slower write. In a real session on this machine, three of
 * sixteen `edit_file` calls died this way.
 *
 * The budget is deliberately short, because the lock that outlives it is not the transient kind:
 * it is a process holding the file exclusively, which no amount of waiting fixes. Failing in
 * well under a second — with an error that names the cause — beats blocking a tool call on a lock
 * that will never clear.
 */
const RENAME_RETRY_DELAYS_MS: readonly number[] = [10, 25, 50, 100, 200, 400];

/**
 * Codes a retry can plausibly clear. `EPERM` is the one Windows actually returns for a locked
 * rename; `EBUSY` and `EACCES` are included because the same condition is reported as each of
 * them across filesystems and SMB shares.
 */
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

export interface AtomicWriteOptions {
  /**
   * Permission bits for the result. Rename replaces the inode, so an existing file's bits are
   * not inherited — pass them (or the intended mode for a secret) to keep them. Applied with an
   * explicit chmod, which the umask does not mask, so `0o600` really is `0o600`.
   */
  mode?: number;
  signal?: AbortSignal;
  /**
   * Write through a symlink standing at `target` — what a plain `writeFile` does, and what a
   * user who linked their config into a dotfiles repository expects (see
   * `resolveWriteTarget`). Left off, the rename replaces the link with a regular file: the
   * right behavior where the directory is model-writable and a link planted there would
   * carry the write outside it.
   */
  followSymlinks?: boolean;
}

/** Writes `content` to `target` atomically. The temp file is removed on failure (best effort). */
export async function atomicWriteFile(
  target: string,
  content: string | Uint8Array,
  opts: AtomicWriteOptions = {},
): Promise<void> {
  const dest = opts.followSymlinks === true ? await resolveWriteTarget(target) : target;
  const tmp = path.join(
    path.dirname(dest),
    `.${path.basename(dest)}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    await writeFile(tmp, content, {
      ...(typeof content === "string" ? { encoding: "utf8" as const } : {}),
      ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      // Rename orders the directory entry, not the data behind it: without this fsync a power
      // loss can commit the new name over blocks that never reached the disk, which is the
      // zero-length file the whole exercise is meant to prevent.
      flush: true,
    });
    if (opts.mode !== undefined) await chmod(tmp, opts.mode);
    await renameIntoPlace(tmp, dest, opts.signal);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * `rename` with a bounded retry for the transient-lock case, and an explanatory error when the
 * lock turns out not to be transient. See {@link RENAME_RETRY_DELAYS_MS}.
 */
async function renameIntoPlace(from: string, to: string, signal?: AbortSignal): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!TRANSIENT_RENAME_CODES.has(code)) throw err;
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      // Out of budget: this lock is not the kind that clears on its own, so say so rather than
      // hand back a bare EPERM that reads like a permissions problem.
      if (delay === undefined) throw lockedTargetError(to, err);
      await delayMs(delay, signal);
    }
  }
}

/**
 * The error a caller sees when the retries ran out: the original failure, with a message naming
 * the cause. The bare `EPERM` a locked file produces reads like a permissions problem, which
 * sends a reader looking for a `chmod` that cannot help — the answer is "something else has the
 * file open". It says the target is unchanged because that is the caller's real question, and it
 * is true: the rename never landed, so the old bytes are intact.
 */
function lockedTargetError(target: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const err = new Error(
    `Could not replace "${target}": another process is holding it open — an editor, a browser ` +
      `showing the page, or a virus scanner mid-scan. The file is unchanged. Close whatever has ` +
      `it open and retry. (${detail})`,
  );
  (err as NodeJS.ErrnoException).code = (cause as NodeJS.ErrnoException | undefined)?.code;
  err.cause = cause;
  return err;
}

/** `setTimeout` as a promise, rejecting early if `signal` aborts mid-wait. */
function delayMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The path a write aimed at `target` must actually land on: the end of its symlink chain.
 *
 * For the file tools (edit_file / write_file) every other step already goes through the link —
 * `stat` reads the target's size and permission bits, `readFile` reads the target's bytes —
 * because those calls dereference. The write is the one step that would not: it finishes with
 * `rename`, which operates on the link itself and would replace it with a regular file, leaving
 * the file the model set out to edit untouched while the tool reports success. Following the
 * chain here is also what makes `mode` meaningful: the bits come from the dereferenced `stat`,
 * so they have to be restored onto the same inode. A config file a user symlinked into a
 * dotfiles repository wants the same treatment, which is why the state writers opt in too.
 *
 * Resolution is leaf-only and deliberate: `realpath` is not used, so a link whose target does
 * not exist yet (a dangling link, which `>` also creates through) still resolves, and directory
 * symlinks along the way are left alone — the temp file only needs to share a directory with the
 * final name for `rename` to stay atomic. A chain leaving the Workspace is followed like any
 * other: these tools already accept absolute paths anywhere, on the same footing as the shell
 * tool.
 *
 * Anything that is not a readable symlink ends the walk and is returned as-is: `EINVAL` (an
 * ordinary file — the common case, one syscall), `ENOENT` (nothing there yet, so the caller
 * creates it), or a permission error the caller's own write reports properly.
 */
export async function resolveWriteTarget(target: string): Promise<string> {
  let current = target;
  for (let hop = 0; hop < MAX_SYMLINK_HOPS; hop += 1) {
    let link: string;
    try {
      link = await readlink(current);
    } catch {
      return current;
    }
    current = path.resolve(path.dirname(current), link);
  }
  throw new Error(`Too many levels of symbolic links: "${target}"`);
}
