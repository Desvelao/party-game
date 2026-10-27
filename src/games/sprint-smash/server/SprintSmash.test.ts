import { describe, expect, it } from 'vitest';
import { defaultOptions, normalizeSelection, optionsFor } from '../../../core/shared/catalog';
import { DASH_CX, DASH_CY, DASH_INNER, DASH_MID, DASH_OUTER } from '../shared/geometry';
import { SprintSmash } from './SprintSmash';
import { DASH_DEFAULTS, DASH_VARIANTS, applyOptions, type DashConfig } from './config';
import { createSprintSmash } from './create';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const variant = (id: string) => DASH_VARIANTS.find((v) => v.id === id)!;
const make = (id = 'dot-sprint', o: Record<string, number> = {}, n = 2, rng: () => number = () => 0.5) => {
  const g = createSprintSmash(variant(id), o, rng);
  g.init(players(n));
  return g;
};
/** the original rules (closed walls, passive gauge, ring missiles on a1) that Ember keeps; Dot Sprint now has open edges, a berry bar and a2 missiles */
const classic = (o: Record<string, number> = {}, n = 2, rng: () => number = () => 0.5) => {
  const v = { ...variant('dot-sprint'), config: { ...DASH_DEFAULTS, missiles: true } };
  const g = createSprintSmash(v, o, rng);
  g.init(players(n));
  return g;
};
const step = (g: SprintSmash, seconds: number) => {
  for (let t = 0; t < Math.round(seconds * 60) && !g.isFinished(); t++) g.update(1 / 60);
};
const state = (g: SprintSmash, id = 'p0') => g.getState().players.find((p) => p.id === id)!;
const set = (g: SprintSmash, id: string, patch: Record<string, unknown>) => {
  const p = (g as unknown as { byId: Map<string, Record<string, unknown>> }).byId.get(id)!;
  Object.assign(p, patch);
  return p;
};
const at = (ang: number, r = DASH_MID) => ({ x: DASH_CX + Math.cos(ang) * r, y: DASH_CY + Math.sin(ang) * r });

/** Steer a craft round the track (stick along the tangent, nudged back to the middle lane). */
function drive(g: SprintSmash, id: string, accel = true): void {
  const s = state(g, id);
  const dx = s.x - DASH_CX;
  const dy = s.y - DASH_CY;
  const r = Math.hypot(dx, dy) || 1;
  const k = (r - DASH_MID) / 70;
  const tx = -dy / r;
  const ty = dx / r;
  const mx = tx - (dx / r) * k;
  const my = ty - (dy / r) * k;
  const l = Math.hypot(mx, my) || 1;
  g.handleInput(id, { mx: mx / l, my: my / l, a1: accel, a2: false });
}

describe('SprintSmash', () => {
  it('starts on the grid behind the line with no laps, full energy and no hazards', () => {
    const g = classic({}, 4);
    const s = g.getState();
    expect(s.kind).toBe('ext:sprint-smash');
    expect(s.variant).toBe('dot-sprint');
    expect(s.laps).toBe(10);
    expect(s.pickups).toHaveLength(0);
    expect(s.barrels).toBeUndefined();
    for (const p of s.players) {
      const r = Math.hypot(p.x - DASH_CX, p.y - DASH_CY);
      expect(r).toBeGreaterThan(DASH_INNER);
      expect(r).toBeLessThan(DASH_OUTER);
      expect(p.p).toBe(0);
      expect(p.e).toBe(1);
      expect(p.item).toBe('');
    }
    expect(new Set(s.players.map((p) => `${p.x},${p.y}`)).size).toBe(4);
  });

  it('the stick steers the craft', () => {
    const g = make();
    g.handleInput('p0', { mx: 0, my: 1, a1: false, a2: false });
    const f0 = state(g).f;
    step(g, 0.3);
    expect(state(g).f).not.toBeCloseTo(f0, 1);
  });

  it('holding the action is faster and drains energy, which refills when released', () => {
    const slow = classic();
    const fast = classic();
    for (let i = 0; i < 90; i++) {
      drive(slow, 'p0', false);
      drive(fast, 'p0', true);
      slow.update(1 / 60);
      fast.update(1 / 60);
    }
    expect(state(fast).p).toBeGreaterThan(state(slow).p);
    expect(state(fast).e).toBeLessThan(1);
    expect(state(slow).e).toBe(1);
    for (let i = 0; i < 60 * 3; i++) {
      drive(fast, 'p0', false);
      fast.update(1 / 60);
    }
    expect(state(fast).e).toBeGreaterThan(0.9);
  });

  it('energy runs out: the boost stops until it refills', () => {
    const g = make('dot-sprint', { energyDrain: 1 });
    for (let i = 0; i < 60 * 3; i++) {
      drive(g, 'p0', true);
      g.update(1 / 60);
      if (state(g).e === 0) break;
    }
    expect(state(g).e).toBe(0);
  });

  it('berry refills the gauge and boosts', () => {
    const g = classic();
    for (let i = 0; i < 60; i++) {
      drive(g, 'p0', true);
      g.update(1 / 60);
    }
    expect(state(g).e).toBeLessThan(0.8);
    const me = state(g);
    (g as unknown as { pickups: unknown[] }).pickups.push({ id: 99, x: me.x, y: me.y, k: 'fruit' });
    g.update(1 / 60);
    expect(state(g).e).toBe(1);
    expect(state(g).boost).toBe(true);
    expect(g.drainEvents().some((e) => e.kind === 'pickup')).toBe(true);
  });

  it('a spawned fruit shows up after the interval', () => {
    const g = make('dot-sprint', { fruitEvery: 3 });
    step(g, 3.1);
    expect(g.getState().pickups.some((k) => k.k === 'fruit')).toBe(true);
  });

  it('an accelerating craft shoves the one it hits', () => {
    const g = classic();
    const a = at(-0.5);
    const b = at(-0.5 + 0.045);
    set(g, 'p0', { x: a.x, y: a.y, heading: -0.5 + Math.PI / 2, lastAng: -0.5 });
    set(g, 'p1', { x: b.x, y: b.y, heading: -0.5 + Math.PI / 2, lastAng: -0.5 + 0.045 });
    g.handleInput('p0', { mx: 0, my: 0, a1: true, a2: false });
    step(g, 0.1);
    expect(g.drainEvents().some((e) => e.kind === 'bump')).toBe(true);
  });

  it('the walls keep the craft on the track', () => {
    const g = classic();
    // drive straight out through the outer wall, then straight in through the inner one
    g.handleInput('p0', { mx: 1, my: 0, a1: true, a2: false });
    step(g, 4);
    let r = Math.hypot(state(g).x - DASH_CX, state(g).y - DASH_CY);
    expect(r).toBeLessThanOrEqual(DASH_OUTER + 0.5);
    expect(r).toBeGreaterThanOrEqual(DASH_INNER);
    g.handleInput('p0', { mx: -1, my: 0, a1: true, a2: false });
    step(g, 4);
    r = Math.hypot(state(g).x - DASH_CX, state(g).y - DASH_CY);
    expect(r).toBeLessThanOrEqual(DASH_OUTER + 0.5);
    expect(r).toBeGreaterThanOrEqual(DASH_INNER);
  });

  it('driving round counts laps, and the first to finish wins', () => {
    const g = make('dot-sprint', { laps: 3 }, 2);
    for (let i = 0; i < 60 * 100 && !g.isFinished(); i++) {
      drive(g, 'p0', true);
      g.handleInput('p1', { mx: 0, my: 0, a1: false, a2: false });
      g.update(1 / 60);
    }
    expect(g.isFinished()).toBe(true);
    expect(state(g, 'p0').fin).toBe(true);
    expect(state(g, 'p0').p).toBeGreaterThanOrEqual(3);
    const pl = g.getPlacements();
    expect(pl.find((p) => p.id === 'p0')!.place).toBe(1);
    expect(pl.find((p) => p.id === 'p1')!.place).toBe(2);
    expect(g.drainEvents().some((e) => e.kind === 'bank')).toBe(true);
  });

  it('time out ranks connected players above leavers; the later leaver ranks higher', () => {
    const g = make('dot-sprint', { timeLimit: 60 }, 3);
    g.removePlayer('p1'); // never moves: nobody makes progress with a removed craft
    g.removePlayer('p2');
    for (let i = 0; i < 60 * 70 && !g.isFinished(); i++) {
      drive(g, 'p0', false); // slow but moving
      g.update(1 / 60);
    }
    expect(g.isFinished()).toBe(true);
    const pl = g.getPlacements();
    expect(pl.find((p) => p.id === 'p0')!.place).toBe(1);
    expect(pl.find((p) => p.id === 'p2')!.place).toBe(2);
    expect(pl.find((p) => p.id === 'p1')!.place).toBe(3);
  });

  it('a disconnect does not end the round for the others', () => {
    const g = make('dot-sprint', {}, 3);
    g.removePlayer('p0');
    step(g, 1);
    expect(g.isFinished()).toBe(false);
    g.removePlayer('p1');
    g.removePlayer('p2');
    g.update(1 / 60);
    expect(g.isFinished()).toBe(true);
    expect(g.getPlacements()).toHaveLength(3);
  });

  describe('Dot Sprint / Ember: missiles', () => {
    it('a held missile is fired on the press and knocks and stuns the rival, not the shooter', () => {
      const g = classic();
      const a = at(-0.6);
      const b = at(-0.6 + 0.3);
      const shooter = set(g, 'p0', { x: a.x, y: a.y, heading: -0.6 + Math.PI / 2, lastAng: -0.6, item: 'missile' });
      set(g, 'p1', { x: b.x, y: b.y, heading: -0.6 + Math.PI / 2, lastAng: -0.6 + 0.3 });
      g.handleInput('p0', { mx: 0, my: 0, a1: true, a2: false });
      g.update(1 / 60);
      expect(shooter.item).toBe('');
      let events = g.drainEvents();
      expect(events.some((e) => e.kind === 'rocket' && e.id === 'p0')).toBe(true);
      expect(g.getState().missiles).toHaveLength(1);
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: false });
      let stunnedP1 = false;
      for (let i = 0; i < 60 * 2; i++) {
        g.update(1 / 60);
        events = events.concat(g.drainEvents());
        stunnedP1 ||= state(g, 'p1').stun;
      }
      expect(events.some((e) => e.kind === 'hit' && e.id === 'p1')).toBe(true);
      expect(events.some((e) => e.kind === 'hit' && e.id === 'p0')).toBe(false);
      expect(stunnedP1).toBe(true);
      expect(g.getState().missiles).toHaveLength(0);
    });

    it('missile pick-ups spawn on the interval and are carried', () => {
      const g = make('dot-sprint', { missileEvery: 4 });
      step(g, 4.1);
      const m = g.getState().pickups.find((k) => k.k === 'missile');
      expect(m).toBeDefined();
      set(g, 'p0', { x: m!.x, y: m!.y });
      g.update(1 / 60);
      expect(state(g).item).toBe('missile');
    });

    it('Toxic and Splash have no missiles', () => {
      for (const id of ['toxic-sprint', 'splash-sprint']) {
        const g = make(id, {});
        step(g, 40);
        expect(g.getState().pickups.some((k) => k.k === 'missile')).toBe(false);
      }
    });
  });

  describe('Ember Sprint: volcano, lava balls, open edge', () => {
    const waitForBalls = (g: SprintSmash) => {
      step(g, 6.1);
      expect(g.getState().volcano!.warn).toBeGreaterThan(0);
      step(g, 1.1);
    };

    it('warns, then throws four lava balls one after another from the centre', () => {
      const g = make('ember-sprint', { eruptEvery: 6 });
      waitForBalls(g);
      expect(g.drainEvents().some((e) => e.kind === 'boom')).toBe(true);
      step(g, 0.8);
      const balls = g.getState().balls!;
      expect(balls.length).toBeGreaterThan(1);
      for (const b of balls) expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(300, 0);
      expect((g.getState() as unknown as Record<string, unknown>).lava).toBeUndefined();
    });

    it('a ball that touches a craft knocks, stuns and slows it', () => {
      const g = make('ember-sprint', { eruptEvery: 6 });
      waitForBalls(g);
      // let the first ball reach the track, then put the craft on it
      let ball = g.getState().balls![0];
      for (let i = 0; i < 120 && Math.hypot(ball.x - DASH_CX, ball.y - DASH_CY) < DASH_INNER + 20; i++) {
        g.update(1 / 60);
        ball = g.getState().balls!.find((b) => b.id === ball.id) ?? ball;
      }
      set(g, 'p0', { x: ball.x, y: ball.y, invulnT: 0, fall: 0, heading: 0 });
      set(g, 'p1', { fall: 99 });
      let hit = false;
      for (let i = 0; i < 60 && !hit; i++) {
        g.update(1 / 60);
        hit = g.drainEvents().some((e) => e.kind === 'hit' && e.id === 'p0');
      }
      expect(hit).toBe(true);
      expect(state(g).slow).toBe(true);
    });

    it('a ball flies over the infield wall and drops into the lava past the outer edge', () => {
      const g = make('ember-sprint', { eruptEvery: 6 });
      // park both crafts out of its way: fallen
      set(g, 'p0', { fall: 99 });
      set(g, 'p1', { fall: 99 });
      waitForBalls(g);
      step(g, 5);
      expect(g.getState().balls).toHaveLength(0);
      expect(g.drainEvents().some((e) => e.kind === 'hit')).toBe(false);
    });

    it('the berry loads the bar, the missile is fired on a2, the outer edge is a fall and the inner a wall', () => {
      const g = make('ember-sprint');
      expect(state(g).e).toBe(0);
      const me = state(g);
      (g as unknown as { pickups: unknown[] }).pickups.push({ id: 99, x: me.x, y: me.y, k: 'fruit' });
      g.update(1 / 60);
      expect(state(g).e).toBe(0.5);
      expect(state(g).boost).toBe(false);
      const m = make('ember-sprint');
      const shooter = set(m, 'p0', { item: 'missile' });
      m.handleInput('p0', { mx: 0, my: 0, a1: true, a2: false });
      m.update(1 / 60);
      expect(shooter.item).toBe('missile');
      m.handleInput('p0', { mx: 0, my: 0, a1: false, a2: true });
      m.update(1 / 60);
      expect(shooter.item).toBe('');
      expect(m.getState().missiles[0].vx).toBeDefined();
      const f = make('ember-sprint');
      set(f, 'p0', { ...at(Math.PI / 2, DASH_OUTER - 40), lastAng: Math.PI / 2, heading: Math.PI / 2 });
      f.handleInput('p0', { mx: 0, my: 1, a1: false, a2: false });
      step(f, 1);
      expect(state(f).fall).toBe(true);
      const w = make('ember-sprint');
      set(w, 'p0', { ...at(0, DASH_INNER + 40), lastAng: 0, heading: Math.PI });
      w.handleInput('p0', { mx: -1, my: 0, a1: false, a2: false });
      step(w, 2);
      expect(state(w).fall).toBe(false);
      expect(Math.hypot(state(w).x - DASH_CX, state(w).y - DASH_CY)).toBeGreaterThanOrEqual(DASH_INNER);
    });
  });

  describe('Toxic Sprint', () => {
    it('has barrels on the track, and one explodes then returns somewhere else', () => {
      let n = 7;
      const g = make('toxic-sprint', {}, 2, () => ((n = (n * 16807) % 2147483647) / 2147483647));
      const barrels = g.getState().barrels!;
      expect(barrels).toHaveLength(8);
      set(g, 'p0', { x: barrels[0].x, y: barrels[0].y });
      g.update(1 / 60);
      expect(g.getState().barrels![0].on).toBe(false);
      expect(g.drainEvents().some((e) => e.kind === 'boom')).toBe(true);
      const was = { x: barrels[0].x, y: barrels[0].y };
      step(g, 5.2);
      const b0 = g.getState().barrels![0];
      expect(b0.on).toBe(true);
      expect(Math.hypot(b0.x - was.x, b0.y - was.y)).toBeGreaterThan(1);
    });

    it('barrels sit at random spots of the track band, not on a fixed ring', () => {
      const radii = new Set<number>();
      for (const seed of [1, 2, 3]) {
        let n = seed;
        const g = make('toxic-sprint', {}, 2, () => ((n = (n * 16807) % 2147483647) / 2147483647));
        for (const b of g.getState().barrels!) {
          const r = Math.hypot(b.x - DASH_CX, b.y - DASH_CY);
          expect(r).toBeGreaterThan(DASH_MID - 46);
          expect(r).toBeLessThan(DASH_MID + 46);
          radii.add(Math.round(r));
        }
      }
      expect(radii.size).toBeGreaterThan(8);
    });

    it('the outer edge is open all round: leaving it is a fall, then the craft is put back', () => {
      for (const ang of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) {
        const g = make('toxic-sprint', { fallPenalty: 1 });
        set(g, 'p0', { ...at(ang, DASH_OUTER - 40), lastAng: ang, heading: ang });
        g.handleInput('p0', { mx: Math.cos(ang), my: Math.sin(ang), a1: false, a2: false });
        step(g, 1);
        expect(state(g).fall).toBe(true);
        for (let i = 0; i < 72; i++) {
          drive(g, 'p0', false); // once put back, follow the track
          g.update(1 / 60);
        }
        const s = state(g);
        expect(s.fall).toBe(false);
        const r = Math.hypot(s.x - DASH_CX, s.y - DASH_CY);
        expect(r).toBeGreaterThan(DASH_INNER);
        expect(r).toBeLessThan(DASH_OUTER);
      }
    });

    it('the inner edge is a wall: no fall', () => {
      const g = make('toxic-sprint');
      set(g, 'p0', { ...at(0, DASH_INNER + 40), lastAng: 0, heading: Math.PI });
      g.handleInput('p0', { mx: -1, my: 0, a1: false, a2: false });
      step(g, 2);
      expect(state(g).fall).toBe(false);
      expect(Math.hypot(state(g).x - DASH_CX, state(g).y - DASH_CY)).toBeGreaterThanOrEqual(DASH_INNER);
    });

    it('the slime monster appears and throws three blobs that knock', () => {
      const g = make('toxic-sprint', { slimeEvery: 8 });
      const run = (secs: number) => {
        for (let i = 0; i < Math.round(secs * 60); i++) {
          drive(g, 'p0', false); // keep to the track: the outer edge is open
          g.update(1 / 60);
        }
      };
      run(8.1);
      expect(g.getState().slime!.t).toBeGreaterThan(0);
      run(3.5); // monster shows for 2 s, then the blobs reach the track
      const blobs = g.getState().blobs!;
      expect(blobs).toHaveLength(3);
      set(g, 'p0', { x: blobs[0].x, y: blobs[0].y, invulnT: 0 });
      g.update(1 / 60);
      expect(g.drainEvents().some((e) => e.kind === 'hit')).toBe(true);
    });

    it('a force field star pushes nearby rivals away on the press', () => {
      const g = make('toxic-sprint');
      const a = at(-0.7);
      const b = at(-0.7 + 0.12); // ~40 units ahead
      set(g, 'p0', { x: a.x, y: a.y, item: 'star' });
      set(g, 'p1', { x: b.x, y: b.y });
      g.handleInput('p0', { mx: 0, my: 0, a1: true, a2: false });
      g.update(1 / 60);
      expect(state(g, 'p0').item).toBe('star'); // a1 is only the throttle
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: true });
      g.update(1 / 60);
      expect(g.drainEvents().some((e) => e.kind === 'zap')).toBe(true);
      expect(state(g, 'p1').stun).toBe(true);
      expect(state(g, 'p0').item).toBe('');
    });

    it('a rival outside the force field radius is not pushed', () => {
      const g = make('toxic-sprint');
      const a = at(-0.7);
      const b = at(-0.7 + 0.6); // well beyond 110 units
      set(g, 'p0', { x: a.x, y: a.y, item: 'star' });
      set(g, 'p1', { x: b.x, y: b.y });
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: true });
      g.update(1 / 60);
      expect(state(g, 'p0').item).toBe('');
      expect(state(g, 'p1').stun).toBe(false);
    });

    it('the berry loads the bar (no boost) and there is no passive speed-up', () => {
      const g = make('toxic-sprint');
      expect(state(g).e).toBe(0);
      const me = state(g);
      (g as unknown as { pickups: unknown[] }).pickups.push({ id: 99, x: me.x, y: me.y, k: 'fruit' });
      g.update(1 / 60);
      expect(state(g).e).toBe(0.5);
      expect(state(g).boost).toBe(false);
      const slow = make('toxic-sprint');
      const empty = make('toxic-sprint');
      for (let i = 0; i < 90; i++) {
        drive(slow, 'p0', false);
        drive(empty, 'p0', true);
        slow.update(1 / 60);
        empty.update(1 / 60);
      }
      expect(state(empty).p).toBeCloseTo(state(slow).p, 5);
    });
  });

  describe('Splash Sprint: hub, tubes, sea', () => {
    /** const rng: 0.5 sends one tube (the 4th), 0.1 sends the whole set of six */
    const hubGame = (o: Record<string, number> = {}, r = 0.5) => make('splash-sprint', { rodEvery: 3, rodBurst: 0, ...o }, 2, () => r);
    const tubesOf = (g: SprintSmash) => g.getState().rods!.tubes;
    const onTube = (g: SprintSmash, k: number, r = DASH_MID) => {
      const a = g.getState().rods!.a + (k * Math.PI * 2) / 6;
      return { ...at(a, r), lastAng: a };
    };

    it('the hub has six tubes, all in at rest, and does not turn', () => {
      const g = hubGame();
      expect(tubesOf(g)).toEqual([0, 0, 0, 0, 0, 0]);
      step(g, 2);
      expect(g.getState().rods!.a).toBe(0);
    });

    it('an event sends one concrete tube or the whole set, holds it, then retracts it', () => {
      const one = hubGame({ rodEvery: 6 });
      step(one, 7.1);
      expect(tubesOf(one).filter((e) => e > 0)).toHaveLength(1);
      expect(tubesOf(one)[3]).toBe(1);
      step(one, 4.1); // 1 s out + 3 s hold + 1 s back, before the next event
      expect(tubesOf(one).every((e) => e === 0)).toBe(true);
      const set = hubGame({}, 0.1);
      step(set, 4.1);
      expect(tubesOf(set).every((e) => e === 1)).toBe(true);
    });

    it('the hub turns against the lap direction while tubes are out', () => {
      const g = hubGame();
      step(g, 3.5);
      const a0 = g.getState().rods!.a;
      step(g, 1);
      expect(g.getState().rods!.a).toBeLessThan(a0 - 0.2);
    });

    it('bursts bring events in quicker sequences; without them the interval holds', () => {
      const count = (burst: number) => {
        const g = hubGame({ rodBurst: burst });
        let n = 0;
        const hub = g as unknown as { startTubes: () => void };
        const orig = hub.startTubes.bind(g);
        hub.startTubes = () => {
          n++;
          orig();
        };
        step(g, 8);
        return n;
      };
      expect(count(0)).toBe(2); // at 3 s and 6 s
      expect(count(100)).toBeGreaterThanOrEqual(5); // 3 s, then every 1.2 s
    });

    it('the interval varies with rodVariance', () => {
      let n = 3;
      const g = make('splash-sprint', { rodEvery: 10, rodVariance: 4 }, 2, () => ((n = (n * 16807) % 2147483647) / 2147483647));
      const t = (g as unknown as { rodTimer: number }).rodTimer;
      expect(t).not.toBe(10);
      expect(Math.abs(t - 10)).toBeLessThanOrEqual(4);
    });

    it('a tube knocks, stuns and slows a grounded craft', () => {
      const g = hubGame();
      step(g, 4.1);
      set(g, 'p0', { ...onTube(g, 3), invulnT: 0, fall: 0 });
      g.drainEvents();
      g.update(1 / 60);
      expect(g.drainEvents().some((e) => e.kind === 'hit' && e.id === 'p0')).toBe(true);
      expect(state(g).slow).toBe(true);
    });

    it('the jump is on a2 (not a1) and a jumping craft passes over a tube', () => {
      const g = hubGame();
      g.handleInput('p0', { mx: 0, my: 0, a1: true, a2: false });
      step(g, 0.2);
      expect(state(g).air).toBe(0);
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: true });
      step(g, 0.1);
      expect(state(g).air).toBeGreaterThan(0);
      const h = hubGame();
      step(h, 4.1);
      set(h, 'p0', { ...onTube(h, 3), airT: 0.5, speed: 0, invulnT: 0 });
      h.drainEvents();
      h.update(1 / 60);
      expect(h.drainEvents().some((e) => e.kind === 'hit')).toBe(false);
    });

    it('jumping the tubes pays: a craft that jumps them gets ahead of one that takes them', () => {
      const race = (jump: boolean) => {
        const g = hubGame({ rodEvery: 2 }, 0.1);
        step(g, 2.5);
        let hits = 0;
        let prev = false;
        for (let t = 0; t < 8 * 60; t++) {
          const sp = state(g);
          const a = Math.atan2(sp.y - DASH_CY, sp.x - DASH_CX);
          const hub = g.getState().rods!;
          let gap = Infinity;
          for (let k = 0; k < 6; k++) if (hub.tubes[k] > 0.3) gap = Math.min(gap, Math.abs(Math.atan2(Math.sin(hub.a + (k * Math.PI) / 3 - a), Math.cos(hub.a + (k * Math.PI) / 3 - a))));
          const press: boolean = jump && gap < 0.3 && !prev;
          prev = press;
          g.handleInput('p0', { mx: -Math.sin(a), my: Math.cos(a), a1: false, a2: press });
          g.update(1 / 60);
          hits += g.drainEvents().filter((e) => e.kind === 'hit' && e.id === 'p0').length;
        }
        return { laps: state(g).p, hits };
      };
      const took = race(false);
      const jumped = race(true);
      expect(took.hits).toBeGreaterThan(0);
      expect(jumped.hits).toBeLessThan(took.hits);
      expect(jumped.laps).toBeGreaterThan(took.laps);
    });

    it('same rules as the other variants: berry bar, no passive speed, open sea edge, inner wall', () => {
      const g = make('splash-sprint');
      expect(state(g).e).toBe(0);
      const me = state(g);
      (g as unknown as { pickups: unknown[] }).pickups.push({ id: 99, x: me.x, y: me.y, k: 'fruit' });
      g.update(1 / 60);
      expect(state(g).e).toBe(0.5);
      expect(state(g).boost).toBe(false);
      for (const ang of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) {
        const f = make('splash-sprint', { fallPenalty: 1 });
        set(f, 'p0', { ...at(ang, DASH_OUTER - 40), lastAng: ang, heading: ang });
        f.handleInput('p0', { mx: Math.cos(ang), my: Math.sin(ang), a1: false, a2: false });
        step(f, 1);
        expect(state(f).fall).toBe(true);
      }
      const w = make('splash-sprint');
      set(w, 'p0', { ...at(0, DASH_INNER + 40), lastAng: 0, heading: Math.PI });
      w.handleInput('p0', { mx: -1, my: 0, a1: false, a2: false });
      step(w, 2);
      expect(state(w).fall).toBe(false);
      expect(Math.hypot(state(w).x - DASH_CX, state(w).y - DASH_CY)).toBeGreaterThanOrEqual(DASH_INNER);
    });
  });

  describe('Dot Sprint: open edges, berry bar, straight missiles', () => {
    const dotAt = (ang: number, r = DASH_MID) => ({ ...at(ang, r), lastAng: ang, heading: ang + Math.PI / 2 });

    it('has no passive speed-up: holding the action with an empty bar only cruises', () => {
      const g = make('dot-sprint');
      expect(state(g).e).toBe(0);
      const slow = make('dot-sprint');
      for (let i = 0; i < 90; i++) {
        drive(slow, 'p0', false);
        drive(g, 'p0', true);
        slow.update(1 / 60);
        g.update(1 / 60);
      }
      expect(state(g).p).toBeCloseTo(state(slow).p, 5);
    });

    it('a berry loads the bar, and holding the action burns it for speed', () => {
      const g = make('dot-sprint');
      const me = state(g);
      (g as unknown as { pickups: unknown[] }).pickups.push({ id: 99, x: me.x, y: me.y, k: 'fruit' });
      g.update(1 / 60);
      expect(state(g).e).toBe(0.5);
      expect(state(g).boost).toBe(false); // loaded, not spent
      const idle = make('dot-sprint');
      for (let i = 0; i < 60; i++) {
        drive(g, 'p0', true);
        drive(idle, 'p0', false);
        g.update(1 / 60);
        idle.update(1 / 60);
      }
      expect(state(g).e).toBeLessThan(0.5);
      expect(state(g).boost).toBe(true);
      expect(state(g).p).toBeGreaterThan(state(idle).p);
      // no regeneration once released
      const e = state(g).e;
      for (let i = 0; i < 60; i++) {
        drive(g, 'p0', false);
        g.update(1 / 60);
      }
      expect(state(g).e).toBe(e);
    });

    it('the top outer arc (10 to 2 o\'clock) is a wall', () => {
      const g = make('dot-sprint');
      set(g, 'p0', { ...dotAt(-Math.PI / 2, DASH_OUTER - 40), heading: -Math.PI / 2 });
      g.handleInput('p0', { mx: 0, my: -1, a1: false, a2: false });
      step(g, 2);
      const s = state(g);
      expect(Math.hypot(s.x - DASH_CX, s.y - DASH_CY)).toBeLessThanOrEqual(DASH_OUTER);
      expect(s.fall).toBe(false);
    });

    it('leaving the track elsewhere is a fall: frozen for the penalty, then put back on the track', () => {
      const g = make('dot-sprint', { fallPenalty: 2 });
      set(g, 'p0', { ...dotAt(Math.PI / 2, DASH_OUTER - 40), heading: Math.PI / 2 });
      g.handleInput('p0', { mx: 0, my: 1, a1: false, a2: false });
      step(g, 1);
      expect(state(g).fall).toBe(true);
      const where = { x: state(g).x, y: state(g).y };
      step(g, 1);
      expect(state(g).fall).toBe(true);
      expect({ x: state(g).x, y: state(g).y }).toEqual(where);
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: false });
      step(g, 0.7);
      const s = state(g);
      expect(s.fall).toBe(false);
      const r = Math.hypot(s.x - DASH_CX, s.y - DASH_CY);
      expect(r).toBeGreaterThan(DASH_INNER);
      expect(r).toBeLessThan(DASH_OUTER);
    });

    it('the inner edge is a wall everywhere: the craft never falls and stays on the track', () => {
      for (const ang of [Math.PI / 2, -Math.PI / 2, 0]) {
        const g = make('dot-sprint');
        set(g, 'p0', { ...dotAt(ang, DASH_INNER + 40), heading: ang + Math.PI });
        g.handleInput('p0', { mx: -Math.cos(ang), my: -Math.sin(ang), a1: false, a2: false });
        step(g, 2);
        const s = state(g);
        expect(s.fall).toBe(false);
        expect(Math.hypot(s.x - DASH_CX, s.y - DASH_CY)).toBeGreaterThanOrEqual(DASH_INNER);
      }
    });

    it('a missile is fired on a2 (not a1), flies straight and hits a rival ahead', () => {
      const g = make('dot-sprint');
      const a = dotAt(-0.6);
      const b = at(-0.6 + 0.3);
      const shooter = set(g, 'p0', { ...a, item: 'missile' });
      set(g, 'p1', { x: b.x, y: b.y });
      g.handleInput('p0', { mx: 0, my: 0, a1: true, a2: false });
      g.update(1 / 60);
      expect(shooter.item).toBe('missile');
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: true });
      g.update(1 / 60);
      expect(shooter.item).toBe('');
      const m = g.getState().missiles[0];
      expect(m.vx).toBeDefined();
      expect(Math.atan2(m.vy!, m.vx!)).toBeCloseTo(a.heading, 1);
      let events = g.drainEvents();
      for (let i = 0; i < 90; i++) {
        g.update(1 / 60);
        events = events.concat(g.drainEvents());
      }
      expect(events.some((e) => e.kind === 'hit' && e.id === 'p1')).toBe(true);
    });

    it('a missile bounces on the top wall, and can then hurt its shooter', () => {
      const g = make('dot-sprint', { invulnTime: 0 });
      const top = -Math.PI / 2;
      set(g, 'p0', { ...dotAt(top, DASH_OUTER - 90), heading: -Math.PI / 2, item: 'missile' });
      const far = at(top + 1.2);
      set(g, 'p1', { x: far.x, y: far.y });
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: true });
      g.update(1 / 60);
      let bounced = false;
      let hitOwner = false;
      for (let i = 0; i < 120; i++) {
        g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: false });
        g.update(1 / 60);
        const m = g.getState().missiles[0];
        if (m && m.vy! > 0) bounced = true;
        if (g.drainEvents().some((e) => e.kind === 'hit' && e.id === 'p0')) hitOwner = true;
      }
      expect(bounced).toBe(true);
      expect(hitOwner).toBe(true);
    });

    it('a hit leaves the craft crawling for hitSlow seconds, then it recovers', () => {
      const g = make('dot-sprint');
      const a = dotAt(-0.6);
      const b = at(-0.6 + 0.3);
      set(g, 'p0', { ...a, item: 'missile' });
      const victim = set(g, 'p1', { x: b.x, y: b.y, heading: -0.6 + 0.3 + Math.PI / 2, lastAng: -0.6 + 0.3 });
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: true });
      g.update(1 / 60);
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: false });
      let slowAt = -1;
      for (let i = 0; i < 60 * 2 && slowAt < 0; i++) {
        drive(g, 'p1', false);
        g.update(1 / 60);
        if (state(g, 'p1').slow) slowAt = i;
      }
      expect(slowAt).toBeGreaterThanOrEqual(0);
      step(g, 1.5); // past the stun: crawling well under the 170 cruise
      expect(state(g, 'p1').slow).toBe(true);
      expect((victim as { speed: number }).speed).toBeLessThan(170 * 0.5);
      for (let i = 0; i < 60 * 3; i++) {
        drive(g, 'p1', false);
        g.update(1 / 60);
      }
      expect(state(g, 'p1').slow).toBe(false);
      expect((victim as { speed: number }).speed).toBeGreaterThan(150);
    });

    it('hitSlow 0 turns the crawl off, and the other variants never crawl', () => {
      const g = make('dot-sprint', { hitSlow: 0 });
      set(g, 'p0', { ...dotAt(-0.6), item: 'missile' });
      const b = at(-0.6 + 0.3);
      set(g, 'p1', { x: b.x, y: b.y });
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: true });
      step(g, 2);
      expect(state(g, 'p1').slow).toBe(false);
      expect(variant('toxic-sprint').config.hitSlow).toBe(0);
    });

    it('a missile bounces off the inner wall instead of passing through it', () => {
      const g = make('dot-sprint', { invulnTime: 0 });
      const ang = Math.PI / 2;
      // on the track beside the inner wall, heading straight at the infield centre
      set(g, 'p0', { ...dotAt(ang, DASH_INNER + 60), heading: -Math.PI / 2, item: 'missile' });
      const far = at(ang + 2.5);
      set(g, 'p1', { x: far.x, y: far.y });
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: true });
      g.update(1 / 60);
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: false });
      let minR = Infinity;
      let outward = false;
      for (let i = 0; i < 14; i++) {
        g.update(1 / 60);
        const m = g.getState().missiles[0];
        if (!m) break;
        minR = Math.min(minR, Math.hypot(m.x - DASH_CX, m.y - DASH_CY));
        if (m.vy! > 0) outward = true; // started going up (-y, to the centre); now heading back out
      }
      expect(minR).toBeGreaterThanOrEqual(DASH_INNER);
      expect(outward).toBe(true); // it came back out (the shooter is in its way, so it may end on them)
    });

    it('a missile that leaves the track elsewhere disappears', () => {
      const g = make('dot-sprint');
      set(g, 'p0', { ...dotAt(Math.PI / 2, DASH_OUTER - 60), heading: Math.PI / 2, item: 'missile' });
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: true });
      g.update(1 / 60);
      expect(g.getState().missiles).toHaveLength(1);
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: false });
      step(g, 0.5);
      expect(g.getState().missiles).toHaveLength(0);
    });
  });

  describe('options', () => {
    it('apply to the config; unknown ids are ignored', () => {
      const cfg: DashConfig = applyOptions(variant('dot-sprint'), { laps: 4, timeLimit: 90, nope: 1 });
      expect(cfg.laps).toBe(4);
      expect(cfg.timeLimit).toBe(90);
      expect(applyOptions(variant('dot-sprint'), {})).toEqual({ ...DASH_DEFAULTS, missiles: true, edgeWalls: true, outerArc: true, hitSlow: 3, berryBar: true, straightMissiles: true, item2: true });
    });

    it('the catalog validates and clamps them', () => {
      expect(normalizeSelection('sprint-smash', 'dot-sprint', { laps: 5 })?.options).toEqual({ laps: 5 });
      expect(normalizeSelection('sprint-smash', 'dot-sprint', { laps: 99 })?.options).toEqual({ laps: 15 });
      expect(normalizeSelection('sprint-smash', 'dot-sprint', { rodSpeed: 0.8 })).toBeNull(); // Splash only
      expect(normalizeSelection('sprint-smash', 'splash-sprint', { rodSpeed: 0.8 })?.options).toEqual({ rodSpeed: 0.8 });
    });

    it('the factory builds every variant', () => {
      for (const v of DASH_VARIANTS) {
        const g = new SprintSmash(applyOptions(v, {}));
        expect(g.id).toBe(v.id);
        g.init(players(2));
        expect(g.getState().variant).toBe(v.id);
      }
    });
  });

  it('option defaults match the server config', () => {
    for (const v of DASH_VARIANTS) {
      const opts = defaultOptions(optionsFor('sprint-smash', v.id));
      const cfg = v.config as unknown as Record<string, unknown>;
      for (const [k, val] of Object.entries(opts).filter(([k]) => k !== 'roundsToWin')) expect(cfg[k], `${v.id}.${k}`).toBe(val);
    }
  });
});

describe('spawn variance', () => {
  const fruitTimer = (g: SprintSmash) => (g as unknown as { fruitTimer: number }).fruitTimer;

  it('fruitVariance 0 keeps the exact interval', () => {
    expect(fruitTimer(make('dot-sprint', { fruitVariance: 0 }, 2, () => 0.99))).toBe(5);
  });

  it('fruitVariance spreads the first spawn around the interval', () => {
    expect(fruitTimer(make('dot-sprint', { fruitVariance: 3 }, 2, () => 0))).toBe(2);
    expect(fruitTimer(make('dot-sprint', { fruitVariance: 3 }, 2, () => 1))).toBe(8);
  });
});

describe('item spawn defaults and caps', () => {
  const count = (g: SprintSmash, k: string) => g.getState().pickups.filter((p) => p.k === k).length;
  /** nobody picks anything up: both crafts are parked off the track */
  const idle = (id: string, o: Record<string, number> = {}) => {
    const g = make(id, o);
    for (const p of ['p0', 'p1']) set(g, p, { fall: 9999 });
    return g;
  };

  it('spawn faster by default: berry 5 s, missile 6 s, force field 10 s; room for 4 / 3 / 2', () => {
    for (const v of DASH_VARIANTS) {
      expect(v.config.fruitEvery).toBe(5);
      expect(v.config.fruitMax).toBe(4);
    }
    expect(variant('dot-sprint').config.missileEvery).toBe(6);
    expect(variant('dot-sprint').config.missileMax).toBe(3);
    expect(variant('toxic-sprint').config.starEvery).toBe(10);
    expect(variant('toxic-sprint').config.starMax).toBe(2);
  });

  it('berries stop at fruitMax however long the round runs', () => {
    expect(count(idle('dot-sprint'), 'fruit')).toBe(0);
    const g = idle('dot-sprint', { timeLimit: 300 });
    step(g, 60);
    expect(count(g, 'fruit')).toBe(4);
    const one = idle('dot-sprint', { fruitMax: 1, timeLimit: 300 });
    step(one, 60);
    expect(count(one, 'fruit')).toBe(1);
  });

  it('missiles stop at missileMax, force fields at starMax', () => {
    const m = idle('dot-sprint', { timeLimit: 300 });
    step(m, 90);
    expect(count(m, 'missile')).toBe(3);
    const m1 = idle('ember-sprint', { missileMax: 1, timeLimit: 300 });
    step(m1, 90);
    expect(count(m1, 'missile')).toBe(1);
    const s = idle('toxic-sprint', { timeLimit: 300 });
    step(s, 90);
    expect(count(s, 'star')).toBe(2);
    const s1 = idle('toxic-sprint', { starMax: 1, timeLimit: 300 });
    step(s1, 90);
    expect(count(s1, 'star')).toBe(1);
  });
});
