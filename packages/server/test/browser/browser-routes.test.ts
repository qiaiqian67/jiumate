/**
 * The agent browser's HTTP surface: the routes the Web App's browser panel calls, and the
 * 503 a host with no browser surface answers.
 *
 * The panel is a page in the app's window, and it is the only thing that can create a
 * `<webview>` — the desktop shell hosts the guests but does not create them. So these routes
 * are where an open request becomes a tab: the panel creates the element, learns the guest's
 * id, and claims the request with it.
 */
import { describe, expect, it } from "vitest";
import { createTestApp, loginAdmin } from "../helpers.js";
import type { ErrorBody } from "../../src/api/types.js";
import { BrowserService } from "../../src/browser/service.js";
import { FakeLink, tab } from "./fake-link.js";

/** A browser over a fake far side, so the routes have something to talk to. */
function browser(link: FakeLink): BrowserService {
  return new BrowserService({
    link,
    sleep: async () => undefined,
    now: () => 1_700_000_000_000,
  });
}

describe("GET /api/browser/status", () => {
  it("reports the backend, its availability and the tabs", async () => {
    const link = new FakeLink();
    link.tabs.set(1, tab(1));
    const t = await createTestApp({ browser: browser(link) });
    try {
      const admin = await loginAdmin(t.app);
      const res = await t.app.request("/api/browser/status", {
        headers: { cookie: admin.cookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        backend: string;
        available: boolean;
        tabs: { id: number }[];
      };
      expect(body.backend).toBe("builtin");
      expect(body.available).toBe(true);
      expect(body.tabs.map((x) => x.id)).toEqual([1]);
    } finally {
      await t.cleanup();
    }
  });

  it("answers 503 browser_unavailable on a host with no browser surface", async () => {
    // A server started on its own has no shell, and so no browser. That is a fact about the
    // host, not a missing path, so it is 503 and not 404.
    const t = await createTestApp();
    try {
      const admin = await loginAdmin(t.app);
      const res = await t.app.request("/api/browser/status", {
        headers: { cookie: admin.cookie },
      });
      expect(res.status).toBe(503);
      expect(((await res.json()) as ErrorBody).error.code).toBe("browser_unavailable");
    } finally {
      await t.cleanup();
    }
  });

  it("needs a signed-in caller", async () => {
    const t = await createTestApp();
    try {
      const res = await t.app.request("/api/browser/status");
      expect(res.status).toBe(401);
    } finally {
      await t.cleanup();
    }
  });
});

describe("the tab routes", () => {
  it("opens a tab and reports the browser's state", async () => {
    const link = new FakeLink();
    const t = await createTestApp({ browser: browser(link) });
    try {
      const admin = await loginAdmin(t.app);
      const res = await t.app.request("/api/browser/tabs", {
        method: "POST",
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.test/" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { tabs: { id: number; url: string }[] };
      expect(body.tabs).toHaveLength(1);
      expect(body.tabs[0]?.url).toBe("https://example.test/");
    } finally {
      await t.cleanup();
    }
  });

  it("refuses a body that is not a JSON object", async () => {
    const t = await createTestApp();
    try {
      const admin = await loginAdmin(t.app);
      const res = await t.app.request("/api/browser/tabs", {
        method: "POST",
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: "[]",
      });
      expect(res.status).toBe(400);
    } finally {
      await t.cleanup();
    }
  });

  it("answers 404 no_such_tab for a tab that is not open", async () => {
    const t = await createTestApp({ browser: browser(new FakeLink()) });
    try {
      const admin = await loginAdmin(t.app);
      const res = await t.app.request("/api/browser/tabs/999/scan", {
        method: "POST",
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
      expect(((await res.json()) as ErrorBody).error.code).toBe("no_such_tab");
    } finally {
      await t.cleanup();
    }
  });

  it("needs the argument an action requires", async () => {
    const t = await createTestApp({ browser: browser(new FakeLink()) });
    try {
      const admin = await loginAdmin(t.app);
      const res = await t.app.request("/api/browser/tabs/1/click", {
        method: "POST",
        headers: { cookie: admin.cookie, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    } finally {
      await t.cleanup();
    }
  });
});
