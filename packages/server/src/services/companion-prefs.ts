/**
 * Bounds on `ui_prefs.companionName`, `companionPronoun`, and `companionProactiveTimeoutMs`.
 *
 * Same motivation as `services/draft-shortcuts.ts`: ui_prefs is free-form JSON whose
 * every other known key is a flag or an id, and these three companion prefs are the
 * first one shipped that carries user-authored text (`companionName`). Without a
 * bound a single PUT could dump a large blob into the per-user TEXT column, so the
 * server clamps on write — the Web App also clamps client-side so the user sees a
 * counter before they hit submit, but a request that bypasses the editor is still
 * bounded here.
 *
 * The numbers:
 * - name length 40 — same as a draft-shortcut title; long enough for "我的小狐狸朋
 *   友" (six CJK glyphs), short enough that the banner / widget never wraps.
 * - proactive timeout 60 minutes — beyond that the throttle is "never" (0), and the
 *   realistic floor of "not nagging" is at least one minute (60_000 ms). Anything
 *   shorter than a minute makes the hook fire while the user is mid-keystroke.
 */
import { HttpError } from "../http/errors.js";
import type {
  CompanionAsrProvider,
  CompanionAvatarPreset,
  CompanionAvatarRenderer,
  CompanionAvatarVrmPreset,
  CompanionPronoun,
  CompanionTtsProvider,
} from "../api/types.js";
import {
  COMPANION_ASR_PROVIDERS,
  COMPANION_AVATAR_PRESETS,
  COMPANION_AVATAR_RENDERERS,
  COMPANION_AVATAR_VRM_PRESETS,
  COMPANION_PRONOUNS,
  COMPANION_TTS_PROVIDERS,
} from "../api/types.js";

export const COMPANION_NAME_MAX = 40;
/** Floor of `companionProactiveTimeoutMs`: 60s = "ask me at most once a minute". */
export const COMPANION_PROACTIVE_TIMEOUT_MIN_MS = 60_000;
/** Ceiling: 60 minutes = "at most once an hour" so the user is not nagged through the day. */
export const COMPANION_PROACTIVE_TIMEOUT_MAX_MS = 3_600_000;
/** Voice ids are opaque provider-specific strings (Web Speech uses voiceURI,
 *  other providers will use their own ids). 64 chars is enough for any of them
 *  while still bounding the prefs row. */
export const COMPANION_TTS_VOICE_MAX = 64;

function invalid(message: string): HttpError {
  return new HttpError(400, "invalid_companion_prefs", message);
}

/** Validate (and normalize) an incoming `companionName`. Returns the trimmed name, or
 *  the empty string when the caller intends to clear the name (the picker uses an
 *  empty input as "use the default greeting"). */
export function validateCompanionName(value: unknown): string {
  if (typeof value !== "string") throw invalid("companionName must be a string.");
  const trimmed = value.trim();
  if (trimmed.length > COMPANION_NAME_MAX) {
    throw invalid(`companionName must be at most ${COMPANION_NAME_MAX} characters.`);
  }
  return trimmed;
}

/** Validate (and normalize) an incoming `companionPronoun`. */
export function validateCompanionPronoun(value: unknown): CompanionPronoun {
  if (typeof value !== "string") throw invalid("companionPronoun must be a string.");
  if (!(COMPANION_PRONOUNS as readonly string[]).includes(value)) {
    throw invalid(`companionPronoun must be one of ${COMPANION_PRONOUNS.join(", ")}.`);
  }
  return value as CompanionPronoun;
}

/** Validate (and clamp) an incoming `companionProactiveTimeoutMs`. Zero is a legal
 *  value meaning "never proactive" — distinct from "unset" because the Web App sends
 *  a zero when the slider is dragged to its leftmost stop. */
export function validateCompanionProactiveTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid("companionProactiveTimeoutMs must be a finite number.");
  }
  if (value === 0) return 0;
  if (value < COMPANION_PROACTIVE_TIMEOUT_MIN_MS) {
    throw invalid(
      `companionProactiveTimeoutMs must be 0 or at most ${COMPANION_PROACTIVE_TIMEOUT_MIN_MS} ms.`,
    );
  }
  if (value > COMPANION_PROACTIVE_TIMEOUT_MAX_MS) {
    throw invalid(
      `companionProactiveTimeoutMs must be at most ${COMPANION_PROACTIVE_TIMEOUT_MAX_MS} ms.`,
    );
  }
  return Math.round(value);
}

/** Validate (and normalize) an incoming `companionTtsProvider`. */
export function validateCompanionTtsProvider(value: unknown): CompanionTtsProvider {
  if (typeof value !== "string") throw invalid("companionTtsProvider must be a string.");
  if (!(COMPANION_TTS_PROVIDERS as readonly string[]).includes(value)) {
    throw invalid(`companionTtsProvider must be one of ${COMPANION_TTS_PROVIDERS.join(", ")}.`);
  }
  return value as CompanionTtsProvider;
}

/** Validate (and normalize) an incoming `companionTtsVoice`. Empty string clears
 *  the voice override (the provider picks its own default). Otherwise trimmed
 *  and length-capped. */
export function validateCompanionTtsVoice(value: unknown): string {
  if (typeof value !== "string") throw invalid("companionTtsVoice must be a string.");
  const trimmed = value.trim();
  if (trimmed.length > COMPANION_TTS_VOICE_MAX) {
    throw invalid(`companionTtsVoice must be at most ${COMPANION_TTS_VOICE_MAX} characters.`);
  }
  return trimmed;
}

/** Validate (and normalize) an incoming `companionAsrProvider`. Same closed-
 *  enum pattern as `validateCompanionTtsProvider`. */
export function validateCompanionAsrProvider(value: unknown): CompanionAsrProvider {
  if (typeof value !== "string") throw invalid("companionAsrProvider must be a string.");
  if (!(COMPANION_ASR_PROVIDERS as readonly string[]).includes(value)) {
    throw invalid(`companionAsrProvider must be one of ${COMPANION_ASR_PROVIDERS.join(", ")}.`);
  }
  return value as CompanionAsrProvider;
}

/** Validate (and normalize) an incoming `companionAvatarRenderer` (L.6).
 *  Closed-enum: anything other than "svg" / "live2d" / "vrm" is a 400. The
 *  client silently degrades to "svg" on WebGL failure — that flip lives in
 *  the web store, not in this gate. */
export function validateCompanionAvatarRenderer(value: unknown): CompanionAvatarRenderer {
  if (typeof value !== "string") throw invalid("companionAvatarRenderer must be a string.");
  if (!(COMPANION_AVATAR_RENDERERS as readonly string[]).includes(value)) {
    throw invalid(
      `companionAvatarRenderer must be one of ${COMPANION_AVATAR_RENDERERS.join(", ")}.`,
    );
  }
  return value as CompanionAvatarRenderer;
}

/** Validate (and normalize) an incoming `companionAvatarPreset` (L.6). The
 *  preset catalog lives in
 *  `packages/web/src/features/chat/companion-live2d/manifest.ts`; server and
 *  client keep this closed list in sync, so an unknown id here is rejected
 *  rather than stored (which would otherwise leave the runtime trying to
 *  resolve a model URL it cannot find). */
export function validateCompanionAvatarPreset(value: unknown): CompanionAvatarPreset {
  if (typeof value !== "string") throw invalid("companionAvatarPreset must be a string.");
  if (!(COMPANION_AVATAR_PRESETS as readonly string[]).includes(value)) {
    throw invalid(`companionAvatarPreset must be one of ${COMPANION_AVATAR_PRESETS.join(", ")}.`);
  }
  return value as CompanionAvatarPreset;
}

/** Validate (and normalize) an incoming `companionAvatarVrmPreset` (L.6).
 *  Parallel to `validateCompanionAvatarPreset`, but for the VRM catalog —
 *  the Live2D and VRM id spaces are kept disjoint so each catalog can
 *  evolve independently. Server and client keep this closed list in
 *  sync, so an unknown id here is rejected rather than stored. */
export function validateCompanionAvatarVrmPreset(value: unknown): CompanionAvatarVrmPreset {
  if (typeof value !== "string") throw invalid("companionAvatarVrmPreset must be a string.");
  if (!(COMPANION_AVATAR_VRM_PRESETS as readonly string[]).includes(value)) {
    throw invalid(
      `companionAvatarVrmPreset must be one of ${COMPANION_AVATAR_VRM_PRESETS.join(", ")}.`,
    );
  }
  return value as CompanionAvatarVrmPreset;
}
