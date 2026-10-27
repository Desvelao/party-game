import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import manifest from '../game.json';
import { TANK_VARIANTS, createTankWars } from '../server/create';
import { TANK_BLOCKS, TANK_RAILS } from '../shared/geometry';
import type { TankState } from '../shared/types';
import { tankWars } from './index';
import { LEVEL_ORDER, LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { NavGrid } from './nav';
import { CANNONS, clear, fireRays, inFire, step, type Arena } from './physics';
import { TacticianPolicy } from './policy/tactician';
import { playRound } from './sim';
import { ADAPTERS } from './variants';
import { WorldModel } from './world';

const open: Arena = { rails: false, maze: false, solids: [], speed: 150 };

describe('physics', () => {
  it('drives freely, and on rails only along the rail it is on', () => {
    const b = { x: 300, y: 300, dirX: 0, dirY: 0 };
    step(b, 1, 0, 1, open);
    expect(b.x).toBeCloseTo(450, 0);
    const r = { x: 360, y: 200, dirX: 0, dirY: 0 };
    const rails: Arena = { rails: true, maze: true, solids: [], speed: 150 };
    step(r, 1, 0, 0.1, rails);
    // on a vertical rail and far from a crossing: a sideways stick does not move it
    expect(r.x).toBe(360);
    step(r, 0, 1, 0.1, rails);
    expect(r.y).toBeCloseTo(215, 0);
  });

  it('sees walls between two points and the fire cross of a maze mine', () => {
    expect(clear(100, 220, 400, 220, TANK_BLOCKS, 6)).toBe(false);
    expect(clear(100, 360, 900, 360, TANK_BLOCKS, 6)).toBe(true);
    const rays = fireRays(360, 360, TANK_BLOCKS);
    expect(inFire(360, 600, 360, 360, rays, 0)).toBe(true);
    expect(inFire(500, 500, 360, 360, rays, 0)).toBe(false);
  });

  it('finds path distances around the maze and along the rails', () => {
    const nav = new NavGrid();
    nav.setArena(TANK_BLOCKS, false);
    nav.setGoal(360, 360);
    expect(nav.distance(360, 100)).toBeCloseTo(260, -1);
    const rails = new NavGrid();
    rails.setArena([], true);
    rails.setGoal(TANK_RAILS[1], TANK_RAILS[1]);
    expect(rails.distance(TANK_RAILS[0], TANK_RAILS[0])).toBeCloseTo(500, -1);
  });
});

function snap(over: Partial<TankState> = {}): TankState {
  const t = (id: string, x: number, y: number, f = 0) => ({ id, x, y, f, hp: 100, alive: true, cannon: 0, mines: 3, shield: 1, up: false, inv: false, item: '' as const });
  return { kind: 'ext:tank-wars', variant: 'jungle-fox', t: 0, limit: 90, maxHp: 100, rails: false, size: 11, players: [t('me', 300, 500), t('foe', 650, 500, Math.PI)], shots: [], bombs: [], mines: [], pickups: [], blasts: [], ...over };
}

describe('world and tactician', () => {
  it('tells its own shots from the rivals', () => {
    const wm = new WorldModel('me', 60, new Set());
    const w = wm.update(snap({ shots: [{ id: 1, x: 300 + 30 + 10, y: 500, f: 0, k: 'shot', c: 0 }, { id: 2, x: 600, y: 500, f: Math.PI, k: 'shot', c: 0 }] }), 0, 0);
    expect(w.shots.map((s) => s.id)).toEqual([2]);
    expect(w.shots[0].vx).toBeCloseTo(-CANNONS[0].speed, 0);
  });

  it('fires at a rival in sight and steps out of a shot coming at it', () => {
    const P = { ...DEFAULT_PARAMS };
    const pol = new TacticianPolicy(P, () => 0.5);
    const w = new WorldModel('me', 60, new Set()).update(snap(), 0, 0);
    expect(pol.decide(w, 0)).toMatchObject({ fire: true, mode: 'attack' });
    const shot = new WorldModel('me', 60, new Set()).update(snap({ players: [snap().players[0]], shots: [{ id: 5, x: 450, y: 500, f: Math.PI, k: 'shot', c: 0 }] }), 0, 0);
    const d = new TacticianPolicy(P, () => 0.5).decide(shot, 0);
    expect(Math.abs(d.my)).toBeGreaterThan(0.5);
  });
});

describe('rules contract (if one fails, the game changed: see src/games/tank-wars/AGENTS.md)', () => {
  it('every variant of game.json has an adapter', () => {
    const ids = (manifest.catalog.variants as { id: string }[]).map((v) => v.id).sort();
    expect(Object.keys(ADAPTERS).sort()).toEqual(ids);
    expect(TANK_VARIANTS.map((v) => v.id).sort()).toEqual(ids);
  });

  it('a tank faces the way it drives and a1 held fires along it', () => {
    const g = createTankWars(TANK_VARIANTS.find((v) => v.id === 'jungle-fox')!, {}, () => 0.5);
    g.init([{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }]);
    g.handleInput('a', { mx: 0, my: 1, a1: true, a2: false });
    g.update(1 / 60);
    const s = g.getState();
    expect(s.players[0].f).toBeCloseTo(Math.PI / 2, 2);
    expect(s.shots).toHaveLength(1);
    expect(s.shots[0].f).toBeCloseTo(Math.PI / 2, 2);
  });
});

describe('levels', () => {
  it('are ordered and only use known parameters', () => {
    expect(LEVEL_ORDER).toEqual(['easy', 'normal', 'hard', 'expert', 'semigod']);
    for (const l of LEVEL_ORDER) for (const k of Object.keys(LEVELS[l])) expect(DEFAULT_PARAMS).toHaveProperty(k);
    expect(tankWars.levels).toBe(LEVELS);
  });
});

describe('headless rounds', () => {
  it('every variant plays to the end, cheaply', () => {
    for (const v of TANK_VARIANTS) {
      const r = playRound(v.id, [{ level: 'semigod' }, { level: 'normal' }, { level: 'easy' }], { options: { timeLimit: 30 }, seed: 3, clock: () => performance.now() });
      expect(r.places).toHaveLength(3);
      expect(r.p99DecideMs).toBeLessThan(25); // headroom: the full suite runs files in parallel
    }
  });

  it('semigod beats easy', () => {
    let wins = 0;
    for (let i = 0; i < 6; i++) {
      const swap = i % 2 === 1;
      const r = playRound('jungle-fox', swap ? [{ level: 'easy' }, { level: 'semigod' }] : [{ level: 'semigod' }, { level: 'easy' }], { options: { timeLimit: 45 }, seed: 30 + i });
      const god = swap ? 1 : 0;
      if (r.places[god] < r.places[1 - god]) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
  });
});
