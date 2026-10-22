/**
 * The agent browser's HTTP API, mounted at /api/browser behind the cookie gate.
 *
 *   GET    /status                     the backend, whether it can be driven, the tabs
 *   POST   /tabs                       open a tab (a URL, or the backend's start page)
 *   POST   /tabs/claim                 a window names the tab it created for a request
 *   POST   /tabs/on-screen             a window names the tab it shows now, or none
 *   POST   /tabs/:tab/activate         focus a tab
 *   DELETE /tabs/:tab                  close a tab
 *   POST   /tabs/:tab/navigate         go to a URL in the tab
 *   POST   /tabs/:tab/scan             the page as simplified HTML or plain text
 *   POST   /tabs/:tab/exec             run script in the page (guarded: see service.ts)
 *   POST   /tabs/:tab/click            click an element
 *   POST   /tabs/:tab/type             type into an element
 *   POST   /tabs/:tab/screenshot       the page as an image
 *
 * `:tab` is a tab id or `active`. Who a call acts for is the signed-in user; an agent's call
 * comes through the tool, in-process, and never over this surface.
 *
 * Every route answers 503 `browser_unavailable` when there is no browser surface at all
 * (a server started on its own, with no desktop shell) rather than 404: the browser is a
 * feature of this host, not a missing path.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  BrowserActRequest,
  BrowserBackendInfo,
  BrowserScreenshot,
  BrowserStatus,
  BrowserTab,
} from "@prismshadow/jiumate-core/interfaces";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import type { BrowserService } from "../../browser/service.js";

type Body = Record<string, unknown>;

/** The request's JSON object; an empty body is an empty object. */
async function jsonBody(c: Context<AppEnv>): Promise<Body> {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "bad_request", "The body is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "bad_request", "The body must be a JSON object.");
  }
  return parsed as Body;
}

function optString(body: Body, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new HttpError(400, "bad_request", `${key} must be a string.`);
  }
  return value;
}

function requiredString(body: Body, key: string): string {
  const value = optString(body, key);
  if (value === undefined || value.trim() === "") {
    throw new HttpError(400, "bad_request", `${key} is required.`);
  }
  return value;
}

function optBool(body: Body, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new HttpError(400, "bad_request", `${key} must be true or false.`);
  }
  return value;
}

function optInt(body: Body, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(400, "bad_request", `${key} must be a non-negative integer.`);
  }
  return value;
}

/** `:tab` is a tab id, or `active` for the one the agent is using. */
function tabIdOf(c: Context<AppEnv>, body: Body): number | undefined {
  const raw = c.req.param("tab") ?? optString(body, "tabId");
  if (raw === undefined || raw === "active") return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new HttpError(400, "bad_request", "The tab id must be a non-negative integer.");
  }
  return parsed;
}

export function browserRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const service = (): BrowserService => {
    if (deps.browser === undefined) {
      throw new HttpError(
        503,
        "browser_unavailable",
        "This host has no browser surface. The built-in browser is part of the desktop app.",
      );
    }
    return deps.browser;
  };

  app.get("/status", async (c) => {
    return c.json(await service().status());
  });

  app.post("/tabs", async (c) => {
    const body = await jsonBody(c);
    const url = optString(body, "url");
    const newTab = optBool(body, "newTab");
    const status = await service().open(url ?? "", {
      ...(newTab !== undefined ? { newTab } : {}),
    });
    return c.json(status);
  });

  app.post("/tabs/claim", async (c) => {
    const body = await jsonBody(c);
    const requestId = requiredString(body, "requestId");
    const tabId = optInt(body, "tabId");
    if (tabId === undefined) {
      throw new HttpError(400, "bad_request", "tabId is required.");
    }
    const outcome = service().claim(tabId, requestId);
    if (outcome === "unknown") {
      throw new HttpError(404, "unknown_request", "That open request is not waiting to be claimed.");
    }
    if (outcome === "duplicate") {
      // A second window claiming the same request: the first one won, so this tab is a
      // duplicate and should be closed. The window that made it is told, and the tab stays.
      throw new HttpError(409, "duplicate_claim", "That open request was already claimed.");
    }
    return c.json({ tabId });
  });

  app.post("/tabs/on-screen", async (c) => {
    const body = await jsonBody(c);
    const tabId = optInt(body, "tabId");
    service().setOnScreen(tabId ?? null);
    return c.body(null, 204);
  });

  app.post("/tabs/:tab/activate", async (c) => {
    const body = await jsonBody(c);
    const tabId = tabIdOf(c, body);
    await service().activate(tabId);
    return c.json(await service().status());
  });

  app.delete("/tabs/:tab", async (c) => {
    const body = await jsonBody(c);
    const tabId = tabIdOf(c, body);
    return c.json(await service().close(tabId));
  });

  app.post("/tabs/:tab/navigate", async (c) => {
    const body = await jsonBody(c);
    const url = requiredString(body, "url");
    const tabId = tabIdOf(c, body);
    await service().navigate(url, tabId);
    return c.json(await service().status());
  });

  app.post("/tabs/:tab/scan", async (c) => {
    const body = await jsonBody(c);
    const textOnly = optBool(body, "textOnly");
    const tabId = tabIdOf(c, body);
    const result = await service().scan({
      ...(textOnly !== undefined ? { textOnly } : {}),
      ...(tabId !== undefined ? { tabId } : {}),
    });
    return c.json(result);
  });

  app.post("/tabs/:tab/exec", async (c) => {
    const body = await jsonBody(c);
    const script = requiredString(body, "script");
    const acceptDialogs = optBool(body, "acceptDialogs");
    const tabId = tabIdOf(c, body);
    const request: BrowserActRequest = {
      action: "exec",
      script,
      ...(acceptDialogs !== undefined ? { acceptDialogs } : {}),
      ...(tabId !== undefined ? { tabId } : {}),
    };
    return c.json(await service().act(request));
  });

  app.post("/tabs/:tab/click", async (c) => {
    const body = await jsonBody(c);
    const selector = requiredString(body, "selector");
    const acceptDialogs = optBool(body, "acceptDialogs");
    const tabId = tabIdOf(c, body);
    const request: BrowserActRequest = {
      action: "click",
      selector,
      ...(acceptDialogs !== undefined ? { acceptDialogs } : {}),
      ...(tabId !== undefined ? { tabId } : {}),
    };
    return c.json(await service().act(request));
  });

  app.post("/tabs/:tab/type", async (c) => {
    const body = await jsonBody(c);
    const selector = requiredString(body, "selector");
    const text = requiredString(body, "text");
    const submit = optBool(body, "submit");
    const acceptDialogs = optBool(body, "acceptDialogs");
    const tabId = tabIdOf(c, body);
    const request: BrowserActRequest = {
      action: "type",
      selector,
      text,
      ...(submit !== undefined ? { submit } : {}),
      ...(acceptDialogs !== undefined ? { acceptDialogs } : {}),
      ...(tabId !== undefined ? { tabId } : {}),
    };
    return c.json(await service().act(request));
  });

  app.post("/tabs/:tab/screenshot", async (c) => {
    const body = await jsonBody(c);
    const tabId = tabIdOf(c, body);
    const shot: BrowserScreenshot = await service().screenshot(
      tabId !== undefined ? { tabId } : {},
    );
    return c.json(shot);
  });

  return app;
}
