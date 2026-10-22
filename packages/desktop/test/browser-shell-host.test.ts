/**
 * The desktop shell's browser relay, and the two bugs that running the app found.
 *
 * Both were found by starting the real app: the browser reported itself unavailable, and
 * then every guest was refused. Neither shows up in a unit test that only exercises the
 * pure rules — the shell needs Electron, and the wiring around it needs a running app.
 *
 * So the rules are pinned by reading the code, the way this package's other structural
 * tests do.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...rel.split("/")), "utf8");

describe("the shell's host window", () => {
  it("is told about the window when the window exists, not only when it is already there", () => {
    const relay = read("builtin-browser-port.ts");
    const main = read("main.ts");
    // The relay is wired while the server is still starting; the window comes after it. A
    // shell that only looked once found nothing, and refused every guest — with a log line
    // that named the page rather than the reason.
    expect(relay).toContain("onWindow");
    expect(main).toContain("hostBrowserWindow?.(win)");
  });

  it("the relay is wired before the window exists, so the two are not the same moment", () => {
    const main = read("main.ts");
    const wired = main.indexOf("wireBuiltinBrowser(");
    const created = main.indexOf("function createWindow(");
    expect(wired).toBeGreaterThan(-1);
    expect(created).toBeGreaterThan(-1);
    // The wiring is inside startServerAndWindow, and the window is created there too —
    // so the order inside that function is what matters, and it is the createWindow call
    // that comes after the wiring.
    const body = main.slice(main.indexOf("async function startServerAndWindow"));
    expect(body.indexOf("wireBuiltinBrowser(")).toBeLessThan(body.indexOf("createWindow(url)"));
  });
});

describe("the port's two ends", () => {
  it("the shell's side reads the frame itself, the server's side reads event.data", () => {
    // The two ends of the SAME port are different objects with different shapes: the
    // server's is `process.parentPort` (a MessageEvent), the shell's is the UtilityProcess
    // (the frame itself). A relay written against one is silently wrong against the other,
    // and nothing fails — the frame is just never recognised.
    const relay = read("builtin-browser-port.ts");
    const updater = read("main.ts");
    expect(relay).not.toContain("e.data");
    expect(relay).toContain("shell.handle(message)");
    expect(updater).toMatch(/child\.on\("message",\s*\(message: unknown\)/);
  });
});
