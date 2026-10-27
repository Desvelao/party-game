// Turns a Sprint Smash snapshot into the bot's view: own craft with its speed (estimated: the snapshot has none) and
// polar position, rivals (teammates left out), the missiles we did not fire (angle and radius on the ring), blobs
// with their velocity, and the rest of the hazards as they are.
import { EntityTracker } from '../../../core/shared/kit/track';
import type { DashPlayerState, DashState } from '../shared/types';
import { CRUISE, polar } from './physics';

export interface WCraft extends DashPlayerState {
  vx: number;
  vy: number;
  speed: number;
  /** polar position */
  a: number;
  r: number;
}

export interface World {
  tick: number;
  time: number;
  recvMs: number;
  variant: string;
  me: WCraft | null;
  rivals: WCraft[];
  allies: WCraft[];
  missiles: { a: number; r: number; x: number; y: number; vx?: number; vy?: number }[];
  blobs: { x: number; y: number; vx: number; vy: number }[];
  /** hub turn rate (rad/s) measured from the snapshots; absent until two samples are in */
  rodSpeed?: number;
  state: DashState;
}

export class WorldModel {
  private crafts = new EntityTracker(1e9);
  private blobs = new EntityTracker(1e9);
  private own = new Set<number>();
  private known = new Set<number>();
  private firedAt = -1;
  /** heading of each missile we fired, when first seen: a turn means it bounced and can hurt us */
  private ownDir = new Map<number, number>();
  private rodSeen: { a: number; time: number } | null = null;
  private rodRate: number | undefined;

  constructor(private readonly selfId: string, private readonly tickRate: number, private readonly allyIds: ReadonlySet<string>) {}

  markFired(time: number): void {
    this.firedAt = time;
  }

  update(s: DashState, tick: number, recvMs: number): World {
    const time = tick / this.tickRate;
    let me: WCraft | null = null;
    const rivals: WCraft[] = [];
    const allies: WCraft[] = [];
    for (const p of s.players) {
      if (p.fin) continue;
      const tr = this.crafts.observe(p.id, p.x, p.y, time);
      const pp = polar(p.x, p.y);
      const c: WCraft = { ...p, vx: tr.vx, vy: tr.vy, speed: tr.known ? Math.hypot(tr.vx, tr.vy) : CRUISE, a: pp.a, r: pp.r };
      if (p.id === this.selfId) me = c;
      else if (this.allyIds.has(p.id)) allies.push(c);
      else rivals.push(c);
    }
    const m = me as WCraft | null;
    const missiles: World['missiles'] = [];
    const seen = new Set<number>();
    for (const q of s.missiles) {
      seen.add(q.id);
      if (!this.known.has(q.id) && m && time - this.firedAt < 0.3 && Math.hypot(q.x - m.x, q.y - m.y) < 120) this.own.add(q.id);
      this.known.add(q.id);
      if (this.own.has(q.id) && !this.bounced(q)) continue;
      const pp = polar(q.x, q.y);
      missiles.push({ a: pp.a, r: pp.r, x: q.x, y: q.y, vx: q.vx, vy: q.vy });
    }
    for (const id of this.known) if (!seen.has(id)) (this.known.delete(id), this.own.delete(id), this.ownDir.delete(id));
    const rods = s.rods;
    if (rods) {
      // the hub turns against the lap direction at the host's rodSpeed (the snapshot angle is not wrapped)
      const prev = this.rodSeen;
      if (prev && time > prev.time) {
        const rate = (prev.a - rods.a) / (time - prev.time);
        if (rate >= 0 && rate < 3) this.rodRate = rate;
      }
      this.rodSeen = { a: rods.a, time };
    }
    const blobs: World['blobs'] = [];
    const bseen = new Set<number | string>();
    for (const b of s.blobs ?? []) {
      bseen.add(b.id);
      const tr = this.blobs.observe(b.id, b.x, b.y, time);
      if (tr.known) blobs.push({ x: b.x, y: b.y, vx: tr.vx, vy: tr.vy });
    }
    this.blobs.prune(bseen);
    return { tick, time, recvMs, variant: s.variant, me: m, rivals, allies, missiles, blobs, rodSpeed: this.rodRate, state: s };
  }

  /** a missile we fired that has turned (wall bounce): it hurts its owner too from then on */
  private bounced(q: DashState['missiles'][number]): boolean {
    if (q.vx === undefined || q.vy === undefined) return false;
    const dir = Math.atan2(q.vy, q.vx);
    const first = this.ownDir.get(q.id);
    if (first === undefined) {
      this.ownDir.set(q.id, dir);
      return false;
    }
    return Math.abs(Math.atan2(Math.sin(dir - first), Math.cos(dir - first))) > 0.3;
  }
}
