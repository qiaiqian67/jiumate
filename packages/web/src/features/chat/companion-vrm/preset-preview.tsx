/**
 * <PresetPreview> — Settings-picker thumbnail for a VRM preset.
 *
 * Renders a 48 px tile showing the preset's display name and a tiny
 * preview. When the underlying `.vrm` asset is present, the preview
 * mounts a `<CompanionVrm>` instance sized to 48 px; when it is not
 * (the L.6 ship-without-assets shape), the preview falls back to a
 * colored circle + preset name so the picker remains usable.
 *
 * ## IntersectionObserver lazy mount
 *
 * The Settings dialog renders the picker only when the user navigates
 * to the Companion page, but each preview still pulls ~600 KB of WebGL
 * + three.js + @pixiv/three-vrm code on mount. An `IntersectionObserver`
 * defers the VRM runtime instantiation until the preview is actually
 * scrolled into view — out-of-view previews render the colored-circle
 * fallback, and the WebGL runtime never spins up until needed.
 *
 * ## Selected state
 *
 * The selected preset gets an orange ring (Tailwind's `ring-orange-500`)
 * matching the rest of the Companion settings row. Click toggles the
 * store's `setAvatarVrmPreset`.
 */
import { useEffect, useRef, useState } from "react";
import { detectLang } from "../../../lib/lang";
import type { ResolvedPreset } from "./manifest";
import { CompanionVrm } from "./CompanionVrm";

export interface PresetPreviewProps {
  preset: ResolvedPreset;
  selected: boolean;
  onSelect: (id: ResolvedPreset["id"]) => void;
}

const PX = 48;

export function PresetPreview({ preset, selected, onSelect }: PresetPreviewProps) {
  const containerRef = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [runtimeFailed, setRuntimeFailed] = useState(false);
  const lang = detectLang();

  useEffect(() => {
    const node = containerRef.current;
    if (node === null) return;
    if (typeof IntersectionObserver === "undefined") {
      // SSR / older browser: skip lazy mount, just render the fallback.
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setVisible(true);
        }
      },
      { rootMargin: "32px" },
    );
    obs.observe(node);
    return () => {
      obs.disconnect();
    };
  }, []);

  const label = preset.displayName[lang] || preset.displayName.en;

  return (
    <button
      ref={containerRef}
      type="button"
      onClick={() => onSelect(preset.id)}
      aria-pressed={selected}
      aria-label={label}
      data-companion-vrm-preset={preset.id}
      className={`flex flex-col items-center gap-1 rounded-md border p-1 transition-colors ${
        selected
          ? "border-orange-500 ring-2 ring-orange-500"
          : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
      }`}
      style={{ width: PX + 16, height: PX + 32 }}
    >
      <div
        className="flex items-center justify-center overflow-hidden rounded"
        style={{ width: PX, height: PX }}
      >
        {visible && !runtimeFailed ? (
          <CompanionVrm
            preset={preset}
            px={PX}
            pose="idle"
            onFallback={() => setRuntimeFailed(true)}
          />
        ) : (
          // Fallback: colored circle + id. Until the asset drop lands,
          // every preview shows this. Once the drop lands, the lazy-
          // mounted VRM renders a real model.
          <span
            className="flex items-center justify-center rounded-full bg-orange-200 text-xs font-semibold text-orange-700 dark:bg-orange-800 dark:text-orange-200"
            style={{ width: PX, height: PX }}
          >
            {label.charAt(0)}
          </span>
        )}
      </div>
      <span className="text-[10px] leading-tight text-zinc-700 dark:text-zinc-300">{label}</span>
    </button>
  );
}
