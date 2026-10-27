import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import manifest from '../game.json';
import { DASH_VARIANTS, createSprintSmash } from '../server/create';
import type { DashState } from '../shared/types';
import { sprintSmash } from './index';
import { LEVEL_ORDER, LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { R_LO, polar, wrap } from './physics';
import { RacerPolicy } from './policy/racer';
import { playRound } from './sim';
import { ADAPTERS, createAdapter } from './variants';
import { WorldModel } from './world';

function snap(over: Partial<DashState> = {}, me: Partial<DashState['players'][0]> = {}): DashState {
  const p = (id: string, x: number, y: number) => ({ id, x, y, f: Math.PI / 2, p: 0, e: 1, item: '' as const, air: 0, stun: false, fall: false, slow: false, boost: false, inv: false, fin: false });
  return { kind: 'ext:sprint-smash', variant: 'dot-sprint', t: 0, limit: 120, laps: 10, players: [{ ...p('me', 830, 500), ...me }, p('foe', 500, 830)], pickups: [], missiles: [], ...over };
}
const decide = (s: DashState, params: Record<string, number> = {}) =>
  new RacerPolicy({ ...DEFAULT_PARAMS, ...params }, () => 0.5, createAdapter(s.variant)).decide(new WorldModel('me', 60, new Set()).update(s, 0, 0), 0);

describe('racer', () => {
  it('heads forward (towards increasing angle) on the inner line', () => {
    const d = decide(snap());
    // at angle 0 forward is +y on screen
    expect(d.my).toBeGreaterThan(0.5);
    expect(d.line).toBeLessThan(R_LO + 30);
    expect(d.throttle).toBe(true);
  });

  it('fires a missile at a rival ahead on its radius', () => {
    const me = polar(830, 500);
    const ahead = { x: 500 + Math.cos(me.a + 0.6) * me.r, y: 500 + Math.sin(me.a + 0.6) * me.r };
    const s = snap({ variant: 'splash-sprint' }, { item: 'missile' }); // ring missiles: no variant uses them now, the policy still handles them
    s.players[1].x = ahead.x;
    s.players[1].y = ahead.y;
    expect(decide(s).press).toBe(true);
  });

  it('Dot Sprint: aims the craft at a rival ahead and fires on a2 when the line is clear', () => {
    const refine = (s: DashState) => {
      const ad = createAdapter(s.variant);
      const w = new WorldModel('me', 60, new Set()).update(s, 0, 0);
      const d = new RacerPolicy({ ...DEFAULT_PARAMS }, () => 0.5, ad).decide(w, 0);
      ad.refine!(w, d, { ...DEFAULT_PARAMS }, 0, () => 0.5);
      return d;
    };
    // the rival straight ahead of the heading: fire
    const s = snap({}, { item: 'missile', x: 700, y: 500, f: 0 });
    s.players[1].x = 900;
    s.players[1].y = 500;
    expect(refine(s).press).toBe(true);
    // the rival off to the side: turn towards it, hold fire
    s.players[0].f = Math.PI / 2;
    const d = refine(s);
    expect(d.press).toBe(false);
    expect(d.mx).toBeGreaterThan(0.9);
  });

  it('Splash Sprint: jumps (a2) when a tube of the hub is about to reach the craft', () => {
    const me = polar(830, 500);
    // tube 0 lies just ahead of the craft's heading, extended; the hub turns against the lap
    const s = snap({ variant: 'splash-sprint', rods: { a: me.a + 0.1, tubes: [1, 0, 0, 0, 0, 0] } }, { x: 830, y: 500 });
    const ad = createAdapter('splash-sprint');
    const w = new WorldModel('me', 60, new Set()).update(s, 0, 0);
    w.me!.speed = 170;
    const d = new RacerPolicy({ ...DEFAULT_PARAMS }, () => 0.5, ad).decide(w, 0);
    ad.refine!(w, d, { ...DEFAULT_PARAMS, dodge: 1, jumpRods: 1 }, 5000, () => 0);
    expect(d.press).toBe(true);
    expect(d.mode).toBe('jump');
    expect(ad.rules.item2).toBe(true);
  });

  it('Splash Sprint: does not jump while stunned (the server ignores a2)', () => {
    const me = polar(830, 500);
    const s = snap({ variant: 'splash-sprint', rods: { a: me.a + 0.1, tubes: [1, 0, 0, 0, 0, 0] } }, { x: 830, y: 500, stun: true });
    const ad = createAdapter('splash-sprint');
    const w = new WorldModel('me', 60, new Set()).update(s, 0, 0);
    w.me!.speed = 170;
    const d = new RacerPolicy({ ...DEFAULT_PARAMS }, () => 0.5, ad).decide(w, 0);
    ad.refine!(w, d, { ...DEFAULT_PARAMS, dodge: 1, jumpRods: 1 }, 5000, () => 0);
    expect(d.mode).not.toBe('jump');
  });

  it('measures the hub turn rate from consecutive snapshots', () => {
    const m = new WorldModel('me', 60, new Set());
    m.update(snap({ variant: 'splash-sprint', rods: { a: 0, tubes: [0, 0, 0, 0, 0, 0] } }), 0, 0);
    const w = m.update(snap({ variant: 'splash-sprint', rods: { a: -0.5, tubes: [0, 0, 0, 0, 0, 0] } }), 60, 0);
    expect(w.rodSpeed).toBeCloseTo(0.5, 5);
  });

  it('dodges its own missile once it has bounced', () => {
    const m = new WorldModel('me', 60, new Set());
    const at = (vx: number, vy: number) => snap({ missiles: [{ id: 7, x: 830, y: 540, a: 0, vx, vy }] });
    m.update(snap(), 0, 0);
    expect(m.update(at(0, 300), 6, 0).missiles).toHaveLength(1); // not fired by us (no press): a hazard
    const f = new WorldModel('me', 60, new Set());
    f.update(snap(), 0, 0);
    f.markFired(0.1);
    expect(f.update(at(0, 300), 6, 0).missiles).toHaveLength(0); // ours, going away
    expect(f.update(at(0, -300), 12, 0).missiles).toHaveLength(1); // bounced back
  });

  it('steers around a lava ball ahead', () => {
    const me = polar(788, 500);
    const at = (a: number) => ({ x: 500 + Math.cos(me.a + a) * me.r, y: 500 + Math.sin(me.a + a) * me.r });
    const s = snap({ variant: 'ember-sprint', balls: [{ id: 1, ...at(0.4), vx: 0, vy: 0 }] }, { x: 788, y: 500 });
    const d = decide(s, { line: 0.0, noise: 0 });
    expect(Math.abs(d.line - me.r)).toBeGreaterThan(20);
    expect(wrap(0)).toBe(0);
  });
});

describe('rules contract (if one fails, the game changed: see src/games/sprint-smash/AGENTS.md)', () => {
  it('every variant of game.json has an adapter', () => {
    const ids = (manifest.catalog.variants as { id: string }[]).map((v) => v.id).sort();
    expect(Object.keys(ADAPTERS).sort()).toEqual(ids);
    expect(DASH_VARIANTS.map((v) => v.id).sort()).toEqual(ids);
  });

  it('laps run towards increasing angle and a1 held burns the berry bar', () => {
    const g = createSprintSmash(DASH_VARIANTS.find((v) => v.id === 'splash-sprint')!, {}, () => 0.5);
    g.init([{ id: 'a', name: 'a' }]);
    const p0 = g.getState().players[0];
    const a0 = polar(p0.x, p0.y).a;
    (g as unknown as { byId: Map<string, { energy: number }> }).byId.get('a')!.energy = 1; // a loaded berry bar
    for (let i = 0; i < 60; i++) {
      const p = g.getState().players[0];
      const pa = polar(p.x, p.y).a;
      g.handleInput('a', { mx: -Math.sin(pa), my: Math.cos(pa), a1: true, a2: false });
      g.update(1 / 60);
    }
    const p1 = g.getState().players[0];
    expect(wrap(polar(p1.x, p1.y).a - a0)).toBeGreaterThan(0.5);
    expect(p1.p).toBeGreaterThan(0.08);
    expect(p1.e).toBeLessThan(1);
  });
});

describe('levels', () => {
  it('are ordered and only use known parameters', () => {
    expect(LEVEL_ORDER).toEqual(['easy', 'normal', 'hard', 'expert', 'semigod']);
    for (const l of LEVEL_ORDER) for (const k of Object.keys(LEVELS[l])) expect(DEFAULT_PARAMS).toHaveProperty(k);
    expect(sprintSmash.levels).toBe(LEVELS);
  });
});

describe('headless rounds', () => {
  it('every variant plays to the end, cheaply', () => {
    for (const v of DASH_VARIANTS) {
      const r = playRound(v.id, [{ level: 'semigod' }, { level: 'normal' }, { level: 'easy' }], { options: { laps: 3, timeLimit: 60 }, seed: 3, clock: () => performance.now() });
      expect(r.places).toHaveLength(3);
      expect(r.p99DecideMs).toBeLessThan(25); // headroom: the full suite runs files in parallel
    }
  });

  it('Toxic Sprint bots collect berries and fire the force field on a2', () => {
    let zaps = 0;
    let pickups = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const r = playRound('toxic-sprint', [{ level: 'semigod' }, { level: 'semigod' }, { level: 'semigod' }], { options: { laps: 4, timeLimit: 90, starEvery: 5 }, seed });
      zaps += (r.events.zap ?? []).reduce((a, n) => a + n, 0);
      pickups += (r.events.pickup ?? []).reduce((a, n) => a + n, 0);
    }
    expect(pickups).toBeGreaterThan(0);
    expect(zaps).toBeGreaterThan(0);
  });

  it('semigod beats easy', () => {
    let wins = 0;
    for (let i = 0; i < 6; i++) {
      const swap = i % 2 === 1;
      const r = playRound('dot-sprint', swap ? [{ level: 'easy' }, { level: 'semigod' }] : [{ level: 'semigod' }, { level: 'easy' }], { options: { laps: 4 }, seed: 60 + i });
      const god = swap ? 1 : 0;
      if (r.places[god] < r.places[1 - god]) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
  });
});
