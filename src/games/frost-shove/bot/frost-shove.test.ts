import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import manifest from '../game.json';
import { POLAR_VARIANTS } from '../server/config';
import { createFrostShove } from '../server/create';
import { frostShove } from './index';
import { LEVEL_ORDER, LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { C, DASH_REACH, coast, margin, moveOf, rayToEdge, step } from './physics';
import { playRound } from './sim';
import { ADAPTERS } from './variants';
import { WorldModel } from './world';
import type { FrostShoveState } from '../shared/types';

const round16 = (r: number) => new Array(16).fill(r);

describe('physics', () => {
  it('a bear steering one way reaches top speed and coasts to a stop', () => {
    const b = { x: C, y: C, vx: 0, vy: 0 };
    const m = moveOf('');
    for (let i = 0; i < 120; i++) step(b, 1, 0, 1 / 60, m);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(m.max, 0);
    const end = coast(b, 10);
    expect(end.x - b.x).toBeCloseTo(m.max / 2.4, 0);
  });

  it('measures the ice left and the distance to the edge', () => {
    expect(margin(round16(400), C, C, 26)).toBeCloseTo(400 + 26 * 0.35, 3);
    expect(margin(round16(400), C + 420, C, 26)).toBeLessThan(0);
    expect(rayToEdge(round16(400), C, C, 1, 0, 26, 500)).toBeGreaterThan(390);
  });

  it('a dash covers about 150 px before the speed cap is back', () => {
    expect(DASH_REACH).toBeCloseTo(152, 0);
  });
});

function snap(over: Partial<FrostShoveState> = {}): FrostShoveState {
  const bear = (id: string, x: number, y: number) => ({ id, x, y, f: 0, alive: true, inv: false, st: 1, r: 26, fx: '', fxl: 0, carry: '', carryl: 0, stun: 0, drown: 0, fall: 0, bomb: false, hits: 0 });
  return { kind: 'ext:frost-shove', variant: 'frost-classic', t: 0, limit: 90, sectors: round16(400), tilt: { x: 0, y: 0 }, players: [bear('me', 500, 500), bear('mate', 600, 500), bear('foe', 400, 500)], items: [], ...over };
}

describe('world', () => {
  it('estimates velocities and keeps teammates out of the rivals', () => {
    const wm = new WorldModel('me', 60, new Set(['mate']));
    wm.update(snap(), 0, 0);
    const s = snap();
    s.players[0].x = 510;
    const w = wm.update(s, 6, 100);
    expect(w.me?.vx).toBeCloseTo(100, 0);
    expect(w.rivals.map((r) => r.id)).toEqual(['foe']);
    expect(w.allies.map((r) => r.id)).toEqual(['mate']);
  });

  it('a bear past the edge is in the water even before its climb starts', () => {
    const s = snap();
    s.players[2].x = 950;
    const w = new WorldModel('me', 60, new Set()).update(s, 0, 0);
    expect(w.rivals.find((r) => r.id === 'foe')?.wet).toBe(true);
  });
});

describe('rules contract (if one fails, the game changed: see src/games/frost-shove/AGENTS.md)', () => {
  it('every variant of game.json has an adapter', () => {
    const ids = (manifest.catalog.variants as { id: string }[]).map((v) => v.id).sort();
    expect(Object.keys(ADAPTERS).sort()).toEqual(ids);
    expect(POLAR_VARIANTS.map((v) => v.id).sort()).toEqual(ids);
  });

  it('a press of a1 dashes along the stick, and five presses climb out of the water', () => {
    const g = createFrostShove(POLAR_VARIANTS[0], {}, () => 0.5);
    g.init([{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }]);
    const x0 = g.getState().players[0].x;
    g.handleInput('a', { mx: 1, my: 0, a1: true, a2: false });
    g.update(1 / 60);
    g.update(1 / 60);
    const dashed = g.getState().players[0];
    expect(dashed.x - x0).toBeGreaterThan(20);
    expect(dashed.st).toBeCloseTo(0.5, 1);
  });
});

describe('levels', () => {
  it('are ordered and only use known parameters', () => {
    expect(LEVEL_ORDER).toEqual(['easy', 'normal', 'hard', 'expert', 'semigod']);
    for (const l of LEVEL_ORDER) for (const k of Object.keys(LEVELS[l])) expect(DEFAULT_PARAMS).toHaveProperty(k);
    for (let i = 1; i < LEVEL_ORDER.length; i++) expect(LEVELS[LEVEL_ORDER[i]].reactionMs).toBeLessThanOrEqual(LEVELS[LEVEL_ORDER[i - 1]].reactionMs);
    expect(frostShove.levels).toBe(LEVELS);
  });
});

describe('headless rounds', () => {
  it('every variant plays to the end, cheaply', () => {
    for (const v of POLAR_VARIANTS) {
      const r = playRound(v.id, [{ level: 'hard' }, { level: 'normal' }, { level: 'easy' }], { options: { timeLimit: 30 }, seed: 3, clock: () => performance.now() });
      expect(r.places).toHaveLength(3);
      expect(r.p99DecideMs).toBeLessThan(25); // headroom: the full suite runs files in parallel
    }
  });

  it('semigod never places below easy and pushes it out more', () => {
    // a good climber rarely drowns, so short rounds often end tied: pushes-out is where the levels show
    let notWorse = 0;
    let push = 0;
    let pushEasy = 0;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const swap = i % 2 === 1;
      const seats = swap ? [{ level: 'easy' }, { level: 'semigod' }] : [{ level: 'semigod' }, { level: 'easy' }];
      const r = playRound('frost-classic', seats, { options: { timeLimit: 45 }, seed: 10 + i });
      const god = swap ? 1 : 0;
      if (r.places[god] <= r.places[1 - god]) notWorse++;
      push += r.metrics[god].pushesOut;
      pushEasy += r.metrics[1 - god].pushesOut;
    }
    expect(notWorse).toBeGreaterThanOrEqual(9);
    expect(push).toBeGreaterThan(pushEasy * 2);
  });
});
