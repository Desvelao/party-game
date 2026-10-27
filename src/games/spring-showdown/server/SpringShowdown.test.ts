import { describe, expect, it } from 'vitest';
import { defaultOptions, optionsFor } from '../../../core/shared/catalog';
import { POGO_VARIANTS, createSpringShowdown } from './create';
import { mulberry32 } from '../../../core/shared/kit/util';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
type G = ReturnType<typeof createSpringShowdown>;
const variant = (id: string) => POGO_VARIANTS.find((v) => v.id === id)!;
const make = (id: string, n = 2, options = {}): G => {
  const g = createSpringShowdown(variant(id), options);
  g.init(players(n));
  return g;
};
const run = (g: G, seconds: number) => {
  for (let t = 0; t < seconds * 60 && !g.isFinished(); t++) g.update(1 / 60);
};
const input = (g: G, id: string, mx: number, my: number, a1 = false) => g.handleInput(id, { mx, my, a1, a2: false });
const me = (g: G, id: string) => g.getState().players.find((p) => p.id === id)!;

/** Reach into the sim to arrange a scenario (tests only). */
const raw = (g: G) => g as unknown as { tiles: number[]; items: { id: number; c: number; r: number; k: string; d: number; ttl: number }[]; n: number; players: { c: number; r: number; pc: number; pr: number; item: string; stunT: number; lockT: number; facing: number }[] };

/** Hop `p0` one tile in a direction and let it land. */
const hop = (g: G, mx: number, my: number) => {
  input(g, 'p0', mx, my);
  run(g, 0.5);
  input(g, 'p0', 0, 0);
};

describe('SpringShowdown', () => {
  it('every variant terminates with unique placements', () => {
    for (const v of POGO_VARIANTS) {
      const g = make(v.id, 4);
      for (let i = 0; i < 4; i++) input(g, `p${i}`, i % 2 ? 1 : -1, i < 2 ? 0.2 : -0.2, true);
      run(g, 200);
      expect(g.isFinished(), v.id).toBe(true);
      const pl = g.getPlacements();
      expect(new Set(pl.map((p) => p.id)).size).toBe(4);
      expect(Math.min(...pl.map((p) => p.place))).toBe(1);
    }
  });

  it('hopping paints the tile and converts a rival tile', () => {
    const g = make('spring-painter', 2);
    const R = raw(g);
    const n = R.n;
    const { c, r } = R.players[0];
    const target = r * n + (c + 1 < n ? c + 1 : c - 1);
    R.tiles[target] = 1; // rival's
    hop(g, c + 1 < n ? 1 : -1, 0);
    expect(g.getState().tiles[target]).toBe(0);
    expect(me(g, 'p0').tiles).toBeGreaterThanOrEqual(2);
  });

  it('a crate banks the painted tiles and clears them', () => {
    const g = make('spring-painter', 2);
    const R = raw(g);
    const { c, r } = R.players[0];
    const dc = c + 1 < R.n ? 1 : -1;
    R.items.push({ id: 99, c: c + dc, r, k: 'crate', d: 0, ttl: Infinity });
    hop(g, dc, 0);
    expect(me(g, 'p0').score).toBe(2);
    expect(me(g, 'p0').tiles).toBe(0);
  });

  it('Spring Rush: closing a loop fills it and banks every square', () => {
    const g = make('spring-rush', 2);
    const R = raw(g);
    const n = R.n;
    // a ring of p0's tiles with one gap; p0 stands next to the gap and hops in
    const ring = [[3, 3], [4, 3], [5, 3], [3, 4], [5, 4], [3, 5], [4, 5]];
    R.tiles.fill(-1);
    for (const [c, r] of ring) R.tiles[r * n + c] = 0;
    R.players[0].c = R.players[0].pc = 6;
    R.players[0].r = R.players[0].pr = 5;
    // hop left onto (5,5) closes the ring around (4,4)
    hop(g, -1, 0);
    const s = g.getState();
    expect(s.players[0].score).toBe(ring.length + 1 + 1); // ring + closing tile + the filled centre
    expect(s.players[0].tiles).toBe(0);
  });

  it('Spring Madness: a loop fills but does not score until a crate', () => {
    const g = make('spring-madness', 2);
    const R = raw(g);
    const n = R.n;
    const ring = [[3, 3], [4, 3], [5, 3], [3, 4], [5, 4], [3, 5], [4, 5]];
    R.tiles.fill(-1);
    for (const [c, r] of ring) R.tiles[r * n + c] = 0;
    R.players[0].c = R.players[0].pc = 6;
    R.players[0].r = R.players[0].pr = 5;
    hop(g, -1, 0);
    const s = g.getState();
    expect(s.tiles[4 * n + 4]).toBe(0);
    expect(s.players[0].score).toBe(0);
    expect(s.players[0].tiles).toBe(ring.length + 2);
  });

  it('Spring Lock: landing on your own colour wipes your squares; the padlock protects', () => {
    const g = make('spring-lock', 2);
    const R = raw(g);
    const { c, r } = R.players[0];
    const dc = c + 1 < R.n ? 1 : -1;
    R.tiles[r * R.n + c + dc] = 0;
    hop(g, dc, 0);
    expect(me(g, 'p0').tiles).toBe(0);

    const g2 = make('spring-lock', 2);
    const R2 = raw(g2);
    const { c: c2, r: r2 } = R2.players[0];
    const dc2 = c2 + 1 < R2.n ? 1 : -1;
    R2.tiles[r2 * R2.n + c2 + dc2] = 0;
    R2.players[0].lockT = 8;
    hop(g2, dc2, 0);
    expect(me(g2, 'p0').tiles).toBeGreaterThanOrEqual(2);
  });

  it('Spring Lock: a missile hit steals all the victim squares', () => {
    // these scenarios place players up to column 9: keep a 12-wide board for them
    const g = make('spring-lock', 2, { gridSize: 12 });
    const R = raw(g);
    R.tiles.fill(-1);
    for (const i of [0, 1, 2, 3]) R.tiles[i] = 1;
    const a = R.players[0];
    const b = R.players[1];
    a.c = a.pc = 5;
    a.r = a.pr = 5;
    b.c = b.pc = 9;
    b.r = b.pr = 5;
    a.item = 'missile';
    a.facing = 1;
    input(g, 'p0', 0, 0, true);
    run(g, 1);
    const s = g.getState();
    expect(s.players[1].stun).toBe(true);
    expect([0, 1, 2, 3].every((i) => s.tiles[i] === 0)).toBe(true);
  });

  it('a stunned player cannot hop and loses held items', () => {
    const g = make('spring-painter', 2);
    const R = raw(g);
    R.players[1].item = 'missile';
    const b = R.players[1];
    const a = R.players[0];
    a.c = a.pc = 2;
    a.r = a.pr = 4;
    b.c = b.pc = 6;
    b.r = b.pr = 4;
    a.item = 'missile';
    a.facing = 1;
    input(g, 'p0', 0, 0, true);
    run(g, 0.8);
    expect(me(g, 'p1').stun).toBe(true);
    const before = { c: me(g, 'p1').c, r: me(g, 'p1').r };
    input(g, 'p1', 0, 1);
    run(g, 0.5);
    expect({ c: me(g, 'p1').c, r: me(g, 'p1').r }).toEqual(before);
    expect(me(g, 'p1').item).toBe('');
  });

  it('Bomber only exists in Spring Madness and eventually lays TNT', () => {
    expect(make('spring-painter').getState().boss).toBeUndefined();
    const g = make('spring-madness', 1, { tntEvery: 1.5 });
    expect(g.getState().boss).toBeDefined();
    let tnt = false;
    for (let t = 0; t < 60 * 10; t++) {
      g.update(1 / 60);
      if (g.getState().items.some((i) => i.k === 'tnt')) tnt = true;
    }
    expect(tnt).toBe(true);
  });

  it('disconnect clears the leaver tiles and keeps placements valid', () => {
    const g = make('spring-painter', 3);
    g.removePlayer('p1');
    expect(me(g, 'p1').gone).toBe(true);
    expect(me(g, 'p1').tiles).toBe(0);
    run(g, 200);
    expect(g.getPlacements()).toHaveLength(3);
  });

  it('no variant spawns mushrooms for now', () => {
    for (const v of POGO_VARIANTS) expect(v.config.mushrooms, v.id).toBe(false);
  });

  it('every variant shares the same crate spawn defaults', () => {
    const ids = ['crateEvery', 'crateVariance', 'crateCount'] as const;
    for (const id of ids) {
      expect(new Set(POGO_VARIANTS.map((v) => v.config[id])).size, `config ${id}`).toBe(1);
      const defaults = POGO_VARIANTS.map((v) => defaultOptions(optionsFor('spring-showdown', v.id))[id]).filter((d) => d !== undefined);
      expect(new Set(defaults).size, `catalog ${id}`).toBe(1);
    }
  });

  it('option defaults match the server config', () => {
    for (const v of POGO_VARIANTS) {
      const opts = defaultOptions(optionsFor('spring-showdown', v.id));
      expect(Object.keys(opts).length).toBeGreaterThan(4);
      const cfg = v.config as unknown as Record<string, unknown>;
      for (const [k, val] of Object.entries(opts).filter(([k]) => k !== 'roundsToWin')) expect(cfg[k], `${v.id}.${k}`).toBe(val);
    }
  });
});

describe('SpringShowdown mechanics', () => {
  // staged scenarios below use columns up to 9, so they run on a 12-wide board
  const makeSeeded = (id: string, options = {}): G => {
    const g = createSpringShowdown(variant(id), { gridSize: 12, ...options }, mulberry32(3));
    g.init(players(2));
    return g;
  };
  const stage = (g: G) => {
    const R = raw(g);
    R.tiles.fill(-1);
    R.items.length = 0;
    const a = R.players[0];
    const b = R.players[1];
    a.c = a.pc = 5;
    a.r = a.pr = 5;
    b.c = b.pc = 9;
    b.r = b.pr = 5;
    return R;
  };

  it('a padlocked victim keeps their squares when hit by a stealing missile', () => {
    const g = makeSeeded('spring-lock');
    const R = stage(g);
    for (const i of [0, 1, 2, 3]) R.tiles[i] = 1;
    (R.players[1] as unknown as { lockT: number }).lockT = 8;
    R.players[0].item = 'missile';
    R.players[0].facing = 1;
    input(g, 'p0', 0, 0, true);
    run(g, 1);
    expect(me(g, 'p1').stun).toBe(true);
    expect([0, 1, 2, 3].every((i) => g.getState().tiles[i] === 1)).toBe(true);
  });

  it('Zap Beam: stuns everyone ahead in the facing line, at any distance, and shows a bolt', () => {
    const g = makeSeeded('spring-rush');
    const R = stage(g);
    R.players[0].item = 'beam';
    R.players[0].facing = 1;
    input(g, 'p0', 0, 0, true);
    g.update(0.05);
    expect(me(g, 'p1').stun).toBe(true);
    expect(g.getState().beams).toEqual([expect.objectContaining({ c: 5, r: 5, d: 1 })]);
    run(g, 1);
    expect(g.getState().beams).toBeUndefined();
  });

  it('Zap Beam: misses rivals behind or off the line', () => {
    for (const facing of [3, 0]) {
      const g = makeSeeded('spring-rush');
      const R = stage(g);
      R.players[0].item = 'beam';
      R.players[0].facing = facing;
      input(g, 'p0', 0, 0, true);
      g.update(0.05);
      expect(me(g, 'p1').stun, `facing ${facing}`).toBe(false);
    }
  });

  it('a non-stealing variant leaves the squares alone on a hit', () => {
    const g = makeSeeded('spring-painter');
    const R = stage(g);
    for (const i of [0, 1]) R.tiles[i] = 1;
    R.players[0].item = 'missile';
    R.players[0].facing = 1;
    input(g, 'p0', 0, 0, true);
    run(g, 1);
    expect(me(g, 'p1').stun).toBe(true);
    expect(g.getState().tiles[0]).toBe(1);
  });

  it('padlocked squares cannot be converted by a rival hop', () => {
    const g = makeSeeded('spring-painter');
    const R = stage(g);
    R.tiles[5 * R.n + 6] = 1;
    (R.players[1] as unknown as { lockT: number }).lockT = 8;
    hop(g, 1, 0);
    expect(g.getState().tiles[5 * R.n + 6]).toBe(1);
  });

  it('enclose skips squares protected by a rival padlock', () => {
    const g = makeSeeded('spring-lock');
    (g as unknown as { cfg: { fillEnclosed: boolean } }).cfg.fillEnclosed = true;
    const R = stage(g);
    const n = R.n;
    // p0 ring around (r2..4, c2..4) with the hole at (3,3) and (3,3) held by p1; hopper lands on the ring's last tile
    for (let r = 2; r <= 4; r++) for (let c = 2; c <= 4; c++) if (!(r === 3 && c === 3)) R.tiles[r * n + c] = 0;
    R.tiles[5 * n + 6] = -1;
    R.tiles[3 * n + 3] = 1;
    (R.players[1] as unknown as { lockT: number }).lockT = 8;
    (g as unknown as { enclose(p: unknown, c: number, r: number): void }).enclose(
      (g as unknown as { players: unknown[] }).players[0],
      6,
      5,
    );
    expect(g.getState().tiles[3 * n + 3]).toBe(1);
    (R.players[1] as unknown as { lockT: number }).lockT = 0;
    (g as unknown as { enclose(p: unknown, c: number, r: number): void }).enclose(
      (g as unknown as { players: unknown[] }).players[0],
      6,
      5,
    );
    expect(g.getState().tiles[3 * n + 3]).toBe(0);
  });

  it('selfWipe emits a wipe event and only clears the hopper squares', () => {
    const g = makeSeeded('spring-lock');
    const R = stage(g);
    R.tiles[5 * R.n + 6] = 0;
    R.tiles[5 * R.n + 7] = 0;
    R.tiles[0] = 1;
    g.drainEvents();
    hop(g, 1, 0);
    expect(me(g, 'p0').tiles).toBe(0);
    expect(g.getState().tiles[0]).toBe(1);
    expect(g.drainEvents().some((e) => e.kind === 'wipe' && e.id === 'p0')).toBe(true);
  });

  it('padlock wanders one tile at a time and never leaves the grid', () => {
    const g = makeSeeded('spring-lock');
    run(g, 3.2);
    const find = () => g.getState().items.find((i) => i.k === 'padlock');
    let prev = find()!;
    expect(prev).toBeDefined();
    let moved = false;
    for (let s = 0; s < 60; s++) {
      run(g, 1);
      const cur = find()!;
      expect(Math.abs(cur.c - prev.c) + Math.abs(cur.r - prev.r)).toBeLessThanOrEqual(1);
      expect(cur.c).toBeGreaterThanOrEqual(0);
      expect(cur.r).toBeLessThan(g.getState().size);
      if (cur.c !== prev.c || cur.r !== prev.r) moved = true;
      prev = cur;
    }
    expect(moved).toBe(true);
  });

  it('picking up the padlock locks the player and a new one respawns later', () => {
    const g = makeSeeded('spring-lock');
    const R = stage(g);
    R.items.push({ id: 500, c: 6, r: 5, k: 'padlock', d: 0, ttl: Infinity });
    hop(g, 1, 0);
    expect(me(g, 'p0').lock).toBeGreaterThan(0);
    expect(g.getState().items.some((i) => i.k === 'padlock')).toBe(false);
    run(g, 6.5);
    expect(g.getState().items.some((i) => i.k === 'padlock')).toBe(true);
  });

  it('Blast Bot fires a missile into the grid that stuns a player in its lane', () => {
    const g = makeSeeded('spring-madness', { tntEvery: 1 });
    stage(g);
    let missile: { x: number; y: number; dir: number } | undefined;
    for (let t = 0; t < 60 * 4 && !missile; t++) {
      g.update(1 / 60);
      missile = g.getState().missiles[0];
    }
    expect(missile).toBeDefined();
    expect(missile!.dir).toBe(2); // first side of the perimeter points down
    // park a player in the missile's column, a few tiles down
    const R = raw(g);
    const col = Math.floor(missile!.x);
    R.players[0].c = R.players[0].pc = col;
    R.players[0].r = R.players[0].pr = 6;
    run(g, 1);
    expect(me(g, 'p0').stun).toBe(true);
    expect(g.getState().missiles).toHaveLength(0);
  });
});

describe('SpringShowdown injected rng', () => {
  const play = (seed: number) => {
    const v = POGO_VARIANTS[0];
    const g = createSpringShowdown(v, {}, mulberry32(seed));
    g.init([{ id: 'p0', name: 'P0' }, { id: 'p1', name: 'P1' }]);
    for (let t = 0; t < 600; t++) g.update(1 / 60);
    return JSON.stringify(g.getState());
  };

  it('same seed gives the same simulation, different seeds diverge', () => {
    expect(play(7)).toBe(play(7));
    expect(play(7)).not.toBe(play(8));
  });

  describe('spawn variance', () => {
    const timers = (g: G) => g as unknown as { itemTimer: number; crateTimer: number };
    const spawnGap = (rngValue: number, options: Record<string, number>) => {
      const g = createSpringShowdown(variant('spring-painter'), options, () => rngValue);
      g.init(players(2));
      const T = timers(g);
      T.itemTimer = 0;
      T.crateTimer = 0;
      g.update(1 / 60);
      return { item: T.itemTimer, crate: T.crateTimer };
    };

    it('re-arms with the fixed interval when variance is 0', () => {
      const gap = spawnGap(0, { itemEvery: 5, crateEvery: 7 });
      expect(gap.item).toBeCloseTo(5);
      expect(gap.crate).toBeCloseTo(7);
    });

    it('spreads the interval by +- variance', () => {
      const opts = { itemEvery: 8, itemVariance: 3, crateEvery: 10, crateVariance: 4 };
      const lo = spawnGap(0, opts);
      const hi = spawnGap(1, opts);
      expect(lo.item).toBeCloseTo(5);
      expect(hi.item).toBeCloseTo(11);
      expect(lo.crate).toBeCloseTo(6);
      expect(hi.crate).toBeCloseTo(14);
    });

    it('never re-arms faster than the minimum gap', () => {
      const gap = spawnGap(0, { itemEvery: 2, itemVariance: 10, crateEvery: 3, crateVariance: 10 });
      expect(gap.item).toBeGreaterThanOrEqual(1);
      expect(gap.crate).toBeGreaterThanOrEqual(1);
    });
  });

  describe('crates per spawn', () => {
    const fire = (options: Record<string, number>, times = 1) => {
      const g = createSpringShowdown(variant('spring-painter'), options, mulberry32(5));
      g.init(players(2));
      const T = g as unknown as { crateTimer: number };
      for (let i = 0; i < times; i++) {
        T.crateTimer = 0;
        g.update(1 / 60);
      }
      return g.getState().items.filter((i) => i.k === 'crate').length;
    };

    it('spawns two crates by default', () => expect(fire({})).toBe(2));
    it('spawns a single crate with crateCount 1', () => expect(fire({ crateCount: 1 })).toBe(1));
    it('spawns crateCount crates at once', () => expect(fire({ crateCount: 4 })).toBe(4));
    it('keeps the board under max(2, 2 x count)', () => {
      expect(fire({ crateCount: 1 }, 5)).toBe(2);
      expect(fire({}, 5)).toBe(4);
      expect(fire({ crateCount: 3 }, 5)).toBe(6);
    });
  });

  describe('player collisions', () => {
    /** p0 at (2,2), p1 right next to it at (3,2) */
    const duel = (options: Record<string, number | boolean> = {}) => {
      const g = make('spring-painter', 2, options);
      const R = raw(g);
      for (const [p, c, r] of [[R.players[0], 2, 2], [R.players[1], 3, 2]] as const) {
        p.c = p.pc = c;
        p.r = p.pr = r;
      }
      return { g, R };
    };

    it('blocks a hop onto an occupied square', () => {
      const { g, R } = duel();
      input(g, 'p0', 1, 0);
      run(g, 0.6);
      expect([R.players[0].c, R.players[0].r]).toEqual([2, 2]);
    });

    it('lets players share a square when collisions are off', () => {
      const { g, R } = duel({ collisions: false });
      input(g, 'p0', 1, 0);
      run(g, 0.2);
      expect([R.players[0].c, R.players[0].r]).toEqual([3, 2]);
    });

    it('lets the second player of a simultaneous hop to one square lose it, and blocks swaps', () => {
      const { g, R } = duel();
      R.players[1].c = R.players[1].pc = 4;
      input(g, 'p0', 1, 0);
      input(g, 'p1', -1, 0);
      run(g, 0.6);
      const at = R.players.map((p) => `${p.c},${p.r}`);
      expect(new Set(at).size).toBe(2);
      const { g: g2, R: R2 } = duel();
      input(g2, 'p0', 1, 0);
      input(g2, 'p1', -1, 0);
      run(g2, 0.6);
      expect([R2.players[0].c, R2.players[1].c]).toEqual([2, 3]);
    });

    it('publishes the rule in the snapshot', () => {
      expect(duel().g.getState().solid).toBe(true);
      expect(duel({ collisions: false }).g.getState().solid).toBe(false);
    });
  });

  it('Spring Madness: a 4-way arrow paints only the cross, not the quadrants', () => {
    const g = make('spring-madness', 2, { tntEvery: 12 });
    const R = raw(g);
    const n = R.n;
    R.tiles.fill(-1);
    R.players[0].c = R.players[0].pc = 3;
    R.players[0].r = R.players[0].pr = 4;
    R.items.push({ id: 950, c: 3, r: 3, k: 'arrow', d: 15, ttl: Infinity });
    hop(g, 0, -1);
    const s = g.getState();
    expect(s.tiles.filter((o) => o === 0).length).toBe(2 * n - 1);
    expect(s.tiles[0]).toBe(-1);
  });

  describe('TNT fuse', () => {
    const lay = (g: G, c: number, r: number) => {
      const R = raw(g);
      R.items.push({ id: 900, c, r, k: 'tnt', d: 0, ttl: 3 });
      return R;
    };

    it('explodes when the fuse ends: wipes the 3x3, spares outside, stuns players inside', () => {
      const g = make('spring-madness', 2, { tntEvery: 12 });
      const R = lay(g, 3, 3);
      R.tiles.fill(1);
      const n = R.n;
      R.players[1].c = R.players[1].pc = 2;
      R.players[1].r = R.players[1].pr = 2;
      R.players[0].c = R.players[0].pc = 0;
      R.players[0].r = R.players[0].pr = 7;
      run(g, 2.5);
      expect(R.items.some((i) => i.id === 900)).toBe(true);
      expect(g.getState().items.find((i) => i.id === 900)?.f).toBeCloseTo(0.5, 0);
      run(g, 0.6);
      expect(R.items.some((i) => i.id === 900)).toBe(false);
      for (let r = 2; r <= 4; r++) for (let c = 2; c <= 4; c++) expect(g.getState().tiles[r * n + c]).toBe(-1);
      expect(g.getState().tiles[1 * n + 3]).toBe(1);
      expect(g.getState().tiles[3 * n + 5]).toBe(1);
      expect(me(g, 'p1').stun).toBe(true);
      expect(me(g, 'p0').stun).toBe(false);
      expect(g.drainEvents().some((e) => e.kind === 'boom')).toBe(true);
    });

    it('tntRadius widens the blast and a padlock protects squares', () => {
      const g = make('spring-madness', 2, { tntEvery: 12, tntRadius: 2 });
      const R = lay(g, 3, 3);
      R.tiles.fill(1);
      R.players[1].lockT = 99;
      run(g, 3.1);
      expect(g.getState().tiles[1 * R.n + 1]).toBe(1); // locked: kept
      R.players[1].lockT = 0;
      const h = make('spring-madness', 2, { tntEvery: 12, tntRadius: 2 });
      const H = lay(h, 3, 3);
      H.tiles.fill(1);
      run(h, 3.1);
      expect(h.getState().tiles[1 * H.n + 1]).toBe(-1);
      expect(h.getState().tiles[0]).toBe(1);
    });

    it('stepping on it first only stuns and leaves no blast', () => {
      const g = make('spring-madness', 2, { tntEvery: 12 });
      const R = raw(g);
      const { c, r } = R.players[0];
      const dc = c + 1 < R.n ? 1 : -1;
      R.items.push({ id: 901, c: c + dc, r, k: 'tnt', d: 0, ttl: 3 });
      R.tiles.fill(1);
      hop(g, dc, 0);
      expect(me(g, 'p0').stun).toBe(true);
      g.drainEvents();
      run(g, 4);
      expect(g.drainEvents().some((e) => e.kind === 'boom')).toBe(false);
    });
  });
});
