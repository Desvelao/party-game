// Turns a Frost Shove snapshot into the bot's view: velocities estimated from positions, own bear, rivals (teammates
// left out), the ice ahead (the shrink of the coming second, the melting under Shadow Bear) and the variant's hazards.
import { EntityTracker } from '../../../core/shared/kit/track';
import type { FrostShoveState } from '../shared/types';
import { BOLT_WARN, C, MIN_RADIUS, globalRadius, margin, moveOf, type Move } from './physics';
import { physicsFor } from './variants';

export interface WBear {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  f: number;
  r: number;
  st: number;
  fx: string;
  /** Lightning or Weight in hand, and the share of its countdown left */
  carry: string;
  carryl: number;
  /** climb progress in the water (0 = on the ice) */
  fall: number;
  bomb: boolean;
  inv: boolean;
  /** seconds left stunned: the server ignores its stick and button meanwhile */
  stun: number;
  /** in the water: climbing (fall > 0), or just fell in (fall is still 0 then, but it is past the edge) */
  wet: boolean;
  known: boolean;
}

export interface World {
  tick: number;
  /** game time of the snapshot, s */
  time: number;
  recvMs: number;
  variant: string;
  me: WBear | null;
  /** living bears that are not us or a teammate */
  rivals: WBear[];
  allies: WBear[];
  /** ice radius per sector about a second ahead (what to stay inside) */
  sectors: number[];
  /** our movement: acceleration with our effect, plus the tilt push */
  move: Move;
  items: FrostShoveState['items'];
  /** bitmask of the wall slices still standing on the rim (0 = no wall, or a variant without one) */
  wall: number;
  /** the item beam while it can be walked into (aiming or live): its spot and radius; `bad` = it only gives bad power-ups */
  beam: { x: number; y: number; r: number; bad: boolean } | null;
  /** bolts to dodge: line, seconds until it fires (0 = on) */
  bolts: { a: number; d: number; tOn: number }[];
  /** thrown bombs with estimated velocity */
  flying: { x: number; y: number; vx: number; vy: number }[];
  state: FrostShoveState;
}

export class WorldModel {
  private bears = new EntityTracker(1e9);
  private bombs = new EntityTracker(1e9);
  private wasWet = new Map<string, boolean>();

  /** `aware` false: ignore everything variant-specific (the Frost Shove view of every variant, for A/B tests) */
  constructor(private readonly selfId: string, private readonly tickRate: number, private readonly allies: ReadonlySet<string>, private readonly aware = true) {}

  update(s: FrostShoveState, tick: number, recvMs: number): World {
    const time = tick / this.tickRate;
    const ph = this.aware ? physicsFor(s.variant) : {};
    let me: WBear | null = null;
    const rivals: WBear[] = [];
    const allies: WBear[] = [];
    for (const p of s.players) {
      if (!p.alive) {
        this.bears.reset(p.id);
        continue;
      }
      // a bear climbing out of the water reappears on the rim: its old track would give a huge velocity
      const wet = p.fall > 0 || margin(s.sectors, p.x, p.y, p.r) < 0;
      if (this.wasWet.get(p.id) === true && !wet) this.bears.reset(p.id);
      this.wasWet.set(p.id, wet);
      const tr = this.bears.observe(p.id, p.x, p.y, time);
      const b: WBear = { id: p.id, x: p.x, y: p.y, vx: tr.vx, vy: tr.vy, f: p.f, r: p.r, st: p.st, fx: p.fx, carry: p.carry, carryl: p.carryl, fall: p.fall, bomb: p.bomb, inv: p.inv, stun: p.stun, wet, known: tr.known };
      if (p.id === this.selfId) me = b;
      else if (this.allies.has(p.id)) allies.push(b);
      else rivals.push(b);
    }
    // the ice a second from now: the shrink, and the bites about to melt out of the rim
    const R = globalRadius(s.t + 1, s.limit);
    const sectors = s.sectors.map((r) => Math.min(r, R));
    if (ph.meltDepth && s.melts) {
      const n = sectors.length;
      // a warned bite is as good as gone: the bot keeps away from it already
      for (const m of s.melts) {
        for (const [o, w] of [[0, 1], [-1, 0.5], [1, 0.5]] as const) {
          const k = (m.i + o + n) % n;
          sectors[k] = Math.max(MIN_RADIUS, sectors[k] - ph.meltDepth * w);
        }
      }
    }
    const tilt = ph.tiltStrength ? { x: s.tilt.x * ph.tiltStrength, y: s.tilt.y * ph.tiltStrength } : { x: 0, y: 0 };
    const move = moveOf(me?.fx ?? '', tilt.x, tilt.y);
    const bolts: World['bolts'] = [];
    if (ph.bolts && s.bolts) for (const b of s.bolts) bolts.push({ a: b.a, d: b.d, tOn: b.on ? 0 : b.warn * BOLT_WARN });
    const flying: World['flying'] = [];
    if (ph.bombs && s.flying) {
      const seen = new Set<number | string>();
      for (const f of s.flying) {
        seen.add(f.id);
        const tr = this.bombs.observe(f.id, f.x, f.y, time);
        flying.push({ x: f.x, y: f.y, vx: tr.vx, vy: tr.vy });
      }
      this.bombs.prune(seen);
    }
    return { tick, time, recvMs, variant: s.variant, me, rivals, allies, sectors, move, items: s.items, beam: s.beam && (s.beam.ph === 'aim' || s.beam.ph === 'on') ? { x: s.beam.sx, y: s.beam.sy, r: s.beam.r, bad: !!ph.badBeam } : null, wall: ph.wall ? s.wall ?? 0 : 0, bolts, flying, state: s };
  }
}
