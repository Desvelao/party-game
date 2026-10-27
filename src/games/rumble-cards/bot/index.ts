// Rumble Cards game bot. The policy picks a play (card and target); the driver below works the controls a phone has:
// left/right moves the selected card, up/down the aimed rival, A plays, B ends the turn. The game reads presses (a
// change from the centre), so every step is a press followed by a release, and the bot waits to see it applied (its
// private hand shows the selection, the state shows the aim) before the next one.
import type { AiContext, GameAi, GameBrain, Incident, StateMeta } from '../../../core/shared/ai';
import { Lapses } from '../../../core/shared/kit/humanize';
import { mulberry32 } from '../../../core/shared/kit/util';
import type { GameEvent, InputState } from '../../../core/shared/types';
import type { CardsPrivate, CardsState } from '../shared/types';
import { incident, type RingEntry } from './incidents';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { GreedyPolicy } from './policy/greedy';
import { PlannerPolicy } from './policy/planner';
import type { Plan, Policy } from './policy/types';
import { WorldModel, guard, type World } from './world';

const NONE: InputState = { mx: 0, my: 0, a1: false, a2: false };
/** longest wait for a press to show before trying again */
const CONFIRM_MS = 450;

type Want = { kind: 'cur'; v: number } | { kind: 'aim'; v: string } | { kind: 'play'; made: number; hand: number } | { kind: 'discard'; hand: number } | { kind: 'end' };

export class RumbleCardsBot implements GameBrain {
  private readonly model: WorldModel;
  private readonly policyImpl: Policy;
  private readonly rng: () => number;
  private readonly lapses: Lapses;
  private world: World | null = null;
  private plan: Plan | null = null;
  private want: Want | null = null;
  private wantSince = 0;
  /** the last input sent was a press: release next */
  private pressed = false;
  private thinkUntil = -1;
  private wasTurn = false;
  private playsPressed = 0;
  private ring: RingEntry[] = [];
  private m = { turns: 0, plays: 0, discards: 0, ends: 0, mistakes: 0, timeouts: 0, knockouts: 0, steps: 0, lapses: 0 };

  constructor(private readonly ctx: AiContext, readonly policy: string) {
    this.rng = mulberry32((ctx.seed ^ 0x9e3779b9) >>> 0);
    this.lapses = new Lapses(this.rng);
    this.model = new WorldModel(ctx.selfId, new Set(ctx.allies ?? []));
    this.policyImpl = policy === 'greedy' ? new GreedyPolicy() : new PlannerPolicy(ctx.params, mulberry32(ctx.seed));
  }

  onPrivate(data: unknown): void {
    this.model.setPrivate(data as CardsPrivate | null);
    if (this.world) this.world = this.model.update(this.world.state, this.world.tick, this.world.recvMs);
  }

  onState(state: CardsState, meta: StateMeta): void {
    this.world = this.model.update(state, meta.tick, meta.recvMs);
  }

  decide(nowMs: number): InputState {
    const w = this.world;
    if (!w?.me) return NONE;
    // a press is always followed by a release (the game only counts a change from the centre)
    if (this.pressed) {
      this.pressed = false;
      return NONE;
    }
    if (!w.myTurn) {
      this.wasTurn = false;
      this.plan = null;
      this.want = null;
      return NONE;
    }
    const P = this.ctx.params;
    if (!this.wasTurn) {
      this.wasTurn = true;
      this.m.turns++;
      this.playsPressed = 0;
      this.thinkUntil = nowMs + this.think();
    }
    if (this.lapses.active(nowMs, P.lapse)) {
      this.m.lapses = this.lapses.count;
      return NONE;
    }
    if (this.want && !this.done(w, this.want) && nowMs - this.wantSince < CONFIRM_MS) return NONE;
    if ((this.want?.kind === 'play' || this.want?.kind === 'discard') && this.done(w, this.want)) {
      // a card was played: think again before the next one
      this.plan = null;
      this.thinkUntil = nowMs + this.think();
    }
    this.want = null;
    // over the hand limit: whatever was planned, the next thing to do is to discard (and back to normal once done)
    if (w.state.purge > 0 && this.plan?.kind !== 'discard') this.plan = null;
    else if (w.state.purge === 0 && this.plan?.kind === 'discard') this.plan = null;
    // hurry when the turn timer runs low
    if (nowMs < this.thinkUntil && w.state.tt > 2.5) return NONE;
    if (!this.plan) {
      this.plan = this.policyImpl.next(w);
      if (!this.plan) return NONE;
      if (this.plan.kind === 'play' && this.plan.why === 'mistake') this.m.mistakes++;
      this.ring.push({ t: w.state.t, hp: w.me.hp, guard: guard(w.me), plan: this.plan.kind === 'play' ? `${w.hand[this.plan.card]}@${this.plan.target || '-'} ${this.plan.why}` : this.plan.kind === 'discard' ? `discard ${w.hand[this.plan.card]} ${this.plan.why}` : `end ${this.plan.why}`, hand: w.hand.slice() });
      if (this.ring.length > 20) this.ring.shift();
    }
    return this.step(w, this.plan, nowMs);
  }

  /** ms to think before a play */
  private think(): number {
    return this.ctx.params.thinkMs * (0.6 + this.rng() * 0.8);
  }

  private done(w: World, want: Want): boolean {
    switch (want.kind) {
      case 'cur':
        return w.cur === want.v;
      case 'aim':
        return w.state.aim === want.v;
      case 'play':
        return w.state.made !== want.made || w.hand.length !== want.hand || !w.myTurn;
      case 'discard':
        return w.hand.length !== want.hand || !w.myTurn;
      case 'end':
        return !w.myTurn || w.state.purge > 0;
    }
  }

  /** the next control press towards the plan */
  private step(w: World, plan: Plan, nowMs: number): InputState {
    this.m.steps++;
    if (plan.kind === 'end') {
      if (w.state.made < 1) {
        this.plan = null;
        return NONE;
      }
      this.m.ends++;
      return this.press({ kind: 'end' }, nowMs, { ...NONE, a2: true });
    }
    if (plan.card >= w.hand.length) {
      this.plan = null;
      return NONE;
    }
    if (w.cur !== plan.card) {
      const n = w.hand.length;
      const fwd = (plan.card - w.cur + n) % n;
      const dx = fwd <= n - fwd ? 1 : -1;
      return this.press({ kind: 'cur', v: (w.cur + dx + n) % n }, nowMs, { ...NONE, mx: dx });
    }
    if (plan.kind === 'discard') {
      this.m.discards++;
      return this.press({ kind: 'discard', hand: w.hand.length }, nowMs, { ...NONE, a1: true });
    }
    if (plan.target && w.state.aim !== plan.target && w.others.length > 1) {
      const order = w.others.map((o) => o.id);
      const i = Math.max(0, order.indexOf(w.state.aim));
      const j = order.indexOf(plan.target);
      if (j < 0) {
        this.plan = null;
        return NONE;
      }
      const n = order.length;
      const dy = (j - i + n) % n <= (i - j + n) % n ? 1 : -1;
      return this.press({ kind: 'aim', v: order[(i + dy + n) % n] }, nowMs, { ...NONE, my: dy });
    }
    this.m.plays++;
    this.playsPressed++;
    return this.press({ kind: 'play', made: w.state.made, hand: w.hand.length }, nowMs, { ...NONE, a1: true });
  }

  private press(want: Want, nowMs: number, input: InputState): InputState {
    this.want = want;
    this.wantSince = nowMs;
    this.pressed = true;
    return input;
  }

  onEvents(events: GameEvent[]): Incident[] {
    const out: Incident[] = [];
    const self = this.ctx.selfId;
    const t = this.world?.state.t ?? 0;
    for (const ev of events) {
      if (ev.kind === 'eliminated') {
        if (ev.id === self) out.push(incident('knocked-out', t, this.ring));
        else if (this.world?.myTurn) this.m.knockouts++;
      } else if (ev.kind === 'ext:play' && ev.id === self && this.playsPressed === 0 && (this.world?.state.tt ?? 99) < 1) {
        // we pressed nothing this turn and a card of ours was played: the turn timer ran out
        this.m.timeouts++;
        out.push(incident('turn-timeout', t, this.ring, { tt: this.world?.state.tt }));
      }
    }
    return out;
  }

  trace(): Record<string, unknown> | null {
    const w = this.world;
    if (!w?.me || !w.myTurn) return null;
    const p = this.plan;
    return { hp: w.me.hp, hand: w.hand, cur: w.cur, aim: w.state.aim, tt: w.state.tt, plan: p ? (p.kind === 'play' ? { card: p.card, target: p.target, why: p.why } : p.kind === 'discard' ? { discard: p.card, why: p.why } : 'end') : null, want: this.want?.kind ?? null };
  }

  metrics(): Record<string, number> {
    return { ...this.m, hpLeft: this.world?.me?.hp ?? 0 };
  }
}

export const rumbleCards: GameAi = {
  id: 'rumble-cards',
  kind: 'ext:rumble-cards',
  policies: ['planner', 'greedy'],
  defaultPolicy: 'planner',
  defaultParams: DEFAULT_PARAMS,
  levels: LEVELS,
  defaultLevel: 'normal',
  create: (ctx, policy) => new RumbleCardsBot(ctx, policy),
};
