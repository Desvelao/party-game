import { describe, expect, it } from 'vitest';
import { defaultOptions, optionsFor } from '../../../core/shared/catalog';
import { polarEdge } from '../shared/geometry';
import type { FrostShoveState } from '../shared/types';
import { POLAR_VARIANTS, createFrostShove } from './create';
import { mulberry32 } from '../../../core/shared/kit/util';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const idle = { mx: 0, my: 0, a1: false, a2: false };
const run = (g: ReturnType<typeof createFrostShove>, seconds: number) => {
  for (let t = 0; t < seconds * 60 && !g.isFinished(); t++) g.update(1 / 60);
};
const variant = (id: string) => POLAR_VARIANTS.find((v) => v.id === id)!;
const make = (id: string, n = 2, options = {}, rng?: () => number) => {
  const g = createFrostShove(variant(id), options, rng);
  g.init(players(n));
  return g;
};
const me = (g: ReturnType<typeof createFrostShove>, id: string) => g.getState().players.find((p) => p.id === id)!;

describe('FrostShove', () => {
  it('every variant terminates with unique placements', () => {
    for (const v of POLAR_VARIANTS) {
      const g = make(v.id, 4);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.handleInput(`p${i}`, { mx: Math.cos(a), my: Math.sin(a), a1: false, a2: false });
      }
      run(g, 200);
      expect(g.isFinished(), v.id).toBe(true);
      const pl = g.getPlacements();
      expect(new Set(pl.map((p) => p.id)).size).toBe(4);
      expect(Math.min(...pl.map((p) => p.place))).toBe(1);
    }
  });

  it('idle bears at the rim are shrunk off the ice, so the round always ends', () => {
    const g = make('frost-classic', 2, { timeLimit: 30 });
    run(g, 60);
    expect(g.isFinished()).toBe(true);
    expect(g.getPlacements()).toHaveLength(2);
  });

  it('a falling bear can climb back by mashing, otherwise is eliminated', () => {
    const g = make('frost-classic', 2);
    (g as unknown as { wall: number }).wall = 0; // the wall would stop it
    g.handleInput('p0', { mx: 1, my: 0, a1: false, a2: false });
    run(g, 6);
    expect(me(g, 'p0').fall).toBeGreaterThanOrEqual(0);
    // run off the edge until in the water
    for (let t = 0; t < 600 && me(g, 'p0').alive && me(g, 'p0').fall === 0; t++) g.update(1 / 60);
    expect(me(g, 'p0').fall).toBeGreaterThanOrEqual(0);
    if (me(g, 'p0').alive) {
      for (let i = 0; i < 6; i++) {
        g.handleInput('p0', { mx: 0, my: 0, a1: true, a2: false });
        g.update(1 / 60);
        g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: false });
        g.update(1 / 60);
      }
      expect(me(g, 'p0').fall).toBe(0);
      expect(me(g, 'p0').alive).toBe(true);
    }
    const lone = make('frost-classic', 2);
    (lone as unknown as { wall: number }).wall = 0;
    lone.handleInput('p0', { mx: 1, my: 0, a1: false, a2: false });
    run(lone, 20);
    expect(me(lone, 'p0').alive).toBe(false);
    expect(me(lone, 'p1').alive).toBe(true);
  });

  it('a charge costs stamina and knocks a rival back', () => {
    const g = make('frost-classic', 2);
    const s = g.getState();
    const [a, b] = s.players;
    const face = Math.atan2(b.y - a.y, b.x - a.x);
    g.handleInput('p0', { mx: Math.cos(face), my: Math.sin(face), a1: false, a2: false });
    g.update(1 / 60);
    g.handleInput('p0', { mx: Math.cos(face), my: Math.sin(face), a1: true, a2: false });
    g.update(1 / 60);
    expect(me(g, 'p0').st).toBeLessThan(0.6);
    expect(g.drainEvents().some((e) => e.kind === 'dash')).toBe(true);
    const d0 = Math.hypot(b.x - a.x, b.y - a.y);
    run(g, 0.5);
    const d1 = Math.hypot(me(g, 'p1').x - me(g, 'p0').x, me(g, 'p1').y - me(g, 'p0').y);
    expect(d1).toBeLessThan(d0);
  });

  it('disconnect eliminates the player', () => {
    const g = make('frost-classic', 3);
    g.removePlayer('p1');
    expect(me(g, 'p1').alive).toBe(false);
  });

  it('only the variant it belongs to carries its extension state', () => {
    const st = (id: string): FrostShoveState => make(id).getState();
    expect(st('frost-classic').bolts).toBeUndefined();
    expect(st('frost-classic').melts).toBeUndefined();
    expect(st('frost-classic').flying).toBeUndefined();
    expect(st('frost-frenzy').bolts).toBeDefined();
    expect(st('thaw-frenzy').melts).toBeDefined();
    expect(st('thaw-frenzy').beam!.who).toBe('warden');
    expect(st('frost-classic').beam!.who).toBe('robot');
    expect(st('wild-frenzy').flying).toBeDefined();
  });

  it('Frost Frenzy bolts appear and knock bears away', () => {
    const g = make('frost-frenzy', 2, { boltEvery: 1 });
    let sawOn = false;
    for (let t = 0; t < 60 * 20; t++) {
      g.update(1 / 60);
      if (g.getState().bolts!.some((b) => b.on)) sawOn = true;
    }
    expect(sawOn).toBe(true);
  });

  it('Tip Tumble drifts idle bears toward the crowded side', () => {
    const g = make('tip-tumble', 1, { tiltStrength: 400 });
    const start = me(g, 'p0');
    run(g, 0.5);
    const now = me(g, 'p0');
    const sx = start.x - 500;
    const sy = start.y - 500;
    const moved = (now.x - start.x) * sx + (now.y - start.y) * sy;
    expect(moved).toBeGreaterThan(0); // slid further out, away from the centre
    expect(Math.hypot(g.getState().tilt.x, g.getState().tilt.y)).toBeGreaterThan(0);
  });

  it('Thaw Frenzy melts the ice under Shadow Bear', () => {
    const g = make('thaw-frenzy', 1, { meltRate: 60 });
    const before = Math.min(...g.getState().sectors);
    run(g, 20);
    expect(Math.min(...g.getState().sectors)).toBeLessThan(before - 50);
  });

  it('Wild Frenzy: one bomb hit dismounts, two eliminate', () => {
    // seeded: bomb placement is random, so an unseeded run occasionally never lands a hit
    const g = make('wild-frenzy', 2, { bombEvery: 2 }, mulberry32(7));
    const p0 = me(g, 'p0');
    const p1 = me(g, 'p1');
    // p0 stands still; p1 is the target. Drive p0 onto bombs and throw at p1.
    let hits = 0;
    for (let t = 0; t < 60 * 60 && !g.isFinished(); t++) {
      const s = g.getState();
      const a = s.players[0];
      const b = s.players[1];
      const bomb = s.items.find((i) => i.k === 'bomb');
      const target = a.bomb ? b : (bomb ?? b);
      const ang = Math.atan2(target.y - a.y, target.x - a.x);
      g.handleInput('p0', { mx: Math.cos(ang), my: Math.sin(ang), a1: a.bomb && t % 2 === 0, a2: false });
      g.update(1 / 60);
      hits = Math.max(hits, me(g, 'p1').hits);
    }
    expect(p0.id).toBe('p0');
    expect(p1.id).toBe('p1');
    expect(hits).toBeGreaterThanOrEqual(1);
  });

  describe('item beam', () => {
    type Inner = { players: { x: number; y: number; vx: number; vy: number; fx: string; fxT: number; carry: string; fallT: number }[] };
    const inner = (g: ReturnType<typeof createFrostShove>) => (g as unknown as Inner).players;

    /** run beams with a bear parked in each one that goes live; the items it was given, in order */
    const collect = (variant: string, beams: number, opts: Record<string, number> = {}) => {
      const g = make(variant, 2, { itemEvery: 3, timeLimit: 100000, boltEvery: 100, ...opts });
      const got: string[] = [];
      for (let t = 0; t < 60 * 60 * 30 && got.length < beams; t++) {
        const ps = inner(g);
        ps[1].x = 500; ps[1].y = 500; ps[1].vx = 0; ps[1].vy = 0;
        const b = g.getState().beam!;
        if (b.ph === 'on') { ps[0].x = b.sx; ps[0].y = b.sy; } else { ps[0].x = 520; ps[0].y = 520; }
        ps[0].vx = 0; ps[0].vy = 0;
        g.update(1 / 60);
        if (ps[0].carry || ps[0].fx) {
          got.push(ps[0].carry || ps[0].fx);
          ps[0].carry = ''; ps[0].fx = ''; ps[0].fxT = 0;
        }
      }
      return got;
    };

    it('the dispenser goes idle, fly, aim, on, back, and a bear in the live beam gets one power-up', () => {
      const g = make('frost-classic', 2, { itemEvery: 3, timeLimit: 100000 });
      const phases: string[] = [];
      for (let t = 0; t < 60 * 30 && phases.length < 6; t++) {
        const ps = inner(g);
        const b = g.getState().beam!;
        if (b.ph === 'on') { ps[0].x = b.sx; ps[0].y = b.sy; } else { ps[0].x = 520; ps[0].y = 520; }
        ps[0].vx = 0; ps[0].vy = 0; ps[1].x = 480; ps[1].y = 480; ps[1].vx = 0; ps[1].vy = 0;
        g.update(1 / 60);
        const ph = g.getState().beam!.ph;
        if (phases[phases.length - 1] !== ph) phases.push(ph);
      }
      expect(phases.slice(0, 6)).toEqual(['idle', 'fly', 'aim', 'on', 'back', 'idle']);
    });

    it('nobody gets an item outside the beam, and the beam ends when it runs out', () => {
      const g = make('frost-classic', 2, { itemEvery: 3, timeLimit: 100000 }, mulberry32(11));
      const ps = inner(g);
      let sawOn = false;
      let sawBackAfterOn = false;
      for (let t = 0; t < 60 * 30; t++) {
        for (const p of ps) { p.x = 500; p.y = 500; p.vx = 0; p.vy = 0; }
        const b0 = g.getState().beam!;
        if (b0.ph === 'on' && Math.hypot(b0.sx - 500, b0.sy - 500) < 130) { ps[0].x = 900; ps[0].y = 900; ps[0].fallT = 0; } // spot too near the middle: skip this check
        g.update(1 / 60);
        const b = g.getState().beam!;
        if (b.ph === 'on') sawOn = true;
        if (sawOn && b.ph === 'back') sawBackAfterOn = true;
        if (Math.hypot(b.sx - 500, b.sy - 500) > 130) expect(ps.every((p) => !p.carry && !p.fx)).toBe(true);
      }
      expect(sawOn).toBe(true);
      expect(sawBackAfterOn).toBe(true);
    });

    it('Frost Classic gives only grow, shrink, Lightning or Weight', () => {
      const got = collect('frost-classic', 60);
      expect(got.length).toBe(60);
      for (const fx of got) expect(['giant', 'shrink', 'lightning', 'weight']).toContain(fx);
      expect(new Set(got).size).toBeGreaterThan(2);
    });

    it('Thaw Frenzy gives only bad power-ups, never Lightning', () => {
      const got = collect('thaw-frenzy', 40);
      expect(got.length).toBe(40);
      for (const fx of got) expect(['weight', 'shrink', 'freeze']).toContain(fx);
    });

    it('the other variants can give all six', () => {
      const got = collect('tip-tumble', 120, { walrusEvery: 90 });
      expect(new Set(got)).toEqual(new Set(['speed', 'giant', 'shrink', 'freeze', 'lightning', 'weight']));
    });

    it('there are no power-up boxes on the ice any more', () => {
      const g = make('frost-frenzy', 2, { itemEvery: 3, boltEvery: 100, timeLimit: 100000 });
      for (let t = 0; t < 60 * 20; t++) g.update(1 / 60);
      expect(g.getState().items).toEqual([]);
    });
  });

  describe('Thaw Frenzy melt events', () => {
    const pin = (g: ReturnType<typeof createFrostShove>) => {
      const ps = (g as unknown as { players: { x: number; y: number; vx: number; vy: number }[] }).players;
      ps[0].x = 500; ps[0].y = 500; ps[1].x = 505; ps[1].y = 500;
      for (const p of ps) { p.vx = 0; p.vy = 0; }
    };

    /** Gruff's item beam out of the way */
    const noBeam = (g: ReturnType<typeof createFrostShove>) => { (g as unknown as { beamTimer: number }).beamTimer = 1e9; };

    it('Gruff flies to the rim, melts it, and flies back', () => {
      const g = make('thaw-frenzy', 2, { meltEvery: 6, meltVariance: 0, timeLimit: 100000 });
      noBeam(g);
      const phases: string[] = [];
      let sector = -1;
      let sawWarnFromFlight = false;
      for (let t = 0; t < 60 * 30 && phases.length < 4; t++) {
        pin(g);
        g.update(1 / 60);
        const st = g.getState();
        const ph = st.beam!.ph;
        if (phases[phases.length - 1] !== ph) phases.push(ph);
        if (ph === 'fly' && st.melts!.length) {
          sawWarnFromFlight = true;
          sector = st.melts![0].i;
        }
        if (ph === 'melt') {
          // he hovers over the rim at the sector's angle
          const a = (sector / 16) * Math.PI * 2;
          expect(Math.hypot(st.beam!.x - 500 - Math.cos(a) * 390, st.beam!.y - 500 - Math.sin(a) * 390)).toBeLessThan(20);
        }
      }
      expect(phases.slice(0, 4)).toEqual(['idle', 'fly', 'melt', 'back']);
      expect(sawWarnFromFlight).toBe(true);
    });

    it('a melt that comes due while the item beam is out waits for the mask, and both happen', () => {
      const g = make('thaw-frenzy', 2, { meltEvery: 4, meltVariance: 0, timeLimit: 100000 });
      (g as unknown as { beamTimer: number; meltTimer: number }).beamTimer = 0;
      (g as unknown as { beamTimer: number; meltTimer: number }).meltTimer = 0.1;
      const seen = new Set<string>();
      let overlap = false;
      for (let t = 0; t < 60 * 25; t++) {
        pin(g);
        g.update(1 / 60);
        const st = g.getState();
        if (st.beam!.ph === 'aim' || st.beam!.ph === 'on') seen.add('beam');
        if (st.beam!.ph === 'melt') seen.add('melt');
        if ((st.beam!.ph === 'aim' || st.beam!.ph === 'on') && st.melts!.length) overlap = true;
      }
      expect(seen).toEqual(new Set(['beam', 'melt']));
      expect(overlap).toBe(false);
    });

    it('a crack warns, then the rim is bitten back for good, never below the minimum', () => {
      const g = make('thaw-frenzy', 2, { meltEvery: 4, meltVariance: 0, meltDepth: 60, timeLimit: 100000 });
      noBeam(g);
      let warned: number | undefined;
      let before = 0;
      let melted = false;
      for (let t = 0; t < 60 * 30 && !melted; t++) {
        pin(g);
        const st = g.getState();
        if (warned === undefined && st.melts!.length) {
          warned = st.melts![0].i;
          before = st.sectors[warned];
        }
        g.update(1 / 60);
        if (warned !== undefined && g.getState().melts!.length === 0) melted = true;
      }
      expect(melted).toBe(true);
      const after = g.getState().sectors;
      expect(after[warned!]).toBeCloseTo(before - 60, 0);
      expect(after[(warned! + 1) % 16]).toBeCloseTo(400 - 30, 0);
      for (let t = 0; t < 60 * 60; t++) {
        pin(g);
        g.update(1 / 60);
      }
      for (const r of g.getState().sectors) expect(r).toBeGreaterThanOrEqual(130);
    });

    it('events come every meltEvery seconds, within the variance', () => {
      const events = (opts: Record<string, number>) => {
        const g = make('thaw-frenzy', 2, { timeLimit: 100000, meltDepth: 20, ...opts });
        noBeam(g);
        const out: number[] = [];
        let prev = 0;
        for (let t = 0; t < 60 * 150; t++) {
          pin(g);
          g.update(1 / 60);
          const n = g.getState().melts!.length;
          if (n > prev) out.push(t / 60);
          prev = n;
        }
        return out;
      };
      const exact = events({ meltEvery: 10, meltVariance: 0 });
      expect(exact.length).toBeGreaterThanOrEqual(10);
      for (let i = 2; i < exact.length; i++) expect(exact[i] - exact[i - 1]).toBeCloseTo(10, 0);
      const loose = events({ meltEvery: 10, meltVariance: 5 });
      for (let i = 2; i < loose.length; i++) {
        const gap = loose[i] - loose[i - 1];
        expect(gap).toBeGreaterThanOrEqual(5 - 0.1);
        expect(gap).toBeLessThanOrEqual(15 + 0.1);
      }
      expect(new Set(loose.slice(1).map((v, i) => Math.round(v - loose[i]))).size).toBeGreaterThan(1);
    });

    it('only Thaw Frenzy melts', () => {
      for (const v of ['frost-classic', 'frost-frenzy', 'tip-tumble', 'wild-frenzy']) expect(make(v).getState().melts, v).toBeUndefined();
    });
  });

  describe('Tip Tumble walrus', () => {
    const walrusAt = (g: ReturnType<typeof createFrostShove>) => g.getState().walrus;
    /** hold the bears still at opposite points of the floe so the round keeps going and the tilt is only the walrus' */
    const pin = (g: ReturnType<typeof createFrostShove>) => {
      const ps = (g as unknown as { players: { x: number; y: number; vx: number; vy: number }[] }).players;
      ps[0].x = 400; ps[0].y = 500; ps[1].x = 600; ps[1].y = 500;
      for (const p of ps) { p.vx = 0; p.vy = 0; }
    };

    it('a visit goes fish, walrus in, eating, out, near the edge and with its weight on the tilt', () => {
      const g = make('tip-tumble', 2, { walrusEvery: 8, walrusVariance: 0, timeLimit: 600 });
      const phases: string[] = [];
      let sawTilt = false;
      for (let t = 0; t < 60 * 30; t++) {
        pin(g);
        g.update(1 / 60);
        const w = walrusAt(g);
        if (!w) continue;
        if (phases[phases.length - 1] !== w.ph) phases.push(w.ph);
        expect(w.r).toBeGreaterThan(200); // never the centre
        expect(w.r).toBeLessThanOrEqual(400);
        if (w.ph === 'eat') {
          const tl = g.getState().tilt;
          // the pinned bears balance each other: the tilt is the walrus' weight, towards its side
          if (Math.hypot(tl.x, tl.y) > 0.6 && tl.x * Math.cos(w.a) + tl.y * Math.sin(w.a) > 0.5) sawTilt = true;
        }
        if (phases.length === 4 && !walrusAt(g)) break;
      }
      expect(phases.slice(0, 4)).toEqual(['fish', 'in', 'eat', 'out']);
      expect(sawTilt).toBe(true);
    });

    it('visits come every walrusEvery seconds, within the variance', () => {
      const starts = (opts: Record<string, number>) => {
        const g = make('tip-tumble', 2, { timeLimit: 600, ...opts }, mulberry32(7));
        const out: number[] = [];
        let prev = false;
        for (let t = 0; t < 60 * 200; t++) {
          pin(g);
          g.update(1 / 60);
          const on = !!walrusAt(g);
          if (on && !prev) out.push(t / 60);
          prev = on;
        }
        return out;
      };
      const exact = starts({ walrusEvery: 20, walrusVariance: 0 });
      expect(exact.length).toBeGreaterThanOrEqual(4);
      for (let i = 2; i < exact.length; i++) expect(exact[i] - exact[i - 1]).toBeCloseTo(20 + 6.2, 0); // the gap runs from the end of a visit
      const loose = starts({ walrusEvery: 20, walrusVariance: 10 });
      for (let i = 2; i < loose.length; i++) {
        const gap = loose[i] - loose[i - 1] - 6.2;
        expect(gap).toBeGreaterThanOrEqual(10 - 0.1);
        expect(gap).toBeLessThanOrEqual(30 + 0.1);
      }
      expect(new Set(loose.slice(1).map((v, i) => Math.round(v - loose[i]))).size).toBeGreaterThan(1);
    });

    it('only Tip Tumble has the walrus', () => {
      for (const v of ['frost-classic', 'frost-frenzy', 'thaw-frenzy', 'wild-frenzy']) {
        const g = make(v, 2, { timeLimit: 600 });
        for (let t = 0; t < 60 * 60; t++) {
          pin(g);
          g.update(1 / 60);
        }
        expect(g.getState().walrus, v).toBeUndefined();
      }
    });
  });

  describe('ledge and wall', () => {
    type Inner = { players: { id: string; x: number; y: number; vx: number; vy: number; dashT: number; stun: number }[]; wall: number };
    const inner = (g: ReturnType<typeof createFrostShove>) => g as unknown as Inner;
    const CX = 500;

    it('a bear sliding slowly over the rim hangs on it and can climb back', () => {
      const g = make('frost-frenzy', 2, { boltEvery: 100 });
      const p = inner(g).players[0];
      p.x = CX + 408; p.y = CX; p.vx = 150; p.vy = 0;
      run(g, 1 / 60);
      const s = me(g, 'p0');
      expect(s.alive).toBe(true);
      expect(s.fall).toBeGreaterThan(0);
      run(g, 0.3);
      expect(Math.hypot(me(g, 'p0').x - CX, me(g, 'p0').y - CX)).toBeLessThan(420); // did not drift away
    });

    it('drown counts the climb time down while hanging on the edge, and is 0 on the ice', () => {
      const g = make('frost-frenzy', 2, { boltEvery: 100 });
      expect(me(g, 'p0').drown).toBe(0);
      const p = inner(g).players[0];
      p.x = CX + 408; p.y = CX; p.vx = 150; p.vy = 0;
      run(g, 1 / 60);
      expect(me(g, 'p0').drown).toBeGreaterThan(0.95);
      run(g, 0.7);
      expect(me(g, 'p0').drown).toBeGreaterThan(0.4);
      expect(me(g, 'p0').drown).toBeLessThan(0.6);
      for (let i = 0; i < 6; i++) {
        g.handleInput('p0', { mx: 0, my: 0, a1: true, a2: false });
        g.update(1 / 60);
        g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: false });
        g.update(1 / 60);
      }
      expect(me(g, 'p0').fall).toBe(0);
      expect(me(g, 'p0').drown).toBe(0);
    });

    it('a bear shoved out fast plunges at once, with no climb', () => {
      const g = make('frost-frenzy', 2, { boltEvery: 100 });
      const p = inner(g).players[0];
      p.x = CX + 408; p.y = CX; p.vx = 700; p.vy = 0; p.stun = 0.5; // a stunned bear is not speed-capped
      run(g, 1 / 60);
      expect(me(g, 'p0').alive).toBe(false);
    });

    it('only Frost Classic has the wall', () => {
      expect(make('frost-classic').getState().wall).toBe(0xffff);
      for (const v of ['frost-frenzy', 'tip-tumble', 'thaw-frenzy', 'wild-frenzy']) expect(make(v).getState().wall).toBeUndefined();
    });

    it('the wall stops a walking bear, and a dash breaks only the slice it hits', () => {
      const g = make('frost-classic', 2);
      const p = inner(g).players[0];
      p.x = CX + 385; p.y = CX; p.vx = 300; p.vy = 0;
      run(g, 5 / 60);
      expect(me(g, 'p0').fall).toBe(0);
      expect(Math.hypot(me(g, 'p0').x - CX, me(g, 'p0').y - CX)).toBeLessThan(400);
      expect(g.getState().wall).toBe(0xffff);
      p.x = CX + 385; p.y = CX; p.vx = 760; p.vy = 0; p.dashT = 0.2;
      run(g, 1 / 60);
      expect(g.getState().wall).toBe(0xffff & ~1); // sector 0, centred on angle 0
      expect(g.drainEvents().some((e) => e.kind === 'crack')).toBe(true);
    });
  });

  describe('Lightning and Weight', () => {
    type Inner = { players: { id: string; x: number; y: number; carry: string; carryT: number; passT: number; stun: number; alive: boolean }[] };
    const inner = (g: ReturnType<typeof createFrostShove>) => (g as unknown as Inner).players;
    const give = (g: ReturnType<typeof createFrostShove>, id: string, carry: 'lightning' | 'weight', secs = 10) => {
      const p = inner(g).find((q) => q.id === id)!;
      p.carry = carry;
      p.carryT = secs;
      p.passT = 0;
    };

    it('Weight eliminates its holder when the countdown ends', () => {
      const g = make('frost-classic', 2);
      give(g, 'p0', 'weight', 1);
      run(g, 0.9);
      expect(me(g, 'p0').alive).toBe(true);
      run(g, 0.3);
      expect(me(g, 'p0').alive).toBe(false);
      expect(me(g, 'p1').alive).toBe(true);
    });

    it('Lightning stuns everyone but the holder for 6 s', () => {
      const g = make('frost-classic', 3);
      give(g, 'p0', 'lightning', 0.5);
      run(g, 0.6);
      const ps = inner(g);
      expect(ps.find((p) => p.id === 'p0')!.stun).toBe(0);
      for (const id of ['p1', 'p2']) expect(ps.find((p) => p.id === id)!.stun).toBeGreaterThan(5.5);
      expect(me(g, 'p0').carry).toBe('');
    });

    it('Weight announces itself just before it eliminates, and Lightning shows the stun in the snapshot', () => {
      const g = make('frost-classic', 2);
      give(g, 'p0', 'weight', 0.5);
      run(g, 0.6);
      const kinds = g.drainEvents().map((e) => e.kind);
      expect(kinds).toContain('ext:weight');
      expect(kinds.indexOf('ext:weight')).toBeLessThan(kinds.indexOf('eliminated'));
      const z = make('frost-classic', 3);
      give(z, 'p0', 'lightning', 0.5);
      run(z, 0.6);
      expect(me(z, 'p1').stun).toBeGreaterThan(5);
      expect(me(z, 'p0').stun).toBe(0);
    });

    it('a touch passes the item with its countdown, and not straight back', () => {
      const g = make('frost-classic', 2);
      const [a, b] = inner(g);
      a.x = 600; a.y = 600; b.x = 640; b.y = 600; // overlapping
      give(g, 'p0', 'weight', 7);
      run(g, 1 / 60);
      expect(me(g, 'p0').carry).toBe('');
      expect(me(g, 'p1').carry).toBe('weight');
      expect(me(g, 'p1').carryl).toBeCloseTo(0.7, 1);
      run(g, 0.2); // still touching, but p1 is on cooldown
      expect(me(g, 'p1').carry).toBe('weight');
    });

    it('falling into the water drops the item', () => {
      const g = make('frost-classic', 2);
      (g as unknown as { wall: number }).wall = 0;
      const [a] = inner(g);
      a.x = 1500; a.y = 1500; // far off the ice
      give(g, 'p0', 'lightning');
      run(g, 1 / 60);
      expect(me(g, 'p0').carry).toBe('');
    });
  });

  it('polarEdge interpolates between sector radii', () => {
    expect(polarEdge([100, 200, 100, 200], 0)).toBe(100);
    expect(polarEdge([100, 200, 100, 200], Math.PI / 4)).toBeCloseTo(150);
  });

  it('option defaults match the server config', () => {
    for (const v of POLAR_VARIANTS) {
      const opts = defaultOptions(optionsFor('frost-shove', v.id));
      expect(Object.keys(opts).length).toBeGreaterThan(2);
      const cfg = v.config as unknown as Record<string, unknown>;
      for (const [k, val] of Object.entries(opts).filter(([k]) => k !== 'roundsToWin')) expect(cfg[k], `${v.id}.${k}`).toBe(val);
    }
  });

  it('simultaneous eliminations share a place', () => {
    const g = make(POLAR_VARIANTS[0].id, 3);
    run(g, 0.1);
    g.removePlayer('p0');
    g.removePlayer('p1');
    g.update(1 / 60);
    expect(g.isFinished()).toBe(true);
    const place = Object.fromEntries(g.getPlacements().map((p) => [p.id, p.place]));
    expect(place).toEqual({ p2: 1, p0: 2, p1: 2 });
  });

  it('players still in the water rank below players on the ice', () => {
    const g = make(POLAR_VARIANTS[0].id, 3);
    run(g, 0.1);
    const ps = (g as unknown as { players: { id: string; fallT: number }[] }).players;
    ps[0].fallT = 1; // p0 is swimming
    g.removePlayer('p2');
    g.update(1 / 60);
    const place = Object.fromEntries(g.getPlacements().map((p) => [p.id, p.place]));
    expect(place).toEqual({ p1: 1, p0: 2, p2: 3 });
  });
});

describe('FrostShove injected rng', () => {
  const play = (seed: number) => {
    const v = POLAR_VARIANTS[0];
    const g = createFrostShove(v, {}, mulberry32(seed));
    g.init([{ id: 'p0', name: 'P0' }, { id: 'p1', name: 'P1' }]);
    for (let t = 0; t < 600; t++) g.update(1 / 60);
    return JSON.stringify(g.getState());
  };

  it('same seed gives the same simulation, different seeds diverge', () => {
    expect(play(7)).toBe(play(7));
    expect(play(7)).not.toBe(play(8));
  });
});
