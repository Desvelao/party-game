/**
 * Character models. The core ships none: a game pack or a plugin registers its models (`characters` in its
 * `game.json` / `plugin.json`: slots and options, validated here) and draws them in its client code (a
 * `CharacterDraw` that returns `Shape`s). A game names the model its players are drawn with (`character` in
 * `game.json`); several games may reuse one model. A player keeps one look per model (`Looks`).
 */
import { sanitizeModelLook, type CharacterModelDef, type Looks, type ModelLook } from './kit/looks';

export type { CharacterDraw, CharacterModelDef, CharacterOption, CharacterSlot, Looks, ModelLook, Shape } from './kit/looks';
export { defaultLook, randomLook, sanitizeModelLook } from './kit/looks';

export const PALETTE = [
  0xff4f8b, 0x4fc3ff, 0xffd23f, 0x6ee06e, 0xb46bff, 0xff8a3d, 0x35e0c2, 0xff6b6b,
  0x9bd34d, 0x6b8cff, 0xf06bd6, 0xc9a227, 0x2fb5a0, 0xe0e0e0, 0x8d6bff, 0xff9f9f,
];

export function sanitizeColor(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < PALETTE.length ? raw : 0;
}

/** A registered model and the game pack or plugin that provides it. */
export interface CharacterModel extends CharacterModelDef {
  owner: { kind: 'game' | 'plugin'; id: string };
}

/** Saved looks of models that are not installed right now are kept within these bounds (uninstalling a plugin for a while loses nothing). */
export const MAX_LOOK_MODELS = 16;
const MAX_SLOTS = 16;
const MAX_OPTIONS = 32;
const MAX_MODELS_PER_OWNER = 8;

const MODEL_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLOT_ID_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const isModelId = (v: unknown): v is string => typeof v === 'string' && v.length >= 2 && v.length <= 32 && MODEL_ID_RE.test(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Check the `characters` list of a manifest, pushing every problem to `errs`. */
export function validateCharacterDefs(v: unknown, path: string, errs: string[]): void {
  if (v === undefined) return;
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_MODELS_PER_OWNER) return void errs.push(`${path} must be a list of 1 to ${MAX_MODELS_PER_OWNER} character models`);
  const ids = new Set<string>();
  v.forEach((m, i) => {
    const at = `${path}[${i}]`;
    if (!isObj(m)) return void errs.push(`${at} must be an object`);
    if (!isModelId(m.id)) errs.push(`${at}.id must be a lowercase id like "blob"`);
    else if (ids.has(m.id)) errs.push(`${at}.id "${m.id}" is repeated`);
    else ids.add(m.id);
    if (!isText(m.name, 40)) errs.push(`${at}.name is required`);
    if (!Array.isArray(m.slots) || m.slots.length === 0 || m.slots.length > MAX_SLOTS) return void errs.push(`${at}.slots must be a list of 1 to ${MAX_SLOTS} slots`);
    const slots = new Set<string>();
    m.slots.forEach((s, j) => {
      const sat = `${at}.slots[${j}]`;
      if (!isObj(s)) return void errs.push(`${sat} must be an object`);
      if (typeof s.id !== 'string' || !SLOT_ID_RE.test(s.id)) errs.push(`${sat}.id must be letters and digits, starting with a letter`);
      else if (slots.has(s.id)) errs.push(`${sat}.id "${s.id}" is repeated`);
      else slots.add(s.id);
      if (!isText(s.label, 40)) errs.push(`${sat}.label is required`);
      const opts = s.options;
      if (!Array.isArray(opts) || opts.length < 2 || opts.length > MAX_OPTIONS) return void errs.push(`${sat}.options must be a list of 2 to ${MAX_OPTIONS} options`);
      opts.forEach((o, k) => {
        if (!isObj(o) || !isText(o.label, 40)) errs.push(`${sat}.options[${k}] must be { label }`);
        else if (o.swatch !== undefined && !(Number.isInteger(o.swatch) && (o.swatch as number) >= 0 && (o.swatch as number) <= 0xffffff)) errs.push(`${sat}.options[${k}].swatch must be a colour like 16711680 (0xff0000)`);
      });
      if (!(Number.isInteger(s.default) && (s.default as number) >= 0 && (s.default as number) < opts.length)) errs.push(`${sat}.default must be the index of one of its options`);
    });
  });
}

/** `character` of a game manifest: the id of a model. */
export function validateCharacterRef(v: unknown, path: string, errs: string[]): void {
  if (v !== undefined && !isModelId(v)) errs.push(`${path} must be the id of a character model like "blob"`);
}

// ---- registry ---------------------------------------------------------------------------------

const MODELS: CharacterModel[] = [];

/**
 * Register the models of a game pack or plugin, in load order. A model id that is already taken is not
 * registered; the ids left out are returned (the caller logs them).
 */
export function registerCharacterModels(owner: CharacterModel['owner'], defs: readonly CharacterModelDef[] | undefined): string[] {
  const clashes: string[] = [];
  for (const def of defs ?? []) {
    if (MODELS.some((m) => m.id === def.id)) clashes.push(def.id);
    else MODELS.push({ ...def, owner });
  }
  return clashes;
}

/** Remove the models of one owner (a pack that failed to load, tests). */
export function unregisterCharacterModels(owner: CharacterModel['owner']): void {
  for (let i = MODELS.length - 1; i >= 0; i--) if (MODELS[i].owner.kind === owner.kind && MODELS[i].owner.id === owner.id) MODELS.splice(i, 1);
}

export const characterModel = (id: string | undefined): CharacterModel | undefined => (id ? MODELS.find((m) => m.id === id) : undefined);

/** Every registered model, in registration order. */
export const characterModels = (): readonly CharacterModel[] => MODELS;

// ---- looks ------------------------------------------------------------------------------------

/**
 * The model the looks saved before models existed belong to (a flat `{ body, eyes, ... }` object). Used only to
 * read old records; the core does not know this model otherwise.
 */
export const LEGACY_LOOK_MODEL = 'blob';

/**
 * Clamp untrusted looks. Registered models are checked against their slots; looks of models that are not
 * registered are kept when they are small whole numbers (bounded counts), so they come back with their plugin.
 * An old flat look is read as the look of `LEGACY_LOOK_MODEL`.
 */
export function sanitizeLooks(raw: unknown): Looks {
  const out: Looks = {};
  if (!isObj(raw)) return out;
  const entries = Object.entries(raw);
  if (entries.some(([, v]) => typeof v === 'number')) return sanitizeLooks({ [LEGACY_LOOK_MODEL]: raw });
  for (const [id, look] of entries) {
    if (Object.keys(out).length >= MAX_LOOK_MODELS) break;
    if (!isModelId(id) || !isObj(look)) continue;
    const model = characterModel(id);
    if (model) {
      out[id] = sanitizeModelLook(model, look);
      continue;
    }
    const kept: ModelLook = {};
    let n = 0;
    for (const [slot, v] of Object.entries(look)) {
      if (n >= MAX_SLOTS) break;
      if (SLOT_ID_RE.test(slot) && typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < MAX_OPTIONS) {
        kept[slot] = v;
        n++;
      }
    }
    if (n > 0) out[id] = kept;
  }
  return out;
}

/** A model id the player picked as their avatar, or undefined. */
export const sanitizeAvatar = (raw: unknown): string | undefined => (isModelId(raw) ? raw : undefined);

/** The player's look of `model` (their saved one, else the model's default). */
export const lookOf = (looks: Looks | undefined, model: CharacterModelDef): ModelLook => sanitizeModelLook(model, looks?.[model.id]);

/** The model a player is shown with outside a game: their avatar when registered, else the first registered model. */
export const avatarModel = (avatar: string | undefined): CharacterModel | undefined => characterModel(avatar) ?? MODELS[0];
