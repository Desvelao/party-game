import { describe, expect, it } from 'vitest';
import { defaultOptions, optionsFor, actionFor, normalizeSelection, secondaryActionFor } from '../../../core/shared/catalog';
import { TANK_BLOCKS, TANK_RAIL_BLOCKS, TANK_MAX, TANK_MIN, TANK_R, TANK_RAILS, arenaBorder, arenaBounds, TANK_TOTEM_POST } from '../shared/geometry';
import { TankWars } from './TankWars';
import { TANK_DEFAULTS, TANK_VARIANTS, applyOptions } from './config';
import { createTankWars } from './create';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const variant = (id: string) => TANK_VARIANTS.find((v) => v.id === id)!;
const make = (id = 'desert-fox', o: Record<string, number | boolean> = {}, n = 2, rng: () => number = () => 0.5) => {
  const g = createTankWars(variant(id), o, rng);
  g.init(players(n));
  return g;
};
const step = (g: TankWars, seconds: number) => {
  for (let t = 0; t < Math.round(seconds * 60) && !g.isFinished(); t++) g.update(1 / 60);
};
const state = (g: TankWars, id = 'p0') => g.getState().players.find((p) => p.id === id)!;
const set = (g: TankWars, id: string, patch: Record<string, unknown>) => {
  const p = (g as unknown as { byId: Map<string, Record<string, unknown>> }).byId.get(id)!;
  Object.assign(p, patch);
  return p;
};
const IDLE = { mx: 0, my: 0, a1: false, a2: false };
const FIRE = { mx: 0, my: 0, a1: true, a2: false };
const MINE = { mx: 0, my: 0, a1: false, a2: true };
/** a tap: press for a frame, then release */
const tap = (g: TankWars, id: string, input: typeof FIRE | typeof MINE) => {
  g.handleInput(id, input);
  g.update(1 / 60);
  g.handleInput(id, IDLE);
};
/** park everyone harmlessly in the top-left/right corners so they do not interfere */
const park = (g: TankWars, ...ids: string[]) => ids.forEach((id, i) => set(g, id, { x: 120 + i * 40, y: 900, f: 0 }));

describe('TankWars', () => {
  it('everyone starts in free space at full health with the mines', () => {
    const g = make('desert-fox', {}, 4);
    for (const p of g.getState().players) {
      expect(p.hp).toBe(100);
      expect(p.mines).toBe(3);
      expect(p.alive).toBe(true);
      expect(p.x).toBeGreaterThan(TANK_MIN);
      expect(p.x).toBeLessThan(TANK_MAX);
      for (const b of TANK_BLOCKS) {
        const inside = p.x > b.x - TANK_R && p.x < b.x + b.w + TANK_R && p.y > b.y - TANK_R && p.y < b.y + b.h + TANK_R;
        expect(inside).toBe(false);
      }
    }
    expect(g.getState().players.map((p) => p.cannon)).toEqual([0, 1, 2, 3]);
  });

  it('cannonTypes off gives everyone the balanced cannon', () => {
    const g = make('desert-fox', { cannonTypes: false }, 4);
    expect(g.getState().players.every((p) => p.cannon === 0)).toBe(true);
  });

  describe('rails', () => {
    const onRail = (v: number) => TANK_RAILS.some((r) => Math.abs(r - v) < 0.6);
    const heldFor = (g: TankWars, mx: number, my: number, seconds: number) => {
      g.handleInput('p0', { mx, my, a1: false, a2: false });
      step(g, seconds);
    };

    it('are the default in Desert Fox and Metal Fox, and off in Jungle Fox and Swamp Fox', () => {
      expect(applyOptions(variant('desert-fox'), {}).rails).toBe(true);
      expect(applyOptions(variant('metal-fox'), {}).rails).toBe(true);
      expect(applyOptions(variant('jungle-fox'), {}).rails).toBe(false);
      expect(applyOptions(variant('swamp-fox'), {}).rails).toBe(false);
      expect(make('desert-fox').getState().rails).toBe(true);
      expect(make('jungle-fox').getState().rails).toBe(false);
    });

    it('the catalog option default matches the variant default and can be switched', () => {
      expect(normalizeSelection('tank-wars', 'desert-fox', { rails: false })?.options).toEqual({ rails: false });
      expect(normalizeSelection('tank-wars', 'desert-fox', { rails: true })?.options).toEqual({}); // equal to default: dropped
      expect(normalizeSelection('tank-wars', 'jungle-fox', { rails: true })?.options).toEqual({ rails: true });
      expect(normalizeSelection('tank-wars', 'desert-fox', { rails: 1 })).toBeNull();
    });

    it('keep the tank on a rail and drive straight along it', () => {
      const g = make('desert-fox');
      park(g, 'p1');
      heldFor(g, 0.8, 0.5, 0.6); // mostly right: the tank follows the top rail
      const s = state(g);
      expect(s.x).toBeGreaterThan(110 + 60);
      expect(s.y).toBeCloseTo(110, 1);
      expect(onRail(s.x) || onRail(s.y)).toBe(true);
    });

    it('a turn is taken at the next crossing, exactly on it', () => {
      const g = make('desert-fox');
      park(g, 'p1');
      set(g, 'p0', { x: 200, y: 110 });
      heldFor(g, 1, 0, 0.1); // already driving right
      heldFor(g, 0, 1, 2); // down is requested between crossings: it keeps going right until x = 360...
      const s = state(g);
      expect(s.x).toBeCloseTo(360, 1); // ...then turns down onto the rail there
      expect(s.y).toBeGreaterThan(110 + 50);
    });

    it('turns at once on the spot of a crossing, and reverses anywhere', () => {
      const g = make('desert-fox');
      park(g, 'p1');
      set(g, 'p0', { x: 110, y: 110 });
      heldFor(g, 0, 1, 0.4);
      expect(state(g).x).toBeCloseTo(110, 1);
      expect(state(g).y).toBeGreaterThan(110 + 40);
      heldFor(g, 0, -1, 0.2); // reverse in the middle of the rail
      expect(state(g).y).toBeLessThan(110 + 70);
      expect(onRail(state(g).x)).toBe(true);
    });

    it('stops when the stick is released and never touches a block', () => {
      const g = make('desert-fox');
      park(g, 'p1');
      heldFor(g, 1, 0, 0.3);
      g.handleInput('p0', IDLE);
      const x = state(g).x;
      step(g, 0.5);
      expect(state(g).x).toBe(x);
      for (let i = 0; i < 6; i++) {
        heldFor(g, i % 2 ? 1 : 0, i % 2 ? 0 : 1, 0.7);
        const p = state(g);
        for (const b of TANK_RAIL_BLOCKS) {
          expect(p.x > b.x - TANK_R + 1 && p.x < b.x + b.w + TANK_R - 1 && p.y > b.y - TANK_R + 1 && p.y < b.y + b.h + TANK_R - 1).toBe(false);
        }
      }
    });

    it('a tank pushed off the grid is put back on a rail', () => {
      const g = make('desert-fox');
      park(g, 'p1');
      set(g, 'p0', { x: 360, y: 200 }); // on the vertical rail x = 360
      set(g, 'p1', { x: 372, y: 200 }); // overlapping: the pair is shoved apart sideways
      step(g, 0.1);
      for (const id of ['p0', 'p1']) expect(onRail(state(g, id).x) || onRail(state(g, id).y)).toBe(true);
    });

    it('off: free movement in any direction, and the blocks still stop the tank', () => {
      const g = make('desert-fox', { rails: false });
      park(g, 'p1');
      heldFor(g, 0.8, 0.5, 0.5);
      expect(state(g).x).toBeGreaterThan(110 + 40);
      expect(state(g).y).toBeGreaterThan(110 + 20);
    });

    it('pick-ups spawn on rails when rails are on', () => {
      const g = make('desert-fox', {}, 2, () => 0.37);
      step(g, 12.1);
      const k = g.getState().pickups.find((q) => q.k === 'fruit')!;
      expect(k).toBeDefined();
      expect(onRail(k.x) || onRail(k.y)).toBe(true);
    });
  });

  it('blocks stop tanks and shots', () => {
    const g = make('desert-fox', { rails: false });
    park(g, 'p1');
    set(g, 'p0', { x: 310, y: 220, f: Math.PI });
    g.handleInput('p0', { mx: -1, my: 0, a1: true, a2: false });
    step(g, 1.5);
    expect(state(g).x).toBeGreaterThanOrEqual(280 + TANK_R - 1);
    expect(g.getState().shots.length).toBe(0); // the shot hit the block and was removed
  });

  it('a hit does the cannon damage; the balanced and plasma cannons differ', () => {
    const g = make();
    set(g, 'p0', { x: 200, y: 110, f: 0 });
    set(g, 'p1', { x: 600, y: 110, f: Math.PI });
    tap(g, 'p0', FIRE);
    step(g, 1.5);
    expect(state(g, 'p1').hp).toBe(80);
    tap(g, 'p1', FIRE);
    step(g, 1.5);
    expect(state(g, 'p0').hp).toBe(86);
    expect(g.drainEvents().some((e) => e.kind === 'hit')).toBe(true);
  });

  it('only one shot may be in flight; the fireball cannon may have two', () => {
    const g = make('jungle-fox', {}, 4);
    park(g, 'p1', 'p2');
    set(g, 'p0', { x: 110, y: 500, f: 0 });
    set(g, 'p3', { x: 110, y: 700, f: 0 });
    g.handleInput('p0', FIRE);
    step(g, 0.1);
    expect(g.getState().shots.filter((s) => s.c === 0)).toHaveLength(1);
    g.handleInput('p3', FIRE);
    step(g, 0.5);
    expect(g.getState().shots.filter((s) => s.c === 3)).toHaveLength(2);
    expect(g.getState().shots.filter((s) => s.c === 0).length).toBeLessThanOrEqual(1);
  });

  it('a spent shot allows the next one', () => {
    const g = make('jungle-fox');
    park(g, 'p1');
    set(g, 'p0', { x: 600, y: 500, f: 0 });
    g.handleInput('p0', FIRE);
    step(g, 0.1);
    expect(g.getState().shots).toHaveLength(1);
    step(g, 1.5); // flies off the field edge
    expect(g.getState().shots).toHaveLength(1); // the held button fired a new shot once the old one was spent
  });

  describe('mines', () => {
    it('Desert Fox: fire runs down the corridors and stops at walls', () => {
      const g = make('desert-fox', { rails: false });
      set(g, 'p0', { x: 220, y: 300, f: 0 });
      set(g, 'p1', { x: 520, y: 300, f: 0 });
      tap(g, 'p0', MINE);
      expect(state(g).mines).toBe(2);
      expect(g.getState().mines).toHaveLength(1);
      set(g, 'p0', { x: 220, y: 900 }); // step away so only p1 stands in the fire
      step(g, 3.1);
      const blast = g.getState().blasts[0];
      expect(blast.rays).toBeDefined();
      expect(blast.rays![0]).toBeLessThan(40); // the block above stops the upward fire
      expect(blast.rays![1]).toBeGreaterThan(250); // the corridor to the right runs on
      expect(state(g, 'p1').hp).toBe(55);
      expect(state(g).hp).toBe(100);
      expect(g.drainEvents().some((e) => e.kind === 'explode')).toBe(true);
    });

    it('Jungle Fox: a radius blast, hurting inside it and not outside', () => {
      const g = make('jungle-fox', {}, 3);
      set(g, 'p0', { x: 500, y: 700, f: 0 });
      set(g, 'p1', { x: 600, y: 700, f: 0 });
      set(g, 'p2', { x: 800, y: 700, f: 0 });
      tap(g, 'p0', MINE);
      set(g, 'p0', { x: 500, y: 900 });
      step(g, 3.1);
      expect(state(g, 'p1').hp).toBe(55);
      expect(state(g, 'p2').hp).toBe(100);
    });

    it('Swamp Fox: it waits until someone drives over it', () => {
      const g = make('swamp-fox', { mineSpeed: 0 });
      set(g, 'p0', { x: 500, y: 700, f: 0 });
      set(g, 'p1', { x: 800, y: 700, f: 0 });
      tap(g, 'p0', MINE);
      g.update(1 / 60); // a Swamp Fox mine is planted on the button's release
      set(g, 'p0', { x: 300, y: 300 });
      step(g, 5);
      expect(g.getState().mines).toHaveLength(1);
      expect(g.getState().mines[0].fuse).toBe(-1);
      expect(state(g, 'p1').hp).toBe(100);
      set(g, 'p1', { x: 500, y: 700 });
      step(g, 0.05);
      expect(g.getState().mines).toHaveLength(0);
      expect(state(g, 'p1').hp).toBe(55);
    });

    it('Swamp Fox: the mine wanders slowly, never times out, and bounces inside the field', () => {
      const g = make('swamp-fox');
      set(g, 'p0', { x: 500, y: 700, f: 0 });
      park(g, 'p1');
      tap(g, 'p0', MINE);
      g.update(1 / 60);
      set(g, 'p0', { x: 900, y: 900 });
      park(g, 'p1');
      const at = (i = 0) => g.getState().mines[i];
      const x0 = at().x;
      const y0 = at().y;
      step(g, 2);
      const d = Math.hypot(at().x - x0, at().y - y0);
      expect(d).toBeGreaterThan(35 * 2 * 0.9);
      expect(d).toBeLessThan(35 * 2 * 1.1);
      for (let i = 0; i < 60 * 40; i++) {
        g.update(1 / 60);
        const m = at();
        expect(m.x).toBeGreaterThan(TANK_MIN);
        expect(m.x).toBeLessThan(TANK_MAX);
        expect(m.y).toBeGreaterThan(TANK_MIN);
        expect(m.y).toBeLessThan(TANK_MAX);
      }
      expect(g.getState().mines).toHaveLength(1); // 40 s later it is still there: no fuse
    });

    it('Swamp Fox: a wandering mine hurts its own owner too', () => {
      const g = make('swamp-fox', { mineSpeed: 0 });
      set(g, 'p0', { x: 500, y: 700, f: 0 });
      park(g, 'p1');
      tap(g, 'p0', MINE);
      g.update(1 / 60);
      step(g, 1); // armed; p0 sits right on it
      expect(g.getState().mines).toHaveLength(0);
      expect(state(g).hp).toBe(55);
    });

    it('Jungle Fox keeps its still 3 s fuse mine', () => {
      const g = make('jungle-fox');
      set(g, 'p0', { x: 300, y: 300, f: 0 });
      park(g, 'p1');
      tap(g, 'p0', MINE);
      const m = g.getState().mines[0];
      step(g, 1);
      expect(g.getState().mines[0]).toMatchObject({ x: m.x, y: m.y });
      expect(g.getState().mines[0].fuse).toBeLessThan(1);
    });

    it('you cannot plant more than you have', () => {
      const g = make('jungle-fox', { mines: 1 });
      park(g, 'p1');
      tap(g, 'p0', MINE);
      tap(g, 'p0', MINE);
      expect(g.getState().mines).toHaveLength(1);
      expect(state(g).mines).toBe(0);
    });
  });

  it('berry heals and is left alone at full health', () => {
    const g = make();
    const fruits = g.getState().pickups;
    expect(fruits).toHaveLength(0);
    step(g, 12.1);
    const fruit = g.getState().pickups.find((k) => k.k === 'fruit')!;
    expect(fruit).toBeDefined();
    set(g, 'p0', { x: fruit.x, y: fruit.y, hp: 50 });
    g.update(1 / 60);
    expect(state(g).hp).toBe(75);
    set(g, 'p0', { x: 800, y: 800 }); // away from the spawn spot, so the next fruit is not taken at once

    step(g, 12.1);
    const f2 = g.getState().pickups.find((k) => k.k === 'fruit')!;
    set(g, 'p0', { x: f2.x, y: f2.y, hp: 100 });
    g.update(1 / 60);
    expect(state(g).hp).toBe(100);
    expect(g.getState().pickups.some((k) => k.id === f2.id)).toBe(true);
  });

  it('Swamp Fox has no fruit', () => {
    const g = make('swamp-fox');
    step(g, 40);
    expect(g.getState().pickups.some((k) => k.k === 'fruit')).toBe(false);
  });

  describe('Metal Fox', () => {
    it('metal walls alternate and block only while raised', () => {
      const g = make('metal-fox', { wallEvery: 6 });
      park(g, 'p1');
      expect(g.getState().walls!.raised).toEqual([true, true, false, false]);
      set(g, 'p0', { x: 360, y: 440, f: 0 });
      g.handleInput('p0', { mx: 0, my: 1, a1: false, a2: false });
      step(g, 1);
      expect(state(g).y).toBeLessThanOrEqual(490 - TANK_R + 0.5); // stopped by the raised wall
      step(g, 5.5);
      expect(g.getState().walls!.raised).toEqual([false, false, true, true]);
      step(g, 1);
      expect(state(g).y).toBeGreaterThan(490 + 10); // it is down now: driven through
    });

    it('wallVariance moves the switch by up to that many seconds, either way', () => {
      const early = make('metal-fox', { wallEvery: 6, wallVariance: 2 }, 2, () => 0);
      park(early, 'p1');
      step(early, 4.5); // 6 - 2 = 4 s: already switched
      expect(early.getState().walls!.raised).toEqual([false, false, true, true]);
      const late = make('metal-fox', { wallEvery: 6, wallVariance: 2 }, 2, () => 1);
      park(late, 'p1');
      step(late, 7.5); // 6 + 2 = 8 s: not yet
      expect(late.getState().walls!.raised).toEqual([true, true, false, false]);
      expect(late.getState().walls!.warn).toBe(true);
    });

    it('a bomb is lobbed over the walls and blasts a large radius', () => {
      const g = make('metal-fox');
      set(g, 'p0', { x: 200, y: 110, f: 0, item: 'bomb' });
      set(g, 'p1', { x: 460, y: 110, f: 0 });
      tap(g, 'p0', FIRE);
      expect(g.getState().bombs).toHaveLength(1);
      expect(state(g).item).toBe('');
      step(g, 0.7);
      expect(state(g, 'p1').hp).toBe(60);
      expect(g.drainEvents().some((e) => e.kind === 'explode')).toBe(true);
    });
  });

  describe('Jungle Fox', () => {
    it('the totem warns, then hurts what is in its path', () => {
      const g = make('jungle-fox', { totemEvery: 8 });
      step(g, 8.1);
      const warn = g.getState().totem!;
      expect(warn.warn).toBeGreaterThan(0);
      const a = warn.a;
      set(g, 'p0', { x: 500 + Math.cos(a) * 150, y: 500 + Math.sin(a) * 150 });
      set(g, 'p1', { x: 500 - Math.cos(a) * 150, y: 500 - Math.sin(a) * 150 });
      step(g, 1.3);
      expect(state(g).hp).toBe(50);
      expect(state(g, 'p1').hp).toBe(100);
      expect(g.getState().totem!.hit).toBeGreaterThan(0);
      expect(g.drainEvents().some((e) => e.kind === 'smash')).toBe(true);
    });

    it('a missile fires twin rockets that hit hard', () => {
      const g = make('jungle-fox');
      set(g, 'p0', { x: 200, y: 300, f: 0, item: 'missile' });
      set(g, 'p1', { x: 600, y: 300, f: Math.PI });
      tap(g, 'p0', FIRE);
      expect(g.getState().shots.filter((s) => s.k === 'rocket')).toHaveLength(2);
      step(g, 1);
      expect(state(g, 'p1').hp).toBeLessThanOrEqual(65);
      expect(state(g).item).toBe('');
    });

    it('missiles fall from the sky as pick-ups and are carried', () => {
      const g = make('jungle-fox', { missileEvery: 8 });
      step(g, 8.1);
      const m = g.getState().pickups.find((k) => k.k === 'missile')!;
      expect(m).toBeDefined();
      expect(m.land).toBeGreaterThan(0); // still falling
      step(g, 1);
      set(g, 'p0', { x: m.x, y: m.y });
      g.update(1 / 60);
      expect(state(g).item).toBe('missile');
    });
  });

  describe('Swamp Fox', () => {
    it('holding the mine button raises a shield that blocks damage; a tap plants a mine', () => {
      const g = make('swamp-fox');
      set(g, 'p0', { x: 200, y: 500, f: 0 });
      set(g, 'p1', { x: 600, y: 500, f: Math.PI });
      g.handleInput('p1', MINE);
      step(g, 0.5);
      expect(state(g, 'p1').up).toBe(true);
      tap(g, 'p0', FIRE);
      g.handleInput('p1', MINE);
      step(g, 1.1);
      expect(state(g, 'p1').hp).toBe(100); // absorbed
      expect(g.drainEvents().some((e) => e.kind === 'zap')).toBe(true);
      g.handleInput('p1', IDLE);
      step(g, 0.1);
      expect(state(g, 'p1').mines).toBe(3); // holding did not plant anything
      tap(g, 'p1', MINE);
      g.update(1 / 60);
      g.update(1 / 60);
      expect(state(g, 'p1').mines).toBe(2); // the quick tap did, on release
    });

    it('the shield runs out and then refills', () => {
      const g = make('swamp-fox', { shieldTime: 1 });
      park(g, 'p1');
      g.handleInput('p0', MINE);
      step(g, 2);
      expect(state(g).up).toBe(false);
      expect(state(g).shield).toBe(0);
      g.handleInput('p0', IDLE);
      step(g, 2);
      expect(state(g).shield).toBeGreaterThan(0.4);
    });
  });

  describe('the round', () => {
    it('ends when one tank is left; the survivor wins and the fallen are ranked by elimination time', () => {
      const g = make('jungle-fox', {}, 3);
      set(g, 'p1', { x: 200, y: 500, f: 0, hp: 1 });
      g.removePlayer('p2');
      g.update(1 / 60);
      expect(g.isFinished()).toBe(false);
      g.removePlayer('p1');
      g.update(1 / 60);
      expect(g.isFinished()).toBe(true);
      const pl = g.getPlacements();
      expect(pl.find((p) => p.id === 'p0')!.place).toBe(1);
      expect(pl.find((p) => p.id === 'p1')!.place).toBe(2); // fell later than p2
      expect(pl.find((p) => p.id === 'p2')!.place).toBe(3);
    });

    it('at the time limit the most health wins and equal health shares a place', () => {
      const g = make('jungle-fox', { timeLimit: 30 }, 3);
      set(g, 'p0', { hp: 80 });
      set(g, 'p1', { hp: 60 });
      set(g, 'p2', { hp: 60 });
      step(g, 31);
      expect(g.isFinished()).toBe(true);
      const pl = g.getPlacements();
      expect(pl.find((p) => p.id === 'p0')!.place).toBe(1);
      expect(pl.find((p) => p.id === 'p1')!.place).toBe(2);
      expect(pl.find((p) => p.id === 'p2')!.place).toBe(2);
    });

    it('a kill emits eliminated', () => {
      const g = make('jungle-fox');
      set(g, 'p0', { x: 200, y: 110, f: 0 });
      set(g, 'p1', { x: 600, y: 110, f: Math.PI, hp: 10 });
      tap(g, 'p0', FIRE);
      step(g, 1.5);
      expect(state(g, 'p1').alive).toBe(false);
      expect(g.drainEvents().some((e) => e.kind === 'eliminated' && e.id === 'p1')).toBe(true);
      expect(g.isFinished()).toBe(true);
    });
  });

  describe('options and catalog', () => {
    it('apply to the config; unknown ids are ignored', () => {
      const cfg = applyOptions(variant('desert-fox'), { timeLimit: 60, maxHp: 150, cannonTypes: false, nope: 1 });
      expect(cfg.timeLimit).toBe(60);
      expect(cfg.maxHp).toBe(150);
      expect(cfg.cannonTypes).toBe(false);
      expect(applyOptions(variant('desert-fox'), {})).toEqual({ ...TANK_DEFAULTS, maze: true, rails: true });
    });

    it('the catalog validates them per variant', () => {
      expect(normalizeSelection('tank-wars', 'jungle-fox', { totemEvery: 10 })?.options).toEqual({ totemEvery: 10 });
      expect(normalizeSelection('tank-wars', 'desert-fox', { totemEvery: 10 })).toBeNull();
      expect(normalizeSelection('tank-wars', 'swamp-fox', { shieldTime: 3, cannonTypes: false })?.options).toEqual({ shieldTime: 3, cannonTypes: false });
      expect(normalizeSelection('tank-wars', 'metal-fox', { mines: 99 })?.options).toEqual({ mines: 6 });
    });

    it('every variant builds, and the action buttons are fire + mine', () => {
      for (const v of TANK_VARIANTS) {
        const g = new TankWars(applyOptions(v, {}));
        g.init(players(2));
        expect(g.id).toBe(v.id);
        expect(g.getState().variant).toBe(v.id);
        expect(actionFor(v.id)).toBe('fire');
        expect(secondaryActionFor(v.id)).toBe('mine');
      }
      expect(secondaryActionFor('crazy-logs')).toBeUndefined();
    });
  });

  it('option defaults match the server config', () => {
    for (const v of TANK_VARIANTS) {
      const opts = defaultOptions(optionsFor('tank-wars', v.id));
      const cfg = v.config as unknown as Record<string, unknown>;
      for (const [k, val] of Object.entries(opts).filter(([k]) => k !== 'roundsToWin')) expect(cfg[k], `${v.id}.${k}`).toBe(val);
    }
  });

  it('hit protection: a second hit inside the window is ignored, none when it is 0', () => {
    const hit = (invulnTime: number) => {
      const g = make('desert-fox', { invulnTime });
      const hurt = (g as unknown as { hurt: (p: unknown, d: number) => void }).hurt.bind(g);
      const p = set(g, 'p0', {});
      hurt(p, 10);
      hurt(p, 10);
      const during = state(g).hp;
      step(g, invulnTime + 0.1);
      hurt(p, 10);
      return [during, state(g).hp];
    };
    const base = make('desert-fox').getState().players[0].hp;
    expect(hit(0.5)).toEqual([base - 10, base - 20]);
    expect(hit(0)[0]).toBe(base - 20);
  });
});

describe('bouncing shots', () => {
  /** p0 at (300, 300) shoots to the right at p1-less space; returns the game after `seconds` */
  const fireRight = (id: string, o: Record<string, number | boolean> = {}) => {
    const g = make(id, o);
    set(g, 'p0', { x: 300, y: 300, f: 0, cannon: 0 });
    park(g, 'p1');
    tap(g, 'p0', FIRE);
    return g;
  };
  const shot = (g: TankWars) => g.getState().shots.find((s) => s.k === 'shot');

  it('Swamp Fox and Jungle Fox bounce by default, with a 3 s life', () => {
    for (const id of ['swamp-fox', 'jungle-fox']) {
      const d = defaultOptions(optionsFor('tank-wars', id));
      expect(d.shotBounce).toBe(true);
      expect(d.shotLife).toBe(3);
    }
    expect(optionsFor('tank-wars', 'desert-fox').some((o) => o.id === 'shotBounce')).toBe(false);
  });

  it('a shot rebounds off the field edge and keeps flying', () => {
    const g = fireRight('swamp-fox');
    step(g, 1.2); // 520 px/s: from x=330 it meets the edge at ~940 after ~1.2 s
    const s = shot(g)!;
    expect(s).toBeDefined();
    step(g, 0.5);
    expect(Math.cos(shot(g)!.f)).toBeLessThan(0); // now heading left
    expect(shot(g)!.x).toBeLessThan(TANK_MAX);
  });

  it('it rebounds off the centre post in Jungle Fox', () => {
    const g = make('jungle-fox');
    set(g, 'p0', { x: 250, y: 500, f: 0, cannon: 0 });
    park(g, 'p1');
    tap(g, 'p0', FIRE);
    step(g, 0.3);
    expect(Math.cos(shot(g)!.f)).toBeLessThan(0);
  });

  it('it vanishes after shotLife', () => {
    const g = fireRight('swamp-fox', { shotLife: 1 });
    step(g, 1.1);
    expect(shot(g)).toBeUndefined();
  });

  it('with bouncing off a shot dies at the wall, and Desert Fox shots stay straight', () => {
    const g = fireRight('swamp-fox', { shotBounce: false });
    step(g, 1.6);
    expect(shot(g)).toBeUndefined();
    const d = make('desert-fox');
    expect(d.getState().size).toBe(11);
  });

  it('a bounced shot never hurts the one who fired it', () => {
    const g = fireRight('swamp-fox');
    step(g, 2.3); // out, off the edge and back through p0's column
    set(g, 'p0', { x: 500, y: 300 });
    step(g, 1);
    expect(state(g).hp).toBe(100);
  });

  it('rockets do not bounce', () => {
    const g = make('jungle-fox');
    set(g, 'p0', { x: 300, y: 300, f: 0, item: 'missile' });
    park(g, 'p1');
    tap(g, 'p0', FIRE);
    step(g, 1.5);
    expect(g.getState().shots.filter((s) => s.k === 'rocket')).toHaveLength(0);
  });
});

describe('arena size', () => {
  it('Jungle Fox and Swamp Fox play on 8 squares by default and the snapshot says so', () => {
    const g = make('jungle-fox');
    expect(g.getState().size).toBe(8);
    expect(make('swamp-fox').getState().size).toBe(8);
    expect(make('desert-fox').getState().size).toBe(11);
    expect(make('metal-fox').getState().size).toBe(11);
  });

  it('tanks start and stay inside a smaller field, which is closed in by walls', () => {
    const g = make('jungle-fox', { arenaSize: 6 }, 4);
    const { min, max } = arenaBounds(6);
    for (const p of g.getState().players) {
      expect(p.x).toBeGreaterThan(min);
      expect(p.x).toBeLessThan(max);
      expect(p.y).toBeGreaterThan(min);
      expect(p.y).toBeLessThan(max);
    }
    g.handleInput('p0', { mx: -1, my: -1, a1: false, a2: false });
    step(g, 6);
    const p = state(g);
    expect(p.x).toBeGreaterThanOrEqual(min + TANK_R - 0.5);
    expect(p.y).toBeGreaterThanOrEqual(min + TANK_R - 0.5);
  });

  it('a Swamp Fox mine stays inside the smaller field', () => {
    const g = make('swamp-fox');
    const { min, max } = arenaBounds(8);
    set(g, 'p0', { x: 500, y: 600, f: 0 });
    park(g, 'p1');
    tap(g, 'p0', MINE);
    g.update(1 / 60);
    set(g, 'p0', { x: 500, y: 300 });
    for (let i = 0; i < 60 * 60; i++) {
      g.update(1 / 60);
      const m = g.getState().mines[0];
      if (!m) break;
      expect(m.x).toBeGreaterThan(min);
      expect(m.x).toBeLessThan(max);
      expect(m.y).toBeGreaterThan(min);
      expect(m.y).toBeLessThan(max);
    }
  });

  it('11 squares is the whole arena with no border', () => {
    expect(arenaBorder(11)).toEqual([]);
    expect(arenaBounds(11)).toEqual({ min: 60, max: 940 });
    expect(arenaBorder(8)).toHaveLength(4);
  });
});

describe('Jungle Fox centre post', () => {
  it('is solid: a tank driving at it is stopped', () => {
    const g = make('jungle-fox');
    set(g, 'p0', { x: 300, y: 500, f: 0 });
    g.handleInput('p0', { mx: 1, my: 0, a1: false, a2: false });
    step(g, 4);
    expect(state(g).x).toBeLessThanOrEqual(TANK_TOTEM_POST.x - TANK_R + 0.5);
  });

  it('only Jungle Fox has it', () => {
    const g = make('swamp-fox');
    set(g, 'p0', { x: 300, y: 500, f: 0 });
    g.handleInput('p0', { mx: 1, my: 0, a1: false, a2: false });
    step(g, 3);
    expect(state(g).x).toBeGreaterThan(TANK_TOTEM_POST.x + TANK_TOTEM_POST.w);
  });
});
