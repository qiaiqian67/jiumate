/**
 * How many runs one exposed Agent admits at once.
 *
 * `maxConcurrentRuns` exists because an Agent's API is a door other programs knock on, and nothing
 * about that door makes its callers well-behaved. Without a ceiling, one caller looping on a slow
 * prompt holds every slot the owner granted, and the Agent's own human user is queued behind
 * someone else's script — which is the failure the owner most needs to be protected from, because
 * they cannot see the other caller.
 *
 * The count is per Agent rather than per key, deliberately. Keys belong to one Agent, so a per-key
 * limit would be multiplied by the number of keys and would stop meaning anything as soon as the
 * owner made a second one — which the management API encourages, for rotation.
 *
 * In-process, not in the database. A run's cost is dominated by the model call it is waiting on, and
 * the ceiling exists to bound concurrent waiting, not to survive a restart: a counter in SQLite
 * would have to be recovered from rows whose sessions were already gone, and a run still in flight
 * at restart is gone with the process anyway. The stored limit is read once per acquisition, so
 * turning it down in the API tab takes effect on the next run rather than the next restart.
 */

/** One slot, held for the duration of a run and released whatever the outcome. */
interface HeldSlot {
  release(): void;
}

export class ConcurrencyGate {
  /** Held counts by Agent, never negative and never above that Agent's limit. */
  private readonly held = new Map<string, number>();

  constructor(
    /** Read per acquisition, not cached: the owner may lower a limit while runs are in flight. */
    private readonly limitOf: (agentId: string) => number,
  ) {}

  /**
   * Takes a slot, or returns why it could not.
   *
   * Not an exception for the full case: "busy" is an expected answer that the caller turns into a
   * 429 with a Retry-After, and the decision of how long to wait belongs to the HTTP layer.
   */
  tryAcquire(agentId: string): { ok: true; slot: HeldSlot } | { ok: false; retryAfterMs: number } {
    const limit = Math.max(1, Math.floor(this.limitOf(agentId)));
    const current = this.held.get(agentId) ?? 0;

    if (current >= limit) {
      // Rounded up to a whole second because Retry-After is expressed in seconds, and rounding
      // down would tell a caller to come back before the slot it is waiting for can exist.
      const waited = 1000;
      return { ok: false, retryAfterMs: waited };
    }

    this.held.set(agentId, current + 1);
    let released = false;
    return {
      ok: true,
      slot: {
        release: () => {
          // Idempotent, because a released-twice slot would silently hand out capacity that does
          // not exist — the next N callers would be admitted past the ceiling with nothing to
          // show for it in `held`.
          if (released) return;
          released = true;
          const next = (this.held.get(agentId) ?? 1) - 1;
          if (next <= 0) this.held.delete(agentId);
          else this.held.set(agentId, next);
        },
      },
    };
  }

  /** How many runs an Agent currently has in flight. The API tab shows this next to the limit. */
  inFlight(agentId: string): number {
    return this.held.get(agentId) ?? 0;
  }
}

/**
 * A single gate shared by every route that starts an Agent run.
 *
 * Per-gate would be per-route, which would multiply the ceiling by the number of ways in — the same
 * mistake as counting per key. The instance is created in http/app.ts and passed through AppDeps,
 * which is where this project's server wires its services by hand.
 */
let shared: ConcurrencyGate | null = null;

export function sharedGate(limitOf: (agentId: string) => number): ConcurrencyGate {
  if (shared === null) shared = new ConcurrencyGate(limitOf);
  return shared;
}