import { describe, expect, it } from 'vitest';
import { defaultOptions, optionsFor } from '../../../core/shared/catalog';
import { CRATE_VARIANTS, createBoxBonanza } from './create';
import { mulberry32 } from '../../../core/shared/kit/util';

type G = ReturnType<typeof createBoxBonanza>;
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const variant = (id: string) => CRATE_VARIANTS.find((v) => v.id === id)!;
const make = (id: string, n = 2, options = {}): G => {
  const g = createBoxBonanza(variant(id), options);
  g.init(players(n));
  return g;
};
const run = (g: G, seconds: number) => {
  for (let t = 0; t < seconds * 60 && !g.isFinished(); t++) g.update(1 / 60);
};
/** one tap of the first button (pick up / throw / weapon) */
const press = (g: G, id: string, mx = 0, my = 0) => {
  g.handleInput(id, { mx, my, a1: true, a2: false });
  g.update(1 / 60);
  g.handleInput(id, { mx, my, a1: false, a2: false });
  g.update(1 / 60);
};
/** one tap of the second button (kick) */
const kick = (g: G, id: string, mx = 0, my = 0) => {
  g.handleInput(id, { mx, my, a1: false, a2: true });
  g.update(1 / 60);
  g.handleInput(id, { mx, my, a1: false, a2: false });
  g.update(1 / 60);
};
const me = (g: G, id: string) => g.getState().players.find((p) => p.id === id)!;

interface RawP { x: number; y: number; vx: number; vy: number; facing: number; hp: number; hold: unknown; mask: number; weightT: number; passCd: number; charges: number; weapon: string; alive: boolean }
interface RawC { id: number; x: number; y: number; vx: number; vy: number; k: string; fuse: number; holder: number; owner: number; flying: boolean; dead: boolean }
interface RawK { id: number; x: number; y: number; k: string; set: number; weapon?: string }
const raw = (g: G) =>
  g as unknown as { players: RawP[]; crates: RawC[]; pickups: RawK[]; holes: number[]; penguin: { awake: boolean } };
const clear = (g: G) => {
  const R = raw(g);
  R.crates.length = 0;
  R.pickups.length = 0;
};
const addCrate = (g: G, k: string, x: number, y: number): RawC => {
  const c: RawC = { id: 9000 + raw(g).crates.length, x, y, vx: 0, vy: 0, k, fuse: -1, holder: -1, owner: -1, flying: false, dead: false };
  raw(g).crates.push(c);
  return c;
};
const place = (g: G, i: number, x: number, y: number, facing = 0) => {
  const p = raw(g).players[i];
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  p.facing = facing;
};

describe('BoxBonanza', () => {
  it('every variant terminates with valid placements', () => {
    for (const v of CRATE_VARIANTS) {
      const g = make(v.id, 4);
      for (let i = 0; i < 4; i++) g.handleInput(`p${i}`, { mx: Math.cos(i), my: Math.sin(i), a1: i % 2 === 0, a2: false });
      run(g, 200);
      expect(g.isFinished(), v.id).toBe(true);
      const pl = g.getPlacements();
      expect(new Set(pl.map((p) => p.id)).size).toBe(4);
      expect(Math.min(...pl.map((p) => p.place))).toBe(1);
    }
  });

  it('picks up, throws and breaks a block on a rival', () => {
    const g = make('jungle-bonanza', 2);
    clear(g);
    place(g, 0, 300, 500, 0);
    place(g, 1, 600, 500);
    addCrate(g, 'block', 340, 500);
    press(g, 'p0'); // pick up (stick neutral)
    expect(me(g, 'p0').hold).toBe('block');
    run(g, 0.4); // action cooldown
    press(g, 'p0'); // throw toward +x
    run(g, 1.2);
    expect(me(g, 'p1').hp).toBe(8);
    expect(raw(g).crates.filter((c) => c.k === 'block')).toHaveLength(0);
  });

  it('TNT blows up after its fuse and hurts everyone in the blast', () => {
    const g = make('jungle-bonanza', 2);
    clear(g);
    place(g, 0, 300, 500);
    place(g, 1, 360, 500);
    const c = addCrate(g, 'tnt', 330, 560);
    c.fuse = 0.3;
    run(g, 1);
    expect(me(g, 'p0').hp).toBe(6);
    expect(me(g, 'p1').hp).toBe(6);
    expect(raw(g).crates.includes(c)).toBe(false);
  });

  it('nitro hurts on touch and cannot be picked up', () => {
    const g = make('jungle-bonanza', 2);
    clear(g);
    place(g, 0, 300, 500);
    place(g, 1, 800, 800);
    addCrate(g, 'nitro', 330, 500);
    press(g, 'p0');
    expect(me(g, 'p0').hold).toBe('');
    place(g, 0, 330, 500);
    run(g, 0.3);
    expect(me(g, 'p0').hp).toBeLessThan(10);
  });

  it('Space Bonanza: an explosion opens a hole and falling in eliminates', () => {
    const g = make('space-bonanza', 2);
    clear(g);
    place(g, 0, 500, 500);
    place(g, 1, 150, 150);
    const c = addCrate(g, 'tnt', 520, 520);
    c.fuse = 0.1;
    run(g, 0.6);
    expect(raw(g).holes.some((h) => h === 1)).toBe(true);
    expect(me(g, 'p0').alive).toBe(false);
    expect(me(g, 'p1').alive).toBe(true);
  });

  it('the weight passes on touch and then kills its carrier', () => {
    const g = make('space-bonanza', 2);
    clear(g);
    place(g, 0, 300, 500);
    place(g, 1, 700, 500);
    raw(g).players[0].weightT = 6;
    raw(g).players[0].passCd = 0;
    place(g, 1, 340, 500);
    run(g, 0.3);
    expect(me(g, 'p0').weight).toBe(0);
    expect(me(g, 'p1').weight).toBeGreaterThan(0);
    // nobody passes it on: p1 dies when it runs out
    place(g, 0, 900, 900);
    run(g, 7);
    expect(me(g, 'p1').alive).toBe(false);
  });

  it('an Guardian mask absorbs exactly one hit', () => {
    const g = make('space-bonanza', 2);
    clear(g);
    place(g, 0, 300, 500);
    place(g, 1, 330, 500);
    raw(g).players[1].mask = 8;
    kick(g, 'p0', 1, 0); // second button
    expect(me(g, 'p1').hp).toBe(10);
    expect(me(g, 'p1').mask).toBe(0);
    run(g, 0.7);
    place(g, 1, raw(g).players[0].x + 30, raw(g).players[0].y);
    kick(g, 'p0', 1, 0);
    expect(me(g, 'p1').hp).toBeLessThan(10);
  });

  it('Snow Bonanza: a hit near the penguin wakes it; it later goes back to sleep', () => {
    const g = make('snow-bonanza', 2, { penguinTime: 4 });
    clear(g);
    expect(g.getState().penguin?.awake).toBe(false);
    place(g, 0, 500, 410, 1.5);
    place(g, 1, 900, 900);
    kick(g, 'p0', 0, 0.9); // next to the penguin
    expect(g.getState().penguin?.awake).toBe(true);
    run(g, 5);
    expect(g.getState().penguin?.awake).toBe(false);
  });

  it('Drain Bonanza: a ? set has three berry and one weapon; opening the weapon removes the rest', () => {
    const g = make('drain-bonanza', 2, { boxEvery: 6 });
    clear(g);
    run(g, 7);
    const set = raw(g).pickups.filter((k) => k.k === 'qbox');
    expect(set).toHaveLength(4);
    expect(set.filter((k) => k.weapon).length).toBe(1);
    const weaponBox = set.find((k) => k.weapon)!;
    place(g, 0, weaponBox.x, weaponBox.y);
    place(g, 1, 100, 900);
    run(g, 0.1);
    expect(me(g, 'p0').weapon).toBe(weaponBox.weapon);
    expect(me(g, 'p0').charges).toBeGreaterThan(0);
    expect(raw(g).pickups.filter((k) => k.k === 'qbox')).toHaveLength(0);
  });

  it('Drain Bonanza weapons use their charges (ring hits for 8)', () => {
    const g = make('drain-bonanza', 2);
    clear(g);
    place(g, 0, 400, 500);
    place(g, 1, 460, 500);
    raw(g).players[0].weapon = 'ring';
    raw(g).players[0].charges = 1;
    press(g, 'p0');
    expect(me(g, 'p1').hp).toBe(2);
    expect(me(g, 'p0').charges).toBe(0);
    expect(me(g, 'p0').weapon).toBe('');
  });

  it('berry heals but never above max health', () => {
    const g = make('jungle-bonanza', 2);
    clear(g);
    place(g, 0, 300, 500);
    place(g, 1, 800, 800);
    raw(g).players[0].hp = 7;
    raw(g).pickups.push({ id: 1, x: 300, y: 500, k: 'berry', set: 0 });
    run(g, 0.1);
    expect(me(g, 'p0').hp).toBe(9);
    raw(g).pickups.push({ id: 2, x: 300, y: 500, k: 'berry', set: 0 });
    run(g, 0.1);
    expect(me(g, 'p0').hp).toBe(10);
  });

  it('survivors rank by health and the eliminated by order', () => {
    const g = make('jungle-bonanza', 3);
    clear(g);
    raw(g).players[0].hp = 3;
    raw(g).players[1].hp = 9;
    g.removePlayer('p2');
    run(g, 200);
    const pl = g.getPlacements();
    const place_ = (id: string) => pl.find((p) => p.id === id)!.place;
    expect(place_('p1')).toBe(1);
    expect(place_('p0')).toBe(2);
    expect(place_('p2')).toBe(3);
  });

  it('option defaults match the server config', () => {
    for (const v of CRATE_VARIANTS) {
      const opts = defaultOptions(optionsFor('box-bonanza', v.id));
      expect(Object.keys(opts).length).toBeGreaterThanOrEqual(4);
      const cfg = v.config as unknown as Record<string, unknown>;
      for (const [k, val] of Object.entries(opts).filter(([k]) => k !== 'roundsToWin')) expect(cfg[k], `${v.id}.${k}`).toBe(val);
    }
  });

  it('solid crates block players, unless the option is off; nitro is never a wall', () => {
    const walkInto = (k: string, options: Record<string, boolean>) => {
      const g = make('jungle-bonanza', 2, options);
      clear(g);
      place(g, 0, 300, 500);
      place(g, 1, 900, 900);
      const c = addCrate(g, k, 400, 500);
      g.handleInput('p0', { mx: 1, my: 0, a1: false, a2: false });
      let minD = Infinity;
      for (let t = 0; t < 90; t++) {
        g.update(1 / 60);
        const p = raw(g).players[0];
        minD = Math.min(minD, Math.hypot(p.x - c.x, p.y - c.y));
      }
      return { minD, c };
    };
    const reach = 24 + 22; // PLAYER_R + CRATE_R
    expect(walkInto('block', {}).minD).toBeGreaterThanOrEqual(reach - 0.01);
    expect(walkInto('tnt', {}).minD).toBeGreaterThanOrEqual(reach - 0.01);
    expect(walkInto('block', { solidCrates: false }).minD).toBeLessThan(reach - 10);
    expect(walkInto('nitro', {}).c.dead || walkInto('nitro', {}).minD < reach).toBe(true);
  });

  it('a thrown crate shoves the crate it hits when crates are solid', () => {
    const shove = (options: Record<string, boolean>) => {
      const g = make('jungle-bonanza', 2, options);
      clear(g);
      place(g, 0, 100, 900);
      place(g, 1, 900, 100);
      const a = addCrate(g, 'tnt', 400, 500);
      const b = addCrate(g, 'block', 460, 500);
      a.vx = 500;
      a.flying = true;
      a.owner = 0;
      for (let t = 0; t < 30; t++) g.update(1 / 60);
      return { a, b };
    };
    const on = shove({});
    expect(on.b.x).toBeGreaterThan(470);
    const off = shove({ solidCrates: false });
    expect(off.b.x).toBe(460);
  });

  it('hit protection: a second hit inside the window is ignored, none when it is 0', () => {
    const hits = (invulnTime: number) => {
      const g = make('jungle-bonanza', 2, { invulnTime });
      clear(g);
      place(g, 0, 300, 500);
      place(g, 1, 900, 900);
      const hurt = (g as unknown as { hurt: (p: unknown, d: number) => void }).hurt.bind(g);
      const p = raw(g).players[0];
      const hp0 = p.hp;
      hurt(p, 1);
      hurt(p, 1);
      return hp0 - p.hp;
    };
    expect(hits(0.5)).toBe(1);
    expect(hits(0)).toBe(2);
  });

  it('simultaneous eliminations share a place', () => {
    const g = make(CRATE_VARIANTS[0].id, 3);
    run(g, 0.1);
    g.removePlayer('p0');
    g.removePlayer('p1');
    g.update(1 / 60);
    expect(g.isFinished()).toBe(true);
    const place = Object.fromEntries(g.getPlacements().map((p) => [p.id, p.place]));
    expect(place).toEqual({ p2: 1, p0: 2, p1: 2 });
  });
});

describe('BoxBonanza mechanics', () => {
  const penguinPos = (g: G) => g.getState().penguin!;

  it('the weight is not passed while the pass cooldown is running, and again after it', () => {
    const g = make('space-bonanza', 2);
    clear(g);
    place(g, 0, 300, 500);
    place(g, 1, 330, 500);
    raw(g).players[0].weightT = 7;
    raw(g).players[0].passCd = 1.2;
    g.update(1 / 60);
    expect(me(g, 'p0').weight).toBeGreaterThan(0);
    expect(me(g, 'p1').weight).toBe(0);
    run(g, 1.3);
    // keep them touching until the cooldown has expired
    place(g, 0, 300, 500);
    place(g, 1, 330, 500);
    g.update(1 / 60);
    expect(me(g, 'p0').weight).toBe(0);
    expect(me(g, 'p1').weight).toBeGreaterThan(0);
  });

  it('a passed weight keeps the remaining time and cannot go to someone already holding it', () => {
    const g = make('space-bonanza', 3);
    clear(g);
    place(g, 0, 300, 500);
    place(g, 1, 330, 500);
    place(g, 2, 900, 900);
    raw(g).players[0].weightT = 5;
    raw(g).players[0].passCd = 0;
    g.update(1 / 60);
    expect(raw(g).players[1].weightT).toBeCloseTo(5, 1);
    expect(raw(g).players[0].weightT).toBe(0);
    // the new carrier's cooldown stops an immediate bounce back
    place(g, 0, 300, 500);
    place(g, 1, 330, 500);
    g.update(1 / 60);
    expect(raw(g).players[0].weightT).toBe(0);
  });

  it('a weight carrier that is eliminated stops holding it', () => {
    const g = make('space-bonanza', 3);
    clear(g);
    raw(g).players[0].weightT = 5;
    g.removePlayer('p0');
    expect(raw(g).players[0].weightT).toBe(0);
  });

  it('opening a ? box with no weapon only heals and leaves the rest of the set', () => {
    const g = make('drain-bonanza', 2, { boxEvery: 6 });
    clear(g);
    run(g, 7);
    const set = raw(g).pickups.filter((k) => k.k === 'qbox');
    const plain = set.find((k) => !k.weapon)!;
    place(g, 0, plain.x, plain.y);
    place(g, 1, 100, 900);
    raw(g).players[0].hp = 5;
    g.update(1 / 60);
    expect(me(g, 'p0').hp).toBe(7);
    expect(me(g, 'p0').weapon).toBe('');
    expect(raw(g).pickups.filter((k) => k.k === 'qbox')).toHaveLength(3);
  });

  it('a player already holding a weapon cannot open ? boxes', () => {
    const g = make('drain-bonanza', 2, { boxEvery: 6 });
    clear(g);
    run(g, 7);
    const box = raw(g).pickups.find((k) => k.k === 'qbox')!;
    raw(g).players[0].weapon = 'ring';
    raw(g).players[0].charges = 1;
    place(g, 0, box.x, box.y);
    place(g, 1, 100, 900);
    g.update(1 / 60);
    expect(raw(g).pickups.filter((k) => k.k === 'qbox')).toHaveLength(4);
  });

  it('Snow Bonanza: an awake penguin hurts a player in its path once per cooldown', () => {
    const g = make('snow-bonanza', 2, { penguinTime: 4 });
    clear(g);
    place(g, 1, 900, 900);
    const R = raw(g) as unknown as { penguin: { awake: boolean; t: number; a: number; rest: number } };
    R.penguin.awake = true;
    R.penguin.t = 1;
    R.penguin.a = 0;
    g.update(1 / 60);
    const { x, y } = penguinPos(g);
    place(g, 0, x, y);
    g.update(1 / 60);
    expect(me(g, 'p0').hp).toBe(8);
    place(g, 0, penguinPos(g).x, penguinPos(g).y);
    g.update(1 / 60);
    expect(me(g, 'p0').hp).toBe(8); // hit cooldown
  });

  it('Snow Bonanza: the penguin throws a player outward, away from it, and they cannot steer meanwhile', () => {
    const g = make('snow-bonanza', 2, { penguinTime: 4 });
    clear(g);
    place(g, 1, 900, 900);
    const R = raw(g) as unknown as { penguin: { awake: boolean; t: number; a: number; rest: number } };
    R.penguin.awake = true;
    R.penguin.t = 1;
    R.penguin.a = 0;
    g.update(1 / 60);
    const { x, y } = penguinPos(g);
    place(g, 0, x + 20, y);
    const d0 = Math.hypot(raw(g).players[0].x - x, raw(g).players[0].y - y);
    // the player tries to run straight back into the penguin
    g.handleInput('p0', { mx: -1, my: 0, a1: false, a2: false });
    for (let i = 0; i < 20; i++) g.update(1 / 60);
    const p = raw(g).players[0];
    const peng = penguinPos(g);
    expect(Math.hypot(p.x - peng.x, p.y - peng.y)).toBeGreaterThan(d0 + 60);
    expect(p.hp).toBe(8);
  });

  it('Snow Bonanza: a rampaging penguin flings crates outward instead of breaking them', () => {
    const setup = () => {
      const g = make('snow-bonanza', 2, { penguinTime: 4 });
      clear(g);
      place(g, 0, 100, 100);
      place(g, 1, 900, 900);
      const R = raw(g) as unknown as { penguin: { awake: boolean; t: number; a: number; rest: number } };
      R.penguin.awake = true;
      R.penguin.t = 1;
      g.update(1 / 60);
      return g;
    };
    const g = setup();
    const { x, y } = penguinPos(g);
    const c = addCrate(g, 'block', x + 10, y);
    const d0 = Math.hypot(c.x - x, c.y - y);
    g.update(1 / 60);
    expect(c.dead).toBe(false);
    expect(raw(g).crates.includes(c)).toBe(true);
    expect(c.flying).toBe(true);
    expect(Math.hypot(c.vx, c.vy)).toBeGreaterThan(300);
    expect(Math.hypot(c.x - penguinPos(g).x, c.y - penguinPos(g).y)).toBeGreaterThan(d0);

    const t = setup();
    const tp = penguinPos(t);
    const tnt = addCrate(t, 'tnt', tp.x, tp.y + 5);
    t.update(1 / 60);
    expect(tnt.dead).toBe(false);
    expect(tnt.fuse).toBeGreaterThan(0); // lit, not detonated
    const n = setup();
    const np = penguinPos(n);
    const nitro = addCrate(n, 'nitro', np.x, np.y - 5);
    n.update(1 / 60);
    expect(nitro.dead).toBe(false);
    expect(nitro.flying).toBe(true);
  });

  it('Snow Bonanza: a crate flung by the penguin bounces off the wall; a player-thrown block still breaks', () => {
    const g = make('snow-bonanza', 2);
    clear(g);
    place(g, 0, 100, 100);
    place(g, 1, 900, 900);
    const flung = addCrate(g, 'block', 120, 500);
    Object.assign(flung, { vx: -600, vy: 0, flying: true, bounce: true });
    const thrown = addCrate(g, 'block', 120, 700);
    Object.assign(thrown, { vx: -600, vy: 0, flying: true, owner: 0 });
    run(g, 0.5);
    expect(flung.dead).toBe(false);
    expect(thrown.dead || !raw(g).crates.includes(thrown)).toBe(true);
  });

  it('Snow Bonanza: the penguin cannot be woken again while resting', () => {
    const g = make('snow-bonanza', 2, { penguinTime: 1 });
    clear(g);
    place(g, 1, 900, 900);
    place(g, 0, 500, 410, 1.5);
    kick(g, 'p0', 0, 0.9);
    expect(penguinPos(g).awake).toBe(true);
    run(g, 1.2);
    expect(penguinPos(g).awake).toBe(false);
    place(g, 0, 500, 410, 1.5);
    run(g, 0.6); // let the kick cooldown pass
    kick(g, 'p0', 0, 0.9);
    expect(penguinPos(g).awake).toBe(false);
    run(g, 6);
    place(g, 0, 500, 410, 1.5);
    kick(g, 'p0', 0, 0.9);
    expect(penguinPos(g).awake).toBe(true);
  });

  it('variants without a penguin never report one', () => {
    expect(make('jungle-bonanza').getState().penguin).toBeUndefined();
  });
});

describe('BoxBonanza injected rng', () => {
  const play = (seed: number) => {
    const v = CRATE_VARIANTS[0];
    const g = createBoxBonanza(v, {}, mulberry32(seed));
    g.init([{ id: 'p0', name: 'P0' }, { id: 'p1', name: 'P1' }]);
    for (let t = 0; t < 600; t++) g.update(1 / 60);
    return JSON.stringify(g.getState());
  };

  it('same seed gives the same simulation, different seeds diverge', () => {
    expect(play(7)).toBe(play(7));
    expect(play(7)).not.toBe(play(8));
  });

describe('BoxBonanza two actions', () => {
  const crateAt = (g: G, x: number, y: number, k = 'wood') => {
    raw(g).crates.push({ id: 900, x, y, vx: 0, vy: 0, k, fuse: -1, holder: -1, owner: -1, flying: false, dead: false });
    return raw(g).crates[raw(g).crates.length - 1];
  };
  const setup = (opts: Record<string, number> = {}) => {
    const g = make('jungle-bonanza', 2, opts);
    clear(g);
    place(g, 0, 300, 500, 0);
    place(g, 1, 900, 900);
    return g;
  };

  it('the first button picks up and throws, the second kicks', () => {
    const g = setup();
    const c = crateAt(g, 340, 500);
    press(g, 'p0', 0, 0);
    expect(raw(g).players[0].hold).toBeTruthy();
    press(g, 'p0', 1, 0);
    expect(raw(g).players[0].hold).toBeFalsy();
    expect(c.holder).toBe(-1);
    expect(c.owner).toBe(0); // thrown by p0
    run(g, 1.5); // the thrown crate is long gone / broken
    const k = crateAt(g, raw(g).players[0].x, raw(g).players[0].y + 45);
    kick(g, 'p0', 0, 1);
    expect(k.owner).toBe(0); // kicked by p0
  });

  it('the first button never kicks and the second never picks up', () => {
    const g = setup();
    const c = crateAt(g, 340, 500);
    kick(g, 'p0', 0, 0);
    expect(raw(g).players[0].hold).toBeFalsy();
    expect(c.flying).toBe(true); // kicked away, not carried
    const g2 = setup();
    const c2 = crateAt(g2, 340, 500);
    g2.handleInput('p0', { mx: 0, my: 0, a1: true, a2: false });
    g2.update(1 / 60);
    expect(c2.vx).toBe(0); // picked up, not kicked
  });

  it('pick up distance and cooldown are configurable', () => {
    const near = setup({ pickupRange: 30 });
    crateAt(near, 380, 500); // 80 px away
    press(near, 'p0', 0, 0);
    expect(raw(near).players[0].hold).toBeFalsy();
    const far = setup({ pickupRange: 110 });
    crateAt(far, 380, 500);
    press(far, 'p0', 0, 0);
    expect(raw(far).players[0].hold).toBeTruthy();

    const slow = setup({ pickupCooldown: 2 });
    crateAt(slow, 340, 500);
    press(slow, 'p0', 0, 0);
    press(slow, 'p0', 1, 0); // throw is blocked by the cooldown
    expect(raw(slow).players[0].hold).toBeTruthy();
    run(slow, 2.1);
    press(slow, 'p0', 1, 0);
    expect(raw(slow).players[0].hold).toBeFalsy();
  });

  it('kick distance and cooldown are configurable', () => {
    const short = setup({ kickRange: 40 });
    const c = crateAt(short, 380, 500);
    kick(short, 'p0', 0, 0);
    expect(c.flying).toBe(false);
    const long = setup({ kickRange: 130 });
    const c2 = crateAt(long, 380, 500);
    kick(long, 'p0', 0, 0);
    expect(c2.flying).toBe(true);

    const g = setup({ kickCooldown: 3 });
    place(g, 1, 330, 500);
    kick(g, 'p0', 1, 0);
    const hp = me(g, 'p1').hp;
    run(g, 0.7);
    place(g, 1, raw(g).players[0].x + 30, raw(g).players[0].y);
    kick(g, 'p0', 1, 0); // still cooling down
    expect(me(g, 'p1').hp).toBe(hp);
  });

  it('defaults: pick up cooldown 0, kick cooldown 0.55', () => {
    const d = defaultOptions(optionsFor('box-bonanza', 'jungle-bonanza'));
    expect(d.pickupCooldown).toBe(0);
    expect(d.kickCooldown).toBe(0.55);
  });
});

describe('BoxBonanza TNT countdown', () => {
  const tntAt = (g: G, x: number, y: number) => {
    const c = addCrate(g, 'tnt', x, y);
    return c;
  };
  const setup = (opts: Record<string, number> = {}) => {
    const g = make('jungle-bonanza', 2, opts);
    clear(g);
    place(g, 0, 300, 500, 0);
    place(g, 1, 900, 900);
    return g;
  };

  it('picking up lights the configured countdown and exposes it in seconds', () => {
    const g = setup({ tntFuse: 5 });
    tntAt(g, 340, 500);
    press(g, 'p0', 0, 0);
    const s = g.getState();
    expect(s.tntFuse).toBe(5);
    expect(me(g, 'p0').holdFuse).toBeGreaterThan(4.8);
    expect(me(g, 'p0').holdFuse).toBeLessThanOrEqual(5);
  });

  it('kicking lights it and it explodes only when the countdown ends', () => {
    const g = setup({ tntFuse: 2, blastRadius: 120 });
    const c = tntAt(g, 300, 540);
    kick(g, 'p0', 0, 1);
    expect(c.fuse).toBeGreaterThan(1.8);
    run(g, 1);
    expect(raw(g).crates.includes(c)).toBe(true);
    expect(c.dead).toBe(false);
    run(g, 1.2);
    expect(c.dead || !raw(g).crates.includes(c)).toBe(true);
  });

  it('damage and radius are configurable', () => {
    const blast = (opts: Record<string, number>, dist: number) => {
      const g = setup(opts);
      place(g, 1, 500, 500);
      const c = tntAt(g, 500 + dist, 500);
      c.fuse = 0.05;
      run(g, 0.3);
      return me(g, 'p1').hp;
    };
    expect(blast({ tntDamage: 6, blastRadius: 130 }, 60)).toBe(4);
    expect(blast({ tntDamage: 2, blastRadius: 130 }, 60)).toBe(8);
    expect(blast({ tntDamage: 4, blastRadius: 80 }, 150)).toBe(10); // outside the smaller radius
    expect(blast({ tntDamage: 4, blastRadius: 200 }, 150)).toBe(6);
  });
});

describe('BoxBonanza pick up reliability', () => {
  const setup = () => {
    const g = make('jungle-bonanza', 2);
    clear(g);
    place(g, 0, 300, 500, 0); // facing +x
    place(g, 1, 900, 900);
    return g;
  };

  it('picks up a crate beside or behind when nothing is in front', () => {
    const side = setup();
    addCrate(side, 'block', 300, 545);
    press(side, 'p0', 0, 0);
    expect(raw(side).players[0].hold).toBeTruthy();
    const behind = setup();
    addCrate(behind, 'block', 255, 500);
    press(behind, 'p0', 0, 0);
    expect(raw(behind).players[0].hold).toBeTruthy();
  });

  it('prefers the crate in front; ignores nitro and crates out of reach', () => {
    const g = setup();
    const back = addCrate(g, 'block', 262, 500);
    const front = addCrate(g, 'block', 350, 500);
    press(g, 'p0', 0, 0);
    expect(raw(g).players[0].hold).toBe(front);
    expect(back.holder).toBe(-1);

    const n = setup();
    addCrate(n, 'nitro', 330, 500);
    press(n, 'p0', 0, 0);
    expect(raw(n).players[0].hold).toBeFalsy();
    const far = setup();
    addCrate(far, 'block', 500, 500);
    press(far, 'p0', 0, 0);
    expect(raw(far).players[0].hold).toBeFalsy();
  });

  it('a tap whose down and up inputs arrive between two ticks still counts', () => {
    const g = setup();
    addCrate(g, 'block', 340, 500);
    g.handleInput('p0', { mx: 0, my: 0, a1: true, a2: false });
    g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: false });
    g.update(1 / 60);
    expect(raw(g).players[0].hold).toBeTruthy();
  });

  it('exposes the crate a pick up would take as the player target', () => {
    const g = setup();
    const c = addCrate(g, 'block', 340, 500);
    expect(me(g, 'p0').target).toBe(c.id);
    press(g, 'p0', 0, 0);
    expect(me(g, 'p0').target).toBe(-1); // holding
  });
});

describe('BoxBonanza weight time', () => {
  const take = (opts: Record<string, number> = {}) => {
    const g = make('space-bonanza', 2, opts);
    clear(g);
    place(g, 0, 300, 500, 0);
    place(g, 1, 900, 900);
    raw(g).pickups.push({ id: 700, x: 300, y: 500, k: 'weight', set: 0 });
    g.update(1 / 60);
    return g;
  };

  it('defaults to 5 s and the carrier dies when it runs out', () => {
    const g = take();
    expect(g.getState().weightTime).toBe(5);
    expect(me(g, 'p0').weight).toBeGreaterThan(0.95);
    run(g, 4.5);
    expect(me(g, 'p0').alive).toBe(true);
    run(g, 1);
    expect(me(g, 'p0').alive).toBe(false);
  });

  it('is configurable', () => {
    const g = take({ weightTime: 9 });
    expect(g.getState().weightTime).toBe(9);
    run(g, 6);
    expect(me(g, 'p0').alive).toBe(true);
    run(g, 3.5);
    expect(me(g, 'p0').alive).toBe(false);
  });
});
});
