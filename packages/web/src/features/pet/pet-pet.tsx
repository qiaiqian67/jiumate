/**
 * PetPet — the desktop pet renderer.
 *
 * Hosts the Petdex sprite atlas when an installed/preset pet is selected;
 * falls back to a hand-drawn panda SVG when no pet is picked or the
 * spritesheet failed to load. Mood→row mapping mirrors OpenBitFun's
 * `AgentCompanionPet` (`rest: 0`, `waiting: 6`, `working: 7`, `analyzing: 8`,
 * drag `right: 1 / left: 2`, action rows `waving: 3, jumping: 4, failed: 5`).
 */
import { useEffect, useMemo, useState } from "react";
import { resolvePetSpriteSrc } from "./pet-service";
import { getPetLookFrame } from "./pet-look";
import { getPetSpriteStyle } from "./sprite";
import type { PetPackage } from "@prismshadow/linsight-pets";

export type PetMood = "rest" | "analyzing" | "waiting" | "working" | "hover" | "dragging";
export type PetAction = "jumping" | "waving" | "failed" | null;

const MOOD_ROW: Record<PetMood, number> = {
  rest: 0,
  hover: 0,
  dragging: 1,
  analyzing: 8,
  waiting: 6,
  working: 7,
};

export interface PetPetProps {
  mood?: PetMood;
  dragDirection?: "left" | "right";
  action?: PetAction;
  /** Active pet package. Null/undefined falls back to the panda SVG. */
  pet?: PetPackage | null;
  /** When true, show only the first idle frame (settings picker thumbnails). */
  staticPreview?: boolean;
  /**
   * Look direction index (see `pet-look.ts`) while the pet is watching the
   * cursor. Null keeps the animated mood row; a v1 atlas has no look rows, so
   * this is ignored there.
   */
  look?: number | null;
}

export function PetPet({
  mood = "rest",
  dragDirection = "right",
  action = null,
  pet = null,
  staticPreview = false,
  look = null,
}: PetPetProps) {
  if (pet === null) {
    return <PandaSvg mood={mood} />;
  }
  return (
    <PetSprite
      mood={mood}
      dragDirection={dragDirection}
      action={action}
      pet={pet}
      staticPreview={staticPreview}
      look={look}
    />
  );
}

function PetSprite({
  mood,
  dragDirection,
  action,
  pet,
  staticPreview,
  look,
}: {
  mood: PetMood;
  dragDirection: "left" | "right";
  action: PetAction;
  pet: PetPackage;
  staticPreview: boolean;
  look: number | null;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const resolved = useMemo(() => resolvePetSpriteSrc(pet), [pet]);

  useEffect(() => {
    setSrc(null);
    setFailed(false);
    const image = new Image();
    image.onload = () => setSrc(resolved);
    image.onerror = () => setFailed(true);
    image.src = resolved;
  }, [pet, resolved]);

  const rowByMood = mood === "dragging" ? (dragDirection === "right" ? 1 : 2) : MOOD_ROW[mood];
  const actionRow =
    action === "waving" ? 3 : action === "jumping" ? 4 : action === "failed" ? 5 : null;
  const version = pet.spriteVersionNumber ?? 1;
  // A reaction or a look both take over the whole sprite, so they outrank the
  // mood row: a waving pet must not be mid-walk, and a look frame is one cell.
  const lookFrame = staticPreview ? null : getPetLookFrame(version, look);
  const row = staticPreview ? 0 : (actionRow ?? lookFrame?.row ?? rowByMood);
  const still = staticPreview || lookFrame !== null;
  const style = src !== null ? getPetSpriteStyle(src, row, version, lookFrame?.column ?? 0) : null;

  if (failed || style === null) {
    return <PandaSvg mood={mood} />;
  }
  // The walk cycle and its per-mood transform come from the mood class in
  // `styles.css` — see the note in `sprite.ts` for why the atlas cadence is not
  // used as the duration.
  return (
    <div
      data-pet-mood={mood}
      data-pet-row={row}
      data-pet-still={still ? "true" : undefined}
      className={
        still
          ? "linsight-pet__sprite linsight-pet__sprite--static"
          : `linsight-pet__sprite linsight-pet__sprite--${mood}`
      }
      style={{
        width: "100%",
        height: "100%",
        ...style,
      }}
    />
  );
}

const VIEW_W = 320;
const VIEW_H = 204;

function PandaSvg({ mood }: { mood: PetMood }) {
  const overlay = moodOverlay(mood);
  return (
    <svg
      className="linsight-pet__panda"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <ellipse cx={120} cy={120} rx={88} ry={64} className="linsight-pet__panda-body" />
      <ellipse cx={200} cy={120} rx={40} ry={50} className="linsight-pet__panda-body" />
      <ellipse cx={130} cy={120} rx={48} ry={56} fill="#fff" className="linsight-pet__panda-face" />
      <circle cx={116} cy={114} r={6} className="linsight-pet__panda-eye" />
      <circle cx={146} cy={114} r={6} className="linsight-pet__panda-eye" />
      <ellipse cx={130} cy={136} rx={6} ry={3} className="linsight-pet__panda-nose" />
      {overlay}
    </svg>
  );
}

function moodOverlay(mood: PetMood) {
  if (mood === "analyzing") {
    return (
      <g className="linsight-pet__overlay">
        <circle cx={224} cy={70} r={4} className="linsight-pet__panda-eye" />
        <circle cx={248} cy={50} r={6} className="linsight-pet__panda-eye" />
        <circle cx={276} cy={28} r={8} className="linsight-pet__panda-eye" />
      </g>
    );
  }
  if (mood === "waiting") {
    return (
      <g className="linsight-pet__overlay">
        <circle cx={228} cy={50} r={5} fill="currentColor" />
        <circle cx={252} cy={50} r={5} fill="currentColor" />
        <circle cx={276} cy={50} r={5} fill="currentColor" />
      </g>
    );
  }
  if (mood === "working") {
    return (
      <g className="linsight-pet__overlay">
        <path
          d="M210 50 C204 60 204 72 210 76 C216 72 216 60 210 50 Z"
          className="linsight-pet__sweat-drop"
        />
      </g>
    );
  }
  return (
    <g className="linsight-pet__overlay">
      <text x={215} y={75} className="linsight-pet__zzz">
        z
      </text>
      <text x={245} y={45} className="linsight-pet__zzz">
        z
      </text>
    </g>
  );
}
