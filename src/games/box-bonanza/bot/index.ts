// Box Bonanza game bot: perception (WorldModel), decision (brawler + variant rules), input assembly (both buttons are
// presses; a press faces the stick, so the stick points the way to throw), metrics and incidents.
import type { AiContext, GameAi, GameBrain, Incident, StateMeta } from '../../../core/shared/ai';
import { EdgeButton, Lapses, ReactionBuffer } from '../../../core/shared/kit/humanize';
import { mulberry32 } from '../../../core/shared/kit/util';
import type { GameEvent, InputState } from '../../../core/shared/types';
import type { CrateState } from '../shared/types';
import { classify, type RingEntry } from './incidents';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { BrawlerPolicy } from './policy/brawler';
import { GreedyPolicy } from './policy/greedy';
import type { Decision, Policy } from './policy/types';
import { createAdapter } from './variants';
import { WorldModel, type World } from './world';

const NONE: InputState = { mx: 0, my: 0, a1: false, a2: false };

export class BoxBonanzaBot implements GameBrain {
  private readonly model: WorldModel;
  private readonly policyImpl: Policy;
  private readonly brawler: BrawlerPolicy | null = null;
  private readonly worlds = new ReactionBuffer<World>();
  private readonly rng: () => number;
  private readonly lapses: Lapses;
  private readonly a1 = new EdgeButton(60, 60);
  private readonly a2 = new EdgeButton(60, 60);
  private pressAim: number | null = null;
  private variant = '';
  private lastIn: InputState = NONE;
  private last: Decision | null = null;
  private ring: RingEntry[] = [];
  private seen: { time: number; ev: GameEvent }[] = [];
  private time = 0;
  private m = { decisions: 0, throws: 0, pickups: 0, kicks: 0, weapons: 0, hitsTaken: 0, masked: 0, heals: 0, lapses: 0 };

  constructor(private readonly ctx: AiContext, readonly policy: string) {
    this.rng = mulberry32((ctx.seed ^ 0x9e3779b9) >>> 0);
    this.lapses = new Lapses(this.rng);
    this.model = new WorldModel(ctx.selfId, ctx.tickRate, new Set(ctx.allies ?? []));
    if (policy === 'greedy') this.policyImpl = new GreedyPolicy();
    else this.policyImpl = this.brawler = new BrawlerPolicy(ctx.params, mulberry32(ctx.seed), createAdapter(''));
  }

  onState(state: CrateState, meta: StateMeta): void {
    if (state.variant !== this.variant) {
      this.variant = state.variant;
      this.brawler?.setAdapter(createAdapter(state.variant, this.ctx.params.variantAware !== 0));
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
    // a press faces the way it was aimed until it is released
    if (this.a1.down(nowMs) || this.a2.down(nowMs)) return this.out(this.pressAim, this.lastIn, this.a1.down(nowMs), this.a2.down(nowMs));
    if (this.lapses.active(nowMs, P.lapse)) {
      this.m.lapses = this.lapses.count;
      return { ...this.lastIn, a1: false, a2: false };
    }
    const view: World = env === latest ? env : { ...env, me: latest.me };
    const d = this.policyImpl.decide(view, nowMs);
    this.last = d;
    this.m.decisions++;
    let p1 = false;
    let p2 = false;
    if (d.act && this.a1.ready(nowMs)) {
      p1 = this.a1.press(nowMs);
      if (d.mode === 'throw' || d.mode === 'weapon') this.model.markLaunch(latest.time);
    }
    if (d.kick && this.a2.ready(nowMs)) {
      p2 = this.a2.press(nowMs);
      this.model.markLaunch(latest.time);
    }
    this.pressAim = p1 ? d.aim : null;
    const me = latest.me;
    this.ring.push({ time: latest.time, x: me.x, y: me.y, hp: me.hp, mode: d.mode, mx: +d.mx.toFixed(2), my: +d.my.toFixed(2), cost: +d.cost.toFixed(2), flying: latest.crates.filter((c) => c.moving && !c.mine && Math.hypot(c.x - me.x, c.y - me.y) < 200).length });
    if (this.ring.length > 40) this.ring.shift();
    return this.out(this.pressAim, d, p1, p2);
  }

  private out(aim: number | null, d: { mx: number; my: number }, a1: boolean, a2: boolean): InputState {
    this.lastIn = aim === null ? { mx: d.mx, my: d.my, a1, a2 } : { mx: Math.cos(aim), my: Math.sin(aim), a1, a2 };
    return this.lastIn;
  }

  onEvents(events: GameEvent[]): Incident[] {
    const out: Incident[] = [];
    const self = this.ctx.selfId;
    for (const ev of events) {
      this.seen.push({ time: this.time, ev });
      if (ev.id === self) {
        if (ev.kind === 'throw') this.m.throws++;
        else if (ev.kind === 'pickup') this.m.pickups++;
        else if (ev.kind === 'kick') this.m.kicks++;
        else if (ev.kind === 'rocket' || ev.kind === 'zap') this.m.weapons++;
        else if (ev.kind === 'hit') this.m.hitsTaken++;
        else if (ev.kind === 'crack') this.m.masked++;
        else if (ev.kind === 'heal') this.m.heals++;
      }
      if (ev.id === self || ev.kind === 'eliminated') {
        const inc = (ev.kind === 'hit' || ev.kind === 'crack' || ev.kind === 'eliminated') && ev.id === self ? classify(self, ev, this.seen, this.ring, this.time) : null;
        if (inc) out.push(inc);
      }
    }
    while (this.seen.length && this.time - this.seen[0].time > 2) this.seen.shift();
    return out;
  }

  trace(): Record<string, unknown> | null {
    const d = this.last;
    const me = this.worlds.latest?.me;
    if (!d || !me) return null;
    return { x: me.x, y: me.y, hp: me.hp, hold: me.hold, mode: d.mode, target: d.target, goal: d.goal, mx: +d.mx.toFixed(2), my: +d.my.toFixed(2), ...d.info };
  }

  metrics(): Record<string, number> {
    return { ...this.m, hpLeft: this.worlds.latest?.me?.hp ?? 0 };
  }
}

export const boxBonanza: GameAi = {
  id: 'box-bonanza',
  kind: 'ext:box-bonanza',
  policies: ['brawler', 'greedy'],
  defaultPolicy: 'brawler',
  defaultParams: DEFAULT_PARAMS,
  levels: LEVELS,
  defaultLevel: 'normal',
  create: (ctx, policy) => new BoxBonanzaBot(ctx, policy),
};
