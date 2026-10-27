import { describe, expect, it } from 'vitest';
import {
  ALL_PLAYABLES,
  CATALOG,
  validateDefaults,
  actionFor,
  filterCatalog,
  normalizeSelection,
  playerCountConflict,
  playerLimitOf,
  selectionSupportsTeams,
  selectionTeamSizeLimit,
  supportsTeams,
  teamSizeLimitOf,
  publishedSettings,
  selectionPlayerLimit,
  variantName,
} from './catalog';

describe('variantName', () => {
  it('maps every catalog variant id to its catalog name', () => {
    for (const g of CATALOG) for (const v of g.variants) expect(variantName(v.id)).toBe(v.name);
  });

  it('falls back to the id with every hyphen replaced', () => {
    expect(variantName('some-unknown-variant')).toBe('some unknown variant');
  });
});

describe('actionFor', () => {
  const EXPECTED: Record<string, string> = {
    'crazy-logs': 'act',
    'rumble-cards': 'act',
    smashball: 'boost',
    'pulse-ball': 'boost',
    'cloud-orbs': 'boost',
    'sand-orb': 'grab',
    'frost-classic': 'charge',
    'frost-frenzy': 'charge',
    'tip-tumble': 'charge',
    'thaw-frenzy': 'charge',
    'wild-frenzy': 'charge',
    'spring-painter': 'fire',
    'spring-rush': 'fire',
    'spring-madness': 'fire',
    'spring-lock': 'fire',
    'desert-fox': 'fire',
    'metal-fox': 'fire',
    'jungle-fox': 'fire',
    'swamp-fox': 'fire',
    'dot-sprint': 'dash',
    'toxic-sprint': 'dash',
    'ember-sprint': 'dash',
    'splash-sprint': 'dash',
    'jungle-bonanza': 'grab',
    'space-bonanza': 'grab',
    'snow-bonanza': 'grab',
    'drain-bonanza': 'grab',
  };

  it('maps every playable id to its expected action', () => {
    for (const p of ALL_PLAYABLES) expect(actionFor(p.id), p.id).toBe(EXPECTED[p.id]);
    expect(ALL_PLAYABLES.map((p) => p.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('falls back to dash for unknown ids', () => {
    expect(actionFor('nope')).toBe('dash');
  });
});

describe('filterCatalog', () => {
  it('returns the catalog itself when nothing is off', () => {
    expect(filterCatalog([])).toBe(CATALOG);
  });

  it('drops a disabled family and a disabled variant, ignoring unknown ids', () => {
    const list = filterCatalog(['box-bonanza', 'frost-classic', 'no-such-game']);
    expect(list.map((g) => g.id)).not.toContain('box-bonanza');
    expect(list.find((g) => g.id === 'frost-shove')!.variants.map((v) => v.id)).not.toContain('frost-classic');
    expect(list.find((g) => g.id === 'frost-shove')!.variants.length).toBe(
      CATALOG.find((g) => g.id === 'frost-shove')!.variants.length - 1,
    );
  });

  it('drops a family whose variants are all disabled, but keeps variant-less games', () => {
    const polar = CATALOG.find((g) => g.id === 'frost-shove')!.variants.map((v) => v.id);
    const list = filterCatalog(polar);
    expect(list.map((g) => g.id)).not.toContain('frost-shove');
    expect(list.map((g) => g.id)).toContain('crazy-logs');
  });
});

describe('player limits', () => {
  it('every declared limit is a usable player count', () => {
    for (const g of CATALOG) {
      if (g.maxPlayers !== undefined) expect(g.maxPlayers).toBeGreaterThanOrEqual(2);
      for (const v of g.variants) if (v.maxPlayers !== undefined) expect(v.maxPlayers).toBeGreaterThanOrEqual(2);
    }
  });

  it('Ballistix and all its variants hold 4; other games are unlimited', () => {
    expect(playerLimitOf('smashball')).toBe(4);
    expect(playerLimitOf('cloud-orbs')).toBe(4);
    expect(playerLimitOf('crazy-logs')).toBeUndefined();
  });

  it('is published per game and variant', () => {
    const pub = publishedSettings();
    expect(pub.find((p) => p.target === 'ballistix')?.maxPlayers).toBe(4);
    expect(pub.find((p) => p.target === 'smashball')?.maxPlayers).toBe(4);
    expect(pub.find((p) => p.target === 'crazy-logs')?.maxPlayers).toBeUndefined();
  });

  it('blocks an explicit game, variant or playlist; a rotation only when nothing fits', () => {
    const one = normalizeSelection('ballistix', 'smashball', {})!;
    expect(selectionPlayerLimit(one)).toBe(4);
    expect(playerCountConflict(one, 4)).toBeNull();
    expect(playerCountConflict(one, 5)).toMatchObject({ max: 4 });

    const list = normalizeSelection(undefined, undefined, undefined, [
      { game: 'crazy-logs', variant: 'all', options: {} },
      { game: 'ballistix', variant: 'smashball', options: {} },
    ])!;
    expect(selectionPlayerLimit(list)).toBe(4);
    expect(playerCountConflict(list, 6)).toMatchObject({ max: 4 });

    const mix = normalizeSelection('mixed', 'all', {})!;
    expect(selectionPlayerLimit(mix)).toBeUndefined();
    expect(playerCountConflict(mix, 8)).toBeNull();

    const allBallistix = normalizeSelection('ballistix', 'all', {})!;
    expect(selectionPlayerLimit(allBallistix)).toBe(4);
    expect(playerCountConflict(allBallistix, 6)).toMatchObject({ max: 4 });
  });
});

describe('team support', () => {
  it('every family supports teams with a usable team size', () => {
    for (const g of CATALOG) {
      expect(g.teams).toBe(true);
      expect(g.maxTeamSize).toBeGreaterThanOrEqual(1);
      expect(supportsTeams(g.id)).toBe(true);
      for (const v of g.variants) {
        expect(supportsTeams(v.id)).toBe(true);
        expect(teamSizeLimitOf(v.id)).toBe(v.maxTeamSize ?? g.maxTeamSize);
      }
    }
    expect(teamSizeLimitOf('smashball')).toBe(2);
    expect(supportsTeams('nope')).toBe(false);
  });

  it('is published per game and variant', () => {
    const pub = publishedSettings();
    expect(pub.find((p) => p.target === 'ballistix')).toMatchObject({ teams: true, maxTeamSize: 2 });
    expect(pub.find((p) => p.target === 'smashball')).toMatchObject({ teams: true, maxTeamSize: 2 });
  });

  it('a selection supports teams only when every round does; size is the strictest', () => {
    expect(selectionSupportsTeams(normalizeSelection('ballistix', 'smashball', {})!)).toBe(true);
    const mixed = normalizeSelection('mixed', undefined, undefined)!;
    expect(selectionSupportsTeams(mixed)).toBe(true);
    expect(selectionTeamSizeLimit(mixed)).toBe(2);
    expect(selectionTeamSizeLimit(normalizeSelection('crazy-logs', undefined, {})!)).toBe(4);
  });
});

describe('renamed option ids', () => {
  it('old ids still load from saved selections and operator defaults', () => {
    const sel = normalizeSelection('frost-shove', 'tip-tumble', { walrusJitter: 2 });
    expect(sel?.options).toEqual({ walrusVariance: 2 });
    expect(validateDefaults({ 'thaw-frenzy': { meltJitter: 1 } })).toEqual({ value: { 'thaw-frenzy': { meltVariance: 1 } }, errors: [] });
  });
});
