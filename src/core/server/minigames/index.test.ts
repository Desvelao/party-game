import { describe, expect, it } from 'vitest';
import { ALL_PLAYABLES, CATALOG, normalizeSelection, playlistFor } from '../../shared';
import { REGISTERED_IDS, createMinigame } from '.';

describe('selection', () => {
  it('registry and catalog are in sync', () => {
    expect([...REGISTERED_IDS].sort()).toEqual(ALL_PLAYABLES.map((p) => p.id).sort());
  });

  it('every game and variant has a description', () => {
    for (const g of CATALOG) {
      expect(g.description.length).toBeGreaterThan(0);
      for (const v of g.variants) expect(v.description.length).toBeGreaterThan(0);
    }
  });

  it('validates untrusted game/variant', () => {
    expect(normalizeSelection(undefined, undefined)).toEqual({ game: 'mixed', variant: 'all', options: {} });
    expect(normalizeSelection('ballistix', 'cloud-orbs')).toEqual({ game: 'ballistix', variant: 'cloud-orbs', options: {} });
    expect(normalizeSelection('ballistix')).toEqual({ game: 'ballistix', variant: 'all', options: {} });
    expect(normalizeSelection('crazy-logs', 'whatever')).toEqual({ game: 'crazy-logs', variant: 'all', options: {} });
    expect(normalizeSelection('nope')).toBeNull();
    expect(normalizeSelection('ballistix', 'smashball2')).toBeNull();
    expect(normalizeSelection('crazy-logs', 5)).toBeNull();
    expect(normalizeSelection({}, undefined)).toBeNull();
  });

  it('builds playlists', () => {
    expect(playlistFor({ game: 'mixed', variant: 'all' })).toHaveLength(27);
    expect(playlistFor({ game: 'ballistix', variant: 'all' }).map((p) => p.id)).toEqual([
      'smashball',
      'sand-orb',
      'pulse-ball',
      'cloud-orbs',
    ]);
    expect(playlistFor({ game: 'ballistix', variant: 'sand-orb' }).map((p) => p.id)).toEqual(['sand-orb']);
    expect(playlistFor({ game: 'crazy-logs', variant: 'all' }).map((p) => p.id)).toEqual(['crazy-logs']);
    expect(playlistFor({ game: 'frost-shove', variant: 'all' }).map((p) => p.id)).toEqual([
      'frost-classic',
      'frost-frenzy',
      'tip-tumble',
      'thaw-frenzy',
      'wild-frenzy',
    ]);
    expect(playlistFor({ game: 'spring-showdown', variant: 'all' }).map((p) => p.id)).toEqual([
      'spring-painter',
      'spring-rush',
      'spring-madness',
      'spring-lock',
    ]);
    expect(playlistFor({ game: 'box-bonanza', variant: 'all' }).map((p) => p.id)).toEqual([
      'jungle-bonanza',
      'space-bonanza',
      'snow-bonanza',
      'drain-bonanza',
    ]);
  });

  it('createMinigame runs each custom round in order with its own options', () => {
    const sel = normalizeSelection(undefined, undefined, undefined, [
      { game: 'spring-showdown', variant: 'spring-painter', options: { gridSize: 10 } },
      { game: 'crazy-logs' },
      { game: 'spring-showdown', variant: 'spring-painter' },
    ])!;
    expect([0, 1, 2].map((i) => createMinigame(sel, i).id)).toEqual(['spring-painter', 'crazy-logs', 'spring-painter']);
    const size = (i: number) => {
      const g = createMinigame(sel, i);
      g.init([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
      return (g.getState() as unknown as { size: number }).size;
    };
    expect(size(0)).toBe(10);
    expect(size(2)).toBe(8);
  });

  it('createMinigame follows the selection', () => {
    const sel = { game: 'ballistix', variant: 'pulse-ball', options: {} };
    for (let i = 0; i < 3; i++) expect(createMinigame(sel, i).id).toBe('pulse-ball');
    const rot = { game: 'ballistix', variant: 'all', options: {} };
    expect([0, 1, 2, 3, 4].map((i) => createMinigame(rot, i).id)).toEqual([
      'smashball',
      'sand-orb',
      'pulse-ball',
      'cloud-orbs',
      'smashball',
    ]);
  });
});

describe('player limits', () => {
  it('a mixed rotation never rolls a game that cannot hold the players', () => {
    const mix = { game: 'mixed', variant: 'all', options: {} };
    for (let i = 0; i < ALL_PLAYABLES.length * 2; i++) {
      expect(createMinigame(mix, i, () => true, 6).id).not.toMatch(/smashball|sand-orb|pulse-ball|cloud-orbs/);
    }
  });
});

describe('disconnect contract', () => {
  const NAMES = ['a', 'b', 'c', 'd'];
  const players = () => NAMES.map((id) => ({ id, name: id.toUpperCase() }));

  function run(id: string, leavers: string[]) {
    const game = createMinigame({ game: id, variant: id }, 0);
    game.init(players());
    const dt = 1 / 30;
    // everyone moves around so leavers have banked score / progress before they go
    NAMES.slice(1).forEach((n, i) => game.handleInput(n, { mx: i % 2 ? -1 : 1, my: i < 1 ? 1 : -1, a1: true, a2: false }));
    // play a while first so leavers have banked score / progress before they go
    for (let t = 0; t < 3 && !game.isFinished(); t += dt) game.update(dt);
    const endedEarly = game.isFinished();
    for (const l of leavers) game.removePlayer(l);
    for (let t = 0; t < 600 && !game.isFinished(); t += dt) game.update(dt);
    return { game, endedEarly };
  }

  for (const id of REGISTERED_IDS) {
    for (const mode of ['all but one', 'everyone'] as const) {
      it(`${id}: ${mode} leave`, () => {
        const leavers = mode === 'everyone' ? NAMES : NAMES.slice(1);
        const { game, endedEarly } = run(id, leavers);
        expect(game.isFinished()).toBe(true);
        const placements = game.getPlacements();
        expect(placements.map((p) => p.id).sort()).toEqual([...NAMES].sort());
        // a round that already ended through normal play before anyone left says nothing about leavers
        if (mode === 'all but one' && !endedEarly) {
          const stay = placements.find((p) => p.id === 'a')!.place;
          for (const p of placements) if (p.id !== 'a') expect(p.place).toBeGreaterThan(stay);
          expect(stay).toBe(1);
        }
      });
    }
  }
});
