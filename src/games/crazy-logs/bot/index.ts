// Crazy Logs game bot: perception (WorldModel), decision (hopper policy), input assembly, metrics and incidents.
// Lapses keep the stick as it was. Its own position comes from the newest snapshot (a person knows where they stand); the river (spins, jets, other
// players) is seen `reactionMs` late.
import type { AiContext, GameAi, GameBrain, Incident, StateMeta } from '../../../core/shared/ai';
import { Lapses, ReactionBuffer } from '../../../core/shared/kit/humanize';
import { Ring } from '../../../core/shared/kit/ring';
import { mulberry32 } from '../../../core/shared/kit/util';
import type { GameEvent, InputState } from '../../../core/shared/types';
import type { LogsState } from '../shared/types';
import { classifySplash, type RingEntry } from './incidents';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { PLAYER_R } from './physics';
import { GreedyPolicy } from './policy/greedy';
import { HopperPolicy } from './policy/hopper';
import type { Decision, Policy } from './policy/types';
import { WorldModel, type World } from './world';

const RING = 45;
const NONE: InputState = { mx: 0, my: 0, a1: false, a2: false };

export class CrazyLogsBot implements GameBrain {
  private readonly model: WorldModel;
  private readonly policyImpl: Policy;
  private readonly worlds = new ReactionBuffer<World>();
  private readonly rng: () => number;
  private readonly lapses: Lapses;
  private readySince = -1;
  private hopLock = 0;
  private lastIn: InputState = NONE;
  private last: Decision | null = null;
  private readonly ring = new Ring<RingEntry>(RING);
  private seen: { time: number; ev: GameEvent }[] = [];
  private time = 0;
  private m = { decisions: 0, hops: 0, crossings: 0, falls: 0, lapses: 0 };

  constructor(private readonly ctx: AiContext, readonly policy: string) {
    this.rng = mulberry32((ctx.seed ^ 0x9e3779b9) >>> 0);
    this.lapses = new Lapses(this.rng);
    this.model = new WorldModel(ctx.selfId, ctx.tickRate);
    this.policyImpl = policy === 'greedy' ? new GreedyPolicy(ctx.selfId) : new HopperPolicy(ctx.params, mulberry32(ctx.seed));
  }

  onState(state: LogsState, meta: StateMeta): void {
    const w = this.model.update(state, meta.tick, meta.recvMs);
    this.time = w.time;
    this.worlds.push(w);
  }

  decide(nowMs: number): InputState {
    const P = this.ctx.params;
    const latest = this.worlds.latest;
    const env = this.worlds.at(nowMs, P.reactionMs);
    const me = latest?.me;
    if (!latest || !env || !me || !me.alive) return NONE;
    const grounded = me.h === 0 && me.w === 0;
    if (grounded && me.d >= 1 && nowMs >= this.hopLock) {
      if (this.readySince < 0) this.readySince = nowMs;
    } else this.readySince = -1;
    if (this.lapses.active(nowMs, P.lapse)) {
      // a person who drifts off keeps holding the stick as it was, and presses nothing
      this.m.lapses = this.lapses.count;
      return { ...this.lastIn, a1: false };
    }
    // the learned hop length and landing impulse are the newest, whatever the reaction time
    const view: World = env === latest ? env : { ...env, hop: latest.hop, landImpulse: latest.landImpulse };
    const d = this.policyImpl.decide(view, { me, ground: latest.ground, readyMs: this.readySince < 0 ? 0 : nowMs - this.readySince + 1 }, nowMs);
    this.last = d;
    this.m.decisions++;
    if (d.hop) {
      this.m.hops++;
      this.readySince = -1;
      // the next snapshots may still show it on the ground: one press per hop
      this.hopLock = nowMs + 150;
    }
    const row = latest.ground.kind === 'log' ? latest.ground.row : -1;
    this.ring.push({
      time: latest.time,
      x: me.x,
      y: me.y,
      air: me.h > 0,
      mode: d.mode,
      v: row >= 0 ? latest.rows[row].v : 0,
      mx: +d.mx.toFixed(2),
      my: +d.my.toFixed(2),
      ty: d.ty === null ? null : Math.round(d.ty),
      crowded: latest.others.some((o) => Math.hypot(o.x - me.x, o.y - me.y) < PLAYER_R * 2 + 4),
    });
    this.lastIn = { mx: d.mx, my: d.my, a1: d.hop || (nowMs < this.hopLock && nowMs > this.hopLock - 60), a2: false };
    return this.lastIn;
  }

  onEvents(events: GameEvent[]): Incident[] {
    const out: Incident[] = [];
    for (const ev of events) {
      this.seen.push({ time: this.time, ev });
      if (ev.id !== this.ctx.selfId) continue;
      if (ev.kind === 'bank') this.m.crossings++;
      else if (ev.kind === 'splash') {
        this.m.falls++;
        out.push(classifySplash(this.ring.toArray(), this.seen, ev, this.time));
      }
    }
    while (this.seen.length && this.time - this.seen[0].time > 2) this.seen.shift();
    return out;
  }

  trace(): Record<string, unknown> | null {
    const d = this.last;
    const me = this.worlds.latest?.me;
    if (!d || !me) return null;
    return { x: me.x, y: me.y, h: me.h, mode: d.mode, ty: d.ty === null ? null : Math.round(d.ty), mx: +d.mx.toFixed(2), my: +d.my.toFixed(2), hop: +(this.worlds.latest?.hop ?? 0).toFixed(1), ...d.info };
  }

  metrics(): Record<string, number> {
    return { ...this.m, score: this.worlds.latest?.me?.score ?? 0, hopLearned: Math.round(this.worlds.latest?.hop ?? 0) };
  }
}

export const crazyLogs: GameAi = {
  id: 'crazy-logs',
  kind: 'ext:crazy-logs',
  policies: ['hopper', 'greedy'],
  defaultPolicy: 'hopper',
  defaultParams: DEFAULT_PARAMS,
  levels: LEVELS,
  defaultLevel: 'normal',
  create: (ctx, policy) => new CrazyLogsBot(ctx, policy),
};
