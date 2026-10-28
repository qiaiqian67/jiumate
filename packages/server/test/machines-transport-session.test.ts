/**
 * The one connection per machine, against a stub `ssh` on PATH that becomes a real `sh` when
 * asked for one: the framing, the heredoc input, progress relayed as it arrives, one session
 * however many ask, and what a session that dies says.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeConnectionTo, connectionTo, sessionOf } from "../src/machines/transport/index.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

posixOnly("the session", () => {
  let stubBin: string;
  let logFile: string;
  let originalPath: string | undefined;
  beforeEach(() => {
    stubBin = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-session-"));
    logFile = path.join(stubBin, "calls.log");
    // Every invocation is logged; an alias containing "refused" dies the way a wrong key
    // does; anything else asked for `sh` becomes one — commands run locally, harmlessly.
    //
    // The shell is not just `/bin/sh`: the transport keeps ONE ssh session per machine and
    // feeds commands to it as lines on stdin, each line a whole command followed by the
    // printf that reports its exit code. So the stub reads stdin a line at a time, and
    // records when it received a line and when that line's command finished. Those two
    // stamps are what make it possible to say whether two commands ran *at the same time*,
    // rather than how long they took — which is the machine's business, not the transport's.
    fs.writeFileSync(
      path.join(stubBin, "ssh"),
      `#!/bin/sh
echo "$*" >> ${JSON.stringify(logFile)}
case "$*" in *refused*) echo "deploy@refused: Permission denied (publickey)." >&2; exit 255 ;; esac
for a in "$@"; do last=$a; done
[ "$last" = sh ] && exec /bin/sh
exit 1
`,
    );
    fs.chmodSync(path.join(stubBin, "ssh"), 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${stubBin}:${process.env.PATH ?? ""}`;
  });
  afterEach(() => {
    for (const address of ["ssh:nas", "ssh:build-box", "ssh:refused"]) closeConnectionTo(address);
    process.env.PATH = originalPath;
    fs.rmSync(stubBin, { recursive: true, force: true });
  });
  /** The commands the stub was asked to run, in order. */
  const spawns = () =>
    fs
      .readFileSync(logFile, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);

  /**
   * Run a command that says when it started and when it finished.
   *
   * The times come from the machine running the command, not from the test's stopwatch: the
   * test and the command need not even be on the same machine — the transport is what connects
   * them — and what is being measured is when the *command* ran, not when the test noticed.
   *
   * The command prints its start, sleeps, and prints its end. The shell's `date` is the clock,
   * and it is the same clock on both sides of the assertion because both commands run on the
   * same machine: the stub runs them locally.
   */
  const stamp = async (
    conn: ReturnType<typeof connectionTo>,
    label: string,
  ): Promise<{ start: number; end: number } | null> => {
    const result = await conn.exec(`date +%s%3N; sleep 0.2; date +%s%3N; echo ${label}`);
    const lines = result.stdout.trim().split("\n");
    const start = Number(lines[0]);
    const end = Number(lines[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start, end };
  };

  it("runs commands with their exit code, and an `exit` cannot end the session", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    // The command's own trailing newline is kept, as execFile would keep it.
    expect(await conn.exec("echo hi")).toMatchObject({ code: 0, stdout: "hi\n" });
    expect((await conn.exec("exit 3")).code).toBe(3);
    expect(await conn.exec("echo still here")).toMatchObject({ code: 0, stdout: "still here\n" });
    expect(spawns()).toHaveLength(1);
  });

  it("hands a command its stdin as a heredoc, bytes intact, and relays lines as they arrive", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    const input = Buffer.from("héllo\nEOF\nworld\n", "utf8");
    const lines: string[] = [];
    const result = await conn.stream("cat", { input, onLine: (line) => lines.push(line) });
    expect(result).toMatchObject({ code: 0, stdout: "héllo\nEOF\nworld\n" });
    expect(lines).toEqual(["héllo", "EOF", "world"]);
    // Binary survives too: the tarball case.
    const bytes = Buffer.from([0x1f, 0x8b, 0x00, 0xff, 0x0a, 0x0d, 0x00]);
    const echoed = await conn.stream("od -An -tx1 | tr -d ' \\n'", { input: bytes });
    expect(echoed.stdout).toBe("1f8b00ff0a0d00");
  });

  it("is one session however many ask: commands queue, and two opens spawn once", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    const [a, b] = await Promise.all([conn.open(), conn.open()]);
    expect(a.ok && b.ok && a.session.pid === b.session.pid).toBe(true);
    expect(spawns()).toHaveLength(1);
    expect(sessionOf("ssh:nas")?.pid).toBe(a.ok ? a.session.pid : -1);

    let started = Date.now();
    await Promise.all([conn.exec("sleep 0.2"), conn.exec("sleep 0.2")]);
    // The same session, so the second command waits for the first: two sleeps of 200ms
    // cannot have finished in less than that.
    expect(Date.now() - started).toBeGreaterThanOrEqual(380);
    // And they did not overlap — one session runs one command at a time, which is the whole
    // of what "one session however many ask" means. The commands say so themselves: the
    // second one began after the first one had already finished.
    const [first, second] = await Promise.all([stamp(conn, "one"), stamp(conn, "two")]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (first === null || second === null) return;
    expect(Math.max(first.start, second.start)).toBeGreaterThanOrEqual(
      Math.min(first.end, second.end),
    );
    // A different machine is a different session: those run side by side.
    //
    // "Side by side" is a statement about *overlap*, not about duration, and the difference
    // matters on a loaded runner: starting two processes can take longer than the 200ms the
    // commands sleep for, and then a parallel pair measures *slower* than a constant
    // threshold would allow — the test then fails on how fast the runner starts processes
    // while the behaviour it names is exactly right.
    //
    // So the timing is read off the commands themselves rather than off a stopwatch. Each
    // command prints a timestamp when it starts and one when it ends, and the test compares
    // the two intervals: the second command began before the first one finished, so they
    // overlapped.
    const other = connectionTo({ alias: "build-box", user: "deploy" });
    // Both at once: the two commands have to be in flight together for the overlap to mean
    // anything.
    const [nas, box] = await Promise.all([stamp(conn, "nas"), stamp(other, "box")]);
    expect(nas).not.toBeNull();
    expect(box).not.toBeNull();
    if (nas === null || box === null) return;
    // Overlap: the later start came before the earlier end.
    expect(Math.max(nas.start, box.start)).toBeLessThan(Math.min(nas.end, box.end));
    expect(spawns()).toHaveLength(2);
  });

  it("a session that dies says why, in ssh's own words, and is not kept", async () => {
    const conn = connectionTo({ alias: "refused", user: "deploy" });
    const opened = await conn.open();
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.detail).toContain("Permission denied");
    expect(sessionOf("ssh:refused")).toBeNull();
  });

  it("answers a command that outlasts its timeout with the timeout, and hands the next one a live session", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    // The timeout is this command's own answer. Dropping the session also answers whatever is
    // pending — with the connection's last words — so the two race for the one resolution a
    // promise has, and the precise diagnosis has to win.
    const timedOut = await conn.stream("sleep 5", { input: Buffer.alloc(0), timeoutMs: 150 });
    expect(timedOut).toMatchObject({ code: 255, stdout: "the machine did not answer in time" });

    // The killed session's close event lands while its replacement is already coming up. It
    // belongs to a child nobody holds any more, and must not take the replacement — or the
    // command riding it — down with it.
    expect(await conn.exec("echo after")).toMatchObject({ code: 0, stdout: "after\n" });
    expect(spawns()).toHaveLength(2);
  });

  it("a held session that dies comes back on its own; a closed one stays closed", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    const held = await conn.hold();
    expect(held.ok).toBe(true);
    expect(conn.held()).toBe(true);
    const first = sessionOf("ssh:nas")!.pid;

    // The link drops — the ssh child is gone, as after keepalives give up on a dead link.
    process.kill(first);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sessionOf("ssh:nas")).toBeNull();
    // Held, so the transport brings it back: the shortest wait is a second.
    const deadline = Date.now() + 5_000;
    while (sessionOf("ssh:nas") === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const second = sessionOf("ssh:nas");
    expect(second).not.toBeNull();
    expect(second!.pid).not.toBe(first);
    // And it is a working session, still held. The spawn count is read only after a command
    // has completed over it: the stub logs its own invocation from inside the child, after
    // spawn() has already returned a pid, so a session can exist before its line is there.
    expect(await conn.exec("echo back")).toMatchObject({ code: 0, stdout: "back\n" });
    expect(spawns()).toHaveLength(2);
    expect(conn.held()).toBe(true);

    // An explicit close lets go for good: nothing reopens it.
    closeConnectionTo("ssh:nas");
    expect(conn.held()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(sessionOf("ssh:nas")).toBeNull();
    expect(spawns()).toHaveLength(2);
  });

  it("a command that times out on a held session drops the corpse but keeps the hold", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    await conn.hold();
    const timedOut = await conn.stream("sleep 5", { input: Buffer.alloc(0), timeoutMs: 150 });
    expect(timedOut).toMatchObject({ code: 255, stdout: "the machine did not answer in time" });
    expect(conn.held()).toBe(true);
    // The next command finds a session — reopened by the command itself or by the hold.
    expect(await conn.exec("echo after")).toMatchObject({ code: 0, stdout: "after\n" });
    expect(conn.held()).toBe(true);
  });

  it("closing lets go of the session; the next ask opens a new one", async () => {
    const conn = connectionTo({ alias: "nas", user: "deploy" });
    await conn.exec("true");
    closeConnectionTo("ssh:nas");
    expect(sessionOf("ssh:nas")).toBeNull();
    await conn.exec("true");
    expect(spawns()).toHaveLength(2);
  });
});
