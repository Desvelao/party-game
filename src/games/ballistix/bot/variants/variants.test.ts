import { describe, expect, it } from 'vitest';
import { VARIANTS, applyOptions, createBallArena } from '../../server/arena';
import { BallistixBot } from '../index';
import { LEVELS } from '../levels';
import { DEFAULT_PARAMS } from '../params';
import { advance, pullRamp, type Env } from '../physics';
import { playRound } from '../sim';
import { WorldModel } from '../world';
import { createAdapter, physicsFor } from './index';

const env: Env = { r: 18, open: [false, true, true, true], obstacles: [] };
const arena = (variant: string, options: Record<string, number | boolean | string> = {}, seed = 3) => {
  const g = createBallArena(applyOptions(VARIANTS.find((v) => v.id === variant)!, { balls: 1, lives: 9, timeLimit: 300, ...options }), seed);
  g.init([{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }]);
  return g;
};
const idle = { mx: 0, my: 0, a1: false, a2: false };

describe('adapters', () => {
  it('the boost is on a2 only where the magnet takes a1', () => {
    expect(createAdapter('smashball').boostButton).toBe('a1');
    expect(createAdapter('sand-orb').boostButton).toBe('a2');
    expect(createAdapter('pulse-ball').boostButton).toBe('a1');
    expect(createAdapter('cloud-orbs').boostButton).toBe('a1');
  });

  it('an unknown variant is played as smash ball', () => {
    expect(createAdapter('whatever').boostButton).toBe('a1');
    expect(physicsFor('whatever')).toEqual(physicsFor('smashball'));
    // the baseline adds nothing but the server's speed limits
    const { vmin, vmax, vmaxSmash, ...rest } = physicsFor('smashball');
    expect(rest).toEqual({});
    expect(vmax).toBeGreaterThan(vmin!);
    expect(vmaxSmash).toBeGreaterThan(vmax!);
  });

  it('a boosted ball may go faster than the normal ceiling, easing back as the boost fades', async () => {
    const { step } = await import('../physics');
    const mk = (boost: number) => ({ x: 0, y: -300, vx: 0, vy: 1000, boost });
    const env = { r: 18, open: [false, false, false, false], obstacles: [], vmax: 800, vmaxSmash: 1200 };
    const plain = mk(0);
    const boosted = mk(1);
    step(plain, 1 / 60, env);
    step(boosted, 1 / 60, env);
    expect(Math.hypot(plain.vx, plain.vy)).toBeCloseTo(800, 3);
    expect(Math.hypot(boosted.vx, boosted.vy)).toBeGreaterThan(900); // not clamped to 800
    expect(boosted.boost).toBeLessThan(1);
  });
});

describe('smash ball', () => {
  it('plays the same with or without the variant rules', () => {
    const g = arena('smashball', { balls: 2 });
    const mk = (variantAware: number) =>
      new BallistixBot({ selfId: 'a', name: 'a', tickRate: 60, networkRate: 30, seed: 5, params: { ...DEFAULT_PARAMS, ...LEVELS.hard, variantAware } }, 'predictive');
    const [x, y] = [mk(1), mk(0)];
    for (let t = 0; t < 60 * 20; t++) {
      const now = (t * 1000) / 60;
      if (t % 2 === 0) for (const b of [x, y]) b.onState(g.getState(), { tick: t, phase: 'playing', recvMs: now });
      const ix = x.decide(now);
      expect(ix).toEqual(y.decide(now));
      g.handleInput('a', ix);
      g.handleInput('b', idle);
      g.update(1 / 60);
    }
  });
});

describe('physics of the variants', () => {
  it('drag decays the speed like the server does', () => {
    const b = advance({ x: 0, y: 0, vx: 300, vy: 0 }, 1, { ...env, open: [false, false, false, false], drag: 0.35 });
    expect(b.vx).toBeCloseTo(300 * Math.exp(-0.35), 0);
  });

  it('the pull ramps in and out at 2 per second', () => {
    const p = { x: 0, y: 0, accel: 700, start: 1, dur: 3, ramp0: 0 };
    expect(pullRamp(p, 0.5)).toBe(0);
    expect(pullRamp(p, 1.25)).toBeCloseTo(0.5);
    expect(pullRamp(p, 2.5)).toBe(1);
    expect(pullRamp(p, 4.25)).toBeCloseTo(0.5);
    expect(pullRamp(p, 6)).toBe(0);
    // already ramping out
    expect(pullRamp({ ...p, start: 0, dur: 0, ramp0: 0.6 }, 0.1)).toBeCloseTo(0.4);
  });

  it('a pull bends the path towards the corner', () => {
    const e: Env = { ...env, open: [false, false, false, false], pulls: [{ x: -300, y: 300, accel: 700, start: 0, dur: 5, ramp0: 1 }] };
    const b = advance({ x: 0, y: 0, vx: 0, vy: 100 }, 0.5, e);
    expect(b.vx).toBeLessThan(-100);
    expect(b.x).toBeLessThan(-10);
  });
});

describe('world model of the variants', () => {
  it('builds engine pulls from Cloud Orbs snapshots, and nothing when unaware', () => {
    const g = arena('cloud-orbs', { failEvery: 5, failVariance: 2.5 });
    const aware = new WorldModel('a', 60, true);
    const plain = new WorldModel('a', 60, false);
    let pulls = 0;
    for (let t = 0; t < 60 * 40; t += 2) {
      for (let k = 0; k < 2; k++) {
        g.handleInput('a', idle);
        g.handleInput('b', idle);
        g.update(1 / 60);
      }
      const st = g.getState();
      const wa = aware.update(st, t, t)!;
      const wp = plain.update(st, t, t)!;
      expect(wp.env.pulls).toBeUndefined();
      if (wa.env.pulls?.length) pulls++;
    }
    expect(pulls).toBeGreaterThan(0);
  });

  it('predicts a ball under engine pull better than the smash ball model', () => {
    const g = arena('cloud-orbs', { failEvery: 5, failVariance: 2.5 });
    const aware = new WorldModel('a', 60, true);
    const plain = new WorldModel('a', 60, false);
    const hist: { fail: boolean; wa: NonNullable<ReturnType<WorldModel['update']>>; wp: NonNullable<ReturnType<WorldModel['update']>> }[] = [];
    for (let t = 0; t < 60 * 120; t += 2) {
      for (let k = 0; k < 2; k++) {
        g.handleInput('a', idle);
        g.handleInput('b', idle);
        g.update(1 / 60);
      }
      g.drainEvents();
      const st = g.getState();
      hist.push({ fail: st.engines!.some((e) => e.phase === 'fail' && e.pull > 0.99), wa: aware.update(st, t, t)!, wp: plain.update(st, t, t)! });
    }
    const err = { a: [] as number[], p: [] as number[] };
    for (let i = 0; i + 15 < hist.length; i++) {
      if (!hist[i].fail) continue;
      for (const b of hist[i].wa.balls) {
        const later = hist[i + 15].wa.balls.find((x) => x.id === b.id);
        const bp = hist[i].wp.balls.find((x) => x.id === b.id);
        // a ball near a goal line meets a paddle in the window: skip
        if (!b.known || !bp?.known || !later || Math.abs(b.y) > 300 || Math.abs(later.y) > 300) continue;
        const ea = advance(b, 0.5, hist[i].wa.env);
        const ep = advance(bp, 0.5, hist[i].wp.env);
        err.a.push(Math.hypot(ea.x - later.x, ea.y - later.y));
        err.p.push(Math.hypot(ep.x - later.x, ep.y - later.y));
      }
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    expect(err.a.length).toBeGreaterThan(20);
    expect(median(err.a)).toBeLessThan(median(err.p) / 2);
  });

  it('leaves out balls stuck to a magnet and our own repulsion, and models the opponent\'s', () => {
    const g = arena('sand-orb');
    let held = false;
    const w = new WorldModel('a', 60);
    for (let t = 0; t < 60 * 60 && !held; t++) {
      const st = g.getState();
      const b = st.balls.find((x) => !x.wait);
      const me = st.paddles.find((p) => p.id === 'a')!;
      g.handleInput('a', { mx: b ? Math.max(-1, Math.min(1, (b.x - 500 - me.pos) / 30)) : 0, my: 0, a1: !!b && b.y > 650, a2: false });
      g.handleInput('b', idle);
      g.update(1 / 60);
      held = g.getState().magnet!.held.length > 0;
    }
    expect(held).toBe(true);
    const st = g.getState();
    const wd = w.update(st, 1, 1)!;
    expect(wd.balls.some((b) => st.magnet!.held.includes(b.id))).toBe(false);
    expect(wd.magnet!.held).toBeGreaterThan(0);
    expect(new WorldModel('a', 60, false).update(st, 1, 1)!.magnet).toBeNull();

    const n = arena('pulse-ball');
    const base = n.getState();
    const state = { ...base, repel: { item: null, radius: 140, paddles: [{ id: 'a', left: 0.5 }, { id: 'b', left: 0.5 }] } };
    const wn = new WorldModel('a', 60).update(state, 1, 1)!;
    expect(wn.env.repulsors).toHaveLength(1);
    // the opponent (side 2, the far edge) pushes from the top of our frame
    expect(wn.env.repulsors![0].y).toBeLessThan(-300);
    expect(wn.env.repulsors![0].until).toBeCloseTo(4);
  });
});

describe('Sand Orb magnet', () => {
  it('catches balls and launches them, and the round ends without a stuck magnet', () => {
    const r = playRound('sand-orb', [{ level: 'hard' }, { level: 'hard' }], { seed: 2, options: { lives: 3 }, maxSeconds: 60 });
    expect(r.events.catch?.[0] ?? 0).toBeGreaterThan(0);
    expect((r.events.smash?.[0] ?? 0) + (r.events.release?.[0] ?? 0)).toBeGreaterThan(0);
  });

  it('a level that does not use the magnet never catches', () => {
    const r = playRound('sand-orb', [{ level: 'hard', params: { magnet: 0 } }, { level: 'hard', params: { magnet: 0 } }], { seed: 2, options: { lives: 3 }, maxSeconds: 40 });
    expect(r.events.catch ?? [0, 0]).toEqual([0, 0]);
  });
});
