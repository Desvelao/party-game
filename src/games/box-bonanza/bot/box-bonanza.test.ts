import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import manifest from '../game.json';
import { CRATE_VARIANTS, createBoxBonanza } from '../server/create';
import type { CrateState } from '../shared/types';
import { boxBonanza } from './index';
import { LEVEL_ORDER, LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { GRIP, SPEED, moveOf, slide, step } from './physics';
import { BrawlerPolicy } from './policy/brawler';
import { playRound } from './sim';
import { ADAPTERS, createAdapter } from './variants';
import { WorldModel } from './world';

describe('physics', () => {
  it('a player reaches top speed through its grip, a sliding crate slows down', () => {
    const b = { x: 300, y: 500, vx: 0, vy: 0 };
    const m = moveOf(0, 0, false, GRIP, 1.5, 0.4);
    for (let i = 0; i < 60; i++) step(b, 1, 0, 1 / 60, m, []);
    expect(b.vx).toBeCloseTo(SPEED, 0);
    const c = slide(0, 0, 640, 0, 10);
    expect(c.x).toBeCloseTo(640 / 1.4, 0);
    expect(c.speed).toBeLessThan(1);
  });
});

function snap(over: Partial<CrateState> = {}, me: Partial<CrateState['players'][0]> = {}): CrateState {
  const p = (id: string, x: number, y: number) => ({ id, x, y, f: 0, hp: 10, alive: true, hold: '' as const, target: -1, holdFuse: -1, mask: 0, inv: false, boots: 0, slow: 0, weight: 0, weapon: '' as const, charges: 0, spin: false });
  return { kind: 'ext:box-bonanza', variant: 'jungle-bonanza', t: 0, limit: 90, maxHp: 10, tntFuse: 3, blastRadius: 130, weightTime: 5, tiles: 0, holes: [], players: [{ ...p('me', 300, 500), ...me }, p('foe', 600, 500)], crates: [], pickups: [], shots: [], ...over };
}
const decide = (s: CrateState, w0?: CrateState) => {
  const wm = new WorldModel('me', 60, new Set());
  if (w0) wm.update(w0, 0, 0);
  return new BrawlerPolicy({ ...DEFAULT_PARAMS }, () => 0.5, createAdapter(s.variant)).decide(wm.update(s, w0 ? 6 : 0, w0 ? 100 : 0), 0);
};

describe('brawler', () => {
  it('throws a held crate at a rival in range', () => {
    expect(decide(snap({}, { hold: 'block' }))).toMatchObject({ act: true, mode: 'throw' });
  });

  it('does not throw a TNT at a rival standing inside its blast', () => {
    const s = snap({}, { hold: 'tnt', holdFuse: 2.5 });
    s.players[1].x = 400;
    expect(decide(s).act).toBe(false);
  });

  it('picks up the crate the server says is in reach', () => {
    const s = snap({ crates: [{ id: 7, x: 340, y: 500, k: 'block', fuse: -1, moving: false }] }, { target: 7 });
    expect(decide(s)).toMatchObject({ act: true, mode: 'pickup' });
  });

  it('kicks a rival in reach', () => {
    const s = snap();
    s.players[1].x = 350;
    expect(decide(s).kick).toBe(true);
  });

  it('steps out of a crate flying at it', () => {
    const before = snap({ crates: [{ id: 3, x: 560, y: 500, k: 'block', fuse: -1, moving: true }] });
    const now = snap({ crates: [{ id: 3, x: 500, y: 500, k: 'block', fuse: -1, moving: true }] });
    before.players[1].y = now.players[1].y = 800;
    const d = decide(now, before);
    expect(Math.abs(d.my)).toBeGreaterThan(0.5);
  });
});

describe('rules contract (if one fails, the game changed: see src/games/box-bonanza/AGENTS.md)', () => {
  it('every variant of game.json has an adapter', () => {
    const ids = (manifest.catalog.variants as { id: string }[]).map((v) => v.id).sort();
    expect(Object.keys(ADAPTERS).sort()).toEqual(ids);
    expect(CRATE_VARIANTS.map((v) => v.id).sort()).toEqual(ids);
  });

  it('the snapshot names the crate a pick up would take, and a1 takes it', () => {
    const g = createBoxBonanza(CRATE_VARIANTS[0], {}, () => 0.37);
    g.init([{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }]);
    const s = g.getState();
    const me = s.players[0];
    const c = s.crates[0];
    // walk to the crate until the server offers it
    for (let i = 0; i < 400 && g.getState().players[0].target < 0; i++) {
      const p = g.getState().players[0];
      g.handleInput('a', { mx: Math.sign(c.x - p.x), my: Math.sign(c.y - p.y), a1: false, a2: false });
      g.update(1 / 60);
    }
    expect(g.getState().players[0].target).toBeGreaterThanOrEqual(0);
    g.handleInput('a', { mx: 0, my: 0, a1: true, a2: false });
    g.update(1 / 60);
    expect(g.getState().players[0].hold).not.toBe('');
    expect(me.id).toBe('a');
  });
});

describe('levels', () => {
  it('are ordered and only use known parameters', () => {
    expect(LEVEL_ORDER).toEqual(['easy', 'normal', 'hard', 'expert', 'semigod']);
    for (const l of LEVEL_ORDER) for (const k of Object.keys(LEVELS[l])) expect(DEFAULT_PARAMS).toHaveProperty(k);
    expect(boxBonanza.levels).toBe(LEVELS);
  });
});

describe('headless rounds', () => {
  it('every variant plays to the end, cheaply', () => {
    for (const v of CRATE_VARIANTS) {
      const r = playRound(v.id, [{ level: 'semigod' }, { level: 'normal' }, { level: 'easy' }], { options: { timeLimit: 30 }, seed: 3, clock: () => performance.now() });
      expect(r.places).toHaveLength(3);
      expect(r.p99DecideMs).toBeLessThan(25); // headroom: the full suite runs files in parallel
    }
  });

  it('semigod beats easy', () => {
    let wins = 0;
    for (let i = 0; i < 6; i++) {
      const swap = i % 2 === 1;
      const r = playRound('jungle-bonanza', swap ? [{ level: 'easy' }, { level: 'semigod' }] : [{ level: 'semigod' }, { level: 'easy' }], { options: { timeLimit: 45 }, seed: 40 + i });
      const god = swap ? 1 : 0;
      if (r.places[god] < r.places[1 - god]) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
  });
});
