/**
 * Application page of System settings — Petdex desktop pet.
 *
 * Mirrors OpenBitFun's `page === 'pet'` block: enable switch, pet picker
 * (preset + imported cards), import button, delete on user packs.
 */
import { useCallback, useEffect, useState } from "react";
import { S } from "../../lib/strings";
import { Switch } from "../../components/ui/switch";
import { Button } from "../../components/ui/button";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { ApiError } from "../../api/client";
import {
  deletePetPackage,
  importExternalPet,
  importPetPackage,
  isBuiltinPetId,
  listExternalPets,
  listPets,
} from "../pet/pet-service";
import type {
  PetExternalCandidate,
  PetExternalCatalog,
  PetPackageWithPreview,
} from "../pet/pet-service";
import { getPetSpriteStyle } from "../pet/sprite";
import { PET_SCALE_CHOICES, usePetStore } from "../pet/pet-store";
import { PetPet } from "../pet/pet-pet";
import type { PetPackage } from "@jadelau/pets";

/** Label for a size choice. Read at render time so a locale switch is picked up. */
function petSizeText(scale: number): string {
  if (scale < 1) return S.settings.applicationPetSizeSmall;
  if (scale > 1) return S.settings.applicationPetSizeLarge;
  return S.settings.applicationPetSizeMedium;
}

export function ApplicationSection() {
  const { prefs, setEnablePet, setActivePetId, setPetWindowScale } = usePetStore();
  const [pets, setPets] = useState<PetPackageWithPreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [external, setExternal] = useState<PetExternalCatalog | null>(null);
  const [scanning, setScanning] = useState(false);
  const [importingExternal, setImportingExternal] = useState<string | null>(null);
  const canPickFolder = typeof window.pet?.pickPackage === "function";

  const reload = useCallback(async () => {
    const list = await listPets();
    setPets(list);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Read the pets bundled with another agent app (Codex) on this machine. The
   * server scans its own install locations, so a machine without Codex simply
   * comes back empty — which is why the failure path is silent rather than a toast.
   */
  const scanExternal = useCallback(async () => {
    setScanning(true);
    try {
      setExternal(await listExternalPets());
    } catch {
      setExternal({ candidates: [], diagnostics: [] });
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scanExternal();
  }, [scanExternal]);

  const handleImportExternal = async (candidate: PetExternalCandidate) => {
    setImportingExternal(candidate.sourceKey);
    try {
      // The fingerprint travels with the request: the server reads the archive
      // again and refuses if it no longer matches what was reviewed here.
      await importExternalPet(candidate.sourceKey, candidate.fingerprint);
      toastSuccess(S.settings.applicationPetImported(candidate.displayName));
      await Promise.all([reload(), scanExternal()]);
    } catch (err) {
      toastError(
        err instanceof ApiError ? apiErrorText(err) : S.settings.applicationPetExternalFailed,
      );
    } finally {
      setImportingExternal(null);
    }
  };

  /**
   * Re-read the catalog on demand. The list is also refreshed after an import or a
   * delete, but a pack can be dropped into the data root by hand (or by another host
   * sharing it), and there is otherwise no way to see it without reopening the dialog.
   */
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } catch (err) {
      toastError(err instanceof ApiError ? apiErrorText(err) : S.settings.applicationPetListFailed);
    } finally {
      setRefreshing(false);
    }
  };

  const handlePick = async (pkg: PetPackage) => {
    await setActivePetId(pkg.id);
  };

  const handleDelete = async (pkg: PetPackage) => {
    if (pkg.source !== "user") return;
    setBusy(true);
    try {
      await deletePetPackage(pkg.id);
      await reload();
      if (prefs.activePetId === pkg.id) await setActivePetId("blue-golden");
      toastSuccess(S.settings.applicationPetDeleted);
    } catch (err) {
      toastError(
        err instanceof ApiError ? apiErrorText(err) : S.settings.applicationPetImportFailed,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!canPickFolder || !window.pet?.pickPackage) {
      toastError(S.settings.applicationPetImportDesktopOnly);
      return;
    }
    setImporting(true);
    try {
      const picked = await window.pet.pickPackage();
      if (picked === null) return;
      const pet = await importPetPackage(picked);
      await reload();
      await setActivePetId(pet.id);
      toastSuccess(S.settings.applicationPetImported(pet.displayName));
    } catch (err) {
      toastError(
        err instanceof ApiError ? apiErrorText(err) : S.settings.applicationPetImportFailed,
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="space-y-6"
      data-openbitfun-component="application-section"
      data-openbitfun-part="root"
    >
      <header className="space-y-1">
        <h2 className="text-base font-medium text-gray-900 dark:text-gray-100">
          {S.settings.applicationTitle}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">{S.settings.applicationInfo}</p>
      </header>

      <section className="space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-700">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {S.settings.applicationEnablePet}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {S.settings.applicationEnablePetInfo}
            </p>
          </div>
          <Switch checked={prefs.enablePet} onChange={(value) => void setEnablePet(value)} />
        </div>
      </section>

      <section className="space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-700">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {S.settings.applicationPetSizeLabel}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {S.settings.applicationPetSizeInfo}
            </p>
          </div>
          <div
            className="inline-flex overflow-hidden rounded-md border border-gray-200 dark:border-gray-700"
            role="radiogroup"
            aria-label={S.settings.applicationPetSizeLabel}
          >
            {PET_SCALE_CHOICES.map((choice) => {
              const active = Math.abs(prefs.petWindowScale - choice) < 0.001;
              return (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => void setPetWindowScale(choice)}
                  className={`px-3 py-1 text-xs transition-colors ${
                    active
                      ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                      : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  }`}
                >
                  {petSizeText(choice)}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {S.settings.applicationPetPicker}
          </h3>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={refreshing}
              title={S.settings.applicationPetRefresh}
              aria-label={S.settings.applicationPetRefresh}
              onClick={() => void handleRefresh()}
            >
              {refreshing ? S.settings.applicationPetRefreshing : S.settings.applicationPetRefresh}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={importing || !canPickFolder}
              title={
                canPickFolder
                  ? S.settings.applicationPetImportHint
                  : S.settings.applicationPetImportDesktopOnly
              }
              onClick={() => void handleImport()}
            >
              {importing ? S.settings.applicationPetImporting : S.settings.applicationPetImport}
            </Button>
          </div>
        </div>
        <div
          className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6"
          data-openbitfun-component="application-section"
          data-openbitfun-part="petGrid"
          role="radiogroup"
          aria-label={S.settings.applicationPetPicker}
        >
          {pets.map((pkg) => (
            <PetCard
              key={pkg.id}
              pkg={pkg}
              selected={prefs.activePetId === pkg.id}
              onPick={() => void handlePick(pkg)}
              onDelete={() => void handleDelete(pkg)}
              busy={busy}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {S.settings.applicationPetExternalTitle}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {S.settings.applicationPetExternalInfo}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={scanning}
            onClick={() => void scanExternal()}
          >
            {scanning
              ? S.settings.applicationPetExternalScanning
              : S.settings.applicationPetExternalScan}
          </Button>
        </div>
        {external !== null && external.candidates.length > 0 ? (
          <ul className="space-y-2" data-openbitfun-part="petExternalList">
            {external.candidates.map((candidate) => (
              <ExternalPetRow
                key={candidate.sourceKey}
                candidate={candidate}
                busy={importingExternal === candidate.sourceKey}
                disabled={importingExternal !== null}
                onImport={() => void handleImportExternal(candidate)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {scanning
              ? S.settings.applicationPetExternalScanning
              : S.settings.applicationPetExternalEmpty}
          </p>
        )}
      </section>
    </div>
  );
}

interface ExternalPetRowProps {
  candidate: PetExternalCandidate;
  busy: boolean;
  disabled: boolean;
  onImport: () => void;
}

/**
 * One reviewable pet from another app's bundle. The preview is the atlas itself,
 * cropped to its first frame by the same sprite CSS the pet renders with — the
 * server has no image decoder, so it hands over the bytes rather than a thumbnail.
 */
function ExternalPetRow({ candidate, busy, disabled, onImport }: ExternalPetRowProps) {
  // Already installed from this source: the row reports what moved since, rather
  // than offering an import that would be a no-op.
  const status =
    candidate.imported !== null
      ? candidate.sourceChanged
        ? S.settings.applicationPetExternalSourceChanged
        : candidate.copyModified
          ? S.settings.applicationPetExternalCopyModified
          : S.settings.applicationPetExternalImported
      : isBuiltinPetId(candidate.id)
        ? S.settings.applicationPetExternalBuiltin
        : null;
  return (
    <li
      className="flex items-center gap-3 rounded-md border border-gray-200 p-2 dark:border-gray-700"
      data-pet-external-id={candidate.id}
    >
      <div
        className="jiumate-pet__sprite jiumate-pet__sprite--static shrink-0"
        aria-hidden
        style={{
          width: 36,
          height: 39,
          ...getPetSpriteStyle(candidate.previewUrl, 0, candidate.spriteVersionNumber),
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-gray-900 dark:text-gray-100">
            {candidate.displayName}
          </span>
          {status === null ? null : (
            <span className="shrink-0 rounded-full border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {status}
            </span>
          )}
        </div>
        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
          {candidate.description ?? candidate.id}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || busy || candidate.imported !== null}
        onClick={onImport}
      >
        {busy ? S.settings.applicationPetImporting : S.settings.applicationPetExternalImport}
      </Button>
    </li>
  );
}

interface PetCardProps {
  pkg: PetPackageWithPreview;
  selected: boolean;
  busy: boolean;
  onPick: () => void;
  onDelete: () => void;
}

function PetCard({ pkg, selected, busy, onPick, onDelete }: PetCardProps) {
  return (
    <button
      type="button"
      onClick={onPick}
      data-openbitfun-component="application-section"
      data-openbitfun-part="petCard"
      data-pet-id={pkg.id}
      data-selected={selected}
      role="radio"
      className={`group relative flex aspect-square items-center justify-center overflow-hidden rounded-md border transition-colors ${
        selected
          ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40"
          : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600"
      }`}
      aria-pressed={selected}
      aria-checked={selected}
    >
      <div className="h-full w-full p-2">
        <PetPet pet={pkg} staticPreview />
      </div>
      {pkg.source === "user" && (
        <span
          role="button"
          tabIndex={0}
          aria-label={S.settings.applicationPetDelete}
          onClick={(event) => {
            event.stopPropagation();
            if (!busy) onDelete();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              if (!busy) onDelete();
            }
          }}
          className="absolute right-1 top-1 hidden rounded bg-red-500 px-1 text-[10px] font-medium text-white group-hover:block"
        >
          ×
        </span>
      )}
      <span className="pointer-events-none absolute bottom-0 left-0 right-0 truncate bg-black/50 px-1 py-0.5 text-[10px] text-white">
        {pkg.displayName}
      </span>
    </button>
  );
}
