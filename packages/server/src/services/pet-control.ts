/**
 * Desktop pet control for the `pet` tool — the server's implementation of core's
 * `PetControlPort`.
 *
 * The pet is a desktop surface, not a file: the floating window is opened by the Electron
 * shell, and the selection lives in `ui_prefs`. A tool call carries no user — Sessions
 * belong to a Project, not to a person — so this acts on the **local admin's** prefs, which
 * is the account the desktop app signs in as and therefore the account that owns the pet
 * window. That is also the authority the agent already holds through the local API token
 * (`auth/service.ts` mints it and authenticates it as the admin), so the tool widens
 * nothing.
 *
 * Scope is the safe half of the reference implementation's surface: list, choose among pets
 * that are already available, show or hide the window. Import and delete write to disk and
 * stay with the user in Settings.
 */
import {
  BUILTIN_PETS,
  DEFAULT_BUILTIN_PET_ID,
  slugifyPetId,
  type PetPackage,
} from "@jadelau/pets";
import type {
  PetControlEntry,
  PetControlPort,
  PetControlSnapshot,
} from "@jadelau/core";
import type { UiPrefsRepo } from "../db/repos/ui-prefs.js";
import type { PetCatalogService } from "./pet-catalog.js";

export interface PetControlDeps {
  catalog: PetCatalogService;
  prefs: UiPrefsRepo;
  /** The account whose pet this controls (the local admin), or null when there is none. */
  ownerUserId: () => string | null;
  /** Tell that account's open clients the pet changed, so its window follows. */
  notify: (userId: string) => void;
}

/** The pet prefs this service reads and writes; the rest of `ui_prefs` is left untouched. */
interface PetPrefs {
  enablePet?: boolean;
  activePetId?: string | null;
}

export class PetControlService implements PetControlPort {
  constructor(private readonly deps: PetControlDeps) {}

  async list(): Promise<PetControlSnapshot> {
    const [pets, prefs] = await Promise.all([this.availablePets(), this.readPrefs()]);
    return {
      enabled: prefs.enablePet ?? true,
      activePetId: prefs.activePetId ?? DEFAULT_BUILTIN_PET_ID,
      pets,
    };
  }

  async setActivePet(petId: string): Promise<PetControlSnapshot> {
    const id = slugifyPetId(petId);
    const pets = await this.availablePets();
    if (!pets.some((pet) => pet.id === id)) {
      throw new Error(
        `No pet with id "${petId}" is available. Call this tool with action="list" to see the ids.`,
      );
    }
    this.patch({ activePetId: id });
    return this.list();
  }

  async setEnabled(enabled: boolean): Promise<PetControlSnapshot> {
    this.patch({ enablePet: enabled });
    return this.list();
  }

  /**
   * Everything the picker would offer: the bundled presets plus the installed packs, with
   * an install shadowing a preset of the same id — the same merge `listPets` does in the
   * web app, so the ids the tool reports are the ids the picker shows.
   */
  private async availablePets(): Promise<PetControlEntry[]> {
    const { pets: installed } = await this.deps.catalog.list();
    const installedIds = new Set(installed.map((pet) => pet.id));
    const entries: PetControlEntry[] = BUILTIN_PETS.filter(
      (preset) => !installedIds.has(preset.id),
    ).map((preset) => ({
      id: preset.id,
      displayName: preset.displayName,
      source: "preset",
    }));
    return [...entries, ...installed.map(toEntry)];
  }

  private readPrefs(): PetPrefs {
    const userId = this.deps.ownerUserId();
    if (userId === null) return {};
    const raw = this.deps.prefs.get(userId);
    if (raw === null) return {};
    try {
      return JSON.parse(raw) as PetPrefs;
    } catch {
      // Corrupted prefs read as empty, exactly like GET /api/me/prefs.
      return {};
    }
  }

  /**
   * Shallow-merge the patch into the stored prefs and tell the owner's clients. `ui_prefs`
   * has several independent writers, so a full replace would drop their fields — the same
   * PATCH semantics `PUT /api/me/prefs` documents.
   */
  private patch(patch: PetPrefs): void {
    const userId = this.deps.ownerUserId();
    if (userId === null) {
      throw new Error("This host has no local account to hold a desktop pet preference.");
    }
    const raw = this.deps.prefs.get(userId);
    let current: Record<string, unknown> = {};
    if (raw !== null) {
      try {
        current = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        current = {};
      }
    }
    this.deps.prefs.set(userId, JSON.stringify({ ...current, ...patch }));
    this.deps.notify(userId);
  }
}

function toEntry(pet: PetPackage): PetControlEntry {
  return { id: pet.id, displayName: pet.displayName, source: pet.source };
}
