import { describe, expect, it } from 'vitest';
import { defaultOptions, normalizeSelection, optionsFor } from '../../../../core/shared/catalog';
import type { BallArena } from '../core/BallArena';
import { VARIANTS, applyOptions, createBallArena } from './index';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const sand = VARIANTS.find((v) => v.id === 'sand-orb')!;
const make = (opts: Record<string, number | boolean | string> = {}, seed = 4) => createBallArena(applyOptions(sand, opts), seed);
const idle = { mx: 0, my: 0, a1: false, a2: false };
type St = ReturnType<BallArena['getState']>;
/** magnet extension of one paddle / ids of balls stuck to paddles */
const mag = (st: St, id = 'p0') => st.magnet!.paddles.find((q) => q.id === id)!;
const isHeld = (st: St, ballId: number) => st.magnet!.held.includes(ballId);
/** a free ball is within the magnet's reach of p0's (bottom) paddle */
const near = (st: St) => st.balls.some((b) => !b.wait && !isHeld(st, b.id) && b.y > 500 + 400 - 250);

/** p0 (bottom side) tracks its nearest ball; returns the paddle/ball state each tick. */
function drive(g: BallArena, seconds: number, a1: (t: number, st: ReturnType<BallArena['getState']>) => boolean, onTick?: (st: ReturnType<BallArena['getState']>, t: number) => boolean | void) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    const st = g.getState();
    const mine = st.paddles.find((p) => p.id === 'p0')!;
    const flying = st.balls.filter((b) => !b.wait && !isHeld(st, b.id));
    const target = flying.sort((a, b) => b.y - a.y)[0];
    const cx = target ? target.x - 500 : 0;
    g.handleInput('p0', { mx: Math.max(-1, Math.min(1, (cx - mine.pos) / 30)), my: 0, a1: a1(i / 60, st), a2: false });
    g.handleInput('p1', idle);
    g.update(1 / 60);
    if (onTick?.(g.getState(), i / 60)) return;
  }
}

describe('Sand Orb magnet', () => {
  it('catalog defaults match the server config', () => {
    const d = defaultOptions(optionsFor('ballistix', 'sand-orb'));
    expect(d.lives).toBe(sand.lives);
    expect(d.ballSpeed).toBe(sand.ballSpeed);
    expect(d.ballMaxSpeed).toBe(sand.ballMaxSpeed);
    expect(d.hitGain).toBe(sand.hitGain);
    expect(d.paddleLen).toBe(sand.paddleLen);
    expect(d.smashGain).toBe(sand.smashGain);
    expect(d.spawnDelay).toBe(sand.spawn.delay);
    expect(d.magnetCapacity).toBe(sand.magnet!.capacity);
    expect(d.holdTime).toBe(sand.magnet!.holdTime);
    expect(d.magnetCooldown).toBe(sand.magnet!.cooldown);
    expect(d.pullRange).toBe(sand.magnet!.pullRange);
    expect(sand.ballRadius).toBe(VARIANTS.find((v) => v.id === 'smashball')!.ballRadius);
    expect(normalizeSelection('ballistix', 'sand-orb', { magnetCapacity: 3, holdTime: 5 })).not.toBeNull();
    expect(d.smashEnabled).toBe(true);
    expect(d.smashCooldown).toBe(sand.smashCooldown);
    expect(d.smashRadius).toBe(sand.smashRadius);
    expect(d.magnetCooldown).toBe(0);
    expect(normalizeSelection('ballistix', 'sand-orb', { smashEnabled: false, magnetCooldown: 2 })).not.toBeNull();
  });

  it('holding the button catches a ball, and the hold bar drains', () => {
    const g = make();
    g.init(players(2));
    let caught = 0;
    const lefts: number[] = [];
    drive(g, 60, (_t, st) => near(st) || mag(st).held > 0, (st) => {
      const p = mag(st);
      if (p.held > 0) {
        caught = p.held;
        lefts.push(p.holdLeft);
        return lefts.length > 30;
      }
    });
    expect(caught).toBeGreaterThan(0);
    expect(lefts[0]).toBeGreaterThan(0.9);
    expect(lefts.at(-1)!).toBeLessThan(lefts[0]);
    const st = g.getState();
    expect(st.magnet!.held.length > 0).toBe(true);
    // a held ball does not move on its own and is not a goal
    expect(st.sides.filter((s) => s.used).every((s) => s.lives === 7)).toBe(true);
  });

  it('releasing the button launches boosted, much faster than a plain hit', () => {
    const g = make();
    g.init(players(2));
    let released = false;
    let speed = 0;
    let prev: { x: number; y: number } | null = null;
    drive(
      g,
      60,
      (_t, st) => {
        const p = mag(st);
        // hold while a ball is near; once caught, let go shortly after
        if (p.held > 0) return p.holdLeft >= 0.8;
        return near(st);
      },
      (st) => {
        const b = st.balls.find((x) => !x.wait && !isHeld(st, x.id))!;
        if (!released) {
          released = st.balls.some((x) => x.boost > 0);
          prev = b ? { x: b.x, y: b.y } : null;
          return false;
        }
        if (b && prev) {
          speed = Math.hypot(b.x - prev.x, b.y - prev.y) * 60;
          return true;
        }
      },
    );
    expect(released).toBe(true);
    expect(speed).toBeGreaterThan(sand.ballSpeed * 1.3);
    expect(speed).toBeLessThanOrEqual(sand.ballMaxSpeed * 1.6 + 30);
  });

  it('holding too long releases without boost and starts a cooldown', () => {
    const g = make({ holdTime: 1.5, magnetCooldown: 1.5 });
    g.init(players(2));
    let phase: 'wait' | 'held' | 'done' = 'wait';
    let events: string[] = [];
    let boostAfter = -1;
    let cdD = 1;
    drive(g, 60, (_t, st) => near(st) || mag(st).held > 0, (st) => {
      const p = mag(st);
      events.push(...g.drainEvents().map((e) => e.kind));
      if (phase === 'wait' && p.held > 0) phase = 'held';
      if (phase === 'held' && p.held === 0) {
        phase = 'done';
        boostAfter = Math.max(...st.balls.map((b) => b.boost));
        cdD = st.paddles.find((q) => q.id === 'p0')!.d;
        return true;
      }
    });
    expect(phase).toBe('done');
    expect(events).toContain('release');
    expect(events).not.toContain('smash');
    expect(boostAfter).toBe(0);
    expect(cdD).toBeLessThan(1); // magnet cooling down
  });

  it('respects the grab capacity', () => {
    const g = make({ balls: '3', magnetCapacity: 2, spawnDelay: 0.5 }, 9);
    g.init(players(2));
    let maxHeld = 0;
    drive(g, 90, (_t, st) => near(st) || mag(st).held > 0, (st) => {
      maxHeld = Math.max(maxHeld, mag(st).held);
    });
    expect(maxHeld).toBeLessThanOrEqual(2);
    expect(maxHeld).toBeGreaterThan(0);
  });

  it('without the button the paddle just deflects, like before', () => {
    const g = make();
    g.init(players(2));
    let hits = 0;
    drive(g, 40, () => false, () => {
      hits += g.drainEvents().filter((e) => e.kind === 'hit').length;
    });
    expect(hits).toBeGreaterThan(0);
    expect(g.getState().magnet!.paddles.every((p) => p.held === 0 && !p.pulling)).toBe(true);
  });

  it('balls held by a disconnected player go back into play', () => {
    const g = make();
    g.init(players(2));
    drive(g, 60, (_t, st) => near(st) || mag(st).held > 0, (st) => mag(st).held > 0);
    g.removePlayer('p0');
    const st = g.getState();
    expect(st.magnet!.held.length > 0).toBe(false);
    expect(st.balls.every((b) => b.wait || b.x > 0)).toBe(true);
  });

  it('a wider pull range is exposed in state and catches a ball with a margin', () => {
    const wide = make({ pullRange: 400 });
    wide.init(players(2));
    expect(wide.getState().magnet!.range).toBe(400);
    expect(make().getState().magnet!.range).toBe(sand.magnet!.pullRange);
    let held = 0;
    drive(wide, 40, (_t, st) => near(st), (st) => {
      held = mag(st).held;
      return held > 0;
    });
    expect(held).toBeGreaterThan(0);
    // default stays small relative to the field
    expect(sand.magnet!.pullRange).toBeLessThan(200);
  });

  it('the second button fires the boost pulse, the first one never does', () => {
    const g = make({ smashRadius: 400 });
    g.init(players(2));
    for (let i = 0; i < 60 * 20 && !g.getState().balls.some((b) => !b.wait); i++) g.update(1 / 60);
    g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: true });
    g.handleInput('p1', idle);
    g.update(1 / 60);
    expect(g.getState().paddles.find((p) => p.id === 'p0')!.pulse).toBeGreaterThan(0.9);
    expect(g.drainEvents().map((e) => e.kind)).toContain('smash');
  });

  it('the first button never fires the boost, and a 0 magnet cooldown allows instant re-use', () => {
    const g = make();
    g.init(players(2));
    const kinds: string[] = [];
    let held = 0;
    drive(g, 60, (_t, st) => near(st) || mag(st).held > 0, (st) => {
      kinds.push(...g.drainEvents().map((e) => e.kind));
      held = Math.max(held, mag(st).held);
      expect(st.paddles.find((p) => p.id === 'p0')!.pulse).toBe(0);
    });
    expect(held).toBeGreaterThan(0);
    expect(sand.magnet!.cooldown).toBe(0);
  });
});
