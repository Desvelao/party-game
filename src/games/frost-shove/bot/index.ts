// Frost Shove game bot: perception (WorldModel), decision (policy + variant adapter), input assembly (buttons are
// read on their press edge), metrics and incident reports.
import type { AiContext, GameAi, GameBrain, Incident, StateMeta } from '../../../core/shared/ai';
import { EdgeButton, Lapses, ReactionBuffer } from '../../../core/shared/kit/humanize';
import { Ring } from '../../../core/shared/kit/ring';
import { mulberry32 } from '../../../core/shared/kit/util';
import type { GameEvent, InputState } from '../../../core/shared/types';
import type { FrostShoveState } from '../shared/types';
import { classifyFall, type RingEntry, type Seen } from './incidents';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { GreedyPolicy } from './policy/greedy';
import { SumoPolicy } from './policy/sumo';
import type { Decision, Policy } from './policy/types';
import { createAdapter, type VariantAdapter } from './variants';
import { WorldModel, type World } from './world';

const RING = 45;
const NONE: InputState = { mx: 0, my: 0, a1: false, a2: false };

export class FrostShoveBot implements GameBrain {
  private readonly model: WorldModel;
  private adapter: VariantAdapter | null = null;
  private variant = '';
  private readonly policyImpl: Policy;
  private readonly worlds = new ReactionBuffer<World>();
  private readonly rng: () => number;
  private readonly lapses: Lapses;
  /** the dash / throw button, and the climbing one (mashed) */
  private readonly button = new EdgeButton(70, 70);
  private readonly mash: EdgeButton;
  /** facing to hold while the button is down */
  private pressAim: number | null = null;
  private last: Decision | null = null;
  private lastIn: InputState = NONE;
  private readonly ring = new Ring<RingEntry>(RING);
  private seen: Seen[] = [];
  private time = 0;
  private lastDash = -Infinity;
  private wetSince = -1;
  private mashNext = 0;
  private m = { decisions: 0, dashes: 0, throws: 0, rescues: 0, falls: 0, climbs: 0, drowned: 0, pushesOut: 0, pickups: 0, lapses: 0 };

  constructor(private readonly ctx: AiContext, readonly policy: string) {
    this.rng = mulberry32((ctx.seed ^ 0x9e3779b9) >>> 0);
    this.lapses = new Lapses(this.rng);
    const P = ctx.params;
    this.mash = new EdgeButton(Math.max(30, 400 / Math.max(1, P.mash)), 30);
    this.model = new WorldModel(ctx.selfId, ctx.tickRate, new Set(ctx.allies ?? []), P.variantAware !== 0);
    this.policyImpl = policy === 'greedy' ? new GreedyPolicy() : new SumoPolicy(P, mulberry32(ctx.seed));
  }

  onState(state: FrostShoveState, meta: StateMeta): void {
    if (state.variant !== this.variant) {
      this.variant = state.variant;
      this.adapter = createAdapter(state.variant);
    }
    const w = this.model.update(state, meta.tick, meta.recvMs);
    this.time = w.time;
    this.worlds.push(w);
  }

  decide(nowMs: number): InputState {
    const P = this.ctx.params;
    const w = this.worlds.at(nowMs, P.reactionMs);
    const latest = this.worlds.latest;
    if (!w || !latest?.me) return NONE;
    // climbing out: mash, once the splash has been noticed (reaction time), at the level's rate
    if (latest.me.wet) {
      if (this.wetSince < 0) this.wetSince = nowMs;
      if (nowMs - this.wetSince >= P.reactionMs && nowMs >= this.mashNext) {
        this.mash.press(nowMs);
        this.mashNext = nowMs + (1000 / Math.max(0.5, P.mash)) * (0.8 + this.rng() * 0.4);
      }
      return { mx: 0, my: 0, a1: this.mash.down(nowMs), a2: false };
    }
    this.wetSince = -1;
    if (this.lapses.active(nowMs, P.lapse)) {
      this.m.lapses = this.lapses.count;
      return { ...this.lastIn, a1: false };
    }
    // the button is down: keep facing the way it was pressed
    if (this.button.down(nowMs)) return this.input(this.pressAim, this.lastIn, true);
    const d = this.policyImpl.decide(w, nowMs);
    if (this.adapter?.refine && P.variantAware !== 0) this.adapter.refine(w, d, P, nowMs, this.rng);
    this.last = d;
    this.m.decisions++;
    let press = false;
    if ((d.dash || d.press) && !(w.me && w.me.stun > 0) && this.button.ready(nowMs)) {
      press = this.button.press(nowMs);
      this.pressAim = d.aim;
      if (d.press) this.m.throws++;
      else {
        this.m.dashes++;
        if (d.mode === 'rescue') this.m.rescues++;
        this.lastDash = w.time;
      }
    }
    const me = w.me!;
    this.ring.push({ time: w.time, x: me.x, y: me.y, vx: Math.round(me.vx), vy: Math.round(me.vy), mode: d.mode, mx: +d.mx.toFixed(2), my: +d.my.toFixed(2), dash: press && d.dash, cost: Math.round(d.cost), target: d.target });
    return this.input(press ? d.aim : null, d, press);
  }

  /** stick (scaled by the level's speed) and button; a press points the stick along `aim` so the bear faces it */
  private input(aim: number | null, d: { mx: number; my: number }, a1: boolean): InputState {
    const s = this.ctx.params.speed;
    const inp: InputState = aim === null ? { mx: d.mx * s, my: d.my * s, a1, a2: false } : { mx: Math.cos(aim), my: Math.sin(aim), a1, a2: false };
    this.lastIn = inp;
    return inp;
  }

  onEvents(events: GameEvent[]): Incident[] {
    const out: Incident[] = [];
    const self = this.ctx.selfId;
    for (const ev of events) {
      if (ev.kind === 'splash') {
        if (ev.id === self) {
          this.m.falls++;
          out.push(classifyFall(self, this.ring.toArray(), this.seen, ev, this.time));
        } else if (this.time - this.lastDash <= 1) this.m.pushesOut++;
      } else if (ev.kind === 'eliminated' && ev.id === self) {
        // out in the water: the climb failed (a bomb elimination happens on the ice)
        if (this.worlds.latest?.me?.wet) this.m.drowned++;
      } else if (ev.kind === 'pickup' && ev.id === self) this.m.pickups++;
      this.seen.push({ time: this.time, ev });
    }
    this.m.climbs = Math.max(0, this.m.falls - this.m.drowned);
    while (this.seen.length && this.time - this.seen[0].time > 2) this.seen.shift();
    return out;
  }

  trace(): Record<string, unknown> | null {
    const d = this.last;
    const me = this.worlds.latest?.me;
    if (!d || !me) return null;
    return { x: me.x, y: me.y, vx: Math.round(me.vx), vy: Math.round(me.vy), st: me.st, mode: d.mode, target: d.target, mx: +d.mx.toFixed(2), my: +d.my.toFixed(2), ...d.info };
  }

  metrics(): Record<string, number> {
    const w = this.worlds.latest;
    return { ...this.m, alive: w?.me ? 1 : 0, rivalsLeft: w?.rivals.length ?? 0 };
  }
}

export const frostShove: GameAi = {
  id: 'frost-shove',
  kind: 'ext:frost-shove',
  policies: ['sumo', 'greedy'],
  defaultPolicy: 'sumo',
  defaultParams: DEFAULT_PARAMS,
  levels: LEVELS,
  defaultLevel: 'normal',
  create: (ctx, policy) => new FrostShoveBot(ctx, policy),
};
