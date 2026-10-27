// Tank Wars game bot: perception (WorldModel), decision (tactician + variant adapter), input assembly (the cannon
// is held, items and mines are presses, the Swamp Fox shield is a hold), metrics and incidents.
import type { AiContext, GameAi, GameBrain, Incident, StateMeta } from '../../../core/shared/ai';
import { EdgeButton, Lapses, ReactionBuffer } from '../../../core/shared/kit/humanize';
import { mulberry32 } from '../../../core/shared/kit/util';
import type { GameEvent, InputState } from '../../../core/shared/types';
import type { TankState } from '../shared/types';
import { classifyHit, type RingEntry } from './incidents';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { GreedyPolicy } from './policy/greedy';
import { TacticianPolicy } from './policy/tactician';
import type { Decision, Policy } from './policy/types';
import { createAdapter, type VariantAdapter } from './variants';
import { WorldModel, type World } from './world';

const NONE: InputState = { mx: 0, my: 0, a1: false, a2: false };

export class TankWarsBot implements GameBrain {
  private readonly model: WorldModel;
  private readonly policyImpl: Policy;
  private adapter: VariantAdapter | null = null;
  private variant = '';
  private readonly worlds = new ReactionBuffer<World>();
  private readonly rng: () => number;
  private readonly lapses: Lapses;
  /** a1 for items (the cannon is a hold: an item press needs a1 up first) and a2 for mines */
  private readonly itemBtn = new EdgeButton(60, 60);
  private readonly mineBtn = new EdgeButton(80, 60);
  private lastIn: InputState = NONE;
  private last: Decision | null = null;
  private ring: RingEntry[] = [];
  private seen: { time: number; ev: GameEvent }[] = [];
  private shotSeen = new Map<number, number>();
  private myMines: { x: number; y: number; time: number }[] = [];
  private time = 0;
  private m = { decisions: 0, fired: 0, hitsTaken: 0, items: 0, minesDropped: 0, shieldBlocks: 0, lapses: 0 };

  constructor(private readonly ctx: AiContext, readonly policy: string) {
    this.rng = mulberry32((ctx.seed ^ 0x9e3779b9) >>> 0);
    this.lapses = new Lapses(this.rng);
    this.model = new WorldModel(ctx.selfId, ctx.tickRate, new Set(ctx.allies ?? []));
    this.policyImpl = policy === 'greedy' ? new GreedyPolicy() : new TacticianPolicy(ctx.params, mulberry32(ctx.seed));
  }

  onState(state: TankState, meta: StateMeta): void {
    if (state.variant !== this.variant) {
      this.variant = state.variant;
      this.adapter = createAdapter(state.variant);
    }
    const w = this.model.update(state, meta.tick, meta.recvMs);
    this.time = w.time;
    this.policyImpl.prepare?.(w);
    for (const s of w.shots) if (!this.shotSeen.has(s.id)) this.shotSeen.set(s.id, w.time);
    if (this.shotSeen.size > 64) for (const [id, t] of this.shotSeen) if (w.time - t > 6) this.shotSeen.delete(id);
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
    const view: World = env === latest ? env : { ...env, me: latest.me, glide: latest.glide };
    const d = this.policyImpl.decide(view, nowMs);
    if (this.adapter?.refine) this.adapter.refine(view, d, P, nowMs, this.rng);
    this.last = d;
    this.m.decisions++;
    let a1 = d.fire;
    // an item is a press of a1: let go of the cannon for one decision, then press
    if (d.item && this.itemBtn.ready(nowMs) && !this.lastIn.a1) {
      this.itemBtn.press(nowMs);
      this.m.items++;
    } else if (d.item && this.lastIn.a1) a1 = false;
    if (this.itemBtn.down(nowMs)) a1 = true;
    let a2 = d.holdA2;
    if (!d.holdA2 && d.mine && this.mineBtn.ready(nowMs)) {
      this.mineBtn.press(nowMs);
      this.m.minesDropped++;
      this.myMines.push({ x: latest.me.x, y: latest.me.y, time: latest.time });
      if (this.myMines.length > 8) this.myMines.shift();
    }
    if (this.mineBtn.down(nowMs)) a2 = true;
    const me = latest.me;
    this.ring.push({
      time: latest.time,
      x: me.x,
      y: me.y,
      mode: d.mode,
      mx: +d.mx.toFixed(2),
      my: +d.my.toFixed(2),
      fire: a1,
      cost: +d.cost.toFixed(2),
      near: latest.shots.filter((s) => Math.hypot(s.x - me.x, s.y - me.y) < 200).map((s) => s.id),
    });
    if (this.ring.length > 40) this.ring.shift();
    this.lastIn = { mx: d.mx, my: d.my, a1, a2 };
    return this.lastIn;
  }

  onEvents(events: GameEvent[]): Incident[] {
    const out: Incident[] = [];
    const self = this.ctx.selfId;
    for (const ev of events) {
      this.seen.push({ time: this.time, ev });
      if (ev.id !== self) continue;
      if (ev.kind === 'throw') this.m.fired++;
      else if (ev.kind === 'zap') this.m.shieldBlocks++;
      else if (ev.kind === 'hit') {
        this.m.hitsTaken++;
        out.push(classifyHit(ev, this.seen, this.ring, this.myMines, this.shotSeen, this.time));
      }
    }
    while (this.seen.length && this.time - this.seen[0].time > 2) this.seen.shift();
    return out;
  }

  trace(): Record<string, unknown> | null {
    const d = this.last;
    const me = this.worlds.latest?.me;
    if (!d || !me) return null;
    return { x: me.x, y: me.y, hp: me.hp, mode: d.mode, target: d.target, goal: d.goal, mx: +d.mx.toFixed(2), my: +d.my.toFixed(2), fire: d.fire, ...d.info };
  }

  metrics(): Record<string, number> {
    return { ...this.m, hpLeft: this.worlds.latest?.me?.hp ?? 0 };
  }
}

export const tankWars: GameAi = {
  id: 'tank-wars',
  kind: 'ext:tank-wars',
  policies: ['tactician', 'greedy'],
  defaultPolicy: 'tactician',
  defaultParams: DEFAULT_PARAMS,
  levels: LEVELS,
  defaultLevel: 'normal',
  create: (ctx, policy) => new TankWarsBot(ctx, policy),
};
