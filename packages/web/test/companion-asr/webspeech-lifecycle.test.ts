/**
 * WebSpeechAsrProvider — lifecycle coverage via a stubbed constructor.
 *
 * The actual `window.SpeechRecognition` API is unavailable in node, but the
 * provider's session-management logic (start → onresult → onend, error
 * mapping, double-start rejection) is exactly the part most likely to leak
 * state in a future refactor. We stub the constructor through `vi.stubGlobal`
 * to exercise the provider end-to-end without spinning up a DOM.
 *
 * The companion-asr/webspeech.test.ts file covers the `mapError` mapper on
 * its own (no stubbing needed); this file complements it with the
 * recognizer-event wiring that depends on the constructor stub.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSpeechAsrProvider } from "../../src/features/chat/companion-asr/webspeech";
import type { AsrError } from "../../src/features/chat/companion-asr/provider";

interface StubRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  onstart: (() => void) | null;
  onresult: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onend: (() => void) | null;
  fireStart: () => void;
  fireResult: (finals: string[], inters?: string[]) => void;
  fireError: (error: string, message?: string) => void;
  fireEnd: () => void;
}

function makeRecognition(): StubRecognition {
  const stub: StubRecognition = {
    lang: "",
    continuous: false,
    interimResults: false,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    onstart: null,
    onresult: null,
    onerror: null,
    onend: null,
    fireStart() {
      this.onstart?.();
    },
    fireResult(finals: string[], inters: string[] = []) {
      // Build an `ArrayLike<ArrayLike<{transcript}> & {isFinal}>` matching the
      // spec. The provider reads `result[0].transcript` and `result.isFinal`,
      // so each entry is a plain object that quacks as an ArrayLike with index 0
      // plus an `isFinal` boolean. Using a real array would not work because
      // `Object.assign([transcript], {isFinal: ...})` makes the property
      // enumerable on the array instance — fine — but TS's noUncheckedIndexedAccess
      // narrows `result[0]` to the array element type, so the cast keeps the
      // type-check honest.
      const results = finals.map((transcript, i) => {
        const isFinal = inters[i] === undefined;
        const entry: ArrayLike<{ transcript: string }> & { isFinal: boolean } = {
          0: { transcript },
          length: 1,
          isFinal,
        };
        return entry;
      });
      this.onresult?.({ resultIndex: 0, results });
    },
    fireError(error: string, message?: string) {
      this.onerror?.({ error, message });
    },
    fireEnd() {
      this.onend?.();
    },
  };
  return stub;
}

describe("WebSpeechAsrProvider — lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function installRecognition(stub: StubRecognition): void {
    const Ctor = function () {
      return stub;
    };
    vi.stubGlobal("window", { SpeechRecognition: Ctor, isSecureContext: true });
  }

  it("available() is true when SpeechRecognition is exposed AND context is secure", () => {
    installRecognition(makeRecognition());
    expect(new WebSpeechAsrProvider().available()).toBe(true);
  });

  it("available() is false when SpeechRecognition is missing", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    expect(new WebSpeechAsrProvider().available()).toBe(false);
  });

  it("available() is false when the page is not in a secure context", () => {
    // Chromium refuses to expose SpeechRecognition on plain HTTP. The
    // provider reflects that by reporting unavailable rather than letting
    // the user click a button that always fails with "not-allowed".
    vi.stubGlobal("window", {
      SpeechRecognition: function () {
        return makeRecognition();
      },
      isSecureContext: false,
    });
    expect(new WebSpeechAsrProvider().available()).toBe(false);
  });

  it("start() resolves on onstart and streams finals through onFinal", async () => {
    const stub = makeRecognition();
    installRecognition(stub);
    const provider = new WebSpeechAsrProvider();
    let received = "";
    let ended: AsrError | null = { kind: "aborted" }; // sentinel: overwritten on end
    const started = provider.start({
      onFinal: (t) => {
        received += t;
      },
      onEnd: (err) => {
        ended = err;
      },
    });
    expect(stub.start).toHaveBeenCalledTimes(1);
    stub.fireStart();
    await started;
    // One event with two final entries — the provider concatenates them into a
    // single onFinal call (it does NOT call onFinal once per entry).
    stub.fireResult(["hello", " world"]);
    stub.fireEnd();
    expect(received).toBe("hello world");
    expect(ended).toBeNull();
  });

  it("start() forwards onInterim transcripts as a single concatenated string", async () => {
    const stub = makeRecognition();
    installRecognition(stub);
    const provider = new WebSpeechAsrProvider();
    const inters: string[] = [];
    const finals: string[] = [];
    const started = provider.start({
      onInterim: (t) => inters.push(t),
      onFinal: (t) => finals.push(t),
      onEnd: () => undefined,
    });
    stub.fireStart();
    await started;
    // The provider concatenates the per-entry transcripts (not the per-entry
    // interim/final label), so two interim entries with transcripts "a" and "b"
    // produce a single onInterim call carrying "ab". One event with all-final
    // entries produces a single onFinal call with concatenated transcripts;
    // a follow-up event with its own finals produces a second onFinal call.
    stub.fireResult(["a", "b"], ["x", "y"]);
    stub.fireResult(["done"], []);
    stub.fireEnd();
    expect(inters).toEqual(["ab"]);
    expect(finals).toEqual(["done"]);
  });

  it("start() maps 'no-speech' error to AsrError and ends the session", async () => {
    const stub = makeRecognition();
    installRecognition(stub);
    const provider = new WebSpeechAsrProvider();
    let ended: AsrError | null = null;
    const started = provider.start({
      onFinal: () => undefined,
      onEnd: (err) => {
        ended = err;
      },
    });
    stub.fireStart();
    await started;
    stub.fireError("no-speech");
    expect(ended).toEqual({ kind: "no-speech" });
    // After an error the active session is cleared — a subsequent start
    // must NOT throw on a stale recognizer.
    const stub2 = makeRecognition();
    installRecognition(stub2);
    const restarted = provider.start({ onFinal: () => undefined, onEnd: () => undefined });
    stub2.fireStart();
    await expect(restarted).resolves.toBeUndefined();
  });

  it("double start() aborts the prior session instead of throwing", async () => {
    const stub1 = makeRecognition();
    installRecognition(stub1);
    const provider = new WebSpeechAsrProvider();
    void provider.start({ onFinal: () => undefined, onEnd: () => undefined });
    // The first recognizer is still active. A second start must abort it
    // and begin a fresh one rather than leaving the user stuck.
    const stub2 = makeRecognition();
    installRecognition(stub2);
    const second = provider.start({ onFinal: () => undefined, onEnd: () => undefined });
    expect(stub1.abort).toHaveBeenCalledTimes(1);
    stub2.fireStart();
    await expect(second).resolves.toBeUndefined();
  });

  it("stop() is a no-op when no session is active", () => {
    installRecognition(makeRecognition());
    const provider = new WebSpeechAsrProvider();
    // Should not throw.
    provider.stop();
  });

  it("stop() calls underlying stop() while a session is active", async () => {
    const stub = makeRecognition();
    installRecognition(stub);
    const provider = new WebSpeechAsrProvider();
    const started = provider.start({ onFinal: () => undefined, onEnd: () => undefined });
    stub.fireStart();
    await started;
    provider.stop();
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });
});
