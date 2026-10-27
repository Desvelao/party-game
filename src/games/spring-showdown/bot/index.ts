// Spring Showdown game bot: perception (WorldModel), decision (planner + variant rules), input assembly, metrics and
// incidents. It knows where it stands from the newest snapshot; the rest of the board it sees `reactionMs` late.
import type { AiContext, GameAi, GameBrain, Incident, StateMeta } from '../../../core/shared/ai';
import { EdgeButton, Lapses, ReactionBuffer } from '../../../core/shared/kit/humanize';
import { Ring } from '../../../core/shared/kit/ring';
import { mulberry32 } from '../../../core/shared/kit/util';
import type { GameEvent, InputState } from '../../../core/shared/types';
import { DX, DY } from '../server/SpringShowdown';
import type { PogoState } from '../shared/types';
import { classify, type RingEntry } from './incidents';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { GreedyPolicy } from './policy/greedy';
import { PlannerPolicy } from './policy/planner';
import type { Decision, Policy } from './policy/types';
import { createAdapter } from './variants';
import { WorldModel, type World } from './world';

const RING = 40;
const NONE: InputState = { mx: 0, my: 0, a1: false, a2: false };

export class PogoBot implements GameBrain {
  private readonly model: WorldModel;
  private readonly policyImpl: Policy;
  private readonly planner: PlannerPolicy | null = null;
  private readonly worlds = new ReactionBuffer<World>();
  private readonly rng: () => number;
  private readonly lapses: Lapses;
  private readonly button = new EdgeButton(60, 60);
  private variant = '';
  private fireDir = 0;
  private mushrooms = true;
  private lastIn: InputState = NONE;
  private last: Decision | null = null;
  private readonly ring = new Ring<RingEntry>(RING);
  private seen: { time: number; ev: GameEvent }[] = [];
  private time = 0;
  private m = { decisions: 0, hops: 0, banks: 0, fired: 0, stuns: 0, wipes: 0, pickups: 0, lapses: 0 };

  constructor(private readonly ctx: AiContext, readonly policy: string) {
    this.rng = mulberry32((ctx.seed ^ 0x9e3779b9) >>> 0);
    this.lapses = new Lapses(this.rng);
    this.model = new WorldModel(ctx.selfId, ctx.tickRate, new Set(ctx.allies ?? []));
    if (policy === 'greedy') this.policyImpl = new GreedyPolicy(ctx.selfId, this.rng);
    else this.policyImpl = this.planner = new PlannerPolicy(ctx.params, mulberry32(ctx.seed), createAdapter(''));
  }

  onState(state: PogoState, meta: StateMeta): void {
    if (state.variant !== this.variant) {
      this.variant = state.variant;
      this.planner?.setAdapter(createAdapter(state.variant, this.ctx.params.variantAware !== 0));
      this.mushrooms = createAdapter(state.variant).rules.mushrooms;
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
    if (this.button.down(nowMs)) return this.stick(this.fireDir, true);
    if (this.lapses.active(nowMs, P.lapse)) {
      this.m.lapses = this.lapses.count;
      return { ...this.lastIn, a1: false };
    }
    // the board as seen late, ourselves as we are
    const view: World = env === latest ? env : { ...env, me: latest.me, hopTime: latest.hopTime, tiles: this.ownTilesNow(env, latest) };
    const d = this.policyImpl.decide(view, nowMs);
    this.last = d;
    this.m.decisions++;
    const me = latest.me;
    this.ring.push({ time: latest.time, c: me.c, r: me.r, dir: d.dir, mode: d.mode, value: +d.value.toFixed(2), tiles: me.tiles });
    // fire mid-hop (the stick then turns back before the landing picks the next hop), or when it is the way we go
    if (d.fire && this.button.ready(nowMs) && (me.hop < 0.7 || d.fireDir === d.dir)) {
      this.button.press(nowMs);
      this.fireDir = d.fireDir;
      this.model.markFired(latest.time);
      this.m.fired++;
      return this.stick(d.fireDir, true);
    }
    return this.stick(d.dir, false);
  }

  /** the late board, but with our own squares as they are now (a player knows what it just painted) */
  private ownTilesNow(env: World, latest: World): number[] {
    const me = latest.me!.idx;
    const out = env.tiles.slice();
    for (let i = 0; i < out.length; i++) if (out[i] === me || latest.tiles[i] === me) out[i] = latest.tiles[i];
    return out;
  }

  private stick(dir: number, a1: boolean): InputState {
    this.lastIn = dir < 0 ? { mx: 0, my: 0, a1, a2: false } : { mx: DX[dir], my: DY[dir], a1, a2: false };
    return this.lastIn;
  }

  onEvents(events: GameEvent[]): Incident[] {
    const out: Incident[] = [];
    const self = this.ctx.selfId;
    // the whole batch is on record first: the server emits a stun before the tnt / boom / zap that caused it
    for (const ev of events) this.seen.push({ time: this.time, ev });
    for (const ev of events) {
      if (ev.id === self) {
        if (ev.kind === 'bank') this.m.banks++;
        else if (ev.kind === 'stun') this.m.stuns++;
        else if (ev.kind === 'wipe') this.m.wipes++;
        else if (ev.kind === 'pickup') this.m.pickups++;
      }
      const inc = classify(self, ev, this.seen, this.ring.toArray(), this.time, this.mushrooms);
      if (inc) out.push(inc);
    }
    while (this.seen.length && this.time - this.seen[0].time > 2) this.seen.shift();
    return out;
  }

  trace(): Record<string, unknown> | null {
    const d = this.last;
    const me = this.worlds.latest?.me;
    if (!d || !me) return null;
    return { c: me.c, r: me.r, hop: me.hop, tiles: me.tiles, score: me.score, item: me.item, dir: d.dir, mode: d.mode, ...d.info };
  }

  metrics(): Record<string, number> {
    const me = this.worlds.latest?.me;
    return { ...this.m, score: me?.score ?? 0, tiles: me?.tiles ?? 0 };
  }
}

export const springShowdown: GameAi = {
  id: 'spring-showdown',
  kind: 'ext:spring-showdown',
  policies: ['planner', 'greedy'],
  defaultPolicy: 'planner',
  defaultParams: DEFAULT_PARAMS,
  levels: LEVELS,
  defaultLevel: 'normal',
  create: (ctx, policy) => new PogoBot(ctx, policy),
};
