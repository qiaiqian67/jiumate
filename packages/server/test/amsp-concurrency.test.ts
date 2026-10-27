import { describe, expect, it } from "vitest";
import { ConcurrencyGate } from "../src/amsp/concurrency.js";
import type { AgentKey } from "../src/amsp/concurrency.js";

/** The gate is keyed by a Project/Agent pair, so the fixtures carry both. */
const key = (agentId: string, projectId = "p1"): AgentKey => ({ projectId, agentId });

describe("ConcurrencyGate", () => {
  it("admits up to the limit and refuses the next", () => {
    const gate = new ConcurrencyGate(() => 2);
    expect(gate.tryAcquire(key("a")).ok).toBe(true);
    expect(gate.tryAcquire(key("a")).ok).toBe(true);
    expect(gate.inFlight(key("a"))).toBe(2);
    expect(gate.tryAcquire(key("a")).ok).toBe(false);
  });

  it("counts per Agent, so a second key does not raise the ceiling", () => {
    // The reason the gate is keyed by Agent rather than by key: the management API encourages
    // making a second key for rotation, and a per-key limit would quietly double the owner's
    // setting every time they did.
    const gate = new ConcurrencyGate(() => 1);
    expect(gate.tryAcquire(key("a")).ok).toBe(true);
    expect(gate.tryAcquire(key("a")).ok).toBe(false);
    expect(gate.tryAcquire(key("b")).ok).toBe(true);
  });

  it("counts the same Agent id in different Projects apart", () => {
    // The ids are namespaced by Project, so the same Agent id in two Projects must not share a
    // budget — otherwise one Project's traffic would starve another's.
    const gate = new ConcurrencyGate(() => 1);
    expect(gate.tryAcquire(key("a", "p1")).ok).toBe(true);
    expect(gate.tryAcquire(key("a", "p1")).ok).toBe(false);
    expect(gate.tryAcquire(key("a", "p2")).ok).toBe(true);
  });

  it("returns the slot on release", () => {
    const gate = new ConcurrencyGate(() => 1);
    const first = gate.tryAcquire(key("a"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(gate.tryAcquire(key("a")).ok).toBe(false);
    first.slot.release();
    expect(gate.inFlight(key("a"))).toBe(0);
    expect(gate.tryAcquire(key("a")).ok).toBe(true);
  });

  it("ignores a double release", () => {
    // Without this, a released-twice slot hands out capacity that does not exist and every later
    // refusal is wrong by that amount.
    const gate = new ConcurrencyGate(() => 2);
    const a = gate.tryAcquire(key("a"));
    if (!a.ok) throw new Error("expected the first slot to be admitted");
    const b = gate.tryAcquire(key("a"));
    if (!b.ok) throw new Error("expected the second slot to be admitted");
    a.slot.release();
    a.slot.release();
    b.slot.release();
    expect(gate.inFlight(key("a"))).toBe(0);
  });

  it("reads the limit on each acquisition, so lowering it takes effect immediately", () => {
    let limit = 3;
    const gate = new ConcurrencyGate(() => limit);
    expect(gate.tryAcquire(key("a")).ok).toBe(true);
    expect(gate.tryAcquire(key("a")).ok).toBe(true);
    expect(gate.tryAcquire(key("a")).ok).toBe(true);
    expect(gate.tryAcquire(key("a")).ok).toBe(false);

    // The owner lowers the ceiling in the API tab while those runs are still going. Reading the
    // limit once at construction would keep admitting three more.
    limit = 1;
    expect(gate.tryAcquire(key("a")).ok).toBe(false);
  });

  it("treats a nonsense limit as one rather than zero or negative", () => {
    // A stored 0 would admit nothing at all and a negative would break the release arithmetic.
    const zero = new ConcurrencyGate(() => 0);
    expect(zero.tryAcquire(key("a")).ok).toBe(true);
    expect(zero.tryAcquire(key("a")).ok).toBe(false);

    const negative = new ConcurrencyGate(() => -5);
    expect(negative.tryAcquire(key("a")).ok).toBe(true);
    expect(negative.tryAcquire(key("a")).ok).toBe(false);
  });

  it("reports Retry-After in whole seconds", () => {
    const gate = new ConcurrencyGate(() => 1);
    const first = gate.tryAcquire(key("a"));
    if (!first.ok) throw new Error("expected the first slot to be admitted");
    const busy = gate.tryAcquire(key("a"));
    expect(busy.ok).toBe(false);
    if (busy.ok) return;
    expect(busy.retryAfterMs % 1000).toBe(0);
    expect(busy.retryAfterMs).toBeGreaterThan(0);
  });
});
