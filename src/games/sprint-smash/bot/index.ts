// Sprint Smash game bot: perception (WorldModel), decision (racer + variant adapter), input assembly (the throttle is a
// hold and the item / jump a press of the same button: it is let go for one decision before a press), metrics and
// incidents.
import type { AiContext, GameAi, GameBrain, Incident, StateMeta } from '../../../core/shared/ai';
import { Lapses, ReactionBuffer } from '../../../core/shared/kit/humanize';
import { mulberry32 } from '../../../core/shared/kit/util';
import type { GameEvent, InputState } from '../../../core/shared/types';
import type { DashState } from '../shared/types';
import { classify, type RingEntry } from './incidents';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { BALL_R, BARREL_R, BLOB_R, MISSILE_R, ROD_HIT } from './physics';
import { GreedyPolicy } from './policy/greedy';
import { RacerPolicy } from './policy/racer';
import type { Decision, Policy } from './policy/types';
import { createAdapter, type VariantAdapter } from './variants';
import { WorldModel, type World } from './world';

const NONE: InputState = { mx: 0, my: 0, a1: false, a2: false };

export class SprintSmashBot implements GameBrain {
  private readonly model: WorldModel;
  private readonly policyImpl: Policy;
  private readonly racer: RacerPolicy | null = null;
  private adapter: VariantAdapter = createAdapter('');
  private variant = '';
  private readonly worlds = new ReactionBuffer<World>();
  private readonly rng: () => number;
  private readonly lapses: Lapses;
  /** a press is waiting for the button to be up */
  private pending = false;
  private lastIn: InputState = NONE;
  private last: Decision | null = null;
  private ring: RingEntry[] = [];
  private seen: { time: number; ev: GameEvent }[] = [];
  private time = 0;
  private m = { decisions: 0, items: 0, jumps: 0, knocks: 0, pickups: 0, lapses: 0 };

  constructor(private readonly ctx: AiContext, readonly policy: string) {
    this.rng = mulberry32((ctx.seed ^ 0x9e3779b9) >>> 0);
    this.lapses = new Lapses(this.rng);
    this.model = new WorldModel(ctx.selfId, ctx.tickRate, new Set(ctx.allies ?? []));
    if (policy === 'greedy') this.policyImpl = new GreedyPolicy();
    else this.policyImpl = this.racer = new RacerPolicy(ctx.params, mulberry32(ctx.seed), this.adapter);
  }

  onState(state: DashState, meta: StateMeta): void {
    if (state.variant !== this.variant) {
      this.variant = state.variant;
      this.adapter = createAdapter(state.variant, this.ctx.params.variantAware !== 0);
      this.racer?.setAdapter(this.adapter);
    }
    const w = this.model.update(state, meta.tick, meta.recvMs);
    this.time = w.time;
    this.worlds.push(w);
  }

  decide(nowMs: number): InputState {
    const P = this.ctx.params;
    const latest = this.worlds.latest;
    const env = this.worlds.at(nowMs, P.reactionMs);
    if (!latest?.me || !env) return NONE;
    if (this.lapses.active(nowMs, P.lapse)) {
      this.m.lapses = this.lapses.count;
      return { ...this.lastIn, a1: false, a2: false };
    }
    const view: World = env === latest ? env : { ...env, me: latest.me };
    const d = this.policyImpl.decide(view, nowMs);
    this.adapter.refine?.(view, d, P, nowMs, this.rng);
    this.last = d;
    this.m.decisions++;
    let a1 = d.throttle;
    let a2 = false;
    if (this.adapter.rules.item2) {
      // the item has its own button: a press edge on a2, the throttle stays a1
      if (d.press && !this.lastIn.a2) {
        a2 = true;
        if (d.mode === 'jump') this.m.jumps++;
        else this.m.items++;
        this.model.markFired(latest.time);
      }
    } else if (d.press || this.pending) {
      if (this.lastIn.a1) {
        // the press needs the button up first
        a1 = false;
        this.pending = true;
      } else {
        a1 = true;
        this.pending = false;
        if (latest.me.item) this.m.items++;
        else this.m.jumps++;
        this.model.markFired(latest.time);
      }
    }
    const me = latest.me;
    const near: string[] = [];
    for (const m of latest.missiles) if (Math.hypot(m.x - me.x, m.y - me.y) < MISSILE_R + 40) near.push('missile');
    for (const b of latest.state.balls ?? []) if (Math.hypot(b.x - me.x, b.y - me.y) < BALL_R + 40) near.push('lava');
    for (const b of latest.blobs) if (Math.hypot(b.x - me.x, b.y - me.y) < BLOB_R + 40) near.push('blob');
    if (latest.state.rods && latest.state.rods.tubes.some((e) => e > ROD_HIT)) near.push('rod');
    for (const b of latest.state.barrels ?? []) if (b.on && Math.hypot(b.x - me.x, b.y - me.y) < BARREL_R + 30) near.push('barrel');
    this.ring.push({ time: latest.time, x: me.x, y: me.y, a: +me.a.toFixed(2), r: Math.round(me.r), line: d.line, mode: d.mode, near });
    if (this.ring.length > 40) this.ring.shift();
    this.lastIn = { mx: d.mx, my: d.my, a1, a2 };
    return this.lastIn;
  }

  onEvents(events: GameEvent[]): Incident[] {
    const out: Incident[] = [];
    const self = this.ctx.selfId;
    for (const ev of events) {
      this.seen.push({ time: this.time, ev });
      if (ev.id === self && ev.kind === 'pickup') this.m.pickups++;
      const inc = classify(self, ev, this.seen, this.ring, this.time);
      if (inc) {
        this.m.knocks++;
        out.push(inc);
      }
    }
    while (this.seen.length && this.time - this.seen[0].time > 2) this.seen.shift();
    return out;
  }

  trace(): Record<string, unknown> | null {
    const d = this.last;
    const me = this.worlds.latest?.me;
    if (!d || !me) return null;
    return { x: me.x, y: me.y, laps: me.p, e: me.e, item: me.item, mode: d.mode, mx: +d.mx.toFixed(2), my: +d.my.toFixed(2), ...d.info };
  }

  metrics(): Record<string, number> {
    const me = this.worlds.latest?.state.players.find((p) => p.id === this.ctx.selfId);
    return { ...this.m, laps: me ? +me.p.toFixed(2) : 0, finished: me?.fin ? 1 : 0 };
  }
}

export const sprintSmash: GameAi = {
  id: 'sprint-smash',
  kind: 'ext:sprint-smash',
  policies: ['racer', 'greedy'],
  defaultPolicy: 'racer',
  defaultParams: DEFAULT_PARAMS,
  levels: LEVELS,
  defaultLevel: 'normal',
  create: (ctx, policy) => new SprintSmashBot(ctx, policy),
};
