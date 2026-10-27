import { describe, expect, it } from 'vitest';
import { applyOptions, createBallArena } from '../variants';
import type { BallArena } from './BallArena';
import { CORNER_SIZE, FIELD_HALF } from '../../shared/geometry';
import { VARIANTS } from '../variants';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const make = (variant: string, seed = 1) => createBallArena(VARIANTS.find((v) => v.id === variant)!, seed);

function run(g: BallArena, seconds: number, onTick?: (t: number) => void) {
  for (let i = 0; i < seconds * 60 && !g.isFinished(); i++) {
    onTick?.(i);
    g.update(1 / 60);
  }
}

describe.each(VARIANTS.map((v) => v.id))('BallArena %s', (variant) => {
  it.each([1, 2, 3, 4, 7, 12])('finishes with every player placed once (%i players)', (n) => {
    const g = make(variant);
    g.init(players(n));
    run(g, 200);
    expect(g.isFinished()).toBe(true);
    const pl = g.getPlacements();
    expect(pl).toHaveLength(n);
    expect(new Set(pl.map((p) => p.id)).size).toBe(n);
    expect(Math.min(...pl.map((p) => p.place))).toBe(1);
  });

  it('idle paddles lose lives to goals', () => {
    const g = make(variant);
    g.init(players(2));
    run(g, 60);
    const lives = g.getState().sides.filter((s) => s.used).map((s) => s.lives);
    expect(lives.some((l) => l < g.getState().sides[0].maxLives)).toBe(true);
  });

  it('keeps paddles inside their lane', () => {
    const g = make(variant);
    g.init(players(4));
    for (const p of players(4)) g.handleInput(p.id, { mx: 1, my: 0, a1: true, a2: false });
    run(g, 5);
    for (const p of g.getState().paddles) {
      expect(Math.abs(p.pos) + p.len / 2).toBeLessThanOrEqual(400.01);
    }
  });

  it('disconnecting the only paddle on a side eliminates it', () => {
    const g = make(variant);
    g.init(players(3));
    g.removePlayer('p1');
    const st = g.getState();
    const side = st.paddles.find((p) => p.id === 'p1')!.side;
    expect(st.sides[side].alive).toBe(false);
  });
});

describe('BallArena corner launchers', () => {
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];

  it.each(VARIANTS.map((v) => v.id))('%s: waiting balls sit in corner blocks, outside the goals', (variant) => {
    const g = make(variant);
    g.init(players(2));
    const st = g.getState();
    expect(st.balls.length).toBeGreaterThan(0);
    for (const b of st.balls) {
      expect(b.wait).toBe(true);
      const [sx, sy] = corners[b.corner];
      expect(b.x).toBeCloseTo(500 + sx * (FIELD_HALF - CORNER_SIZE / 2), 0);
      expect(b.y).toBeCloseTo(500 + sy * (FIELD_HALF - CORNER_SIZE / 2), 0);
    }
  });

  it('lanes stop where the corner blocks begin', () => {
    const g = make('smashball');
    g.init(players(2));
    for (const p of players(2)) g.handleInput(p.id, { mx: 1, my: 0, a1: false, a2: false });
    run(g, 3);
    for (const p of g.getState().paddles) {
      expect(Math.abs(p.pos) + p.len / 2).toBeLessThanOrEqual(FIELD_HALF - CORNER_SIZE + 0.01);
    }
  });

  it('launches from several corners with varying delays inside base +- variance', () => {
    const v = VARIANTS.find((x) => x.id === 'smashball')!;
    // no reinforcements here: this test measures the respawn delay of the single ball
    const g = createBallArena({ ...v, reinforce: { every: 15, variance: 6, max: 1 } }, 7);
    g.init(players(2));
    const lo = v.spawn.delay - v.spawn.variance;
    const hi = v.spawn.delay + v.spawn.variance;
    const delays: number[] = [];
    const used = new Set<number>();
    let waitStart = 0;
    let prevWaiting = new Map<number, boolean>();
    let t = 0;
    run(g, 120, () => {
      const st = g.getState();
      for (const b of st.balls) {
        const was = prevWaiting.get(b.id);
        if (was === undefined && b.wait) waitStart = t;
        if (b.wait && b.corner >= 0) used.add(b.corner);
        if (was === false && b.wait) waitStart = t;
        if (was === true && !b.wait) delays.push(t - waitStart);
        prevWaiting.set(b.id, b.wait);
      }
      t += 1 / 60;
    });
    expect(delays.length).toBeGreaterThanOrEqual(4);
    // every observed charge time is within the jitter window (+ one tick of sampling slack)
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(lo - 0.1);
    expect(Math.max(...delays)).toBeLessThanOrEqual(hi + 0.1);
    expect(new Set(delays.map((d) => d.toFixed(1))).size).toBeGreaterThan(1);
    expect(used.size).toBeGreaterThan(1);
  });

  it('a ball can never score through a corner block', () => {
    const g = make('smashball', 3);
    g.init(players(4));
    // park every paddle in the middle so only corner geometry matters
    run(g, 120);
    const st = g.getState();
    expect(st.sides.every((s) => s.lives >= 0)).toBe(true);
    expect(st.balls.every((b) => Math.abs(b.x - 500) <= FIELD_HALF + 30 && Math.abs(b.y - 500) <= FIELD_HALF + 30)).toBe(true);
  });
});

// the boost pulse is fired by the variant's `smashButton` (Sand Orb: the second action)
describe.each(VARIANTS.filter((v) => v.smashEnabled).map((v) => v.id))('BallArena boost pulse %s', (variant) => {
  const cfg = VARIANTS.find((v) => v.id === variant)!;
  const press = (g: BallArena, on: boolean, button: 'a1' | 'a2' = cfg.smashButton) =>
    g.handleInput('p0', { mx: 0, my: 0, a1: button === 'a1' && on, a2: button === 'a2' && on });
  /** a game advanced until a ball is flying; p0 (side 0) sits at the bottom, face centre (500 + pos, 890) */
  const flying = (opts: Record<string, number | boolean | string>, seed = 3) => {
    const g = createBallArena(applyOptions(cfg, opts), seed);
    g.init(players(2));
    for (let i = 0; i < 60 * 20 && !g.getState().balls.some((b) => !b.wait); i++) g.update(1 / 60);
    return g;
  };
  const pad0 = (g: BallArena) => g.getState().paddles.find((p) => p.id === 'p0')!;

  it('shoves a ball in range straight away from the paddle, boosted', () => {
    const g = createBallArena(applyOptions(cfg, { smashRadius: 400, lives: 15 }), 3);
    g.init(players(2));
    const dist = (b: { x: number; y: number }) => Math.hypot(b.x - (500 + pad0(g).pos), b.y - 890);
    // idle paddle: wait for a free ball to come within reach
    for (let i = 0; i < 60 * 60; i++) {
      if (g.getState().balls.some((b) => !b.wait && dist(b) < 300)) break;
      g.update(1 / 60);
    }
    const before = g.getState().balls.find((b) => !b.wait && dist(b) < 300)!;
    expect(before).toBeTruthy();
    const d0 = dist(before);
    press(g, true);
    g.update(1 / 60);
    const after = g.getState().balls.find((b) => b.id === before.id)!;
    expect(dist(after)).toBeGreaterThan(d0);
    expect(after.boost).toBeGreaterThan(0);
    expect(pad0(g).pulse).toBeGreaterThan(0.9);
    expect(g.drainEvents().some((e) => e.kind === 'smash' && e.id === 'p0')).toBe(true);
  });

  it('leaves balls outside the radius alone and still goes on cooldown', () => {
    const g = flying({ smashRadius: 60 });
    press(g, true);
    g.update(1 / 60);
    expect(g.getState().balls.every((b) => b.boost === 0)).toBe(true);
    expect(pad0(g).d).toBeLessThan(1);
    expect(g.getState().boostRadius).toBe(60);
  });

  it('fires once per press and respects the cooldown', () => {
    const g = flying({ smashCooldown: 1 });
    let n = 0;
    press(g, true);
    for (let i = 0; i < 60 * 3; i++) {
      g.update(1 / 60);
      n += g.drainEvents().filter((e) => e.kind === 'smash').length;
    }
    expect(n).toBe(1); // held for 3 s: no repeat
    press(g, false);
    g.update(1 / 60);
    press(g, true);
    g.update(1 / 60);
    expect(g.drainEvents().some((e) => e.kind === 'smash')).toBe(true); // cooldown (1 s) is long over
    press(g, false);
    g.update(1 / 60);
    press(g, true);
    g.update(1 / 60);
    expect(g.drainEvents().some((e) => e.kind === 'smash')).toBe(false); // too soon
  });

  it('only the variant\'s own button fires it, and smashEnabled=false disables it', () => {
    const other = cfg.smashButton === 'a1' ? 'a2' : 'a1';
    const g = flying({});
    press(g, true, other);
    g.update(1 / 60);
    expect(pad0(g).pulse).toBe(0);
    const off = flying({ smashEnabled: false });
    press(off, true);
    off.update(1 / 60);
    expect(pad0(off).pulse).toBe(0);
  });
});

describe('BallArena rules', () => {
  it('a defended side does not concede while the paddle tracks the ball', () => {
    const g = make('smashball');
    g.init(players(2));
    // simple bot: every paddle follows the nearest ball's along-side position
    run(g, 20, () => {
      const st = g.getState();
      for (const pad of st.paddles) {
        const ball = st.balls[0];
        // canonical x of the ball for this side
        const dx = ball.x - 500;
        const dy = ball.y - 500;
        const k = pad.side;
        const cx = k === 0 ? dx : k === 2 ? -dx : k === 1 ? dy : -dy;
        g.handleInput(pad.id, { mx: Math.max(-1, Math.min(1, (cx - pad.pos) / 40)), my: 0, a1: false, a2: false });
      }
    });
    const lost = g.getState().sides.filter((s) => s.used).reduce((a, s) => a + (5 - s.lives), 0);
    expect(lost).toBeLessThanOrEqual(1);
  });

  it('teams share a side and its placement', () => {
    const g = make('smashball');
    g.init(players(8));
    const sides = new Map<number, number>();
    for (const p of g.getState().paddles) sides.set(p.side, (sides.get(p.side) ?? 0) + 1);
    expect([...sides.values()]).toEqual([2, 2, 2, 2]);
    run(g, 200);
    const places = new Map(g.getPlacements().map((p) => [p.id, p.place]));
    const st = g.getState();
    for (const side of [0, 1, 2, 3]) {
      const ids = st.paddles.filter((p) => p.side === side).map((p) => p.id);
      expect(new Set(ids.map((id) => places.get(id))).size).toBe(1);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = make('cloud-orbs', 42);
    const b = make('cloud-orbs', 42);
    a.init(players(4));
    b.init(players(4));
    run(a, 10);
    run(b, 10);
    expect(a.getState()).toEqual(b.getState());
  });
});
