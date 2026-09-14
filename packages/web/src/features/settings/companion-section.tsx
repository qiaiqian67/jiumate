/**
 * Companion-specific settings page (System settings → AI companion).
 *
 * Independent of the Agent workflow: this page edits the companion's own identity
 * and idle behaviour — name, pronoun, proactive interval — and never touches
 * anything that flows through the Agent State / Trace pipeline. The placement
 * picker stays on the General page because placement is a UI affordance, not a
 * piece of the persona.
 *
 * Layout follows the rest of the settings dialog: a stack of `PrefRow`s in a
 * `divide-y` container. The rows write through `useCompanionStore`, which both
 * updates local state and fires a fire-and-forget `putPrefs` — same pattern as
 * every other personal-pref row.
 */
import { S } from "../../lib/strings";
import { Segmented } from "../../components/ui/segmented";
import { PrefRow } from "./setting-row";
import { toastError } from "../../components/ui/toast";
import {
  useCompanionStore,
  type CompanionAsrProvider,
  type CompanionAvatarRenderer,
  type CompanionPronoun,
  type CompanionTtsProvider,
} from "../chat/companion-store";
import { useTts } from "../chat/companion-tts/use-tts";
import { listResolvedPresets, resolvePreset } from "../chat/companion-live2d/manifest";
import { PresetPreview } from "../chat/companion-live2d/preset-preview";

/** The five stops the proactive-interval slider snaps to. 0 = "Off" (never
 *  proactive); otherwise the value is minutes * 60_000. Bounded by
 *  `services/companion-prefs.ts` so any chosen stop is already inside the
 *  server-side cap. */
const PROACTIVE_STOPS_MIN: ReadonlyArray<{ label: string; minutes: number }> = [
  { label: S.settings.companionProactiveTimeoutOff, minutes: 0 },
  { label: S.settings.companionProactiveTimeout1m, minutes: 1 },
  { label: S.settings.companionProactiveTimeout5m, minutes: 5 },
  { label: S.settings.companionProactiveTimeout15m, minutes: 15 },
  { label: S.settings.companionProactiveTimeout30m, minutes: 30 },
  { label: S.settings.companionProactiveTimeout60m, minutes: 60 },
];

/** Snap a raw ms value to the nearest stop's minutes, then return the ms value the
 *  store will accept. Used when the persisted value was set by an older build (or
 *  hand-edited JSON) and does not exactly match a stop — we'd rather coerce than
 *  fail the PUT. Returns `0` for any non-positive input so the slider reliably
 *  lands on the Off segment. */
function snapProactiveTimeoutMs(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const minutes = raw / 60_000;
  let bestMinutes: number | undefined;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const stop of PROACTIVE_STOPS_MIN) {
    const diff = Math.abs(minutes - stop.minutes);
    if (diff < bestDiff) {
      bestMinutes = stop.minutes;
      bestDiff = diff;
    }
  }
  return (bestMinutes ?? 0) * 60_000;
}

export function CompanionSection() {
  const {
    name,
    setName,
    pronoun,
    setPronoun,
    proactiveTimeoutMs,
    setProactiveTimeoutMs,
    ttsProvider,
    setTtsProvider,
    ttsVoice,
    setTtsVoice,
    asrProvider,
    setAsrProvider,
    avatarRenderer,
    setAvatarRenderer,
    avatarPreset,
    setAvatarPreset,
  } = useCompanionStore();
  const tts = useTts();

  /** WebGL auto-fallback fired by `<CompanionLive2D>` when the runtime
   *  cannot create a WebGL context or load the `.moc3` asset. The store
   *  flips renderer → "svg" and the toast surfaces once per session so
   *  the user knows why the picker reset. */
  const onAvatarFallback = (reason: "no-webgl" | "load-failed"): void => {
    setAvatarRenderer("svg");
    toastError(S.settings.companionAvatarRendererFallbackToast);
    void reason;
  };

  const pronounOptions: ReadonlyArray<{ value: CompanionPronoun; label: string }> = [
    { value: "he", label: S.settings.companionPronounHe },
    { value: "she", label: S.settings.companionPronounShe },
    { value: "it", label: S.settings.companionPronounIt },
    { value: "they", label: S.settings.companionPronounThey },
  ];

  /** The slider's segments carry minute counts, not the raw ms the store keeps.
   *  Reading the current ms and rounding to the nearest minute keeps the
   *  highlight on the right stop after re-hydration. */
  const currentMinutes = proactiveTimeoutMs > 0 ? Math.round(proactiveTimeoutMs / 60_000) : 0;
  /** Match by minutes so a value that is technically a stop's ms-equivalent
   *  (e.g. 60_000) still lands on that stop rather than on whichever is first.
   *  `Segmented` keys off string, so the chosen stop's label doubles as the
   *  string key. Falls back to the first stop in the array — the array's
   *  length is asserted to be ≥ 1 at module load by the `companionPageTitle`
   *  catalog being non-empty, so the `!` is safe rather than a hidden assumption. */
  const matchedStop =
    PROACTIVE_STOPS_MIN.find((s) => s.minutes === currentMinutes) ?? PROACTIVE_STOPS_MIN[0]!;

  /** Proactive slider segments carry string keys (Segmented requires string T),
   *  but the store keeps raw ms. The `onChange` converts key → ms by looking up
   *  the matching stop. */
  const proactiveOptions = PROACTIVE_STOPS_MIN.map((s) => ({
    value: s.label,
    label: s.label,
  }));
  const onProactiveChange = (label: string): void => {
    const stop = PROACTIVE_STOPS_MIN.find((s) => s.label === label);
    if (stop !== undefined) setProactiveTimeoutMs(stop.minutes * 60_000);
  };

  /** TTS picker options. Static map so the labels come from the i18n catalog
   *  rather than the enum itself — the enum is a wire format, the labels are
   *  what the user reads. */
  const ttsProviderOptions: ReadonlyArray<{ value: CompanionTtsProvider; label: string }> = [
    { value: "off", label: S.settings.companionTtsProviderOff },
    { value: "webspeech", label: S.settings.companionTtsProviderWebspeech },
  ];

  /** ASR picker options — same shape as the TTS row. The composer only renders
   *  a mic button when the chosen provider is not "off"; turning it off
   *  immediately hides the button, no extra wiring needed. */
  const asrProviderOptions: ReadonlyArray<{ value: CompanionAsrProvider; label: string }> = [
    { value: "off", label: S.settings.companionAsrProviderOff },
    { value: "webspeech", label: S.settings.companionAsrProviderWebspeech },
  ];

  /** Avatar renderer picker (L.6). Two-segment picker mirroring the
   *  TTS/ASR shape; "svg" is the safe default (every existing user
   *  lands on it on hydration). Switching to "live2d" lazy-loads the
   *  pixi chunk via `<CompanionLive2D>` on the next render. */
  const avatarRendererOptions: ReadonlyArray<{
    value: CompanionAvatarRenderer;
    label: string;
  }> = [
    { value: "svg", label: S.settings.companionAvatarRendererSvg },
    { value: "live2d", label: S.settings.companionAvatarRendererLive2d },
  ];

  /** Preset catalog for the Live2D picker. `resolvePreset` falls back to
   *  `null` when the manifest is missing; the picker skips missing
   *  entries rather than rendering a broken row. */
  const presets = listResolvedPresets().filter((p) => resolvePreset(p.id) !== null);

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
      <PrefRow label={S.settings.companionNameLabel} info={S.settings.companionPageInfo}>
        <input
          type="text"
          maxLength={40}
          value={name}
          placeholder={S.settings.companionNamePlaceholder}
          onChange={(e) => setName(e.target.value)}
          aria-label={S.settings.companionNameLabel}
          className="w-56 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </PrefRow>
      <PrefRow label={S.settings.companionPronounLabel}>
        <Segmented<CompanionPronoun>
          options={pronounOptions}
          value={pronoun}
          onChange={setPronoun}
          cols={4}
        />
      </PrefRow>
      <PrefRow
        label={S.settings.companionProactiveTimeoutLabel}
        hint={S.settings.companionProactiveTimeoutHint}
      >
        <Segmented<string>
          options={proactiveOptions}
          value={matchedStop.label}
          onChange={onProactiveChange}
          cols={6}
        />
      </PrefRow>
      <PrefRow
        label={S.settings.companionTtsProviderLabel}
        info={S.settings.companionTtsProviderInfo}
      >
        <Segmented<CompanionTtsProvider>
          options={ttsProviderOptions}
          value={ttsProvider}
          onChange={setTtsProvider}
          cols={2}
        />
      </PrefRow>
      {ttsProvider === "webspeech" && (
        <PrefRow label={S.settings.companionTtsVoiceLabel}>
          {/* Native select: voice lists vary from a handful (headless test) to
              hundreds (macOS premium) and a Segmented control is not designed
              for that range. `ttsVoice === ""` is the explicit "follow system"
              option, distinct from "no voice selected", which we do not allow. */}
          <select
            value={ttsVoice}
            onChange={(e) => setTtsVoice(e.target.value)}
            aria-label={S.settings.companionTtsVoiceLabel}
            className="w-64 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">{S.settings.companionTtsVoiceDefault}</option>
            {tts.voices.length === 0 ? (
              <option value="" disabled>
                {S.settings.companionTtsVoiceEmpty}
              </option>
            ) : (
              tts.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))
            )}
          </select>
        </PrefRow>
      )}
      {/* ASR picker — mirrors the TTS row's 2-segment shape. Switching to "off"
          hides the composer's mic button on the next render (the button reads
          `asrProvider !== "off" && useAsr().available` and so hides itself). */}
      <PrefRow
        label={S.settings.companionAsrProviderLabel}
        info={S.settings.companionAsrProviderInfo}
      >
        <Segmented<CompanionAsrProvider>
          options={asrProviderOptions}
          value={asrProvider}
          onChange={setAsrProvider}
          cols={2}
        />
      </PrefRow>
      {/* Avatar (L.6): the renderer picker is always visible; the
          preset row only renders when the user has opted in to Live2D.
          The runtime's WebGL auto-fallback flips renderer back to "svg"
          when assets are missing or the host cannot run WebGL. */}
      <PrefRow
        label={S.settings.companionAvatarRendererLabel}
        info={S.settings.companionAvatarRendererInfo}
      >
        <Segmented<CompanionAvatarRenderer>
          options={avatarRendererOptions}
          value={avatarRenderer}
          onChange={setAvatarRenderer}
          cols={2}
        />
      </PrefRow>
      {avatarRenderer === "live2d" && presets.length > 0 && (
        <PrefRow
          label={S.settings.companionAvatarPresetLabel}
          info={S.settings.companionAvatarPresetInfo}
        >
          <div
            className="flex gap-2"
            role="radiogroup"
            aria-label={S.settings.companionAvatarPresetLabel}
          >
            {presets.map((p) => (
              <PresetPreview
                key={p.id}
                preset={p}
                selected={avatarPreset === p.id}
                onSelect={setAvatarPreset}
              />
            ))}
          </div>
        </PrefRow>
      )}
    </div>
  );
}

// Export the snap helper so the unit test under `web/test/` can pin the rounding
// behaviour without rendering React.
export const snapProactiveTimeoutMsForTest = snapProactiveTimeoutMs;
