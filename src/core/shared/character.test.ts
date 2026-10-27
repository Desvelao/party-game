import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGACY_LOOK_MODEL,
  MAX_LOOK_MODELS,
  PALETTE,
  avatarModel,
  characterModel,
  characterModels,
  defaultLook,
  lookOf,
  randomLook,
  registerCharacterModels,
  sanitizeAvatar,
  sanitizeColor,
  sanitizeLooks,
  sanitizeModelLook,
  unregisterCharacterModels,
  validateCharacterDefs,
  validateCharacterRef,
  type CharacterModelDef,
} from './character';
import { shapePen } from './kit/shapes';

const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `O${i}` }));
const ROBOT: CharacterModelDef = {
  id: 'robot',
  name: 'Robot',
  slots: [
    { id: 'head', label: 'Head', options: opts(3), default: 1 },
    { id: 'antenna', label: 'Antenna', options: opts(2), default: 0 },
  ],
};
const DUCK: CharacterModelDef = { id: 'duck', name: 'Duck', slots: [{ id: 'beak', label: 'Beak', options: opts(4), default: 2 }] };
const PACK = { kind: 'game', id: 'robots' } as const;
const PLUGIN = { kind: 'plugin', id: 'ducks' } as const;

afterEach(() => {
  unregisterCharacterModels(PACK);
  unregisterCharacterModels(PLUGIN);
});

describe('registry', () => {
  it('registers in order, keeps the first owner of an id and unregisters per owner', () => {
    expect(registerCharacterModels(PACK, [ROBOT])).toEqual([]);
    expect(registerCharacterModels(PLUGIN, [DUCK, { ...ROBOT, name: 'Other robot' }])).toEqual(['robot']);
    expect(characterModels().map((m) => m.id)).toEqual(['robot', 'duck']);
    expect(characterModel('robot')?.owner).toEqual(PACK);
    expect(characterModel('robot')?.name).toBe('Robot');
    unregisterCharacterModels(PACK);
    expect(characterModel('robot')).toBeUndefined();
    expect(characterModel('duck')?.owner).toEqual(PLUGIN);
  });
  it('picks the avatar model, else the first one', () => {
    expect(avatarModel('robot')).toBeUndefined();
    registerCharacterModels(PACK, [ROBOT]);
    registerCharacterModels(PLUGIN, [DUCK]);
    expect(avatarModel('duck')?.id).toBe('duck');
    expect(avatarModel('gone')?.id).toBe('robot');
    expect(avatarModel(undefined)?.id).toBe('robot');
  });
});

describe('looks', () => {
  it('default and random looks are complete and valid', () => {
    expect(defaultLook(ROBOT)).toEqual({ head: 1, antenna: 0 });
    for (let i = 0; i < 30; i++) {
      const look = randomLook(ROBOT);
      expect(sanitizeModelLook(ROBOT, look)).toEqual(look);
    }
    expect(randomLook(ROBOT, () => 0.999999)).toEqual({ head: 2, antenna: 1 });
  });
  it('sanitizeModelLook keeps valid slots and defaults the rest', () => {
    expect(sanitizeModelLook(ROBOT, { head: 2, antenna: 5, evil: 1 })).toEqual({ head: 2, antenna: 0 });
    expect(sanitizeModelLook(ROBOT, { head: 1.5, antenna: '1' })).toEqual(defaultLook(ROBOT));
    for (const v of [null, 3, 'x', []]) expect(sanitizeModelLook(ROBOT, v)).toEqual(defaultLook(ROBOT));
  });
  it('sanitizeLooks checks registered models and keeps small unknown ones', () => {
    registerCharacterModels(PACK, [ROBOT]);
    const looks = sanitizeLooks({ robot: { head: 9 }, ghost: { cape: 3, bad: -1, huge: 99, 'not id': 1 }, 'Bad Id': { a: 1 }, empty: { x: 'y' } });
    expect(looks).toEqual({ robot: { head: 1, antenna: 0 }, ghost: { cape: 3 } });
    for (const v of [null, 3, 'x', []]) expect(sanitizeLooks(v)).toEqual({});
  });
  it('reads an old flat look as the legacy model', () => {
    expect(sanitizeLooks({ body: 1, hat: 2 })).toEqual({ [LEGACY_LOOK_MODEL]: { body: 1, hat: 2 } });
  });
  it('bounds the number of models kept', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`m${i}`, { a: 1 }]));
    expect(Object.keys(sanitizeLooks(many))).toHaveLength(MAX_LOOK_MODELS);
  });
  it('lookOf falls back to the default', () => {
    expect(lookOf({ robot: { head: 2, antenna: 1 } }, ROBOT)).toEqual({ head: 2, antenna: 1 });
    expect(lookOf({}, ROBOT)).toEqual(defaultLook(ROBOT));
    expect(lookOf(undefined, ROBOT)).toEqual(defaultLook(ROBOT));
  });
  it('sanitizeAvatar accepts model ids only', () => {
    expect(sanitizeAvatar('robot')).toBe('robot');
    for (const v of ['', 'Robot', 3, null, 'x'.repeat(40)]) expect(sanitizeAvatar(v)).toBeUndefined();
  });
});

describe('validateCharacterDefs', () => {
  const check = (v: unknown) => {
    const errs: string[] = [];
    validateCharacterDefs(v, 'characters', errs);
    return errs;
  };
  it('accepts a valid list and nothing', () => {
    expect(check([ROBOT, DUCK])).toEqual([]);
    expect(check(undefined)).toEqual([]);
    expect(check([{ ...DUCK, slots: [{ ...DUCK.slots[0], options: [{ label: 'Red', swatch: 0xff0000 }, { label: 'Blue' }] , default: 0 }] }])).toEqual([]);
  });
  it('reports bad models, slots and options', () => {
    expect(check([])).not.toEqual([]);
    expect(check([ROBOT, ROBOT]).join()).toContain('repeated');
    expect(check([{ ...ROBOT, id: 'Robot' }]).join()).toContain('.id');
    expect(check([{ ...ROBOT, slots: [] }]).join()).toContain('slots');
    expect(check([{ ...ROBOT, slots: [{ ...ROBOT.slots[0], options: opts(1) }] }]).join()).toContain('options');
    expect(check([{ ...ROBOT, slots: [{ ...ROBOT.slots[0], default: 3 }] }]).join()).toContain('default');
    expect(check([{ ...ROBOT, slots: [ROBOT.slots[0], ROBOT.slots[0]] }]).join()).toContain('repeated');
    expect(check([{ ...DUCK, slots: [{ ...DUCK.slots[0], options: [{ label: 'a', swatch: -1 }, { label: 'b' }] }] }]).join()).toContain('swatch');
  });
  it('checks the model a game names', () => {
    const errs: string[] = [];
    validateCharacterRef('blob', 'character', errs);
    validateCharacterRef(undefined, 'character', errs);
    expect(errs).toEqual([]);
    validateCharacterRef('Blob!', 'character', errs);
    expect(errs).toHaveLength(1);
  });
});

describe('sanitizeColor', () => {
  it('accepts palette indexes only', () => {
    expect(sanitizeColor(3)).toBe(3);
    expect(sanitizeColor(PALETTE.length)).toBe(0);
    expect(sanitizeColor(-1)).toBe(0);
    expect(sanitizeColor('2')).toBe(0);
  });
});

describe('shapePen', () => {
  it('turns (u, v) with the facing and scales by the radius', () => {
    const pen = shapePen(10, Math.PI / 2);
    const c = pen.circle(1, 0, 0.5, 7);
    expect(c.k === 'circle' && [Math.round(c.x), Math.round(c.y), c.r]).toEqual([0, 10, 5]);
    const sq = pen.regular(4, 1, 1);
    expect(sq.k === 'poly' && sq.pts).toHaveLength(8);
  });
});
