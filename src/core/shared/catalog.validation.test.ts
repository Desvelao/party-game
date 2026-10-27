import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_PLAYABLES,
  CATALOG,
  coerceOption,
  describeOptions,
  describeSelection,
  normalizeSelection,
  optionSources,
  optionsFor,
  playlistFor,
  type OptionDef,
} from './catalog';
import { getLang, setLang, type Lang } from './i18n';

const num = (extra: Partial<OptionDef> = {}): OptionDef => ({
  id: 'n',
  label: 'N',
  description: '',
  type: 'number',
  default: 5,
  ...extra,
});

describe('coerceOption', () => {
  it('rejects wrong types and non-finite numbers', () => {
    const d = num({ min: 0, max: 10 });
    for (const raw of ['5', true, null, undefined, {}, [], NaN, Infinity, -Infinity]) {
      expect(coerceOption(d, raw), String(raw)).toBeUndefined();
    }
    const b: OptionDef = { ...d, type: 'boolean', default: true };
    for (const raw of [1, 0, 'true', null, undefined]) expect(coerceOption(b, raw)).toBeUndefined();
    expect(coerceOption(b, false)).toBe(false);
    const c: OptionDef = { ...d, type: 'choice', default: 'a', choices: [{ value: 'a', label: 'A' }] };
    expect(coerceOption(c, 'a')).toBe('a');
    for (const raw of ['b', 1, true, null]) expect(coerceOption(c, raw)).toBeUndefined();
    expect(coerceOption({ ...c, choices: undefined }, 'a')).toBeUndefined();
  });

  it('clamps to min/max', () => {
    const d = num({ min: 2, max: 8 });
    expect(coerceOption(d, -100)).toBe(2);
    expect(coerceOption(d, 100)).toBe(8);
    expect(coerceOption(d, 5)).toBe(5);
    expect(coerceOption(num({ max: 8 }), -100)).toBe(-100);
  });

  it('snaps to the step grid anchored at min, never leaving [min, max]', () => {
    const d = num({ min: 1, max: 10, step: 3 }); // grid: 1, 4, 7, 10
    expect(coerceOption(d, 5)).toBe(4);
    expect(coerceOption(d, 6)).toBe(7);
    expect(coerceOption(d, 9)).toBe(10);
    // Current behaviour: when max is off the grid, a value that rounds above max is clamped to max
    // (10 here), which is not a grid point (0, 4, 8). Documented, not endorsed.
    const odd = num({ min: 0, max: 10, step: 4 });
    expect(coerceOption(odd, 10)).toBe(10);
    expect(coerceOption(odd, 5)).toBe(4);
    expect(coerceOption(num({ min: 0, max: 1, step: 0.1 }), 0.30000000000000004)).toBe(0.3);
  });

  it('snaps relative to 0 when step is set without min', () => {
    const d = num({ max: 10, step: 3 }); // grid: ..., -3, 0, 3, 6, 9
    expect(coerceOption(d, 4)).toBe(3);
    expect(coerceOption(d, 5)).toBe(6);
    expect(coerceOption(d, -4)).toBe(-3);
    expect(coerceOption(d, -5)).toBe(-6);
    expect(coerceOption(d, 11)).toBe(9); // clamped to max 10, then snapped to the grid
    expect(coerceOption(num({ step: 0.5 }), 1.3)).toBe(1.5);
  });
});

describe('normalizeSelection', () => {
  it('treats missing game as the mixed selection', () => {
    for (const g of [undefined, null, '', 'mixed']) {
      expect(normalizeSelection(g), String(g)).toEqual({ game: 'mixed', variant: 'all', options: {} });
    }
    expect(normalizeSelection('mixed', 'smashball')).toEqual({ game: 'mixed', variant: 'all', options: {} });
  });

  it('rejects unknown games, unknown variants and non-string ids', () => {
    expect(normalizeSelection('nope')).toBeNull();
    expect(normalizeSelection('ballistix', 'nope')).toBeNull();
    expect(normalizeSelection('ballistix', 'jungle-bonanza')).toBeNull(); // variant of another game
    expect(normalizeSelection(5)).toBeNull();
    expect(normalizeSelection({})).toBeNull();
    expect(normalizeSelection('ballistix', 5)).toBeNull();
  });

  it('accepts variants and defaults the variant to all', () => {
    expect(normalizeSelection('ballistix', 'smashball')).toEqual({ game: 'ballistix', variant: 'smashball', options: {} });
    for (const v of [undefined, null, '', 'all']) {
      expect(normalizeSelection('ballistix', v)).toEqual({ game: 'ballistix', variant: 'all', options: {} });
    }
  });

  it('ignores the variant for games without variants', () => {
    expect(normalizeSelection('crazy-logs', 'whatever')).toEqual({
      game: 'crazy-logs',
      variant: 'all',
      options: {},
    });
  });

  it('rejects options that are not a plain object', () => {
    for (const o of ['x', 5, true, [], [1]]) expect(normalizeSelection('ballistix', 'smashball', o), String(o)).toBeNull();
    expect(normalizeSelection('ballistix', 'smashball', null)).not.toBeNull();
    expect(normalizeSelection('ballistix', 'smashball', {})).not.toBeNull();
  });

  it('rejects option keys the selection does not offer', () => {
    expect(normalizeSelection('ballistix', 'smashball', { nope: 1 })).toBeNull();
    expect(normalizeSelection('ballistix', 'smashball', { enemyRate: 2 })).toBeNull(); // Pulse Ball only
    expect(normalizeSelection('ballistix', 'pulse-ball', { enemyRate: 2 })).toEqual({
      game: 'ballistix',
      variant: 'pulse-ball',
      options: { enemyRate: 2 },
    });
    expect(normalizeSelection('crazy-logs', undefined, { lives: 3 })).toBeNull();
  });

  it('rejects options for mixed or all-variant selections unless empty', () => {
    expect(normalizeSelection('mixed', undefined, { lives: 3 })).toBeNull();
    expect(normalizeSelection(undefined, undefined, { lives: 3 })).toBeNull();
    expect(normalizeSelection('ballistix', 'all', { lives: 3 })).toBeNull();
    expect(normalizeSelection('mixed', undefined, {})).toEqual({ game: 'mixed', variant: 'all', options: {} });
  });

  it('rejects wrong value types and non-finite numbers', () => {
    const bad = (o: Record<string, unknown>) => normalizeSelection('ballistix', 'smashball', o);
    expect(bad({ lives: '8' })).toBeNull();
    expect(bad({ lives: true })).toBeNull();
    expect(bad({ lives: NaN })).toBeNull();
    expect(bad({ lives: Infinity })).toBeNull();
    expect(bad({ lives: -Infinity })).toBeNull();
    expect(bad({ lives: null })).toBeNull();
    expect(bad({ smashEnabled: 1 })).toBeNull();
    expect(bad({ smashEnabled: 'false' })).toBeNull();
    expect(bad({ balls: 'banana' })).toBeNull();
    expect(bad({ balls: 2 })).toBeNull(); // choices are strings
  });

  it('keeps values that differ from the defaults and strips those equal to them', () => {
    const r = normalizeSelection('ballistix', 'smashball', { lives: 8, ballSpeed: 380, smashEnabled: false, balls: 'auto' });
    expect(r?.options).toEqual({ lives: 8, smashEnabled: false });
    expect(normalizeSelection('ballistix', 'smashball', { balls: '3' })?.options).toEqual({ balls: '3' });
  });

  it('compares against the variant-specific default', () => {
    // lives defaults to 5 in Smashball but 7 in Sand Orb.
    expect(normalizeSelection('ballistix', 'smashball', { lives: 5 })?.options).toEqual({});
    expect(normalizeSelection('ballistix', 'sand-orb', { lives: 5 })?.options).toEqual({ lives: 5 });
    expect(normalizeSelection('ballistix', 'sand-orb', { lives: 7 })?.options).toEqual({});
  });

  it('clamps numbers to min/max', () => {
    const o = (v: number) => normalizeSelection('ballistix', 'smashball', { lives: v })?.options;
    expect(o(99)).toEqual({ lives: 15 });
    expect(o(-4)).toEqual({ lives: 1 });
    expect(o(0)).toEqual({ lives: 1 });
  });

  it('snaps numbers to the step grid', () => {
    const o = (id: string, v: number) => normalizeSelection('ballistix', 'smashball', { [id]: v })?.options;
    expect(o('lives', 3.4)).toEqual({ lives: 3 });
    expect(o('ballSpeed', 386)).toEqual({ ballSpeed: 390 });
    expect(o('ballSpeed', 384)).toEqual({}); // snaps to the default 380 and is stripped
    expect(o('hitGain', 1.234)).toEqual({ hitGain: 1.23 });
    expect(o('smashCooldown', 2.04)).toEqual({ smashCooldown: 2 });
  });

  it('clamps first, then strips when the clamped value equals the default', () => {
    const r = normalizeSelection('ballistix', 'sand-orb', { ballSpeed: 10 }); // min 150
    expect(r?.options).toEqual({ ballSpeed: 150 });
  });

  it('does not mutate its input', () => {
    const input = { lives: 99 };
    normalizeSelection('ballistix', 'smashball', input);
    expect(input).toEqual({ lives: 99 });
  });
});

describe('optionsFor', () => {
  it('is empty for mixed, unknown games and games without options', () => {
    // every playable offers the shared "rounds to win" option and nothing else here
    expect(optionsFor('mixed', 'all').map((o) => o.id)).toEqual(['roundsToWin']);
    expect(optionsFor('nope', 'all')).toEqual([]);
    expect(optionsFor('nope', 'smashball')).toEqual([]);
    expect(optionsFor('crazy-logs', 'all').map((o) => o.id)).toContain('roundsToWin');
  });

  it('returns variant options for a variant and game-level options otherwise', () => {
    const crash = optionsFor('ballistix', 'smashball');
    expect(crash.length).toBeGreaterThan(0);
    const ids = crash.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    const g = CATALOG.find((c) => c.id === 'ballistix')!;
    expect(optionsFor('ballistix', 'all').filter((o) => o.id !== 'roundsToWin')).toEqual(g.options ?? []);
  });

  it('lets variant options override same-id game options while keeping the rest', () => {
    const game: OptionDef = { id: 'a', label: 'A', description: '', type: 'number', default: 1, min: 0, max: 9 };
    const other: OptionDef = { ...game, id: 'b' };
    const g = CATALOG.find((c) => c.id === 'box-bonanza')!;
    const saved = { go: g.options, vo: g.variants[0].options };
    try {
      g.options = [game, other];
      g.variants[0].options = [{ ...game, default: 7 }];
      const merged = optionsFor(g.id, g.variants[0].id);
      expect(merged.map((o) => o.id)).toEqual(['a', 'b', 'roundsToWin']);
      expect(merged.find((o) => o.id === 'a')?.default).toBe(7);
      expect(optionsFor(g.id, 'all').find((o) => o.id === 'a')?.default).toBe(1);
      expect(optionsFor(g.id, 'unknown-variant').map((o) => o.id)).toEqual(['a', 'b', 'roundsToWin']);
    } finally {
      g.options = saved.go;
      g.variants[0].options = saved.vo;
    }
  });
});

describe('playlistFor', () => {
  it('returns all 27 playables for mixed and unknown games', () => {
    expect(ALL_PLAYABLES).toHaveLength(27);
    expect(playlistFor({ game: 'mixed', variant: 'all' })).toEqual(ALL_PLAYABLES);
    expect(playlistFor({ game: 'mixed', variant: 'smashball' })).toEqual(ALL_PLAYABLES);
    expect(playlistFor({ game: 'nope', variant: 'all' })).toEqual(ALL_PLAYABLES);
  });

  it('returns every variant of a game in catalog order for all', () => {
    const g = CATALOG.find((c) => c.id === 'frost-shove')!;
    expect(playlistFor({ game: 'frost-shove', variant: 'all' }).map((p) => p.id)).toEqual(g.variants.map((v) => v.id));
  });

  it('returns a single entry for one variant', () => {
    expect(playlistFor({ game: 'ballistix', variant: 'cloud-orbs' })).toEqual([
      { id: 'cloud-orbs', game: 'ballistix', name: 'Cloud Orbs' },
    ]);
  });

  it('returns the game itself for games without variants', () => {
    expect(playlistFor({ game: 'crazy-logs', variant: 'all' })).toEqual([
      { id: 'crazy-logs', game: 'crazy-logs', name: 'Crazy Logs' },
    ]);
  });
});

describe('describeSelection / describeOptions', () => {
  let prev: Lang;
  beforeEach(() => {
    prev = getLang();
  });
  afterEach(() => setLang(prev));

  it('describes selections in English', () => {
    setLang('en');
    expect(describeSelection({ game: 'mixed', variant: 'all', options: {} })).toBe('Mixed games');
    expect(describeSelection({ game: 'nope', variant: 'all', options: {} })).toBe('Mixed games');
    expect(describeSelection({ game: 'crazy-logs', variant: 'all', options: {} })).toBe('Crazy Logs');
    expect(describeSelection({ game: 'crazy-logs', variant: 'all', options: { x: 1 } })).toBe('Crazy Logs (custom)');
    expect(describeSelection({ game: 'ballistix', variant: 'all', options: {} })).toBe('Ballistix - all variants');
    expect(describeSelection({ game: 'ballistix', variant: 'smashball', options: {} })).toBe('Ballistix - Smashball');
    expect(describeSelection({ game: 'ballistix', variant: 'smashball', options: { lives: 8 } })).toBe(
      'Ballistix - Smashball (custom)',
    );
  });

  it('describes selections in Spanish', () => {
    setLang('es');
    expect(describeSelection({ game: 'mixed', variant: 'all', options: {} })).toBe('Juegos mixtos');
    expect(describeSelection({ game: 'ballistix', variant: 'all', options: {} })).toBe('Ballistix - todas las variantes');
    expect(describeSelection({ game: 'ballistix', variant: 'smashball', options: { lives: 8 } })).toMatch(
      / \(personalizado\)$/,
    );
  });

  it('formats option values in English', () => {
    setLang('en');
    const sel = (options: Record<string, number | boolean | string>) =>
      describeOptions({ game: 'ballistix', variant: 'smashball', options });
    expect(sel({})).toEqual([]);
    expect(sel({ lives: 8 })).toEqual(['Lives per side: 8']);
    expect(sel({ smashEnabled: false })).toEqual(['Boost enabled: off']);
    expect(sel({ smashEnabled: true })).toEqual(['Boost enabled: on']);
    expect(sel({ maxBalls: 0 })).toEqual(['Maximum balls: No maximum']);
    expect(sel({ maxBalls: 6 })).toEqual(['Maximum balls: 6']);
    expect(sel({ smashCooldown: 2 })).toEqual(['Boost cooldown: 2s']);
    expect(sel({ balls: '3' })).toEqual(['Balls in play: 3']);
    expect(sel({ balls: 'auto' })).toEqual(['Balls in play: Auto']);
    expect(sel({ unknownKey: 1 })).toEqual([]); // ids the selection does not offer are skipped
    expect(sel({ lives: 8, smashCooldown: 2 })).toEqual(['Lives per side: 8', 'Boost cooldown: 2s']);
  });

  it('formats option values in Spanish', () => {
    setLang('es');
    const sel = (options: Record<string, number | boolean | string>) =>
      describeOptions({ game: 'ballistix', variant: 'smashball', options });
    expect(sel({ lives: 8 })).toEqual(['Vidas por lado: 8']);
    expect(sel({ smashEnabled: false })[0]).toMatch(/: no$/);
    expect(sel({ maxBalls: 0 })[0]).toMatch(/: Sin máximo$/);
    expect(sel({ smashCooldown: 2 })[0]).toMatch(/: 2s$/);
  });
});

describe('option groups', () => {
  it('every option of every game and variant has an explicit group', async () => {
    const { OPTION_GROUP_OF } = await import('./option-groups');
    const missing = new Set<string>();
    for (const g of CATALOG) {
      for (const v of ['all', ...g.variants.map((x) => x.id)]) {
        for (const d of optionsFor(g.id, v)) if (!d.group && !(d.id in OPTION_GROUP_OF)) missing.add(d.id);
      }
    }
    expect([...missing]).toEqual([]);
  });
});

describe('optionSources', () => {
  it('tells core options (every variant has them) from variant-specific ones', () => {
    const beach = optionSources('ballistix', 'sand-orb');
    expect(beach.lives).toBe('core');
    expect(beach.smashGain).toBe('core');
    expect(beach.roundsToWin).toBe('core');
    expect(beach.magnetCapacity).toBe('variant');
    const nb = optionSources('ballistix', 'pulse-ball');
    expect(nb.enemyEnabled).toBe('variant');
    expect(nb.repelForce).toBe('variant');
    expect(nb.timeLimit).toBe('core');
  });

  it('is empty without variants, for mixed and for all variants; classifies every option', () => {
    expect(optionSources('crazy-logs', 'all')).toEqual({});
    expect(optionSources('mixed', 'all')).toEqual({});
    expect(optionSources('ballistix', 'all')).toEqual({});
    for (const g of CATALOG.filter((c) => c.variants.length > 1)) {
      for (const v of g.variants) {
        const src = optionSources(g.id, v.id);
        expect(Object.keys(src).sort(), `${g.id}/${v.id}`).toEqual(optionsFor(g.id, v.id).map((o) => o.id).sort());
      }
    }
  });
});

describe('game tags', () => {
  it('every game is tagged with the fixed vocabulary, and a tag filter narrows games and variants', async () => {
    const { GAME_TAGS, filterByTags, tagsInUse, tagsOf } = await import('./catalog');
    for (const g of CATALOG) {
      expect(g.tags?.length, g.id).toBeGreaterThan(0);
      for (const x of [...tagsOf(g), ...g.variants.flatMap((v) => tagsOf(g, v))]) expect(GAME_TAGS, `${g.id}: ${x}`).toContain(x);
    }
    expect(tagsInUse(CATALOG).length).toBeGreaterThan(3);
    const race = filterByTags(CATALOG, ['race']);
    expect(race.map((g) => g.id)).toEqual(['sprint-smash']);
    expect(race[0]).toBe(CATALOG.find((g) => g.id === 'sprint-smash'));
    expect(filterByTags(CATALOG, [])).toBe(CATALOG);
    expect(filterByTags(CATALOG, ['race', 'turn-based'])).toEqual([]);
    // every tag a game uses can be picked, and what it picks is never empty
    for (const x of tagsInUse(CATALOG)) expect(filterByTags(CATALOG, [x]).length, x).toBeGreaterThan(0);
  });

  it('a variant keeps the game tags unless it has its own', async () => {
    const { filterByTags, tagsOf } = await import('./catalog');
    const game = { id: 'g', tags: ['race'], variants: [{ id: 'a' }, { id: 'b', tags: ['points'] }] } as never as (typeof CATALOG)[number];
    expect(tagsOf(game, game.variants[0])).toEqual(['race']);
    expect(tagsOf(game, game.variants[1])).toEqual(['points']);
    expect(filterByTags([game], ['points'])[0]!.variants.map((v) => v.id)).toEqual(['b']);
    expect(filterByTags([game], ['race'])[0]!.variants.map((v) => v.id)).toEqual(['a']);
  });
});
