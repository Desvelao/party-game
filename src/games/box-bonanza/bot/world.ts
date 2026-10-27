// Turns a Box Bonanza snapshot into the bot's view: own player and velocity, rivals (teammates left out), crates with
// estimated velocities (and which ones we sent flying: a crate does not hurt its thrower), lit TNT, enemy shots,
// the penguin, the holes, the solid resting crates.
import { EntityTracker } from '../../../core/shared/kit/track';
import type { CratePlayerState, CrateState } from '../shared/types';
import { CX, CY, HOLD_DIST } from './physics';

export interface WPlayer extends CratePlayerState {
  vx: number;
  vy: number;
}

export interface WCrate {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  k: CrateState['crates'][number]['k'];
  fuse: number;
  moving: boolean;
  /** we threw or kicked it */
  mine: boolean;
}

export interface World {
  tick: number;
  time: number;
  recvMs: number;
  variant: string;
  me: WPlayer | null;
  rivals: WPlayer[];
  allies: WPlayer[];
  crates: WCrate[];
  /** lit TNT carried by others: where it is (in front of the carrier) and when it goes off */
  heldTnt: { x: number; y: number; fuse: number }[];
  shots: { x: number; y: number; vx: number; vy: number }[];
  penguin: { x: number; y: number; r: number; a: number } | null;
  state: CrateState;
}

export class WorldModel {
  private players = new EntityTracker(1e9);
  private crates = new EntityTracker(1e9);
  private shots = new EntityTracker(1e9);
  private mine = new Map<number, number>();
  private ownShots = new Set<number>();
  private firedAt = -1;

  constructor(private readonly selfId: string, private readonly tickRate: number, private readonly allyIds: ReadonlySet<string>) {}

  /** we threw or kicked: crates that start moving near us in the next moments are ours */
  markLaunch(time: number): void {
    this.firedAt = time;
  }

  update(s: CrateState, tick: number, recvMs: number): World {
    const time = tick / this.tickRate;
    let me: WPlayer | null = null;
    const rivals: WPlayer[] = [];
    const allies: WPlayer[] = [];
    for (const p of s.players) {
      if (!p.alive) continue;
      const tr = this.players.observe(p.id, p.x, p.y, time);
      const w: WPlayer = { ...p, vx: tr.vx, vy: tr.vy };
      if (p.id === this.selfId) me = w;
      else if (this.allyIds.has(p.id)) allies.push(w);
      else rivals.push(w);
    }
    const m = me as WPlayer | null;
    const crates: WCrate[] = [];
    const seen = new Set<number | string>();
    for (const c of s.crates) {
      seen.add(c.id);
      const tr = this.crates.observe(c.id, c.x, c.y, time);
      if (c.moving && m && time - this.firedAt < 0.4 && Math.hypot(c.x - m.x, c.y - m.y) < 160 && !this.mine.has(c.id)) this.mine.set(c.id, time);
      if (!c.moving) this.mine.delete(c.id);
      crates.push({ id: c.id, x: c.x, y: c.y, vx: tr.vx, vy: tr.vy, k: c.k, fuse: c.fuse, moving: c.moving, mine: this.mine.has(c.id) });
    }
    this.crates.prune(seen);
    for (const id of this.mine.keys()) if (!seen.has(id)) this.mine.delete(id);
    const heldTnt: World['heldTnt'] = [];
    for (const p of [...rivals, ...allies]) {
      if (p.hold === 'tnt' && p.holdFuse >= 0) heldTnt.push({ x: p.x + Math.cos(p.f) * HOLD_DIST, y: p.y + Math.sin(p.f) * HOLD_DIST, fuse: p.holdFuse });
    }
    const shots: World['shots'] = [];
    const sseen = new Set<number | string>();
    for (const q of s.shots) {
      if (q.k === 'ring') continue;
      sseen.add(q.id);
      const tr = this.shots.observe(q.id, q.x, q.y, time);
      if (m && !this.ownShots.has(q.id) && !tr.known && time - this.firedAt < 0.3 && Math.hypot(q.x - m.x, q.y - m.y) < 60) this.ownShots.add(q.id);
      if (!this.ownShots.has(q.id) && tr.known) shots.push({ x: q.x, y: q.y, vx: tr.vx, vy: tr.vy });
    }
    this.shots.prune(sseen);
    for (const id of this.ownShots) if (!sseen.has(id)) this.ownShots.delete(id);
    let penguin: World['penguin'] = null;
    if (s.penguin?.awake) penguin = { x: s.penguin.x, y: s.penguin.y, r: Math.hypot(s.penguin.x - CX, s.penguin.y - CY), a: s.penguin.a };
    return { tick, time, recvMs, variant: s.variant, me: m, rivals, allies, crates, heldTnt, shots, penguin, state: s };
  }
}
