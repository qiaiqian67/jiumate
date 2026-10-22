/**
 * What the agent does with a tab: the scan that reads a page, the exec that runs script in it,
 * and the trusted input — a click, typed text.
 *
 * exec, click and type share one shape: take a baseline and start the transient monitor, act,
 * give the page a moment (or wait out a reload), then report the new tabs the action opened,
 * the transient texts, and the change against the baseline — with a note when nothing visible
 * happened. The page's dialogs are answered and reported, since one would block it; and a tab
 * runs one action at a time.
 */
import type {
  BrowserDialog,
  BrowserExecResult,
  BrowserScreenshot,
} from "@prismshadow/jiumate-core/interfaces";
import { HttpError } from "../http/errors.js";
import { PageScriptError } from "./driver.js";
import type { BrowserDriver, EvaluateOutcome } from "./driver.js";
import type { TabRegistry } from "./tabs.js";
import { execExpression, parseExecOutcome } from "./page-scripts/exec.js";
import {
  DISPATCH_INPUT_EVENTS_SCRIPT,
  clickTargetScript,
  focusScript,
  pointTargetScript,
  scrollScript,
  selectScript,
} from "./page-scripts/input.js";
import {
  MONITOR_BEGIN_SCRIPT,
  MONITOR_END_SCRIPT,
  MONITOR_STOP_SCRIPT,
} from "./page-scripts/monitor.js";
import { scanScript } from "./page-scripts/simplify.js";

/** The scan's content budget. The text form gets a third of it. */
export const DEFAULT_SCAN_MAX_CHARS = 35_000;
export const DEFAULT_EXEC_TIMEOUT_MS = 15_000;

export interface ActionTiming {
  /** The pause after an action before the page is measured. */
  settleMs: number;
  /** How long a reload an action caused is waited out. */
  reloadWaitMs: number;
  /** How long navigate waits for the page to load. */
  loadWaitMs: number;
  /** How long a popup's tab gets to be claimed before a call reports its new tabs without it. */
  popupClaimMs: number;
  /** The gap between the mouse events of one click. */
  clickGapMs: number;
  /** The monitor scripts and the element lookups. */
  helperTimeoutMs: number;
  scanTimeoutMs: number;
  screenshotTimeoutMs: number;
}

export const DEFAULT_ACTION_TIMING: ActionTiming = {
  settleMs: 1_000,
  reloadWaitMs: 10_000,
  loadWaitMs: 15_000,
  popupClaimMs: 3_000,
  clickGapMs: 70,
  helperTimeoutMs: 10_000,
  scanTimeoutMs: 30_000,
  screenshotTimeoutMs: 20_000,
};

/** The tallest full-page screenshot taken, in CSS pixels (Chromium's texture limit). */
const MAX_FULL_PAGE_HEIGHT = 16_384;

const NO_CHANGE_NOTE = "No visible change on the page.";

/** The CDP event of a page's dialog opening, and the dialogs it names. */
const DIALOG_EVENT = "Page.javascriptDialogOpening";
const DIALOG_TYPES: readonly BrowserDialog["type"][] = [
  "alert",
  "confirm",
  "prompt",
  "beforeunload",
];
/** Turning a tab's Page events on or off: a page that is not blocked answers at once. */
const PAGE_EVENTS_TIMEOUT_MS = 3_000;

/** What an action did before it is measured. */
interface ActOutcome {
  ok: boolean;
  value?: unknown;
  error?: string;
  reloaded?: boolean;
}

/**
 * A key, as CDP's `Input.dispatchKeyEvent` wants it.
 *
 * The named keys are the ones a page handles by name; anything else is a single character
 * and is typed as such. The codes and the virtual key codes are Chromium's own, so a page
 * that reads `event.key` or `event.keyCode` sees what a person's keyboard would send.
 */
function keyEvent(key: string): {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  nativeVirtualKeyCode: number;
  text?: string;
} {
  const named: Record<string, { code: string; vk: number; text?: string }> = {
    Enter: { code: "Enter", vk: 13, text: "\r" },
    Tab: { code: "Tab", vk: 9 },
    Escape: { code: "Escape", vk: 27 },
    Backspace: { code: "Backspace", vk: 8 },
    Delete: { code: "Delete", vk: 46 },
    ArrowUp: { code: "ArrowUp", vk: 38 },
    ArrowDown: { code: "ArrowDown", vk: 40 },
    ArrowLeft: { code: "ArrowLeft", vk: 37 },
    ArrowRight: { code: "ArrowRight", vk: 39 },
    Home: { code: "Home", vk: 36 },
    End: { code: "End", vk: 35 },
    PageUp: { code: "PageUp", vk: 33 },
    PageDown: { code: "PageDown", vk: 34 },
    Space: { code: "Space", vk: 32, text: " " },
  };
  const found = named[key] ?? named[key.toLowerCase()];
  if (found !== undefined) {
    return {
      key: key.length === 1 ? key : key.charAt(0).toUpperCase() + key.slice(1),
      code: found.code,
      windowsVirtualKeyCode: found.vk,
      nativeVirtualKeyCode: found.vk,
      ...(found.text !== undefined ? { text: found.text } : {}),
    };
  }
  // A single character: typed as it is.
  const upper = key.toUpperCase();
  return {
    key: key,
    code: /^\p{L}$/u.test(key) ? `Key${upper}` : key,
    windowsVirtualKeyCode: upper.charCodeAt(0),
    nativeVirtualKeyCode: upper.charCodeAt(0),
    text: key,
  };
}

interface MonitorEnd {
  lost?: boolean;
  transients?: string[];
  changed?: number;
  topChange?: string;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The tab closed, or its page crashed, under the action: the action ends with that error. */
function tabGone(err: unknown): boolean {
  return err instanceof HttpError && (err.code === "no_such_tab" || err.code === "tab_crashed");
}

/** A page script of ours that threw is the caller's `script_error`, with the page's message. */
function scriptError(err: unknown): Error {
  return err instanceof PageScriptError
    ? new HttpError(422, "script_error", err.message)
    : (err as Error);
}

export interface ActionDeps {
  driver: BrowserDriver;
  tabs: TabRegistry;
  timing?: Partial<ActionTiming>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class BrowserActions {
  private readonly driver: BrowserDriver;
  private readonly tabs: TabRegistry;
  private readonly timing: ActionTiming;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** Per tab, the exec, click or type under way; the next one starts when it has ended. */
  private readonly lanes = new Map<number, Promise<void>>();

  constructor(deps: ActionDeps) {
    this.driver = deps.driver;
    this.tabs = deps.tabs;
    this.timing = { ...DEFAULT_ACTION_TIMING, ...deps.timing };
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
  }

  /** The page as the model reads it: simplified HTML, or plain text with `textOnly`. */
  async scan(
    tabId: number,
    opts: { textOnly?: boolean; maxChars?: number; instruction?: string },
  ): Promise<{ content: string; truncated: boolean }> {
    const textOnly = opts.textOnly === true;
    const budget = opts.maxChars ?? DEFAULT_SCAN_MAX_CHARS;
    const maxChars = textOnly ? Math.floor(budget / 3) : budget;
    const script = scanScript({
      textOnly,
      maxChars,
      ...(opts.instruction !== undefined ? { instruction: opts.instruction } : {}),
    });
    // A page caught between documents is scanned again once it has loaded.
    for (let attempt = 0; ; attempt++) {
      let outcome: EvaluateOutcome;
      try {
        outcome = await this.driver.evaluate(tabId, script, {
          timeoutMs: this.timing.scanTimeoutMs,
        });
      } catch (err) {
        throw scriptError(err);
      }
      if ("value" in outcome) {
        const value = (outcome.value ?? {}) as { content?: unknown; truncated?: unknown };
        return {
          content: typeof value.content === "string" ? value.content : "",
          truncated: value.truncated === true,
        };
      }
      if (attempt > 0) {
        throw new HttpError(
          422,
          "script_error",
          "The page kept navigating; scan it again once it settles.",
        );
      }
      await this.driver.waitForLoad(tabId, this.timing.reloadWaitMs);
    }
  }

  /**
   * Runs script in the page. With `acceptDialogs`, every dialog the page opens meanwhile is
   * accepted; without, only alerts are. The same goes for click and type.
   */
  exec(
    tabId: number,
    script: string,
    opts: { noMonitor?: boolean; timeoutMs?: number; acceptDialogs?: boolean } = {},
  ): Promise<BrowserExecResult> {
    return this.serial(tabId, () => this.execNow(tabId, script, opts));
  }

  /** A trusted click (see `clickNow`). */
  click(
    tabId: number,
    target: { selector: string; index?: number } | { x: number; y: number },
    opts: { acceptDialogs?: boolean } = {},
  ): Promise<BrowserExecResult> {
    return this.serial(tabId, () => this.clickNow(tabId, target, opts.acceptDialogs === true));
  }

  /** Typing (see `typeNow`). */
  type(
    tabId: number,
    opts: { text: string; selector?: string; submit?: boolean; acceptDialogs?: boolean },
  ): Promise<BrowserExecResult> {
    return this.serial(tabId, () => this.typeNow(tabId, opts));
  }

  /**
   * Runs one exec, click or type on a tab once the one before it has ended. Their measuring
   * keeps its state in the page's window (the transient monitor, the diff's baseline), so two
   * at once on one tab would overwrite each other's; and a type must not lose its focus to a
   * click in between.
   */
  private serial<T>(tabId: number, run: () => Promise<T>): Promise<T> {
    const before = this.lanes.get(tabId) ?? Promise.resolve();
    const result = before.then(run);
    const done = result.then(
      () => undefined,
      () => undefined,
    );
    this.lanes.set(tabId, done);
    void done.then(() => {
      if (this.lanes.get(tabId) === done) this.lanes.delete(tabId);
    });
    return result;
  }

  private async execNow(
    tabId: number,
    script: string,
    opts: { noMonitor?: boolean; timeoutMs?: number; acceptDialogs?: boolean },
  ): Promise<BrowserExecResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const observe = {
      noMonitor: opts.noMonitor === true,
      acceptDialogs: opts.acceptDialogs === true,
    };
    return this.observed(tabId, observe, async () => {
      let outcome: EvaluateOutcome;
      try {
        outcome = await this.driver.evaluate(tabId, `return ${execExpression(script)};`, {
          timeoutMs,
        });
      } catch (err) {
        if (err instanceof HttpError && err.code === "timeout") {
          return {
            ok: false,
            error: `No result within ${Math.round(timeoutMs / 1000)}s; the script may still be running.`,
          };
        }
        if (err instanceof PageScriptError) return { ok: false, error: err.message };
        throw err;
      }
      if ("reloaded" in outcome) return { ok: true, reloaded: true };
      const result = parseExecOutcome(outcome.value);
      if (!result.ok) {
        return { ok: false, error: `${result.error.name}: ${result.error.message}` };
      }
      return { ok: true, ...(result.data !== undefined ? { value: result.data } : {}) };
    });
  }

  /**
   * A trusted click: the element's centre (scrolled into view first) or a viewport point, then
   * mouseMoved → mousePressed → mouseReleased with a short gap — the full sequence, since
   * hover-driven components ignore a press that no move preceded.
   */
  private async clickNow(
    tabId: number,
    target: { selector: string; index?: number } | { x: number; y: number },
    acceptDialogs: boolean,
  ): Promise<BrowserExecResult> {
    let clicked: { x: number; y: number; tag?: string; text?: string };
    if ("selector" in target) {
      const found = await this.helper(tabId, clickTargetScript(target.selector, target.index ?? 0));
      clicked = found as { x: number; y: number; tag?: string; text?: string };
    } else {
      const found = (await this.helper(tabId, pointTargetScript(target.x, target.y))) as {
        tag?: string;
        text?: string;
      };
      clicked = { x: target.x, y: target.y, ...found };
    }
    const { x, y } = clicked;
    const result = await this.observed(tabId, { noMonitor: false, acceptDialogs }, async () => {
      try {
        await this.driver.cdp(tabId, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y,
          button: "none",
        });
        await this.sleep(this.timing.clickGapMs);
        await this.driver.cdp(tabId, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          buttons: 1,
          clickCount: 1,
        });
        await this.sleep(this.timing.clickGapMs);
        await this.driver.cdp(tabId, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          buttons: 0,
          clickCount: 1,
        });
      } catch (err) {
        if (tabGone(err)) throw err;
        return { ok: false, error: messageOf(err) };
      }
      return { ok: true };
    });
    return { ...result, clicked };
  }

  /**
   * Typing: into the field `selector` names (focused, its content selected so the text
   * replaces it) or wherever focus already is; CDP insertText, then input and change events
   * for controlled components; Enter (keyDown / keyUp) with `submit`.
   */
  private async typeNow(
    tabId: number,
    opts: { text: string; selector?: string; submit?: boolean; acceptDialogs?: boolean },
  ): Promise<BrowserExecResult> {
    if (opts.selector !== undefined) await this.helper(tabId, focusScript(opts.selector));
    const observe = { noMonitor: false, acceptDialogs: opts.acceptDialogs === true };
    return this.observed(tabId, observe, async () => {
      try {
        if (opts.text !== "") {
          await this.driver.cdp(tabId, "Input.insertText", { text: opts.text });
        }
        await this.driver.evaluate(tabId, DISPATCH_INPUT_EVENTS_SCRIPT, {
          timeoutMs: this.timing.helperTimeoutMs,
        });
        if (opts.submit === true) {
          const enter = {
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
          };
          await this.driver.cdp(tabId, "Input.dispatchKeyEvent", {
            type: "keyDown",
            ...enter,
            text: "\r",
            unmodifiedText: "\r",
          });
          // The keyDown is the submit; a page that navigates on it may not take the keyUp.
          await this.driver
            .cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...enter })
            .catch(() => undefined);
        }
      } catch (err) {
        if (tabGone(err)) throw err;
        return { ok: false, error: messageOf(err) };
      }
      return { ok: true };
    });
  }

  /** A PNG of the viewport, or of the whole page (up to Chromium's texture height). */
  async screenshot(tabId: number, opts: { fullPage?: boolean } = {}): Promise<BrowserScreenshot> {
    const params: Record<string, unknown> = { format: "png" };
    if (opts.fullPage === true) {
      const metrics = (await this.driver.cdp(tabId, "Page.getLayoutMetrics")) as {
        cssContentSize?: { width: number; height: number };
        contentSize?: { width: number; height: number };
      };
      const size = metrics.cssContentSize ?? metrics.contentSize;
      if (size !== undefined) {
        params.captureBeyondViewport = true;
        params.clip = {
          x: 0,
          y: 0,
          width: Math.max(1, Math.ceil(size.width)),
          height: Math.max(1, Math.min(MAX_FULL_PAGE_HEIGHT, Math.ceil(size.height))),
          scale: 1,
        };
      }
    }
    const shot = (await this.driver.cdp(
      tabId,
      "Page.captureScreenshot",
      params,
      this.timing.screenshotTimeoutMs,
    )) as { data?: unknown };
    if (typeof shot.data !== "string") {
      throw new HttpError(502, "cdp_error", "The page returned no screenshot.");
    }
    return { mime: "image/png", data: shot.data };
  }

  /**
   * Scrolls the page, and says where it ended up.
   *
   * The answer matters more than the scroll: a model that is told "scrolled to the bottom"
   * when the page did not move will keep asking, and one that is told the page's height
   * and its position can decide for itself whether there is more to read.
   */
  async scroll(tabId: number, amount: number): Promise<BrowserExecResult> {
    return this.observed(tabId, { noMonitor: false, acceptDialogs: false }, async () => {
      try {
        const outcome = (await this.helper(tabId, scrollScript(amount))) as {
          moved: boolean;
          x: number;
          y: number;
          atBottom: boolean;
          atTop: boolean;
          height: number;
          viewport: number;
        };
        return {
          ok: true,
          value: {
            moved: outcome.moved,
            x: outcome.x,
            y: outcome.y,
            atBottom: outcome.atBottom,
            atTop: outcome.atTop,
            pageHeight: outcome.height,
            viewportHeight: outcome.viewport,
          },
        };
      } catch (err) {
        if (tabGone(err)) throw err;
        return { ok: false, error: messageOf(err) };
      }
    });
  }

  /**
   * Presses a key, the way a person's keyboard would.
   *
   * The key is dispatched through CDP, so the page cannot tell it from a person typing —
   * which is the point: a form that only accepts trusted events would ignore a script.
   */
  async press(tabId: number, key: string, acceptDialogs?: boolean): Promise<BrowserExecResult> {
    const event = keyEvent(key);
    return this.observed(
      tabId,
      { noMonitor: false, acceptDialogs: acceptDialogs === true },
      async () => {
        try {
          await this.driver.cdp(tabId, "Input.dispatchKeyEvent", {
            type: "keyDown",
            ...event,
            ...(event.text === undefined ? {} : { text: event.text, unmodifiedText: event.text }),
          });
          await this.driver
            .cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...event })
            .catch(() => undefined);
          return { ok: true, value: { key } };
        } catch (err) {
          if (tabGone(err)) throw err;
          return { ok: false, error: messageOf(err) };
        }
      },
    );
  }

  /**
   * Chooses an option in a `<select>`.
   *
   * The option is named by its value, or by the text the user reads on it — a model that
   * saw "United States" in a scan should be able to choose it without knowing the value.
   */
  async select(tabId: number, selector: string, value: string): Promise<BrowserExecResult> {
    return this.observed(tabId, { noMonitor: false, acceptDialogs: false }, async () => {
      try {
        const outcome = (await this.helper(tabId, selectScript(selector, value))) as {
          value: string;
          label: string;
        };
        return { ok: true, value: { selected: outcome.value, label: outcome.label } };
      } catch (err) {
        if (tabGone(err)) throw err;
        return { ok: false, error: messageOf(err) };
      }
    });
  }

  /**
   * Loads a URL in the tab and waits (up to the load budget) for it; a slow page is not an
   * error, the tab is simply still loading. A page that cannot be reached is.
   */
  async navigate(tabId: number, url: string): Promise<void> {
    const deadline = this.now() + this.timing.loadWaitMs;
    let answer: { errorText?: unknown };
    try {
      answer = (await this.driver.cdp(tabId, "Page.navigate", { url }, this.timing.loadWaitMs)) as {
        errorText?: unknown;
      };
    } catch (err) {
      if (err instanceof HttpError && err.code === "timeout") return;
      throw err;
    }
    // A download aborts the navigation and leaves the page where it was; that is not a failure.
    if (
      typeof answer.errorText === "string" &&
      answer.errorText !== "" &&
      answer.errorText !== "net::ERR_ABORTED"
    ) {
      throw new HttpError(
        502,
        "navigation_failed",
        `${url} could not be opened: ${answer.errorText}.`,
      );
    }
    await this.driver.waitForLoad(tabId, Math.max(0, deadline - this.now()));
  }

  /** Runs one of our lookup scripts; its throw is the caller's script_error. */
  private async helper(tabId: number, script: string): Promise<unknown> {
    let outcome: EvaluateOutcome;
    try {
      outcome = await this.driver.evaluate(tabId, script, {
        timeoutMs: this.timing.helperTimeoutMs,
      });
    } catch (err) {
      throw scriptError(err);
    }
    if ("reloaded" in outcome) {
      throw new HttpError(
        422,
        "script_error",
        "The page navigated while the element was being found; try again.",
      );
    }
    return outcome.value;
  }

  /** Measures around the action, answering the page's dialogs. */
  private async observed(
    tabId: number,
    opts: { noMonitor: boolean; acceptDialogs: boolean },
    act: () => Promise<ActOutcome>,
  ): Promise<BrowserExecResult> {
    const dialogs: BrowserDialog[] = [];
    const unwatch = await this.watchDialogs(tabId, opts.acceptDialogs, dialogs);
    try {
      const result = await this.measured(tabId, opts.noMonitor, act);
      if (dialogs.length > 0) result.dialogs = dialogs;
      return result;
    } finally {
      await unwatch();
    }
  }

  /**
   * Answers the page's dialogs while an action runs. An alert, confirm, prompt or leave-page
   * dialog blocks the page until someone answers it, and nobody is there to: so the tab's Page
   * events are on for the span of the action, an alert is accepted and the others dismissed
   * unless `accept`, and each is recorded. They go off again after.
   */
  private async watchDialogs(
    tabId: number,
    accept: boolean,
    into: BrowserDialog[],
  ): Promise<() => Promise<void>> {
    const stop = this.driver.onCdpEvent(tabId, (method, params) => {
      if (method !== DIALOG_EVENT) return;
      const type = DIALOG_TYPES.find((t) => t === params.type) ?? "alert";
      const accepted = type === "alert" || accept;
      const message = typeof params.message === "string" ? params.message : "";
      into.push({ type, message, accepted });
      const answer: Record<string, unknown> = { accept: accepted };
      if (accepted && type === "prompt" && typeof params.defaultPrompt === "string") {
        answer.promptText = params.defaultPrompt;
      }
      void this.driver.cdp(tabId, "Page.handleJavaScriptDialog", answer).catch(() => undefined);
    });
    const off = () =>
      this.driver
        .cdp(tabId, "Page.disable", {}, PAGE_EVENTS_TIMEOUT_MS, undefined, [DIALOG_EVENT])
        .then(
          () => undefined,
          () => undefined,
        );
    try {
      await this.driver.cdp(tabId, "Page.enable", {}, PAGE_EVENTS_TIMEOUT_MS, [DIALOG_EVENT]);
    } catch (err) {
      stop();
      // A blocked page takes the enable once it is free: the disable queues behind it.
      void off();
      if (tabGone(err)) throw err;
      return async () => {};
    }
    return async () => {
      await off();
      stop();
    };
  }

  /** The measuring around the action. */
  private async measured(
    tabId: number,
    noMonitor: boolean,
    act: () => Promise<ActOutcome>,
  ): Promise<BrowserExecResult> {
    const before = new Set(this.tabs.ids());
    const since = this.now();
    // Whether the monitor runs in the page the action starts on. Without it the result goes
    // unmeasured.
    let monitoring = false;
    if (!noMonitor) {
      try {
        const begin = await this.driver.evaluate(tabId, MONITOR_BEGIN_SCRIPT, {
          timeoutMs: this.timing.helperTimeoutMs,
        });
        monitoring = "value" in begin;
      } catch {
        // A page too busy to answer may still have started it; it is stopped below.
      }
      if (!monitoring) this.stopMonitor(tabId);
    }
    let outcome: ActOutcome;
    try {
      outcome = await act();
    } catch (err) {
      if (monitoring) this.stopMonitor(tabId);
      throw err;
    }
    let reloaded = outcome.reloaded === true;
    if (reloaded) await this.driver.waitForLoad(tabId, this.timing.reloadWaitMs);
    else await this.sleep(this.timing.settleMs);

    const newTabs = await this.newTabs(tabId, before, since);
    const result: BrowserExecResult = {
      status: outcome.ok ? "success" : "failed",
      tabId,
      ...(outcome.value !== undefined ? { value: outcome.value } : {}),
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    };
    if (newTabs.length > 0) result.newTabs = newTabs;
    if (monitoring && !reloaded) {
      let end: EvaluateOutcome | null = null;
      try {
        end = await this.driver.evaluate(tabId, MONITOR_END_SCRIPT, {
          timeoutMs: this.timing.helperTimeoutMs,
        });
      } catch {
        // Unmeasurable (the page is busy or gone): the result simply carries no measurements.
      }
      const measured = end !== null && "value" in end ? ((end.value ?? {}) as MonitorEnd) : null;
      if ((end !== null && "reloaded" in end) || measured?.lost === true) {
        // The document the monitor started in is gone: the action navigated after all.
        reloaded = true;
        await this.driver.waitForLoad(tabId, this.timing.reloadWaitMs);
      } else if (measured !== null) {
        result.transients = Array.isArray(measured.transients) ? measured.transients : [];
        if (newTabs.length === 0 && typeof measured.changed === "number") {
          result.diff = {
            changed: measured.changed,
            ...(typeof measured.topChange === "string" ? { topChange: measured.topChange } : {}),
          };
          if (measured.changed === 0 && result.transients.length === 0) {
            result.suggestion = NO_CHANGE_NOTE;
          }
        }
      }
    }
    if (reloaded) result.reloaded = true;
    return result;
  }

  /** Stops a monitor that will not be read (best effort: the page may be gone). */
  private stopMonitor(tabId: number): void {
    void this.driver
      .evaluate(tabId, MONITOR_STOP_SCRIPT, { timeoutMs: this.timing.helperTimeoutMs })
      .catch(() => undefined);
  }

  /**
   * The tabs an action opened: the popups its tab asked for since it started (each given a
   * moment to be claimed, so it has an id), plus any tab that appeared meanwhile.
   */
  private async newTabs(
    tabId: number,
    before: ReadonlySet<number>,
    since: number,
  ): Promise<{ id: number; url: string }[]> {
    const found = new Map<number, string>();
    for (const request of this.tabs.opensFrom(tabId, since)) {
      const id =
        request.claimedTabId ??
        (await this.tabs.waitForClaim(request.requestId, this.timing.popupClaimMs));
      if (id !== null) found.set(id, this.tabs.get(id)?.url || request.url);
    }
    for (const tab of this.tabs.list()) {
      if (!before.has(tab.id) && !found.has(tab.id)) found.set(tab.id, tab.url);
    }
    return [...found].map(([id, url]) => ({ id, url }));
  }
}
