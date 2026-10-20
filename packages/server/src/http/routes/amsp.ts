/**
 * The Agent API itself: `/amsp/v1/projects/:projectId/agents/:agentId/...`.
 *
 * This is the calling side. `/api/...` is the Web App's own surface — it authenticates the signed-in
 * person or the local API token, and its writes need a human. This surface authenticates an
 * `jiumate_` key instead, so a program outside the Web App can drive the Agent, and it needs no
 * human at all: the owner already decided, by minting the key, that this program may.
 *
 *   POST   /sessions            start a run: create the session and send the first turn
 *   GET    /sessions/:id        the session's status and its messages
 *   GET    /sessions/:id/stream the same session's events as SSE
 *   DELETE /sessions/:id        cancel a run in progress
 *
 * Create-and-send is one request rather than two. A caller outside the Web App has no UI to
 * correlate two calls with, and splitting them would force every caller to implement the pairing —
 * and to handle a session created and then never used, which is an idle session nobody can see.
 *
 * A POST answers 202 with the session id, not the answer. A turn takes as long as the model takes;
 * waiting for it inside the request would turn a slow model into a client-side timeout that looks
 * exactly like a hung Agent, and would pin the HTTP connection for the whole run. So the run
 * continues on the server after the response, and the caller reads the result with GET or follows
 * it with the SSE stream — the same split the Web App itself uses.
 *
 * Authorisation is `authorizeAgentApiCall` (../../amsp/authenticate.ts), which resolves the key,
 * checks both switches and returns the settings a run should use: the approval mode, the model,
 * the thinking level and the Workspace. Those come from the Agent's settings rather than from the
 * request, so a caller cannot pick a cheaper model or a laxer approval mode than the owner
 * granted. A caller may narrow the Workspace; it cannot widen the grant.
 *
 * Concurrency is bounded by the gate, per Agent rather than per key. The slot is held for the
 * duration of the *run*, not the duration of the request — a ceiling that only bounded the moment
 * of starting would admit unbounded concurrent runs, which is the thing it exists to prevent. It is
 * therefore released by a watcher that waits for the session to go idle, and the watcher is
 * attached to the run rather than to the HTTP response, so a client that disconnects mid-run does
 * not strand the slot.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { THINKING_LEVEL_NAMES, userText } from "@prismshadow/jiumate-core";
import type { AppDeps } from "../../app.js";
import { authorizeAgentApiCall } from "../../amsp/authenticate.js";
import type { AgentApiGrant } from "../../amsp/authenticate.js";
import { ConcurrencyGate } from "../../amsp/concurrency.js";
import type { AgentKey } from "../../amsp/concurrency.js";
import { HttpError } from "../errors.js";
import { sseEndpoint } from "../sse.js";
import { assertWorkspaceAllowed } from "../../services/workspace-guard.js";
import { badRequest, optionalEnum, optionalString, readJson, requireValidId } from "../validate.js";

/** What starting a run answers with. The answer itself is read separately, by session id. */
export interface AmspRunStarted {
  sessionId: string;
  /** Always false here: this surface refuses a busy session rather than queueing behind it. */
  queued: boolean;
}

/** How long a slot may be held before the watcher gives up on seeing the session go idle. */
const SLOT_WATCH_TIMEOUT_MS = 60 * 60_000;
/** How often the watcher re-reads the status. Cheap enough to be frequent, rare enough to not spin. */
const SLOT_WATCH_INTERVAL_MS = 250;

export function amspRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  /*
   * One gate for every route, created per app rather than per request.
   *
   * It is not a module-level singleton: the limit lookup needs this app's repo, and a singleton
   * would keep the first app's repo alive for the life of the process — so a second server in the
   * same process (the test suite builds one per file) would count against the first one's
   * settings. A gate per route would multiply the owner's ceiling by the number of ways in, which
   * is the same mistake as counting per key.
   */
  const gate = new ConcurrencyGate((key) => {
    // Read per acquisition rather than cached: the owner may lower the ceiling in the API tab
    // while runs are in flight, and that has to bind the next request rather than the next restart.
    const settings = deps.agentApiRepo.get(key.projectId, key.agentId);
    return settings?.maxConcurrentRuns ?? 4;
  });

  /**
   * Authorise, then take a slot in the Agent's budget.
   *
   * The slot is taken after authorisation, not before: a refused request — a bad key, a switch
   * that is off — must not consume capacity it was never entitled to, or a program could deny
   * service to its own Agent by spamming bad keys.
   */
  /**
   * Either a grant with a slot, or the refusal that the slot could not be taken.
   *
   * A discriminated union rather than an optional field, so that a caller cannot read `busy`
   * without first proving it is there: `if ("busy" in admitted)` narrows to the refusal, and
   * anything else is the grant.
   */
  type Admission =
    | { busy: undefined; grant: AgentApiGrant; slot: { release(): void } }
    | { busy: { retryAfterSeconds: number }; grant: AgentApiGrant; slot: { release(): void } };

  const admit = (c: Context): Admission => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const grant = authorizeAgentApiCall(c, deps, { projectId, agentId });

    const key: AgentKey = { projectId: grant.projectId, agentId: grant.agentId };
    const taken = gate.tryAcquire(key);
    if (!taken.ok) {
      /*
       * Reported rather than thrown, because the Retry-After has to survive: an exception is
       * turned into a response by the error handler, which builds a new response object, and a
       * header set on the context here would be dropped with it. "Busy" is also not an error in
       * the usual sense — it is the one refusal that is expected to clear on its own, and the
       * header is the whole point of it.
       */
      return {
        busy: { retryAfterSeconds: Math.max(1, Math.ceil(taken.retryAfterMs / 1000)) },
        grant,
        slot: { release: () => {} },
      };
    }
    return { busy: undefined, grant, slot: taken.slot };
  };

  /**
   * The 429 every route answers with when the Agent is at its ceiling.
   *
   * One place, so the status code, the code string and the Retry-After cannot drift apart
   * between the four routes.
   */
  const refuseBusy = (c: Context, busy: { retryAfterSeconds: number }): never => {
    c.header("Retry-After", String(busy.retryAfterSeconds));
    throw new HttpError(
      429,
      "too_many_runs",
      "This Agent already has as many runs in progress as it allows.",
    );
  };

  /** The session a key may reach: its own Agent's, and nobody else's. */
  const sessionOf = (c: Context, projectId: string, agentId: string) => {
    const sessionId = c.req.param("sessionId");
    const row = sessionId === undefined ? null : deps.sessionsRepo.findById(sessionId);
    // 404 rather than 403 for a session belonging elsewhere: the key names one Agent, so another
    // Agent's session has to read as absent rather than as forbidden — 403 would confirm it exists.
    if (row === null || row.projectId !== projectId || row.agentId !== agentId) {
      throw new HttpError(404, "not_found", "No such session.");
    }
    return row;
  };

  /**
   * Releases the slot when the run is over.
   *
   * Polls the session's status rather than listening for an event: the manager's status is the
   * same thing the Web App's own UI reads, so the two agree on when a run has finished. The
   * timeout is a backstop, not the normal path — a run that somehow never reports idle must not
   * hold a slot forever, because a stuck slot reduces the Agent's capacity permanently.
   */
  const releaseWhenIdle = (sessionId: string, release: () => void): void => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const idle = deps.manager.statusOf(sessionId) === "idle";
      const expired = Date.now() - startedAt > SLOT_WATCH_TIMEOUT_MS;
      if (idle || expired) {
        clearInterval(timer);
        release();
      }
    }, SLOT_WATCH_INTERVAL_MS);
    // The watcher must not hold the process open on its own: a server shutting down should not
    // wait a minute for the last run's timer.
    timer.unref?.();
  };

  app.post("/projects/:projectId/agents/:agentId/sessions", async (c) => {
    const admitted = admit(c);
    if (admitted.busy !== undefined) refuseBusy(c, admitted.busy);
    const { grant, slot } = admitted;

    const body = await readJson(c);
    const prompt = optionalString(body, "prompt", { minLen: 1, label: "prompt" });
    if (prompt === undefined) throw badRequest("prompt is required and must be a non-empty string.");

    // Narrowing only. An explicit Workspace has to exist already, and omitting it falls back to
    // the Agent's setting — or, when that is empty too, to a fresh temporary one per run.
    let workspace = grant.workspace;
    if (body.workspace !== undefined) {
      const requested = optionalString(body, "workspace", { minLen: 1, label: "workspace" });
      workspace =
        requested === undefined ? null : await assertWorkspaceAllowed({ workspace: requested });
    }

    // The owner chose the model and the approval mode when they exposed the Agent. A request may
    // not override either: that would let a caller run its own turns under a cheaper model or a
    // laxer policy than the one granted. The thinking level is the caller's own business.
    const thinkingLevel = optionalEnum(body, "thinkingLevel", THINKING_LEVEL_NAMES);

    let session;
    try {
      session = await deps.sessionService.createSession({
        projectId: grant.projectId,
        agentId: grant.agentId,
        ...(grant.model !== null
          ? { modelId: grant.model.modelId, provider: grant.model.provider }
          : {}),
        ...(workspace != null ? { workspace } : {}),
        approvalMode: grant.approvalMode,
        // Recorded as "cli": this surface is by definition not the Web App, and the provenance is
        // what makes an API-created session distinguishable in the list afterwards.
        client: "cli",
      });
    } catch (err) {
      // The session was never created, so nothing is running and the slot must go back now.
      slot.release();
      throw err;
    }

    // Applied after creation, because createSession does not take a thinking level: the setting
    // lives on the session row, and the run reads it from there.
    if (thinkingLevel !== undefined) {
      deps.sessionsRepo.updateThinkingLevel(session.sessionId, thinkingLevel);
    }

    try {
      const started = await deps.manager.startTask(session.sessionId, [userText(prompt)]);
      // The slot is held until the run finishes, not until this response is written.
      releaseWhenIdle(started.sessionId, slot.release);
      return c.json({ sessionId: started.sessionId, queued: false } satisfies AmspRunStarted, 202);
    } catch (err) {
      // The run never started. The session exists and is idle, and is left in place deliberately:
      // deleting it would race the self-heal that startTask may already have done, and an idle
      // session is visible in the list rather than being an invisible leak.
      slot.release();
      throw err instanceof HttpError
        ? err
        : new HttpError(400, "run_start_failed", err instanceof Error ? err.message : String(err));
    }
  });

  app.get("/projects/:projectId/agents/:agentId/sessions/:sessionId", async (c) => {
    const admitted = admit(c);
    if (admitted.busy !== undefined) refuseBusy(c, admitted.busy);
    const { grant, slot } = admitted;
    try {
      const row = sessionOf(c, grant.projectId, grant.agentId);
      const messages = await deps.traceService.readMessages(
        row.projectId,
        row.agentId,
        row.sessionId,
      );
      return c.json({
        sessionId: row.sessionId,
        status: deps.manager.statusOf(row.sessionId),
        messages,
      });
    } finally {
      // A read does not occupy a run slot: the ceiling bounds concurrent *runs*, and reading a
      // finished session's messages is not one.
      slot.release();
    }
  });

  app.get("/projects/:projectId/agents/:agentId/sessions/:sessionId/stream", (c) => {
    const admitted = admit(c);
    if (admitted.busy !== undefined) refuseBusy(c, admitted.busy);
    const { grant, slot } = admitted;
    const row = sessionOf(c, grant.projectId, grant.agentId);
    const channel = deps.channels.get(row.sessionId);
    // The first event is the current state, exactly as the Web App's own stream sends it, so a
    // caller that subscribes late is not left waiting for a status it missed.
    return sseEndpoint(c, channel, {
      initialEvents: [
        { type: "task_state", state: deps.manager.statusOf(row.sessionId), queued: 0 },
      ],
    });
  });

  app.delete("/projects/:projectId/agents/:agentId/sessions/:sessionId", (c) => {
    const admitted = admit(c);
    if (admitted.busy !== undefined) refuseBusy(c, admitted.busy);
    const { grant, slot } = admitted;
    try {
      const row = sessionOf(c, grant.projectId, grant.agentId);
      // 204 whether or not there was anything to cancel: the caller's intent is "this run should
      // not continue", and it does not. Reporting "no run was active" would make an idempotent
      // retry look like a failure.
      deps.manager.abortTask(row.sessionId);
      return c.body(null, 204);
    } finally {
      slot.release();
    }
  });

  return app;
}
