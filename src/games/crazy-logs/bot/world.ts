// Turns a Crazy Logs snapshot into the bot's view: own player, the rows with their spin, the jets, other players on
// the ground, and the hop length and landing impulse learned from its own hops.
import type { LogsPlayerState, LogsState } from '../shared/types';
import { DEFAULT_HOP, DEFAULT_LAND_IMPULSE, groundAt, type Ground } from './physics';

export interface World {
  tick: number;
  /** game time of the snapshot, s */
  time: number;
  recvMs: number;
  me: LogsPlayerState | null;
  /** where we stand (when on the ground) */
  ground: Ground;
  rows: LogsState['rows'];
  half: number;
  jets: LogsState['jets'];
  /** other players on the ground (they shove) */
  others: { x: number; y: number }[];
  /** learned from our hops */
  hop: number;
  landImpulse: number;
  state: LogsState;
}

export class WorldModel {
  hop = DEFAULT_HOP;
  landImpulse = DEFAULT_LAND_IMPULSE;
  /** hop under way: where it started (progress 0) as extrapolated from a mid-air sample */
  private air: { x: number; y: number; h: number } | null = null;
  /** our landing to learn the impulse from: row, offset, row speed before */
  private landing: { row: number; offset: number; v: number } | null = null;
  private prev: LogsPlayerState | null = null;
  private prevRows: LogsState['rows'] = [];
  private hopsSeen = 0;

  constructor(private readonly selfId: string, private readonly tickRate: number) {}

  update(s: LogsState, tick: number, recvMs: number): World {
    const me = s.players.find((p) => p.id === this.selfId) ?? null;
    if (me) this.learn(me, s);
    const others: World['others'] = [];
    for (const p of s.players) if (p.id !== this.selfId && p.alive && p.h === 0 && p.w === 0) others.push({ x: p.x, y: p.y });
    const ground = me && me.h === 0 && me.w === 0 ? groundAt(me.x, me.y, s.rows, s.half) : { kind: 'water' as const };
    this.prev = me;
    this.prevRows = s.rows;
    return { tick, time: tick / this.tickRate, recvMs, me, ground, rows: s.rows, half: s.half, jets: s.jets, others, hop: this.hop, landImpulse: this.landImpulse, state: s };
  }

  /** hop length from two mid-air samples (the server moves a hop linearly with its progress); landing impulse from the row's spin change */
  private learn(me: LogsPlayerState, s: LogsState): void {
    const p = this.prev;
    if (me.h > 0 && p && p.h > 0 && me.h > p.h + 0.1 && me.w === 0) {
      const k = 1 / (me.h - p.h);
      const len = Math.hypot((me.x - p.x) * k, (me.y - p.y) * k);
      // jets shift a hop, and clamping at the world edge shortens it: only trust plausible lengths, and average
      if (len > 50 && len < 160) {
        this.hopsSeen++;
        this.hop += (len - this.hop) / Math.min(this.hopsSeen, 5);
      }
    }
    if (p && p.h > 0 && me.h === 0 && me.w === 0) {
      const g = groundAt(me.x, me.y, s.rows, s.half);
      if (g.kind === 'log') {
        const offset = Math.max(-1, Math.min(1, (me.y - s.rows[g.row].y) / s.half));
        this.landing = { row: g.row, offset, v: this.prevRows[g.row]?.v ?? 0 };
      }
    } else if (this.landing) {
      const l = this.landing;
      this.landing = null;
      // the impulse is offset * landImpulse, minus a few ms of decay; skip small offsets (noise) and spins at the cap
      if (Math.abs(l.offset) > 0.3) {
        const est = (s.rows[l.row].v - l.v) / l.offset;
        if (est > 0 && est < 400) this.landImpulse += (est - this.landImpulse) * 0.3;
      }
    }
  }
}
