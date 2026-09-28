/**
 * Standalone pet window page (Electron pet window).
 *
 * Loads with no chrome — the host `BrowserWindow` is already frameless and
 * transparent — and lays out a bottom-right dock: the speech-bubble stack to the
 * left, the pet to the right. The window is content-sized, so this page measures
 * what it needs and reports it back over `window.pet.resize`; the shell grows the
 * window up and to the left, keeping the corner the pet is parked in.
 *
 * Mirrors OpenBitFun's `AgentCompanionDesktopPet`, which is also where the three
 * non-obvious decisions here come from:
 *
 *   - Hover and "look at the cursor" are POLLED, not driven by pointer events. A
 *     window that does not have focus receives no pointer events at all, and the
 *     pet spends its life unfocused, so the shell is asked where the cursor is.
 *   - A press that travels less than `DRAG_THRESHOLD_PX` is a click, not a drag —
 *     otherwise every attempt to bring the app forward would nudge the pet.
 *   - Menus are anchored by their distance from the window's bottom-right corner,
 *     because that corner is what stays put when the window grows to fit them.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { PetBubble } from "./pet-bubble";
import { PetMenu, menuAnchorFromEvent, type PetMenuAnchor, type PetMenuItem } from "./pet-menu";
import { PetPet, type PetAction, type PetMood } from "./pet-pet";
import { PetProvider, usePetStore } from "./pet-store";
import {
  aggregatePetMood,
  requestPetSync,
  sendPetCommand,
  subscribePetActivity,
  type PetActivityPayload,
  type PetTaskState,
  type PetTaskStatus,
} from "./pet-activity";
import { getPetLookDirection } from "./pet-look";
import { resolvePetById } from "./pet-service";
import type { PetPackage } from "@prismshadow/jiumate-pets";

/** Pet footprint at scale 1. Mirrors `PET_WINDOW_BASE_*` in packages/desktop/src/pet-window.ts. */
const PET_BASE_WIDTH = 96;
const PET_BASE_HEIGHT = 104;
/** Bubble column, and the gap between it and the pet. */
const BUBBLE_WIDTH = 180;
const BUBBLE_GAP = 8;
/** Stacked bubbles share the window; one bubble simply matches the pet's height. */
const BUBBLE_STACK_ROW = 76;
const BUBBLE_STACK_GAP = 4;
/** The composer needs room the plain bubble body does not. */
const BUBBLE_COMPOSER_ROW = 116;
/** The shell clamps the window to this, so the bubble must fit in what is left. */
const WINDOW_MAX_WIDTH = 360;
const WINDOW_MAX_HEIGHT = 240;
/** Floor for a squeezed bubble, so a large pet still leaves readable text. */
const BUBBLE_MIN_WIDTH = 132;
/** Marks `<html>` so the app-wide opaque page background can be switched off here. */
const PET_HOST_CLASS = "jiumate-pet-host";
/** A press that moves less than this is a click ("bring the app forward"), not a drag. */
const DRAG_THRESHOLD_PX = 8;
/** How often the shell is asked where the cursor is (see the file header). */
const CURSOR_POLL_MS = 120;
/** How long a reaction animation plays before the mood row takes over again. */
const REACTION_MS = 2600;

/** Dismissing a running bubble hides it only while the task runs; a later notice still gets through. */
function dismissBucket(state: PetTaskState): "active" | "notice" {
  return state === "running" || state === "waiting" ? "active" : "notice";
}

export function PetWindowPage() {
  return (
    <PetProvider>
      <PetWindowBody />
    </PetProvider>
  );
}

interface DragState {
  screenX: number;
  screenY: number;
  winX: number;
  winY: number;
  moved: boolean;
}

interface ComposerState {
  sessionId: string;
  value: string;
  busy: boolean;
}

function PetWindowBody() {
  const { prefs, hydrated, setPetWindowPosition, setEnablePet } = usePetStore();
  const [payload, setPayload] = useState<PetActivityPayload | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, "active" | "notice">>({});
  const [dragging, setDragging] = useState(false);
  const [dragDirection, setDragDirection] = useState<"left" | "right">("right");
  const [hovering, setHovering] = useState(false);
  const [look, setLook] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ items: PetMenuItem[]; anchor: PetMenuAnchor } | null>(null);
  const [composing, setComposing] = useState<ComposerState | null>(null);
  const [reaction, setReaction] = useState<PetAction>(null);
  const [pet, setPet] = useState<PetPackage | null>(null);

  const petRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const reactionRef = useRef<number | null>(null);
  const lastPayloadRef = useRef<{ sequence: number; emittedAt: number } | null>(null);
  const prevStatesRef = useRef<Map<string, PetTaskState>>(new Map());

  // The window is transparent, but the app-wide stylesheet paints `body` opaque
  // (`bg-white` / `dark:bg-gray-950`). Without this the pet sits on a white slab.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(PET_HOST_CLASS);
    return () => root.classList.remove(PET_HOST_CLASS);
  }, []);

  useEffect(() => {
    // The pet can be opened while a task is already running: without this handshake
    // its bubbles would stay empty until the next state change.
    requestPetSync();
  }, []);

  useEffect(
    () =>
      subscribePetActivity((incoming) => {
        const last = lastPayloadRef.current;
        if (last !== null) {
          if (incoming.emittedAt < last.emittedAt) return;
          if (incoming.emittedAt === last.emittedAt && incoming.sequence <= last.sequence) return;
        }
        lastPayloadRef.current = { sequence: incoming.sequence, emittedAt: incoming.emittedAt };
        setPayload(incoming);
      }),
    [],
  );

  useEffect(
    () => () => {
      if (reactionRef.current !== null) window.clearTimeout(reactionRef.current);
    },
    [],
  );

  // A dismissal only lasts while it still describes the task: a silenced running task
  // stays hidden, but once it needs attention or finishes, the bubble comes back.
  const tasks = useMemo(() => payload?.tasks ?? [], [payload]);
  useEffect(() => {
    setDismissed((previous) => {
      const next: Record<string, "active" | "notice"> = {};
      let changed = false;
      for (const task of tasks) {
        const bucket = previous[task.sessionId];
        if (bucket === undefined) continue;
        if (bucket === dismissBucket(task.state)) next[task.sessionId] = bucket;
        else changed = true;
      }
      if (!changed && Object.keys(next).length === Object.keys(previous).length) return previous;
      return next;
    });
  }, [tasks]);

  // Every tracked task gets a bubble; the stack scrolls when they do not all fit, rather
  // than dropping the oldest ones silently. The chat side already caps the list at
  // `PET_MAX_TRACKED_TASKS`, so this cannot grow without bound.
  const visibleTasks = useMemo(
    () => tasks.filter((task) => dismissed[task.sessionId] !== dismissBucket(task.state)),
    [tasks, dismissed],
  );

  // A reaction fires on a state change the user should notice, not on the state itself.
  useEffect(() => {
    const previous = prevStatesRef.current;
    const next = new Map<string, PetTaskState>();
    let action: PetAction = null;
    for (const task of visibleTasks) {
      next.set(task.sessionId, task.state);
      const before = previous.get(task.sessionId);
      if (before === undefined || before === task.state) continue;
      if (task.state === "attention") action = "waving";
      else if (task.state === "completed" || task.state === "failed") action = "jumping";
    }
    prevStatesRef.current = next;
    if (action === null) return;
    setReaction(action);
    if (reactionRef.current !== null) window.clearTimeout(reactionRef.current);
    reactionRef.current = window.setTimeout(() => {
      reactionRef.current = null;
      setReaction(null);
    }, REACTION_MS);
  }, [visibleTasks]);

  // Hover and look, polled — see the file header for why pointer events will not do.
  useEffect(() => {
    const bridge = window.pet;
    if (bridge === undefined) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const cursor = await bridge.cursor();
        const origin = await bridge.getPosition();
        if (cancelled) return;
        const element = petRef.current;
        if (element === null || origin === null) {
          setHovering(false);
          setLook(null);
        } else {
          const rect = element.getBoundingClientRect();
          const left = origin.x + rect.left;
          const top = origin.y + rect.top;
          const inside =
            cursor.x >= left &&
            cursor.x <= left + rect.width &&
            cursor.y >= top &&
            cursor.y <= top + rect.height;
          setHovering(inside);
          setLook(
            getPetLookDirection(
              cursor.x - (left + rect.width / 2),
              cursor.y - (top + rect.height / 2),
            ),
          );
        }
      } catch {
        // The window is going away; the next tick is never scheduled.
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), CURSOR_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  // The activity payload wins once it arrives: the chat window is where the pet and its
  // size get changed, and this window's own prefs fetch ran only at mount.
  const activePetId = payload === null ? prefs.activePetId : payload.petId;
  const scale = payload === null ? prefs.petWindowScale : payload.scale;

  useEffect(() => {
    if (!hydrated && payload === null) return;
    let cancelled = false;
    void resolvePetById(activePetId).then((resolved) => {
      if (!cancelled) setPet(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, activePetId, payload]);

  const petWidth = Math.round(PET_BASE_WIDTH * scale);
  const petHeight = Math.round(PET_BASE_HEIGHT * scale);
  const bubbleWidth = Math.max(
    BUBBLE_MIN_WIDTH,
    Math.min(BUBBLE_WIDTH, WINDOW_MAX_WIDTH - BUBBLE_GAP - petWidth),
  );
  const bubbleCount = visibleTasks.length;
  const bubbleRow = composing === null ? BUBBLE_STACK_ROW : BUBBLE_COMPOSER_ROW;
  const stackContent =
    bubbleCount === 0 ? 0 : bubbleCount * bubbleRow + (bubbleCount - 1) * BUBBLE_STACK_GAP;
  // Never shorter than the pet (a lone bubble matches its height) and never taller than the
  // shell's ceiling — past that the stack scrolls rather than growing the window further.
  // The height is handed to the stack inline because a percentage against the dock's
  // auto height resolves to auto, which left the stack overflowing the window unclipped.
  const stackHeight = Math.min(WINDOW_MAX_HEIGHT, Math.max(petHeight, stackContent));
  const windowWidth = bubbleCount === 0 ? petWidth : petWidth + BUBBLE_GAP + bubbleWidth;
  const windowHeight = bubbleCount === 0 ? petHeight : stackHeight;

  // Only the geometry is a dependency: the bubbles' text changes on every streamed
  // token and must not turn into an IPC round trip each time.
  useLayoutEffect(() => {
    const bridge = window.pet;
    if (bridge === undefined || !prefs.enablePet) return;
    void bridge.resize({ width: windowWidth, height: windowHeight }).catch(() => {
      // Best effort: a stale size only mis-crops the dock.
    });
  }, [windowWidth, windowHeight, prefs.enablePet]);

  const openSession = useCallback((sessionId: string) => {
    sendPetCommand({ kind: "open-session", sessionId });
    void window.pet?.focusMain();
  }, []);

  const dismissTask = useCallback((task: PetTaskStatus) => {
    setDismissed((previous) => ({ ...previous, [task.sessionId]: dismissBucket(task.state) }));
    sendPetCommand({ kind: "dismiss-task", sessionId: task.sessionId });
  }, []);

  const closePet = useCallback(() => {
    // Through the chat window: it owns the pref the open/close effect reads, and a
    // stale `enablePet: true` there would reopen the pet on the next prefs change.
    sendPetCommand({ kind: "disable-pet" });
    setEnablePet(false);
    void window.pet?.close();
  }, [setEnablePet]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bridge = window.pet;
    if (bridge === undefined) return;
    setMenu(null);
    const { screenX, screenY } = event;
    // Capture keeps the drag alive when the pointer leaves the tiny window, but it
    // throws when there is no active pointer for the id — never fatal to the drag.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Drag still works, it just ends if the pointer leaves the pet.
    }
    void bridge.getPosition().then((origin) => {
      if (origin === null) return;
      dragRef.current = { screenX, screenY, winX: origin.x, winY: origin.y, moved: false };
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const bridge = window.pet;
    if (drag === null || bridge === undefined) return;
    const dx = event.screenX - drag.screenX;
    const dy = event.screenY - drag.screenY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    setDragging(true);
    if (Math.abs(dx) > 3) setDragDirection(dx > 0 ? "right" : "left");
    void bridge.move({ x: drag.winX + dx, y: drag.winY + dy });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Nothing to release.
    }
    const bridge = window.pet;
    if (bridge === undefined) return;
    if (drag !== null && drag.moved) {
      // Persist on release only: a save per pointermove would PUT /api/me/prefs
      // dozens of times per drag.
      void bridge.getPosition().then((origin) => {
        if (origin !== null) setPetWindowPosition(origin);
      });
      return;
    }
    void bridge.focusMain();
  };

  const openPetMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setMenu({
      anchor: menuAnchorFromEvent(event),
      items: [
        {
          key: "switch-pet",
          label: S.pet.menuSwitchPet,
          onSelect: () => sendPetCommand({ kind: "open-pet-settings" }),
        },
        { key: "close-pet", label: S.pet.menuClosePet, danger: true, onSelect: closePet },
      ],
    });
  };

  const openBubbleMenu = (event: ReactMouseEvent<HTMLDivElement>, sessionId: string) => {
    event.preventDefault();
    const task = visibleTasks.find((candidate) => candidate.sessionId === sessionId);
    if (task === undefined) return;
    setMenu({
      anchor: menuAnchorFromEvent(event),
      items: [
        {
          key: "close-bubble",
          label: S.pet.menuCloseBubble,
          onSelect: () => dismissTask(task),
        },
      ],
    });
  };

  const submitComposer = useCallback(async () => {
    const state = composing;
    if (state === null || state.busy) return;
    const text = state.value.trim();
    if (text === "") return;
    setComposing({ ...state, busy: true });
    try {
      // Straight to the task endpoint. The chat window's composer pipeline (drafts,
      // staged skills, attachments, goal budget) is deliberately not involved: the pet
      // sends one line of text, and anything richer belongs in the app itself.
      await api.postTask(state.sessionId, { input: [{ type: "text", text }] });
      setComposing(null);
    } catch {
      // Keep the text so the send can be retried after fixing whatever failed.
      setComposing((current) => (current === null ? null : { ...current, busy: false }));
    }
  }, [composing]);

  if (!prefs.enablePet) return null;

  const mood: PetMood = dragging ? "dragging" : hovering ? "hover" : aggregatePetMood(visibleTasks);
  const failed = visibleTasks.some((task) => task.state === "failed");
  const action: PetAction = dragging ? null : failed ? "failed" : reaction;

  return (
    <div
      className="jiumate-pet-window"
      style={{ width: windowWidth, height: windowHeight } as CSSProperties}
    >
      <div className="jiumate-pet-window__dock">
        {bubbleCount === 0 ? null : (
          <div
            className="jiumate-pet-window__bubbles"
            style={{ width: bubbleWidth, height: stackHeight }}
          >
            {visibleTasks.map((task) => (
              <PetBubble
                key={task.sessionId}
                task={task}
                single={bubbleCount === 1}
                composing={composing?.sessionId === task.sessionId}
                composer={{
                  value: composing?.sessionId === task.sessionId ? composing.value : "",
                  busy: composing?.busy ?? false,
                  onValueChange: (value) =>
                    setComposing((current) => (current === null ? null : { ...current, value })),
                  onSubmit: () => void submitComposer(),
                  onCancel: () => setComposing(null),
                }}
                onOpenSession={openSession}
                onOpenComposer={(sessionId) => setComposing({ sessionId, value: "", busy: false })}
                onContextMenu={openBubbleMenu}
              />
            ))}
          </div>
        )}
        <div
          ref={petRef}
          className="jiumate-pet-window__pet-hitbox"
          style={{ width: petWidth, height: petHeight }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={openPetMenu}
        >
          <PetPet mood={mood} dragDirection={dragDirection} action={action} pet={pet} look={look} />
        </div>
      </div>
      {menu === null ? null : (
        <PetMenu items={menu.items} anchor={menu.anchor} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
