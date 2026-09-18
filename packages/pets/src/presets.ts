/**
 * The built-in Petdex gallery.
 *
 * Lives in this package rather than in the web app because two sides need the same list:
 * the picker renders it, and the server has to be able to name the pets a user can switch
 * to (the `pet` tool reports them). The ids are the contract — a preset is selected by id
 * exactly like an installed pack.
 *
 * Web-bundle specifics (the `/pets/<folder>/spritesheet.<ext>` URL shape) stay in the web
 * app; this is metadata only.
 */
import type { SpriteVersionNumber } from "./schema.js";

export interface BuiltinPetPreset {
  id: string;
  displayName: string;
  description: string;
  spritesheetMimeType: "image/png" | "image/webp";
  /** v2 atlases add the two look-direction rows; omitted means v1. */
  spriteVersionNumber?: SpriteVersionNumber;
  /** Folder under the web bundle's `pets/` when it differs from the id (e.g. elaina → elaina-2). */
  folder?: string;
}

/** In the same order the picker renders them. */
export const BUILTIN_PETS: readonly BuiltinPetPreset[] = [
  {
    id: "blue-golden",
    displayName: "困困",
    description:
      "A sweet, round-faced blue-golden shaded cat with wide bright eyes and soft silver-blue fur warmed by creamy-gold highlights.",
    spritesheetMimeType: "image/png",
  },
  {
    id: "openbitfun-girl",
    displayName: "芳翎",
    description:
      "Fangling, a silver-haired short-legged companion with a softly oval face and hollow rounded-hexagon ornaments.",
    spritesheetMimeType: "image/webp",
    spriteVersionNumber: 2,
  },
  {
    id: "deepseek-goldwhale",
    displayName: "大肥鲸",
    description:
      "A quiet whale maid with long blue curls, a whale apron, and a gold sea-patterned skirt.",
    spritesheetMimeType: "image/webp",
    spriteVersionNumber: 2,
  },
  {
    id: "openbitfun",
    displayName: "OpenBitFun",
    description:
      "OpenBitFun's mascot — Bifang, a figure from Chinese mythology said to live on Mount Zhang'e.",
    spritesheetMimeType: "image/webp",
  },
  {
    id: "boxcat",
    displayName: "Boxcat",
    description: "A tiny cat tucked inside a cardboard box for cozy coding sessions.",
    spritesheetMimeType: "image/webp",
  },
  {
    id: "capy",
    displayName: "Capy",
    description: "An original emotionally stable capybara with a tiny orange on its head.",
    spritesheetMimeType: "image/webp",
  },
  {
    id: "elaina",
    displayName: "Elaina",
    description:
      "A cute pixel-art Codex pet inspired by Elaina, the tiny traveling witch with a bright hat and gentle broom-side charm.",
    spritesheetMimeType: "image/webp",
    folder: "elaina-2",
  },
  {
    id: "gugugaga",
    displayName: "咕咕嘎嘎",
    description:
      "A cheerful chibi girl in a black penguin suit with a simple silver collar pendant.",
    spritesheetMimeType: "image/webp",
  },
  {
    id: "hachiware",
    displayName: "Hachiware",
    description:
      "A tiny Hachiware-inspired desktop pet with white and blue cat markings, bright eyes, and cheerful expressions.",
    spritesheetMimeType: "image/webp",
  },
  {
    id: "ikun",
    displayName: "IKUN",
    description: "A hoodie chick with hot path stage energy.",
    spritesheetMimeType: "image/webp",
  },
  {
    id: "jiyi",
    displayName: "吉伊",
    description:
      "A round white chibi bear with dark chocolate outlines, pink cheeks, tiny limbs, curled ears, and a small pink bear pouch.",
    spritesheetMimeType: "image/webp",
  },
  {
    id: "panda-pix",
    displayName: "Panda",
    description: "Codux bundled pet atlas.",
    spritesheetMimeType: "image/png",
  },
  {
    id: "usagi",
    displayName: "Usagi",
    description: "A tiny cream rabbit companion based on the provided Usagi reference.",
    spritesheetMimeType: "image/webp",
  },
];

/** The id of the preset a user gets before choosing one. */
export const DEFAULT_BUILTIN_PET_ID = BUILTIN_PETS[0]!.id;

/** Look up a preset by id (null when the id is not a built-in). */
export function findBuiltinPetPreset(id: string | null | undefined): BuiltinPetPreset | null {
  if (!id) return null;
  return BUILTIN_PETS.find((preset) => preset.id === id) ?? null;
}
