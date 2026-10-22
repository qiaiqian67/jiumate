/**
 * The two ends of the utilityProcess port, and the shape each one delivers.
 *
 * This is a real bug that was found by running the app, not by reading it: the browser's
 * commands never reached the shell, so the browser reported itself unavailable forever.
 *
 * The cause is that the two ends of the SAME port are different objects with different
 * shapes. The server side is Electron's `process.parentPort`, whose `message` event carries
 * a `MessageEvent` — so the frame is `event.data`. The shell side is the `UtilityProcess`,
 * whose `message` event carries the frame ITSELF — so the frame is the argument, and
 * `event.data` is undefined.
 *
 * So a relay written against one of them is silently wrong against the other, and nothing
 * fails: the frame is just never recognised. The updater relay got this right (it reads the
 * argument directly); the browser and export relays did not.
 *
 * The test below pins the shell side's shape, and — more importantly — pins that a relay
 * reads the frame the way the port delivers it.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...rel.split("/")), "utf8");

describe("the utilityProcess port's shape", () => {
  it("the shell's side delivers the frame itself, not a { data } wrapper", () => {
    // The updater relay is the one that was already right, and it is the reference: it reads
    // the argument, not `event.data`.
    const updater = read("main.ts");
    expect(updater).toMatch(/child\.on\("message",\s*\(message: unknown\)/);
    expect(updater).not.toMatch(/child\.on\("message",\s*\(e: \{ data/);
  });

  it("the browser's relay reads the frame the way the port delivers it", () => {
    const relay = read("builtin-browser-port.ts");
    // `e.data` is undefined on this side of the port, so a relay that reads it never sees a
    // command: the browser stays "unavailable" and nothing says why.
    expect(relay).not.toContain("e.data");
    expect(relay).toContain("shell.handle(message)");
  });

  it("the export relay reads the frame the way the port delivers it", () => {
    const relay = read("export-pdf.ts");
    expect(relay).not.toContain("e.data");
  });

  it("the server's side is the other shape, and the relay there is right", () => {
    // The server's end is `process.parentPort`, whose event IS a MessageEvent — so `e.data`
    // is the frame there. The two sides differ, which is the whole trap.
    const relay = fs.readFileSync(
      path.join(__dirname, "..", "..", "server", "src", "services", "desktop-update-port.ts"),
      "utf8",
    );
    expect(relay).toContain("e.data");
  });
});
