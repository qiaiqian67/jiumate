/**
 * AI companion mode — global UI state.
 *
 * One React context, hydrated once at app root (mounted in `app-layout.tsx`): every
 * companion surface (banner, right widget, Electron floating window) reads the same
 * `placement` value, so flipping it in Settings updates every visible pet on the next
 * render without a reload. `placement === null` means the prefs request is still in
 * flight; UI surfaces treat that as "off" so an unhydrated user never sees a
 * companion they didn't ask for.
 *
 * The companion-mode string catalog carries four labels (off/banner/widget/floating)
 * rendered by the 4-segment picker; the store here is just state + persistence.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as api from "../../api/endpoints";

/** Mirrors the server-side `CompanionPlacement` union (`packages/server/src/api/types.ts`)
 *  — the same four strings the user picks from in Settings → General. Defined here too
 *  because importing server's `api/types` from the renderer pulls in Hono / Node-only
 *  modules; the runtime shape is verified by `companion-banner-helpers.test.ts` plus
 *  the existing server gate. */
export type CompanionPlacement = "off" | "banner" | "widget" | "floating";

/** Canonical ordering — the Settings row iterates this directly so the UI order matches
 *  the user's expectation (off → most subtle → most visible). */
export const COMPANION_PLACEMENTS: readonly CompanionPlacement[] = [
  "off",
  "banner",
  "widget",
  "floating",
];

/** Mirrors `CompanionPronoun` on the server (`packages/server/src/api/types.ts`).
 *  Closed list — adding a value here is also adding it to the server enum. */
export type CompanionPronoun = "he" | "she" | "they" | "it";
export const COMPANION_PRONOUNS: readonly CompanionPronoun[] = ["he", "she", "they", "it"];

/** Mirrors `CompanionTtsProvider` on the server. "off" = never speak, the safe
 *  default; "webspeech" = browser/Electron `speechSynthesis`. ElevenLabs /
 *  OpenAI / Kokoro land in later phases via the provider-impl registry under
 *  `companion-tts/`. */
export type CompanionTtsProvider = "off" | "webspeech";
export const COMPANION_TTS_PROVIDERS: readonly CompanionTtsProvider[] = ["off", "webspeech"];

/** Mirrors `CompanionAsrProvider` on the server. "off" = no mic button (the
 *  safe default); "webspeech" = `SpeechRecognition` via Chromium, tap-to-talk.
 *  Whisper / OpenAI Transcribe land in later phases through the same
 *  registry indirection under `companion-asr/`. */
export type CompanionAsrProvider = "off" | "webspeech";
export const COMPANION_ASR_PROVIDERS: readonly CompanionAsrProvider[] = ["off", "webspeech"];

/** Mirrors `CompanionAvatarRenderer` on the server (L.6). "svg" is the safe
 *  default — every existing user keeps the 2D fox on every surface until
 *  they opt in. "live2d" swaps in a pseudo-3D Cubism model behind the same
 *  `<CompanionPet>` swap point; the runtime auto-degrades to "svg" when
 *  WebGL is unavailable (a setting row never lands on a broken canvas). */
export type CompanionAvatarRenderer = "svg" | "live2d";
export const COMPANION_AVATAR_RENDERERS: readonly CompanionAvatarRenderer[] = ["svg", "live2d"];

/** Mirrors `CompanionAvatarPreset` on the server (L.6). Closed list of the
 *  built-in Cubism SDK sample models the runtime knows how to resolve. The
 *  Settings picker iterates this list; the server-side gate uses it to reject
 *  unknown ids. */
export type CompanionAvatarPreset = "hiyori" | "mark" | "mao";
export const COMPANION_AVATAR_PRESETS: readonly CompanionAvatarPreset[] = ["hiyori", "mark", "mao"];

/** Two-element tuple for the Electron floating window. Kept inline rather than imported
 *  because no other surface in the web app needs it. */
export interface FloatingPosition {
  x: number;
  y: number;
}

export interface CompanionStoreValue {
  /** Hydrated placement; `null` only between mount and the first prefs fetch. */
  placement: CompanionPlacement | null;
  /** Persisted position of the Electron floating pet. `null` when no position has
   *  been saved yet (the user has never placed the pet, or never enabled floating). */
  floatingPosition: FloatingPosition | null;
  /** Display name the user picked in the companion-specific settings page. Empty
   *  string when unset — callers render their own default greeting. */
  name: string;
  /** Self-referential pronoun. Defaults to "they" when unset (a neutral default
   *  rather than picking one side). */
  pronoun: CompanionPronoun;
  /** Idle-threshold in milliseconds before the companion may proactively speak.
   *  0 means "never proactive". The proactive-trigger hook reads this through the
   *  same store; the value reaches LLM in a later phase. */
  proactiveTimeoutMs: number;
  /** TTS provider for the floating pet. "off" silences the pet regardless of
   *  voice; "webspeech" reads bubble text aloud via the system TTS. */
  ttsProvider: CompanionTtsProvider;
  /** Voice id picked from the provider's voice list. Empty string means "use the
   *  provider default" (the Web Speech impl picks the first locale-matching
   *  voice). */
  ttsVoice: string;
  /** ASR provider for the chat composer. "off" hides the mic button entirely. */
  asrProvider: CompanionAsrProvider;
  /** Avatar renderer (L.6). "svg" = existing 2D fox, "live2d" = pseudo-3D
   *  Cubism model. Size-gated inside `<CompanionPet>`: sm (36 px banner)
   *  always renders SVG regardless of this value, so the visual quality at
   *  small sizes never regresses. */
  avatarRenderer: CompanionAvatarRenderer;
  /** Live2D preset id, only meaningful when `avatarRenderer === "live2d"`.
   *  Defaults to "hiyori" on hydration so a user who flips the renderer on
   *  before opening the picker still sees a model. */
  avatarPreset: CompanionAvatarPreset;
  /** Update the placement and persist. Synchronous local update so the UI responds
   *  on the same tick; the putPrefs write is fire-and-forget. */
  setPlacement: (next: CompanionPlacement) => void;
  /** Update the floating-window position and persist. Called on `mouseup` of a drag,
   *  not on every mousemove frame. */
  setFloatingPosition: (pos: FloatingPosition | null) => void;
  setName: (next: string) => void;
  setPronoun: (next: CompanionPronoun) => void;
  /** Rounded to whole milliseconds by the server. The picker sends minute-resolution
   *  values; the store keeps the same number the server has. */
  setProactiveTimeoutMs: (next: number) => void;
  setTtsProvider: (next: CompanionTtsProvider) => void;
  setTtsVoice: (next: string) => void;
  setAsrProvider: (next: CompanionAsrProvider) => void;
  setAvatarRenderer: (next: CompanionAvatarRenderer) => void;
  setAvatarPreset: (next: CompanionAvatarPreset) => void;
}

const CompanionContext = createContext<CompanionStoreValue | null>(null);

/** Pick a placement out of a freshly-fetched prefs record. The legacy boolean is
 *  honoured here (without writing back) so a user who opted in before the enum
 *  refactor keeps seeing the banner until they pick something else.
 *
 *  Exported (rather than kept private) so the unit test under `web/test/` can pin the
 *  legacy-compat precedence without rendering React or stubbing the api module. */
export function placementFromPrefs(prefs: {
  companionPlacement?: unknown;
  companionModeEnabled?: unknown;
}): CompanionPlacement | null {
  const p = prefs.companionPlacement;
  if (p === "off" || p === "banner" || p === "widget" || p === "floating") return p;
  if (prefs.companionModeEnabled === true) return "banner";
  return null;
}

/** Hydrate the three new companion-specific fields. Each has its own sane default so
 *  a brand-new user (or one whose prefs predates this phase) gets neutral behaviour
 *  rather than a missing-field error. Exported for the unit test alongside
 *  `placementFromPrefs`. */
export function companionIdentityFromPrefs(prefs: {
  companionName?: unknown;
  companionPronoun?: unknown;
  companionProactiveTimeoutMs?: unknown;
}): { name: string; pronoun: CompanionPronoun; proactiveTimeoutMs: number } {
  const name = typeof prefs.companionName === "string" ? (prefs.companionName as string) : "";
  const pronoun: CompanionPronoun =
    prefs.companionPronoun === "he" ||
    prefs.companionPronoun === "she" ||
    prefs.companionPronoun === "they" ||
    prefs.companionPronoun === "it"
      ? prefs.companionPronoun
      : "they";
  const proactiveTimeoutMs =
    typeof prefs.companionProactiveTimeoutMs === "number" &&
    Number.isFinite(prefs.companionProactiveTimeoutMs)
      ? (prefs.companionProactiveTimeoutMs as number)
      : 0;
  return { name, pronoun, proactiveTimeoutMs };
}

/** Hydrate the TTS fields (L.4). "off" is the safe default — a user who never
 *  opens the new TTS row gets a silent pet, identical to the pre-L.4 behaviour. */
export function companionTtsFromPrefs(prefs: {
  companionTtsProvider?: unknown;
  companionTtsVoice?: unknown;
}): { provider: CompanionTtsProvider; voice: string } {
  const provider: CompanionTtsProvider =
    prefs.companionTtsProvider === "webspeech" ? "webspeech" : "off";
  const voice = typeof prefs.companionTtsVoice === "string" ? prefs.companionTtsVoice : "";
  return { provider, voice };
}

/** Hydrate the ASR field (L.5). "off" hides the mic button — the safe default
 *  for a brand-new user (or one whose prefs predates this phase). */
export function companionAsrFromPrefs(prefs: { companionAsrProvider?: unknown }): {
  provider: CompanionAsrProvider;
} {
  const provider: CompanionAsrProvider =
    prefs.companionAsrProvider === "webspeech" ? "webspeech" : "off";
  return { provider };
}

/** Hydrate the avatar fields (L.6). The renderer mirrors `CompanionAvatarRenderer`
 *  closed-enum on the server: anything other than "svg" / "live2d" falls back to
 *  "svg" so a hand-crafted prefs row never lands the user on an unknown
 *  renderer. The preset mirrors `CompanionAvatarPreset` closed list; unknown
 *  ids fall back to "hiyori" so a future preset removed from the catalog
 *  still resolves to a working model.
 *
 *  Renderer and preset are independent on purpose: a user can flip the
 *  renderer on before picking a preset, and the runtime is happy with the
 *  "hiyori" default. */
export function companionAvatarFromPrefs(prefs: {
  companionAvatarRenderer?: unknown;
  companionAvatarPreset?: unknown;
}): { renderer: CompanionAvatarRenderer; preset: CompanionAvatarPreset } {
  const renderer: CompanionAvatarRenderer =
    prefs.companionAvatarRenderer === "live2d" ? "live2d" : "svg";
  const preset: CompanionAvatarPreset =
    prefs.companionAvatarPreset === "hiyori" ||
    prefs.companionAvatarPreset === "mark" ||
    prefs.companionAvatarPreset === "mao"
      ? prefs.companionAvatarPreset
      : "hiyori";
  return { renderer, preset };
}

export function CompanionProvider({ children }: { children: ReactNode }) {
  const [placement, setPlacementState] = useState<CompanionPlacement | null>(null);
  const [floatingPosition, setFloatingPositionState] = useState<FloatingPosition | null>(null);
  const [name, setNameState] = useState<string>("");
  const [pronoun, setPronounState] = useState<CompanionPronoun>("they");
  const [proactiveTimeoutMs, setProactiveTimeoutMsState] = useState<number>(0);
  const [ttsProvider, setTtsProviderState] = useState<CompanionTtsProvider>("off");
  const [ttsVoice, setTtsVoiceState] = useState<string>("");
  const [asrProvider, setAsrProviderState] = useState<CompanionAsrProvider>("off");
  const [avatarRenderer, setAvatarRendererState] = useState<CompanionAvatarRenderer>("svg");
  const [avatarPreset, setAvatarPresetState] = useState<CompanionAvatarPreset>("hiyori");

  useEffect(() => {
    let cancelled = false;
    void api
      .getPrefs()
      .then((res) => {
        if (cancelled) return;
        setPlacementState(placementFromPrefs(res.prefs));
        const f = res.prefs.companionFloatingPosition;
        if (
          f !== null &&
          typeof f === "object" &&
          typeof (f as { x?: unknown }).x === "number" &&
          typeof (f as { y?: unknown }).y === "number"
        ) {
          setFloatingPositionState({ x: (f as { x: number }).x, y: (f as { y: number }).y });
        }
        const identity = companionIdentityFromPrefs(res.prefs);
        setNameState(identity.name);
        setPronounState(identity.pronoun);
        setProactiveTimeoutMsState(identity.proactiveTimeoutMs);
        const tts = companionTtsFromPrefs(res.prefs);
        setTtsProviderState(tts.provider);
        setTtsVoiceState(tts.voice);
        const asr = companionAsrFromPrefs(res.prefs);
        setAsrProviderState(asr.provider);
        const avatar = companionAvatarFromPrefs(res.prefs);
        setAvatarRendererState(avatar.renderer);
        setAvatarPresetState(avatar.preset);
      })
      .catch(() => {
        // Unreachable prefs: opt-out, same as every other settings row. The Settings
        // dialog does its own hydrate for the picker; this global store exists for
        // surfaces that need to react across the app.
        if (!cancelled) setPlacementState("off");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<CompanionStoreValue>(
    () => ({
      placement,
      floatingPosition,
      name,
      pronoun,
      proactiveTimeoutMs,
      ttsProvider,
      ttsVoice,
      asrProvider,
      avatarRenderer,
      avatarPreset,
      setPlacement: (next) => {
        setPlacementState(next);
        // We do NOT clear `companionFloatingPosition` when leaving "floating": the
        // shallow-merge on PUT cannot delete keys, so sending
        // `companionFloatingPosition: undefined` would persist `undefined` into the
        // JSON. Instead we keep the last known position around (< 50 bytes) and reuse
        // it the next time the user re-enables floating.
        void api.putPrefs({ companionPlacement: next }).catch(() => undefined);
      },
      setFloatingPosition: (pos) => {
        setFloatingPositionState(pos);
        // The server-side `UiPrefs.companionFloatingPosition` is typed as
        // `{x,y} | undefined`, not nullable: a true `null` would round-trip into the
        // persisted JSON as `"null"` and pollute the file. The store never needs to
        // clear the saved position anyway — the floating window always has a position
        // when open, and we keep the last known one for re-enable.
        if (pos !== null) {
          void api.putPrefs({ companionFloatingPosition: pos }).catch(() => undefined);
        }
      },
      setName: (next) => {
        // Trim client-side so the server-side bound sees a normalized value. The
        // settings input accepts a 40-char string; empty means "use default greeting".
        const trimmed = next.trim().slice(0, 40);
        setNameState(trimmed);
        void api.putPrefs({ companionName: trimmed }).catch(() => undefined);
      },
      setPronoun: (next) => {
        setPronounState(next);
        void api.putPrefs({ companionPronoun: next }).catch(() => undefined);
      },
      setProactiveTimeoutMs: (next) => {
        setProactiveTimeoutMsState(next);
        void api.putPrefs({ companionProactiveTimeoutMs: next }).catch(() => undefined);
      },
      setTtsProvider: (next) => {
        setTtsProviderState(next);
        void api.putPrefs({ companionTtsProvider: next }).catch(() => undefined);
      },
      setTtsVoice: (next) => {
        // Trim + length-cap client-side so the server-side bound sees a normalized
        // value. Empty string clears the override (provider default).
        const trimmed = next.trim().slice(0, 64);
        setTtsVoiceState(trimmed);
        void api.putPrefs({ companionTtsVoice: trimmed }).catch(() => undefined);
      },
      setAsrProvider: (next) => {
        setAsrProviderState(next);
        void api.putPrefs({ companionAsrProvider: next }).catch(() => undefined);
      },
      setAvatarRenderer: (next) => {
        setAvatarRendererState(next);
        void api.putPrefs({ companionAvatarRenderer: next }).catch(() => undefined);
      },
      setAvatarPreset: (next) => {
        setAvatarPresetState(next);
        void api.putPrefs({ companionAvatarPreset: next }).catch(() => undefined);
      },
    }),
    [
      placement,
      floatingPosition,
      name,
      pronoun,
      proactiveTimeoutMs,
      ttsProvider,
      ttsVoice,
      asrProvider,
      avatarRenderer,
      avatarPreset,
    ],
  );

  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}

/** Read companion-mode state from the nearest provider. Returns a sane default (`off`)
 *  if no provider is mounted (useful for components that may render before app shell,
 *  e.g. storybook / isolated tests). */
export function useCompanionStore(): CompanionStoreValue {
  const ctx = useContext(CompanionContext);
  return (
    ctx ?? {
      placement: null,
      floatingPosition: null,
      name: "",
      pronoun: "they",
      proactiveTimeoutMs: 0,
      ttsProvider: "off",
      ttsVoice: "",
      asrProvider: "off",
      avatarRenderer: "svg",
      avatarPreset: "hiyori",
      setPlacement: () => undefined,
      setFloatingPosition: () => undefined,
      setName: () => undefined,
      setPronoun: () => undefined,
      setProactiveTimeoutMs: () => undefined,
      setTtsProvider: () => undefined,
      setTtsVoice: () => undefined,
      setAsrProvider: () => undefined,
      setAvatarRenderer: () => undefined,
      setAvatarPreset: () => undefined,
    }
  );
}

/** `true` when running in the Vite dev server (no Electron shell). Used by the
 *  Settings row to grey out the "Floating" option with a tooltip explaining the
 *  window can only open from the desktop client. */
export function isDevBuild(): boolean {
  return import.meta.env.DEV === true;
}
