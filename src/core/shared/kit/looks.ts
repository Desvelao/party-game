/**
 * Character model types and the stateless look helpers a pack or plugin may bundle (the registry of installed models
 * lives in `core/shared/character.ts`, which a pack must not bundle: its copy would be empty).
 */

export type Shape =
  | { k: 'circle'; x: number; y: number; r: number; fill: number }
  | { k: 'poly'; pts: number[]; fill: number };

/** One choice of a slot. `label` is English (translated with the owner's `locales`); `swatch` (0xRRGGBB) shows it as a colour. */
export interface CharacterOption {
  label: string;
  swatch?: number;
}

export interface CharacterSlot {
  /** letters and digits, starting with a letter */
  id: string;
  label: string;
  options: CharacterOption[];
  /** index of the option a new look starts with */
  default: number;
}

/** A model as its owner declares it in `characters` of its manifest. */
export interface CharacterModelDef {
  /** lowercase id like "blob", unique on the server */
  id: string;
  /** English, translated with the owner's `locales` */
  name: string;
  slots: CharacterSlot[];
}

/** One model's look: option index per slot id. */
export type ModelLook = Record<string, number>;
/** A player's looks, by model id. */
export type Looks = Record<string, ModelLook>;

/**
 * How a model is drawn: the shapes of the character centred on (0,0), body radius `r`, looking along `facing`
 * (radians), in paint order. Pure and deterministic. `color` is the player's colour (0xRRGGBB); the first shape is
 * the body (the core outlines it).
 */
export type CharacterDraw = (look: ModelLook, color: number, r: number, facing: number) => Shape[];

export function defaultLook(def: CharacterModelDef): ModelLook {
  const out: ModelLook = {};
  for (const s of def.slots) out[s.id] = s.default;
  return out;
}

export function randomLook(def: CharacterModelDef, rand: () => number = Math.random): ModelLook {
  const out: ModelLook = {};
  for (const s of def.slots) out[s.id] = Math.min(s.options.length - 1, Math.floor(rand() * s.options.length));
  return out;
}

/** A complete, valid look of `def`: every slot present, invalid or missing ones at their default, unknown keys dropped. */
export function sanitizeModelLook(def: CharacterModelDef, raw: unknown): ModelLook {
  const out = defaultLook(def);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const s of def.slots) {
    const v = src[s.id];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < s.options.length) out[s.id] = v;
  }
  return out;
}
