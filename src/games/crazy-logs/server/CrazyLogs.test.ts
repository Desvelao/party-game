import { describe, expect, it } from 'vitest';
import { defaultOptions, normalizeSelection, optionsFor } from '../../../core/shared/catalog';
import { LOGS_FINISH_Y, LOGS_START_Y, logRowY } from '../shared/geometry';
import { CrazyLogs } from './CrazyLogs';
import { DEFAULT_CONFIG, applyOptions } from './config';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const UP = { mx: 0, my: -1, a1: true, a2: false };
const WALK_UP = { mx: 0, my: -1, a1: false, a2: false };
const IDLE = { mx: 0, my: 0, a1: false, a2: false };
const step = (g: CrazyLogs, seconds: number) => {
  for (let t = 0; t < Math.round(seconds * 60) && !g.isFinished(); t++) g.update(1 / 60);
};
const state = (g: CrazyLogs, id = 'p0') => g.getState().players.find((p) => p.id === id)!;

/** A tiny autopilot: hop from the bank edge, centre itself on each log, hop to the next. */
function autopilot(g: CrazyLogs, id: string): void {
  const s = state(g, id);
  if (s.w > 0 || s.h > 0) return g.handleInput(id, IDLE);
  if (s.y >= LOGS_START_Y) return g.handleInput(id, s.y <= LOGS_START_Y + 14 ? UP : WALK_UP);
  let off = Infinity;
  for (let i = 0; i < 6; i++) if (Math.abs(s.y - logRowY(i)) < Math.abs(off)) off = s.y - logRowY(i);
  if (Math.abs(off) < 8) g.handleInput(id, UP);
  else g.handleInput(id, { mx: 0, my: off > 0 ? -1 : 1, a1: false, a2: false });
}

describe('CrazyLogs', () => {
  it('starts everyone on the start bank with no points and the logs still', () => {
    const g = new CrazyLogs();
    g.init(players(3));
    const s = g.getState();
    expect(s.kind).toBe('ext:crazy-logs');
    expect(s.limit).toBe(60);
    expect(s.rows).toHaveLength(6);
    expect(s.rows.every((r) => r.v === 0 && r.ph === 0)).toBe(true);
    for (const p of s.players) {
      expect(p.y).toBeGreaterThan(LOGS_START_Y);
      expect(p.score).toBe(0);
      expect(p.falls).toBe(0);
      expect(p.w).toBe(0);
    }
  });

  it('logs stay still until someone gets on them', () => {
    const g = new CrazyLogs();
    g.init(players(2));
    const before = g.getState();
    step(g, 2);
    const after = g.getState();
    expect(after.rows.every((r) => r.v === 0 && r.ph === 0)).toBe(true);
    expect(after.players).toEqual(before.players);
  });

  it('a hop moves the player up the river', () => {
    const g = new CrazyLogs();
    g.init(players(2));
    const y0 = state(g).y;
    g.handleInput('p0', UP);
    step(g, 0.1);
    expect(state(g).h).toBeGreaterThan(0);
    g.handleInput('p0', IDLE);
    step(g, 0.3);
    expect(state(g).y).toBeLessThan(y0 - 60);
    expect(g.drainEvents().some((e) => e.kind === 'dash')).toBe(true);
  });

  it('standing on the near half spins the log back, on the far half towards the far bank', () => {
    const near = new CrazyLogs();
    near.init(players(2));
    near.handleInput('p0', UP); // from y = 875 the hop lands at 775, the near half of the first log
    step(near, 0.05);
    near.handleInput('p0', IDLE);
    step(near, 0.35);
    const v0 = near.getState().rows[0].v;
    step(near, 0.1);
    expect(near.getState().rows[0].v).toBeGreaterThan(v0); // keeps pushing while the player stands there
    expect(v0).toBeGreaterThan(30);

    const far = new CrazyLogs();
    far.init(players(2));
    far.handleInput('p0', WALK_UP);
    step(far, 1); // to the very edge of the bank
    far.handleInput('p0', UP);
    step(far, 0.05);
    far.handleInput('p0', IDLE);
    step(far, 0.35);
    expect(far.getState().rows[0].v).toBeLessThan(-20);
  });

  it('walking across the middle reverses a slow spin', () => {
    const g = new CrazyLogs();
    g.init(players(2));
    g.handleInput('p0', WALK_UP);
    step(g, 4 / 60); // a few px up the bank, so the hop lands almost on the log's axis
    g.handleInput('p0', UP);
    step(g, 1 / 60);
    g.handleInput('p0', IDLE);
    step(g, 0.32);
    const slow = g.getState().rows[0].v;
    expect(state(g).y).toBeGreaterThan(logRowY(0) - 1); // on the near side of the axis
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThan(25);
    g.handleInput('p0', WALK_UP);
    step(g, 0.1); // across the middle onto the far half
    g.handleInput('p0', IDLE);
    step(g, 0.2);
    expect(g.getState().rows[0].v).toBeLessThan(0);
  });

  it('the spin is capped and fades when nobody is on the log', () => {
    const g = new CrazyLogs();
    g.init(players(2));
    g.handleInput('p0', UP);
    step(g, 0.05);
    g.handleInput('p0', IDLE);
    step(g, 0.8); // p0 is dragged off into the water; the log keeps turning, slower and slower
    const v = Math.abs(g.getState().rows[0].v);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(190);
    step(g, 4);
    expect(Math.abs(g.getState().rows[0].v)).toBeLessThan(v);
  });

  it('a fall costs time, not the round: back at the start bank, still in play, no point', () => {
    const g = new CrazyLogs();
    g.init(players(2));
    const start = { x: state(g).x, y: state(g).y };
    g.handleInput('p0', UP);
    step(g, 0.05);
    g.handleInput('p0', IDLE); // idle on the near half: dragged into the water
    for (let i = 0; i < 60 * 3 && state(g).falls === 0; i++) step(g, 1 / 60);
    expect(state(g).falls).toBe(1);
    expect(state(g).w).toBeGreaterThan(0);
    expect(state(g).alive).toBe(true);
    expect(g.drainEvents().some((e) => e.kind === 'splash')).toBe(true);
    expect(g.isFinished()).toBe(false);
    step(g, 1.5);
    expect(state(g).w).toBe(0);
    expect(state(g)).toMatchObject({ x: start.x, y: start.y, score: 0, falls: 1 });
  });

  it('a crossing is a point and sends the player back to the start to go again', () => {
    const g = new CrazyLogs();
    g.init(players(2));
    for (let i = 0; i < 60 * 45 && state(g).score === 0; i++) {
      autopilot(g, 'p0');
      g.update(1 / 60);
    }
    expect(state(g).score).toBe(1);
    expect(state(g).y).toBeGreaterThan(LOGS_START_Y);
    expect(state(g).y).toBeGreaterThan(LOGS_FINISH_Y);
    expect(g.drainEvents().some((e) => e.kind === 'bank')).toBe(true);
    expect(g.isFinished()).toBe(false);
  });

  it('the round lasts the time limit and ranks by points, then fewer falls', () => {
    const g = new CrazyLogs();
    g.init(players(3));
    let t = 0;
    for (; t < 60 * 80 && !g.isFinished(); t++) {
      autopilot(g, 'p0'); // keeps crossing
      if (t === 60) g.handleInput('p1', UP); // hops once and is dragged into the water, then idles
      if (t === 66) g.handleInput('p1', IDLE);
      g.update(1 / 60);
    }
    expect(g.isFinished()).toBe(true);
    expect(t).toBeGreaterThanOrEqual(60 * 60);
    expect(t).toBeLessThanOrEqual(60 * 60 + 2);
    expect(state(g).score).toBeGreaterThanOrEqual(2);
    const pl = g.getPlacements();
    expect(pl).toHaveLength(3);
    expect(new Set(pl.map((p) => p.id)).size).toBe(3);
    const place = (id: string) => pl.find((p) => p.id === id)!.place;
    expect(place('p0')).toBe(1);
    expect(place('p2')).toBeLessThan(place('p1')); // p1 fell, p2 sat on the bank
  });

  it('equal points and falls share a place', () => {
    const g = new CrazyLogs();
    g.init(players(3));
    for (let t = 0; t < 60 * 80 && !g.isFinished(); t++) g.update(1 / 60);
    expect(g.isFinished()).toBe(true);
    expect(g.getPlacements().every((p) => p.place === 1)).toBe(true);
  });

  it('a disconnect does not end the round; leavers place below the connected, later leavers higher', () => {
    const g = new CrazyLogs();
    g.init(players(2));
    for (let i = 0; i < 60 * 45 && state(g).score === 0; i++) {
      autopilot(g, 'p0');
      g.update(1 / 60);
    }
    g.removePlayer('p0');
    expect(state(g).alive).toBe(false);
    expect(state(g).score).toBe(1);
    expect(g.isFinished()).toBe(false);
    g.removePlayer('p1');
    g.update(1 / 60);
    expect(g.isFinished()).toBe(true);
    const pl = g.getPlacements();
    expect(pl).toHaveLength(2);
    expect(pl.find((p) => p.id === 'p1')!.place).toBe(1);
    expect(pl.find((p) => p.id === 'p0')!.place).toBe(2);
  });

  describe('options', () => {
    const make = (o: Record<string, number>, n = 2) => {
      const g = new CrazyLogs(applyOptions(o));
      g.init(players(n));
      return g;
    };
    const rideNearHalf = (g: CrazyLogs) => {
      g.handleInput('p0', UP);
      step(g, 0.05);
      g.handleInput('p0', IDLE);
      step(g, 0.3);
    };

    it('the declared defaults are the built-in config', () => {
      expect(applyOptions(defaultOptions(optionsFor('crazy-logs', 'all')))).toEqual(DEFAULT_CONFIG);
      expect(applyOptions({})).toEqual(DEFAULT_CONFIG);
    });

    it('the catalog accepts the options and rejects unknown ones', () => {
      expect(normalizeSelection('crazy-logs', undefined, { timeLimit: 30 })?.options).toEqual({ timeLimit: 30 });
      expect(normalizeSelection('crazy-logs', undefined, { nope: 1 })).toBeNull();
      expect(normalizeSelection('crazy-logs', undefined, { timeLimit: 9999 })?.options).toEqual({ timeLimit: 180 });
    });

    it('timeLimit sets the round length and is published in the state', () => {
      const g = make({ timeLimit: 20 });
      expect(g.getState().limit).toBe(20);
      let t = 0;
      for (; t < 60 * 40 && !g.isFinished(); t++) g.update(1 / 60);
      expect(t).toBeGreaterThanOrEqual(60 * 20);
      expect(t).toBeLessThanOrEqual(60 * 20 + 2);
    });

    it('stability 100 keeps the logs still; 0 makes them react more than the default', () => {
      const still = make({ stability: 100 });
      rideNearHalf(still);
      expect(still.getState().rows.every((r) => r.v === 0)).toBe(true);
      expect(state(still).y).toBeCloseTo(775, 0); // 875 - 100: stays where the hop landed

      const normal = make({});
      const twitchy = make({ stability: 0 });
      rideNearHalf(normal);
      rideNearHalf(twitchy);
      expect(Math.abs(twitchy.getState().rows[0].v)).toBeGreaterThan(Math.abs(normal.getState().rows[0].v));
    });

    it('maxSpin caps the surface speed', () => {
      const g = make({ maxSpin: 60, stability: 0 });
      rideNearHalf(g);
      step(g, 0.1);
      expect(Math.abs(g.getState().rows[0].v)).toBeLessThanOrEqual(60);
    });

    it('respawnTime 0 restarts a fall at once, with no sinking phase', () => {
      const g = make({ respawnTime: 0 });
      g.handleInput('p0', UP);
      step(g, 0.05);
      g.handleInput('p0', IDLE);
      for (let i = 0; i < 60 * 3 && state(g).falls === 0; i++) step(g, 1 / 60);
      expect(state(g).falls).toBe(1);
      expect(state(g).w).toBe(0);
      expect(state(g).y).toBeGreaterThan(LOGS_START_Y);
    });

    it('hopDistance changes how far a hop goes', () => {
      const far = make({ hopDistance: 130 });
      const short = make({ hopDistance: 70 });
      for (const g of [far, short]) {
        g.handleInput('p0', UP);
        step(g, 0.5);
      }
      expect(state(far).y).toBeLessThan(state(short).y);
    });

    it('the default layout is 6 logs of half-thickness 32 centred where logRowY says', () => {
      const st = make({}).getState();
      expect(st.rows).toHaveLength(6);
      expect(st.half).toBe(32);
      st.rows.forEach((r, i) => expect(r.y).toBeCloseTo(logRowY(i), 1));
    });

    it('logCount sets the number of logs, evenly spread and never overlapping', () => {
      for (const n of [4, 5, 8]) {
        const st = make({ logCount: n, logSize: 90 }).getState();
        expect(st.rows).toHaveLength(n);
        const ys = st.rows.map((r) => r.y);
        expect(ys[0]).toBeCloseTo(760, 0);
        expect(ys[n - 1]).toBeCloseTo(260, 0);
        for (let i = 1; i < n; i++) expect(ys[i - 1] - ys[i] - 2 * st.half).toBeGreaterThanOrEqual(7.9);
      }
    });

    it('logSize sets the thickness, clamped so logs never touch', () => {
      expect(make({ logSize: 40 }).getState().half).toBe(20);
      expect(make({ logSize: 90 }).getState().half).toBe(45); // 6 logs: pitch 100 leaves room
      expect(make({ logSize: 90, logCount: 8 }).getState().half).toBeLessThan(32); // pitch ~71: capped at pitch / 2 - 4
    });

    it('a thin log is missed by a hop that lands on a normal one', () => {
      // judge the landing itself (hop = 0.3 s), before spin can carry the rider far
      const land = (o: Record<string, number>) => {
        const g = make(o);
        g.handleInput('p0', UP);
        step(g, 0.34);
        return state(g);
      };
      // the default hop from y = 875 lands at 775: 15 from the centre of the first log (760)
      expect(land({}).falls).toBe(0);
      expect(land({ logSize: 40, hopDistance: 130 }).falls).toBe(0); // 745: 15 away, inside a half of 20
      expect(land({ logSize: 40, hopDistance: 70 }).falls).toBe(1); // 805: 45 away, past half 20 + assist
    });

    it('options are accepted by the catalog', () => {
      expect(normalizeSelection('crazy-logs', undefined, { logCount: 5, logSize: 50 })?.options).toEqual({ logCount: 5, logSize: 50 });
      expect(normalizeSelection('crazy-logs', undefined, { logCount: 99 })?.options).toEqual({ logCount: 8 });
    });

    describe('water jets', () => {
      const jetsOn = (o: Record<string, number | boolean> = {}, rng: () => number = () => 0.5, n = 2) => {
        const g = new CrazyLogs(applyOptions({ jets: true, ...o }), rng);
        g.init(players(n));
        return g;
      };
      const events = (g: CrazyLogs) => g.drainEvents().filter((e) => e.kind === 'jet');

      it('are off by default: nothing erupts and the state lists no jets', () => {
        const g = make({});
        let n = 0;
        for (let t = 0; t < 60 * 59; t++) {
          g.update(1 / 60);
          n += events(g).length;
          expect(g.getState().jets).toHaveLength(0);
        }
        expect(n).toBe(0);
      });

      it('warn first, then erupt once, then clear', () => {
        const g = jetsOn({ jetInterval: 5, jetVariance: 0 });
        step(g, 4.5);
        expect(g.getState().jets).toHaveLength(0);
        step(g, 0.6); // t = 5.1: a jet was scheduled
        const warn = g.getState().jets[0];
        expect(warn.e).toBe(false);
        expect(warn.w).toBeGreaterThan(0);
        step(g, 1.0);
        expect(g.getState().jets[0]?.e).toBe(true);
        expect(events(g)).toHaveLength(1);
        step(g, 0.6);
        expect(g.getState().jets).toHaveLength(0);
      });

      it('the gap is interval +- variance, never under a second', () => {
        const gaps = (rngValue: number, o: Record<string, number>) => {
          const g = jetsOn(o, () => rngValue);
          const times: number[] = [];
          for (let t = 0; t < 60 * 40; t++) {
            g.update(1 / 60);
            for (const _ of events(g)) times.push(t / 60);
          }
          return times.slice(1).map((v, i) => v - times[i]);
        };
        for (const gp of gaps(0.5, { jetInterval: 6, jetVariance: 0 })) expect(gp).toBeCloseTo(6, 0);
        for (const gp of gaps(0, { jetInterval: 6, jetVariance: 3 })) expect(gp).toBeCloseTo(3, 0); // rng 0 -> -variance
        for (const gp of gaps(1, { jetInterval: 6, jetVariance: 3 })) expect(gp).toBeCloseTo(9, 0); // rng 1 -> +variance
        for (const gp of gaps(0, { jetInterval: 3, jetVariance: 10 })) expect(gp).toBeGreaterThanOrEqual(0.9);
      });

      it('shove nearby players away, harder with more force, and leave far ones alone', () => {
        const moved = (force: number) => {
          // rng 0.5 -> jet on the middle log row (index 3 of 6), x in the middle of the log
          const g = jetsOn({ jetForce: force, jetInterval: 3, jetVariance: 0 }, () => 0.5);
          const j0 = g.getState();
          expect(j0.rows).toHaveLength(6);
          step(g, 3.05);
          const jet = g.getState().jets[0];
          expect(jet).toBeDefined();
          // park p0 on that log next to the jet, p1 stays on the start bank
          const anyG = g as unknown as { players: { id: string; x: number; y: number }[] };
          const p0 = anyG.players[0];
          p0.x = jet.x + 20;
          p0.y = jet.y;
          const x0 = p0.x;
          step(g, 1.1);
          return { dx: p0.x - x0, far: state(g, 'p1') };
        };
        const soft = moved(150);
        const hard = moved(600);
        expect(soft.dx).toBeGreaterThan(5);
        expect(hard.dx).toBeGreaterThan(soft.dx);
        expect(soft.far.falls).toBe(0);
      });

      it('options are validated by the catalog', () => {
        expect(normalizeSelection('crazy-logs', undefined, { jets: true, jetForce: 450, jetInterval: 5, jetVariance: 2 })?.options).toEqual({
          jets: true,
          jetForce: 450,
          jetInterval: 5,
          jetVariance: 2,
        });
        expect(normalizeSelection('crazy-logs', undefined, { jets: 'yes' })).toBeNull();
        expect(normalizeSelection('crazy-logs', undefined, { jetForce: 5000 })?.options).toEqual({ jetForce: 600 });
      });
    });
  });
});
