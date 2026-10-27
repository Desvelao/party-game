import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import manifest from '../game.json';
import { POGO_VARIANTS, createSpringShowdown } from '../server/create';
import type { PogoState } from '../shared/types';
import { springShowdown } from './index';
import { LEVEL_ORDER, LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { PlannerPolicy } from './policy/planner';
import { playRound } from './sim';
import { ADAPTERS, createAdapter } from './variants';
import { WorldModel } from './world';

const n = 8;
function snap(over: Partial<PogoState> = {}, me: Partial<PogoState['players'][0]> = {}): PogoState {
  const p = (id: string, c: number, r: number) => ({ id, c, r, pc: c, pr: r, hop: 1, f: 0, score: 0, tiles: 0, item: '' as const, boots: 0, lock: 0, stun: false, inv: false, gone: false });
  return { kind: 'ext:spring-showdown', variant: 'spring-painter', t: 0, limit: 90, size: n, tiles: new Array(n * n).fill(-1), players: [{ ...p('me', 3, 3), ...me }, p('foe', 6, 6)], items: [], missiles: [], ...over };
}
const plan = (s: PogoState, params: Record<string, number> = {}) =>
  new PlannerPolicy({ ...DEFAULT_PARAMS, ...params }, () => 0.5, createAdapter(s.variant)).decide(new WorldModel('me', 60, new Set()).update(s, 0, 0), 0);

describe('planner', () => {
  it('paints a free square rather than its own', () => {
    const s = snap();
    // own squares above and to the left; free to the right and below
    s.tiles[2 * n + 3] = 0;
    s.tiles[3 * n + 2] = 0;
    s.tiles[3 * n + 3] = 0;
    const d = plan(s, { depth: 1 });
    expect([1, 2]).toContain(d.dir);
  });

  it('does not try to hop onto a player when collisions are on', () => {
    const s = snap({ solid: true }, { tiles: 0 });
    s.players[1] = { ...s.players[1], c: 4, r: 3, pc: 4, pr: 3 };
    // the only fresh squares: the rival's, and below
    for (let i = 0; i < n * n; i++) s.tiles[i] = 0;
    s.tiles[3 * n + 4] = -1;
    s.tiles[4 * n + 3] = -1;
    expect(plan(s, { depth: 1 }).dir).toBe(2);
  });

  it('goes for a crate when it has squares to bank', () => {
    const s = snap({ items: [{ id: 1, c: 3, r: 1, k: 'crate', d: 0 }] }, { tiles: 12 });
    for (let i = 0; i < 12; i++) s.tiles[7 * n + (i % 8)] = 0;
    expect(plan(s).dir).toBe(0);
  });

  it('keeps off its own colour where landing on it wipes everything', () => {
    const s = snap({ variant: 'spring-lock' }, { tiles: 3 });
    s.tiles[2 * n + 3] = 0;
    s.tiles[3 * n + 4] = 0;
    s.tiles[3 * n + 3] = 0;
    const d = plan(s, { depth: 1 });
    expect([2, 3]).toContain(d.dir);
  });

  it('fires a missile at a rival lined up in its row', () => {
    const s = snap({}, { item: 'missile' });
    s.players[1].c = 6;
    s.players[1].r = 3;
    const d = plan(s);
    expect(d.fire).toBe(true);
    expect(d.fireDir).toBe(1);
  });

  it('steps out of a missile coming down its column', () => {
    const s = snap({ missiles: [{ id: 9, x: 3.5, y: 0.2, dir: 2 }] });
    // every square around is free, so only the missile decides: not up or down the column
    const d = plan(s, { depth: 1 });
    expect([1, 3]).toContain(d.dir);
  });
});

describe('rules contract (if one fails, the game changed: see src/games/spring-showdown/AGENTS.md)', () => {
  it('every variant of game.json has an adapter', () => {
    const ids = (manifest.catalog.variants as { id: string }[]).map((v) => v.id).sort();
    expect(Object.keys(ADAPTERS).sort()).toEqual(ids);
    expect(POGO_VARIANTS.map((v) => v.id).sort()).toEqual(ids);
  });

  it('holding a direction hops one square that way, and the snapshot shows the destination at once', () => {
    const g = createSpringShowdown(POGO_VARIANTS[0], {}, () => 0.5);
    g.init([{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }]);
    const s0 = g.getState().players[0];
    g.handleInput('a', { mx: 0, my: 1, a1: false, a2: false });
    g.update(1 / 60);
    const s1 = g.getState().players[0];
    expect([s1.c, s1.r]).toEqual([s0.c, s0.r + 1]);
    expect(s1.hop).toBeLessThan(1);
  });
});

describe('levels', () => {
  it('are ordered and only use known parameters', () => {
    expect(LEVEL_ORDER).toEqual(['easy', 'normal', 'hard', 'expert', 'semigod']);
    for (const l of LEVEL_ORDER) for (const k of Object.keys(LEVELS[l])) expect(DEFAULT_PARAMS).toHaveProperty(k);
    expect(springShowdown.levels).toBe(LEVELS);
  });
});

describe('headless rounds', () => {
  it('every variant plays to the end, cheaply', () => {
    for (const v of POGO_VARIANTS) {
      const r = playRound(v.id, [{ level: 'semigod' }, { level: 'normal' }, { level: 'easy' }], { options: { timeLimit: 30 }, seed: 3, clock: () => performance.now() });
      expect(r.places).toHaveLength(3);
      expect(r.p99DecideMs).toBeLessThan(25); // headroom: the full suite runs files in parallel
    }
  });

  it('semigod beats easy', () => {
    let wins = 0;
    for (let i = 0; i < 6; i++) {
      const swap = i % 2 === 1;
      const r = playRound('spring-painter', swap ? [{ level: 'easy' }, { level: 'semigod' }] : [{ level: 'semigod' }, { level: 'easy' }], { options: { timeLimit: 45 }, seed: 20 + i });
      const god = swap ? 1 : 0;
      if (r.places[god] < r.places[1 - god]) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
  });
});
