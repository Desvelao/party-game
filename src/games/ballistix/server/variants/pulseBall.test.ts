import { describe, expect, it } from 'vitest';
import { defaultOptions, normalizeSelection, optionsFor } from '../../../../core/shared/catalog';
import type { BallArena } from '../core/BallArena';
import { VARIANTS, applyOptions, createBallArena } from './index';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const nb = VARIANTS.find((v) => v.id === 'pulse-ball')!;
const crash = VARIANTS.find((v) => v.id === 'smashball')!;

type Snap = ReturnType<BallArena['getState']>;
const mod = (g: unknown, id: string) => (g as { modules: { id: string }[] }).modules.find((m) => m.id === id) as any;
const isEnemyBall = (st: Snap, id: number) => st.enemy!.balls.some((b) => b.id === id);
function simulate(opts: Record<string, number | boolean | string>, seconds: number, seed = 1) {
  const cfg = applyOptions(nb, { lives: 15, timeLimit: 300, balls: '1', maxBalls: 1, ...opts });
  const g = createBallArena(cfg, seed);
  g.init(players(2));
  const log: { t: number; st: Snap; ev: string[] }[] = [];
  for (let i = 0; i < seconds * 60 && !g.isFinished(); i++) {
    // paddles follow the nearest ball so they rarely lose a life
    const st = g.getState();
    for (const p of st.paddles) {
      const target = st.balls.filter((b) => !b.wait).sort((a, b) => (p.side === 0 ? b.y - a.y : a.y - b.y))[0];
      const cx = target ? (p.side === 0 ? target.x - 500 : -(target.x - 500)) : 0;
      g.handleInput(p.id, { mx: Math.max(-1, Math.min(1, (cx - p.pos) / 30)), my: 0, a1: false, a2: false });
    }
    g.update(1 / 60);
    log.push({ t: i / 60, st: g.getState(), ev: g.drainEvents().map((e) => e.kind) });
  }
  return log;
}

describe('Pulse Ball enemy', () => {
  it('is Smashball with an enemy: same core defaults', () => {
    for (const k of ['lives', 'ballSpeed', 'ballMaxSpeed', 'hitGain', 'paddleLen', 'smashGain', 'ballRadius'] as const) {
      expect(nb[k]).toBe(crash[k]);
    }
    expect(nb.enemy).toBeDefined();
    expect(crash.enemy).toBeUndefined();
  });

  it('appears, warns, fires, then leaves', () => {
    const log = simulate({ enemyEvery: 5, enemyVariance: 2.5, enemyDuration: 4, spawnDelayVariance: 0, ballSpawnVariance: 0 }, 40);
    const phases = log.map((l) => l.st.enemy!.phase);
    const first = phases.indexOf('warn');
    expect(first).toBeGreaterThan(0);
    expect(phases.indexOf('on')).toBeGreaterThan(first);
    expect(phases.indexOf('off', phases.indexOf('on'))).toBeGreaterThan(phases.indexOf('on'));
    // not before it is due (5 s +- 50 %)
    expect(first / 60).toBeGreaterThanOrEqual(2.4);
    expect(log.some((l) => l.ev.includes('enemy'))).toBe(true);
  });

  it('fires about rate x duration balls at the configured speed', () => {
    const log = simulate({ enemyEvery: 5, enemyVariance: 2.5, enemyDuration: 6, enemyRate: 2, enemyBallSpeed: 500, maxBalls: 1 }, 14, 2);
    const shots = log.filter((l) => l.st.enemy!.phase === 'on').reduce((n, l) => n + l.ev.filter((e) => e === 'spawn').length, 0);
    expect(shots).toBeGreaterThanOrEqual(6 * 2 - 3);
    expect(shots).toBeLessThanOrEqual(6 * 2 + 3);
    // the fired balls are flagged temp and not part of the normal ball count
    const onTick = log.find((l) => l.st.enemy!.phase === 'on' && l.st.enemy!.balls.length > 0)!;
    expect(onTick.st.balls.filter((b) => !isEnemyBall(onTick.st, b.id))).toHaveLength(1);
  });

  it('rotates in a random direction each appearance', () => {
    const dirs = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) {
      const log = simulate({ enemyEvery: 5, enemyVariance: 2.5, enemyDuration: 3, enemySpin: 2 }, 14, seed);
      const on = log.filter((l) => l.st.enemy!.phase === 'on');
      if (on.length < 10) continue;
      let delta = on.at(-1)!.st.enemy!.angle - on[0].st.enemy!.angle;
      // angle is rounded/unwrapped by the server (monotonic), so the sign is the direction
      dirs.add(Math.sign(delta));
    }
    expect(dirs.has(1)).toBe(true);
    expect(dirs.has(-1)).toBe(true);
  });

  it('enemy balls are capped and vanish when their life ends or after a goal', () => {
    const cfg = applyOptions(nb, { lives: 15, timeLimit: 300, balls: '1', maxBalls: 1, enemyEvery: 120, enemyVariance: 0, enemyDuration: 2, enemyRate: 8, enemyBallSpeed: 600 });
    const g = createBallArena(cfg, 4);
    g.init(players(2));
    mod(g, 'enemy').t = 0.1; // appear right away
    let peak = 0;
    let tempAt20 = -1;
    for (let i = 0; i < 60 * 24; i++) {
      g.update(1 / 60);
      const temps = g.getState().enemy!.balls.length;
      peak = Math.max(peak, temps);
      if (i === 60 * 20) tempAt20 = temps;
    }
    expect(peak).toBeGreaterThan(5);
    expect(peak).toBeLessThanOrEqual(12);
    // 1.5 s warning + 2 s firing + 12 s life < 20 s
    expect(tempAt20).toBe(0);
  });

  it('the body is solid for balls', () => {
    const cfg = applyOptions(nb, { balls: '1', maxBalls: 1, enemyEvery: 5 });
    const g = createBallArena({ ...cfg, ballMinSpeed: 1 }, 1);
    g.init(players(2));
    const bs = (g as unknown as { balls: { x: number; y: number; vx: number; vy: number; wait: number; corner: number; px: number; py: number }[] }).balls;
    mod(g, 'enemy').phase = 'on';
    mod(g, 'enemy').t = 99;
    Object.assign(bs[0], { x: 400, y: 500, px: 400, py: 500, vx: 300, vy: 0, wait: 0, corner: -1 });
    for (let i = 0; i < 40; i++) g.update(1 / 60);
    expect(bs[0].vx).toBeLessThan(0);
  });

  it('can be disabled and tuned through options; catalog defaults match', () => {
    const off = applyOptions(nb, { enemyEnabled: false });
    expect(off.enemy).toBeUndefined();
    const g = createBallArena(off, 1);
    g.init(players(2));
    expect(g.getState().enemy).toBeUndefined();

    const d = defaultOptions(optionsFor('ballistix', 'pulse-ball'));
    expect(d.enemyEvery).toBe(nb.enemy!.every);
    expect(d.enemyDuration).toBe(nb.enemy!.duration);
    expect(d.enemyRate).toBe(nb.enemy!.rate);
    expect(d.enemyBallSpeed).toBe(nb.enemy!.ballSpeed);
    expect(d.enemySpin).toBe(nb.enemy!.spin);
    expect(d.lives).toBe(nb.lives);
    expect(d.ballSpeed).toBe(nb.ballSpeed);
    expect(d.spawnDelay).toBe(nb.spawn.delay);
    expect(d.ballSpawnEvery).toBe(nb.reinforce.every);

    const sel = normalizeSelection('ballistix', 'pulse-ball', { enemyRate: 100, enemyEvery: 1 })!;
    expect(sel.options).toEqual({ enemyRate: 8, enemyEvery: 5 });
    expect(normalizeSelection('ballistix', 'cloud-orbs', { enemyRate: 2 })).toBeNull();
  });
});

describe('Pulse Ball repulsion power-up', () => {
  const game = (opts: Record<string, number | boolean | string> = {}, seed = 5) => {
    const g = createBallArena(applyOptions(nb, { lives: 15, timeLimit: 300, balls: '1', maxBalls: 1, enemyEnabled: false, ...opts }), seed);
    g.init(players(2));
    return g;
  };
  const ball = (g: unknown) => (g as { balls: Record<string, number>[] }).balls[0];

  it('an item appears in a corner after the interval', () => {
    const g = game({ repelEvery: 10 });
    let seen: { x: number; y: number } | null = null;
    for (let i = 0; i < 60 * 20 && !seen; i++) {
      g.update(1 / 60);
      seen = g.getState().repel!.item;
    }
    expect(seen).not.toBeNull();
    expect(Math.abs(seen!.x - 500)).toBe(316);
    expect(Math.abs(seen!.y - 500)).toBe(316);
  });

  it('a paddle at the lane end takes it and gets the effect alone', () => {
    const g = game();
    mod(g, 'repel').item = { x: 816, y: 816, corner: 2, left: 20, total: 20 };
    const kinds: string[] = [];
    for (let i = 0; i < 60 * 3; i++) {
      g.handleInput('p0', { mx: 1, my: 0, a1: false, a2: false });
      g.handleInput('p1', { mx: 0, my: 0, a1: false, a2: false });
      g.update(1 / 60);
      kinds.push(...g.drainEvents().map((e) => e.kind));
    }
    const rep = g.getState().repel!;
    expect(rep.item).toBeNull();
    expect(kinds).toContain('pickup');
    expect(rep.paddles.map((p) => p.id)).toEqual(['p0']);
    expect(rep.paddles[0].left).toBeGreaterThan(0);
  });

  it('pushes balls in front of the paddle away, only within the radius', () => {
    const run = (y: number) => {
      const g = game({ repelRadius: 150 });
      mod(g, 'repel').effect.set('p0', { left: 8, total: 8 });
      mod(g, 'repel').wait = 999;
      const b = ball(g);
      const x = 500 + g.getState().paddles.find((p) => p.id === 'p0')!.pos;
      Object.assign(b, { x, y, px: x, py: y, vx: 0, vy: 0, wait: 0, corner: -1 });
      for (let i = 0; i < 20; i++) g.update(1 / 60);
      return b.y - y;
    };
    expect(run(800)).toBeLessThan(-5); // near the paddle: shoved into the field
    expect(Math.abs(run(500))).toBeLessThan(3 + 0); // far: untouched by the field (core min speed may move it)
  });

  it('the effect ends, and the event can be disabled with defaults matching', () => {
    const g = game({ repelDuration: 2 });
    mod(g, 'repel').effect.set('p0', { left: 2, total: 2 });
    for (let i = 0; i < 60 * 3; i++) g.update(1 / 60);
    expect(g.getState().repel!.paddles).toEqual([]);

    const off = applyOptions(nb, { repelEnabled: false });
    expect(off.repel).toBeUndefined();
    const g2 = createBallArena(off, 1);
    g2.init(players(2));
    expect(g2.getState().repel).toBeUndefined();

    const d = defaultOptions(optionsFor('ballistix', 'pulse-ball'));
    expect(d.repelEnabled).toBe(true);
    expect(d.repelEvery).toBe(nb.repel!.every);
    expect(d.repelDuration).toBe(nb.repel!.duration);
    expect(d.repelRadius).toBe(nb.repel!.radius);
    expect(d.repelForce).toBe(nb.repel!.force);
    expect(d.repelItemLife).toBe(nb.repel!.itemLife);
    expect(crash.repel).toBeUndefined();
  });

  it('force scales the push, and an untaken item vanishes after its corner time', () => {
    const shove = (force: number) => {
      const g = game({ repelForce: force, repelRadius: 150 });
      mod(g, 'repel').effect.set('p0', { left: 8, total: 8 });
      mod(g, 'repel').wait = 999;
      const b = ball(g);
      const x = 500 + g.getState().paddles.find((p) => p.id === 'p0')!.pos;
      Object.assign(b, { x, y: 800, px: x, py: 800, vx: 0, vy: 0, wait: 0, corner: -1 });
      for (let i = 0; i < 15; i++) g.update(1 / 60);
      return 800 - b.y;
    };
    expect(shove(5000)).toBeGreaterThan(shove(1000));

    const g = game({ repelItemLife: 5, repelEvery: 10 });
    mod(g, 'repel').item = { x: 184, y: 184, corner: 0, left: 5, total: 5 };
    mod(g, 'repel').wait = 999;
    for (let i = 0; i < 60 * 6; i++) g.update(1 / 60);
    expect(g.getState().repel!.item).toBeNull();
    expect(applyOptions(nb, { repelForce: 99999, repelItemLife: 1 }).repel).toMatchObject({ force: 6000, itemLife: 5 });
  });
});
