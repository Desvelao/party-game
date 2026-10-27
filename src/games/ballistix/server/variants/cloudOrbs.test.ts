import { describe, expect, it } from 'vitest';
import { cornerCenter } from '../../shared/geometry';
import { defaultOptions, normalizeSelection, optionsFor } from '../../../../core/shared/catalog';
import type { BallArena } from '../core/BallArena';
import { VARIANTS, applyOptions, createBallArena } from './index';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const cloud = VARIANTS.find((v) => v.id === 'cloud-orbs')!;

type Snap = ReturnType<BallArena['getState']>;
const mod = (g: unknown, id: string) => (g as { modules: { id: string }[] }).modules.find((m) => m.id === id) as any;
const sim = (opts: Record<string, number | boolean | string>, seconds: number, seed = 1) => {
  const g = createBallArena(applyOptions(cloud, { lives: 15, timeLimit: 300, ...opts }), seed);
  g.init(players(2));
  const log: { t: number; st: Snap; ev: { kind: string; id: string }[] }[] = [];
  for (let i = 0; i < seconds * 60 && !g.isFinished(); i++) {
    g.update(1 / 60);
    log.push({ t: i / 60, st: g.getState(), ev: g.drainEvents() });
  }
  return { g, log };
};

describe('Cloud Orbs engines', () => {
  it('fail on schedule: warn -> fail -> recover, then wait again', () => {
    const { log } = sim({ failEvery: 5, failDuration: 3 }, 40);
    const phases = log.map((l) => l.st.engines!.map((e) => e.phase));
    const firstWarn = phases.findIndex((p) => p.includes('warn'));
    const firstFail = phases.findIndex((p) => p.includes('fail'));
    const recovered = phases.findIndex((p, i) => i > firstFail && p.every((x) => x === 'ok'));
    expect(firstWarn).toBeGreaterThan(0);
    expect(firstFail).toBeGreaterThan(firstWarn);
    expect(recovered).toBeGreaterThan(firstFail);
    // warn 1.5 s, fail 3 s
    expect((firstFail - firstWarn) / 60).toBeCloseTo(1.5, 0);
    expect((recovered - firstFail) / 60).toBeCloseTo(3, 0);
    expect(log.some((l) => l.ev.some((e) => e.kind === 'engine' && e.id.endsWith(':fail')))).toBe(true);
    expect(log.some((l) => l.ev.some((e) => e.kind === 'engine' && e.id.endsWith(':ok')))).toBe(true);
  });

  it('a failing engine drags balls toward it, and stops when it recovers', () => {
    const cfg = applyOptions(cloud, { failEvery: 5, failDuration: 6, failPull: 1500, balls: '1', maxBalls: 1});
    const g = createBallArena({ ...cfg, ballMinSpeed: 1, ballCollisions: false }, 3);
    g.init(players(2));
    type B = { x: number; y: number; vx: number; vy: number; wait: number; corner: number; px: number; py: number };
    const ball = (g as unknown as { balls: B[] }).balls[0];
    // park the ball mid-field, almost stationary; fail engine 2 (bottom right)
    Object.assign(ball, { x: 500, y: 500, px: 500, py: 500, vx: 1, vy: 0, wait: 0, corner: -1 });
    const engines = mod(g, 'engines').engines as { phase: string; t: number; ramp: number }[];
    engines[2].phase = 'fail';
    engines[2].t = 4;
    mod(g, 'engines').wait = 999;
    for (let i = 0; i < 20; i++) g.update(1 / 60);
    const [cx, cy] = cornerCenter(2);
    // moving toward the failing corner: both components point at it
    expect(Math.sign(ball.vx)).toBe(Math.sign(cx - 500));
    expect(ball.vy).toBeGreaterThan(5);
    expect(Math.hypot(ball.vx, ball.vy)).toBeGreaterThan(30);
    void cy;
    // after recovery the extra acceleration is gone (speed stops growing)
    for (let i = 0; i < 60 * 5; i++) g.update(1 / 60);
    expect(engines[2].phase).toBe('ok');
  });

  it('pull strength scales the effect', () => {
    const run = (pull: number) => {
      const cfg = applyOptions(cloud, { failPull: pull, balls: '1', maxBalls: 1});
      const g = createBallArena({ ...cfg, ballMinSpeed: 1, ballCollisions: false }, 3);
      g.init(players(2));
      const b = (g as unknown as { balls: { x: number; y: number; vx: number; vy: number; wait: number; corner: number; px: number; py: number }[] }).balls[0];
      Object.assign(b, { x: 500, y: 500, px: 500, py: 500, vx: 1, vy: 1, wait: 0, corner: -1 });
      const en = mod(g, 'engines').engines as { phase: string; t: number; ramp: number }[];
      en[0].phase = 'fail';
      en[0].t = 5;
      mod(g, 'engines').wait = 999;
      for (let i = 0; i < 15; i++) g.update(1 / 60);
      return Math.hypot(b.vx, b.vy);
    };
    expect(run(1500)).toBeGreaterThan(run(300) * 2);
  });

  it('several engines can fail at once, all distinct', () => {
    const { log } = sim({ failEvery: 5, failDuration: 6, failCount: 3 }, 30);
    const most = Math.max(...log.map((l) => l.st.engines!.filter((e) => e.phase !== 'ok').length));
    expect(most).toBe(3);
  });

  it('can be turned off', () => {
    const off = applyOptions(cloud, { failEnabled: false });
    expect(off.engines).toBeUndefined();
    const g = createBallArena(off, 1);
    g.init(players(2));
    expect(g.getState().engines).toBeUndefined();
  });

  it('catalog defaults match the config (core + specific); validation', () => {
    const d = defaultOptions(optionsFor('ballistix', 'cloud-orbs'));
    expect(d.lives).toBe(cloud.lives);
    expect(d.ballSpeed).toBe(cloud.ballSpeed);
    expect(d.ballMaxSpeed).toBe(cloud.ballMaxSpeed);
    expect(d.hitGain).toBe(cloud.hitGain);
    expect(d.paddleLen).toBe(cloud.paddleLen);
    expect(d.spawnDelay).toBe(cloud.spawn.delay);
    expect(d.ballSpawnEvery).toBe(cloud.reinforce.every);
    expect(d.failEvery).toBe(cloud.engines!.every);
    expect(d.failDuration).toBe(cloud.engines!.duration);
    expect(d.failPull).toBe(cloud.engines!.pull);
    expect(d.failCount).toBe(cloud.engines!.count);
    expect(normalizeSelection('ballistix', 'cloud-orbs', { failPull: 99999, failCount: 9 })!.options).toEqual({
      failPull: 2000,
      failCount: 3,
    });
    expect(normalizeSelection('ballistix', 'smashball', { failPull: 500 })).toBeNull();
  });
});
