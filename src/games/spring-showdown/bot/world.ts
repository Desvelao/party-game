// Turns a Spring Showdown snapshot into the bot's view: own index and tile, rivals (teammates left out), the
// missiles it did not fire, and the hop time (a host option) measured from the hop progress.
import { POGO_DEFAULTS } from '../server/config';
import type { PogoPlayerState, PogoState } from '../shared/types';

export interface WPlayer extends PogoPlayerState {
  idx: number;
}

export interface World {
  tick: number;
  /** game time of the snapshot, s */
  time: number;
  recvMs: number;
  variant: string;
  n: number;
  tiles: number[];
  me: WPlayer | null;
  rivals: WPlayer[];
  /** player indexes of teammates (their squares count for the team) */
  allies: Set<number>;
  items: PogoState['items'];
  /** missiles that can hit us (ours are left out) */
  missiles: PogoState['missiles'];
  /** seconds per hop without boots (measured) */
  hopTime: number;
  state: PogoState;
}

export class WorldModel {
  hopTime = POGO_DEFAULTS.hopTime;
  private own = new Set<number>();
  private firedAt = -1;
  private prevHop = -1;
  private prevT = 0;

  constructor(private readonly selfId: string, private readonly tickRate: number, private readonly allyIds: ReadonlySet<string>) {}

  /** we just fired: missiles that show up next to us in the next moments are ours */
  markFired(time: number): void {
    this.firedAt = time;
  }

  update(s: PogoState, tick: number, recvMs: number): World {
    const time = tick / this.tickRate;
    let me: WPlayer | null = null;
    const rivals: WPlayer[] = [];
    const allies = new Set<number>();
    s.players.forEach((p, idx) => {
      if (p.gone) return;
      const w = { ...p, idx };
      if (p.id === this.selfId) me = w;
      else if (this.allyIds.has(p.id)) allies.add(idx);
      else rivals.push(w);
    });
    const m = me as WPlayer | null;
    if (m) this.learnHop(m, time);
    const missiles: World['missiles'] = [];
    const seen = new Set<number>();
    for (const mi of s.missiles) {
      seen.add(mi.id);
      if (!this.own.has(mi.id) && m && time - this.firedAt < 0.3 && Math.abs(mi.x - (m.c + 0.5)) < 2.5 && Math.abs(mi.y - (m.r + 0.5)) < 2.5) this.own.add(mi.id);
      if (!this.own.has(mi.id)) missiles.push(mi);
    }
    for (const id of this.own) if (!seen.has(id)) this.own.delete(id);
    return { tick, time, recvMs, variant: s.variant, n: s.size, tiles: s.tiles, me: m, rivals, allies, items: s.items, missiles, hopTime: this.hopTime, state: s };
  }

  /** hop progress grows by dt / hopDur: with boots off, that gives the host's hop time */
  private learnHop(me: WPlayer, time: number): void {
    if (me.hop < 1 && this.prevHop >= 0 && me.hop > this.prevHop && me.boots === 0) {
      const dt = time - this.prevT;
      const est = dt / (me.hop - this.prevHop);
      if (est > 0.1 && est < 1.5) this.hopTime += (est - this.hopTime) * 0.2;
    }
    this.prevHop = me.hop < 1 ? me.hop : -1;
    this.prevT = time;
  }
}
