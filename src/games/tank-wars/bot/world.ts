// Turns a Tank Wars snapshot into the bot's view: own tank (and the way it glides on rails), rivals (teammates left
// out) with estimated velocities, the shots that are not ours with their velocity (from facing and cannon) and how far
// they can fly, mines with their blast shape and time, bombs with where they will land, the arena's solids.
import { EntityTracker } from '../../../core/shared/kit/track';
import type { TankPlayerState, TankState } from '../shared/types';
import { BOAT_SPEED, BOMB_TIME, CANNONS, MINE_FUSE, MUZZLE, ROCKET_DMG, ROCKET_SPEED, TANK_SPEED, fireRays, flight, solidsOf, type Arena } from './physics';
import { physicsFor } from './variants';

export interface WTank extends TankPlayerState {
  vx: number;
  vy: number;
}

export interface WShot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** seconds until it hits a wall */
  tMax: number;
  dmg: number;
}

export interface World {
  tick: number;
  time: number;
  recvMs: number;
  variant: string;
  arena: Arena;
  swamp: boolean;
  me: WTank | null;
  /** rails: the direction we glide in (from our last moves) */
  glide: [number, number];
  rivals: WTank[];
  allies: WTank[];
  shots: WShot[];
  /** t: seconds to the blast (contact mines: 0, they go off when touched); rays: fire cross in the maze */
  mines: { x: number; y: number; t: number; contact: boolean; rays: number[] | null }[];
  bombs: { x: number; y: number; t: number }[];
  pickups: TankState['pickups'];
  totem: TankState['totem'] | null;
  state: TankState;
}

/** a shot we see for the first time is ours if it sits on our facing line, at the muzzle plus one snapshot of flight */
function isOwnShot(q: TankState['shots'][number], me: TankPlayerState): boolean {
  if (Math.abs(Math.atan2(Math.sin(q.f - me.f), Math.cos(q.f - me.f))) > 0.05) return false;
  const ux = Math.cos(me.f);
  const uy = Math.sin(me.f);
  const along = (q.x - me.x) * ux + (q.y - me.y) * uy;
  const across = Math.abs((q.x - me.x) * uy - (q.y - me.y) * ux);
  const speed = q.k === 'rocket' ? ROCKET_SPEED : CANNONS[q.c]?.speed ?? 520;
  return across < (q.k === 'rocket' ? 18 : 6) && along > MUZZLE - 10 && along < MUZZLE + speed * 0.12 + 10;
}

export class WorldModel {
  private tanks = new EntityTracker(1e9);
  private own = new Set<number>();
  private bombSeen = new Map<number, { x: number; y: number; h: number }>();
  private mineRays = new Map<number, number[]>();
  private last: { x: number; y: number } | null = null;
  private glide: [number, number] = [0, 0];

  constructor(private readonly selfId: string, private readonly tickRate: number, private readonly allyIds: ReadonlySet<string>) {}

  update(s: TankState, tick: number, recvMs: number): World {
    const time = tick / this.tickRate;
    const ph = physicsFor(s.variant);
    const solids = solidsOf(s, ph.maze);
    const arena: Arena = { rails: s.rails, maze: ph.maze, solids, speed: ph.swamp ? BOAT_SPEED : TANK_SPEED };
    let me: WTank | null = null;
    const rivals: WTank[] = [];
    const allies: WTank[] = [];
    for (const p of s.players) {
      if (!p.alive) continue;
      const tr = this.tanks.observe(p.id, p.x, p.y, time);
      const t: WTank = { ...p, vx: tr.vx, vy: tr.vy };
      if (p.id === this.selfId) me = t;
      else if (this.allyIds.has(p.id)) allies.push(t);
      else rivals.push(t);
    }
    const m = me as WTank | null;
    if (m) {
      if (this.last) {
        const dx = m.x - this.last.x;
        const dy = m.y - this.last.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) this.glide = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
        else this.glide = [0, 0];
      }
      this.last = { x: m.x, y: m.y };
    }
    // shots: a new one right at our muzzle is ours (it cannot hurt us anyway); the rest fly straight until a wall
    const shots: WShot[] = [];
    const seen = new Set<number>();
    for (const q of s.shots) {
      seen.add(q.id);
      if (m && !this.knownShot.has(q.id) && isOwnShot(q, m)) this.own.add(q.id);
      this.knownShot.add(q.id);
      if (this.own.has(q.id)) continue;
      const speed = q.k === 'rocket' ? ROCKET_SPEED : CANNONS[q.c]?.speed ?? 520;
      const ux = Math.cos(q.f);
      const uy = Math.sin(q.f);
      const dist = flight(q.x, q.y, ux, uy, solids, speed * 1.5);
      shots.push({ id: q.id, x: q.x, y: q.y, vx: ux * speed, vy: uy * speed, tMax: dist / speed, dmg: q.k === 'rocket' ? ROCKET_DMG : CANNONS[q.c]?.dmg ?? 20 });
    }
    for (const id of this.own) if (!seen.has(id)) this.own.delete(id);
    for (const id of this.knownShot) if (!seen.has(id)) this.knownShot.delete(id);

    const mines: World['mines'] = s.mines.map((mi) => {
      let rays: number[] | null = null;
      if (ph.maze && !ph.swamp) {
        rays = this.mineRays.get(mi.id) ?? fireRays(mi.x, mi.y, solids);
        this.mineRays.set(mi.id, rays);
      }
      return { x: mi.x, y: mi.y, t: mi.fuse < 0 ? 0 : mi.fuse * MINE_FUSE, contact: mi.fuse < 0, rays };
    });
    if (this.mineRays.size > 32) this.mineRays.clear();
    // bombs fly in a straight line from the thrower to the landing point: two samples give the landing point
    const bombs: World['bombs'] = [];
    const bseen = new Set<number>();
    for (const b of s.bombs) {
      bseen.add(b.id);
      const first = this.bombSeen.get(b.id);
      if (!first) this.bombSeen.set(b.id, { x: b.x, y: b.y, h: b.h });
      let lx = b.x;
      let ly = b.y;
      if (first && b.h > first.h + 0.01) {
        const k = (1 - first.h) / (b.h - first.h);
        lx = first.x + (b.x - first.x) * k;
        ly = first.y + (b.y - first.y) * k;
      }
      bombs.push({ x: lx, y: ly, t: (1 - b.h) * BOMB_TIME });
    }
    for (const id of this.bombSeen.keys()) if (!bseen.has(id)) this.bombSeen.delete(id);

    return { tick, time, recvMs, variant: s.variant, arena, swamp: !!ph.swamp, me: m, glide: this.glide, rivals, allies, shots, mines, bombs, pickups: s.pickups, totem: s.totem ?? null, state: s };
  }

  private knownShot = new Set<number>();
}
