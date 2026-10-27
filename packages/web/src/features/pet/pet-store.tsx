/**
 * Pet store: hydrate the per-user pet prefs from the server, expose
 * `enablePet`, `activePetId`, and `setPet` actions. Mirrors the watch + listener
 * pattern of the AI 伴侣 store it replaces.
 *
 * Real catalog data lives in `pet-catalog.ts` (separate React context, so the
 * Settings page can refresh it independently).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "../../api/endpoints";
import { subscribePrefsChanged } from "./prefs-events";
import type { UiPrefs } from "@jadelau/server/api";

export interface PetPrefs {
  enablePet: boolean;
  activePetId: string | null;
  petWindowPosition: { x: number; y: number } | null;
  /** Size multiplier for the floating pet window (1 = the shell's base footprint). */
  petWindowScale: number;
}

/** Scale bounds, mirrored by `validatePetPrefs` on the server. */
export const PET_SCALE_MIN = 0.5;
export const PET_SCALE_MAX = 2;
export const PET_SCALE_DEFAULT = 1;

/** The three sizes the settings picker offers, so the control stays a choice rather than a slider. */
export const PET_SCALE_CHOICES: readonly number[] = [0.75, 1, 1.5];

const DEFAULT_PREFS: PetPrefs = {
  enablePet: true,
  activePetId: "blue-golden",
  petWindowPosition: null,
  petWindowScale: PET_SCALE_DEFAULT,
};

/** Coerce anything the server (or an older client) hands back into a usable scale. */
export function clampScale(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return PET_SCALE_DEFAULT;
  return Math.min(Math.max(raw, PET_SCALE_MIN), PET_SCALE_MAX);
}

export interface PetStore {
  prefs: PetPrefs;
  hydrated: boolean;
  setEnablePet: (enabled: boolean) => void;
  setActivePetId: (id: string | null) => void;
  setPetWindowPosition: (pos: { x: number; y: number } | null) => void;
  setPetWindowScale: (scale: number) => void;
}

const PetContext = createContext<PetStore | null>(null);

export function PetProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<PetPrefs>(DEFAULT_PREFS);
  const [hydrated, setHydrated] = useState(false);
  const initial = useRef(true);

  /**
   * Read the prefs from the server. Also the handler for the `prefs_changed` announcement:
   * the `pet` tool changes these server-side, and without re-reading, a pet switched from a
   * conversation would only show up after a reload.
   */
  const hydrate = useCallback(async () => {
    try {
      const response = await api.getPrefs();
      const raw = response.prefs ?? {};
      setPrefs({
        enablePet: raw.enablePet ?? DEFAULT_PREFS.enablePet,
        activePetId: raw.activePetId ?? DEFAULT_PREFS.activePetId,
        petWindowPosition: raw.petWindowPosition ?? null,
        petWindowScale: clampScale(raw.petWindowScale),
      });
    } catch {
      // Best effort: the defaults stay in place and `hydrated` still flips below.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => subscribePrefsChanged(() => void hydrate()), [hydrate]);

  const persist = useCallback((patch: Partial<PetPrefs>) => {
    setPrefs((current) => ({ ...current, ...patch }));
    // The PUT body has to drop `null` for keys the server doesn't want to see
    // undefined; the pet prefs validator already handles null on read, so the
    // store only forwards what the user has explicitly set.
    void api.putPrefs(patch as Partial<UiPrefs>).catch(() => {
      // Surfaced via toast in higher-level flows; the store is best-effort.
    });
  }, []);

  const setEnablePet = useCallback(
    (enabled: boolean) => persist({ enablePet: enabled }),
    [persist],
  );
  const setActivePetId = useCallback(
    (id: string | null) => persist({ activePetId: id }),
    [persist],
  );
  const setPetWindowPosition = useCallback(
    (pos: { x: number; y: number } | null) => persist({ petWindowPosition: pos }),
    [persist],
  );
  const setPetWindowScale = useCallback(
    (scale: number) => persist({ petWindowScale: clampScale(scale) }),
    [persist],
  );

  // Mark the first effect tick as "hydration" so the persistence effect skips it.
  useEffect(() => {
    if (initial.current) initial.current = false;
  }, []);

  const value = useMemo<PetStore>(
    () => ({
      prefs,
      hydrated,
      setEnablePet,
      setActivePetId,
      setPetWindowPosition,
      setPetWindowScale,
    }),
    [prefs, hydrated, setEnablePet, setActivePetId, setPetWindowPosition, setPetWindowScale],
  );

  return <PetContext.Provider value={value}>{children}</PetContext.Provider>;
}

export function usePetStore(): PetStore {
  const store = useContext(PetContext);
  if (!store) throw new Error("usePetStore must be used inside <PetProvider>");
  return store;
}
