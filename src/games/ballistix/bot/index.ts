// Ballistix game bot: perception (WorldModel), decision (policy), input assembly, metrics and incident reports.
import { rotQuarter } from '../shared/geometry';
import type { BallArenaState } from '../shared/types';
import { WORLD_SIZE } from '../../../core/shared/constants';
import { Ring } from '../../../core/shared/kit/ring';
import { mulberry32 } from '../../../core/shared/kit/util';
import type { GameEvent, InputState } from '../../../core/shared/types';
import type { AiContext as BotContext, GameAi as GamePlugin, GameBrain as GameBot, Incident, StateMeta } from '../../../core/shared/ai';
import { classifyGoal, type RingEntry } from './incidents';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { GreedyPolicy } from './policy/greedy';
import { PredictivePolicy } from './policy/predictive';
import type { Decision, Policy } from './policy/types';
import { createAdapter, type VariantAdapter } from './variants';
import { WorldModel, type World } from './world';

const C = WORLD_SIZE / 2;
const RING = 45;
const SMASH_HOLD_MS = 100;
const SMASH_LOCK_MS = 400;

export class BallistixBot implements GameBot {
  private readonly model: WorldModel;
  /** what is specific to the variant being played; the variant is only known from the snapshots */
  private adapter: VariantAdapter | null = null;
  private variant = '';
  private readonly policyImpl: Policy;
  private world: World | null = null;
  /** recent worlds, newest last: the policy may be asked to decide from an older one (reaction time) */
  private worlds: World[] = [];
  private readonly rng: () => number;
  private lapseUntil = 0;
  private lastDecideMs = 0;
  private lastMx = 0;
  private last: Decision | null = null;
  private readonly ring = new Ring<RingEntry>(RING);
  private smashUntil = 0;
  private smashLock = 0;
  private m = { decisions: 0, hits: 0, smashes: 0, smashSaves: 0, smashOffence: 0, goalsConceded: 0, othersConceded: 0, opponentHits: 0, opponentGoalsAfterSmash: 0, idle: 0, lapses: 0 };
  private lastSmashTime = -Infinity;

  constructor(private readonly ctx: BotContext, readonly policy: string) {
    this.rng = mulberry32((ctx.seed ^ 0x9e3779b9) >>> 0);
    this.model = new WorldModel(ctx.selfId, ctx.tickRate, ctx.params.variantAware !== 0);
    this.policyImpl = policy === 'greedy' ? new GreedyPolicy() : new PredictivePolicy(ctx.params, mulberry32(ctx.seed));
  }

  onState(state: BallArenaState, meta: StateMeta): void {
    if (state.variant !== this.variant) {
      this.variant = state.variant;
      this.adapter = createAdapter(state.variant);
    }
    this.world = this.model.update(state, meta.tick, meta.recvMs);
    if (this.world) {
      this.worlds.push(this.world);
      if (this.worlds.length > 40) this.worlds.shift();
    }
  }

  decide(nowMs: number): InputState {
    const latest = this.world;
    if (!latest) return { mx: 0, my: 0, a1: false, a2: false };
    const P = this.ctx.params;
    // reaction time: act on the newest snapshot that is at least reactionMs old (or the oldest we have)
    let w = latest;
    if (P.reactionMs > 0) {
      w = this.worlds[0];
      for (const c of this.worlds) if (c.recvMs <= nowMs - P.reactionMs) w = c;
    }
    const dtS = Math.min(0.1, Math.max(0, (nowMs - this.lastDecideMs) / 1000));
    this.lastDecideMs = nowMs;
    if (P.lapse > 0 && nowMs >= this.lapseUntil && this.rng() < P.lapse * dtS) {
      this.lapseUntil = nowMs + 300 + this.rng() * 300;
      this.m.lapses++;
    }
    if (nowMs < this.lapseUntil) return { mx: this.lastMx, my: 0, a1: false, a2: false };
    const d = this.policyImpl.decide(w, nowMs);
    if (P.speed < 1) d.mx = Math.max(-P.speed, Math.min(P.speed, d.mx));
    this.lastMx = d.mx;
    this.last = d;
    this.m.decisions++;
    if (!d.threats.length) this.m.idle++;
    if (d.smash && nowMs >= this.smashLock) {
      this.smashUntil = nowMs + SMASH_HOLD_MS;
      this.smashLock = nowMs + SMASH_LOCK_MS;
      this.m.smashes++;
      if (d.info.smash === 'save') this.m.smashSaves++;
      else this.m.smashOffence++;
      this.lastSmashTime = w.time;
    }
    // the variant's own action (Sand Orb's magnet) on top of the shared decision; the rules (boost button) always apply
    if (this.adapter?.refine && P.variantAware !== 0) {
      this.adapter.refine(w, d, P, nowMs, this.rng);
      if (P.speed < 1) d.mx = Math.max(-P.speed, Math.min(P.speed, d.mx));
      this.lastMx = d.mx;
    }
    const press = nowMs < this.smashUntil;
    const boostOnA2 = this.adapter?.boostButton === 'a2';
    if (w.me) {
      this.ring.push({
        time: w.time,
        pos: w.me.pos,
        vel: w.me.vel,
        len: w.me.len,
        target: d.target,
        mx: d.mx,
        chosen: d.chosen,
        ready: w.me.ready,
        smash: press,
        threats: d.threats.slice(0, 3).map((t) => ({ id: t.id, t: +t.t.toFixed(3), x: +t.x.toFixed(1), slack: +t.slack.toFixed(3), bounces: t.bounces })),
        balls: w.balls.map((b) => ({ id: b.id, x: +b.x.toFixed(1), y: +b.y.toFixed(1), vx: Math.round(b.vx), vy: Math.round(b.vy) })),
      });
    }
    return { mx: d.mx, my: 0, a1: (!boostOnA2 && press) || !!d.hold, a2: boostOnA2 && press };
  }

  onEvents(events: GameEvent[]): Incident[] {
    const out: Incident[] = [];
    const w = this.world;
    for (const ev of events) {
      if (ev.kind === 'hit') {
        if (ev.id === this.ctx.selfId) this.m.hits++;
        else this.m.opponentHits++;
      }
      else if (ev.kind === 'goal') {
        // the server names the first paddle of the side that conceded, so teammates share one id
        const sideOwner = w?.state.paddles.find((p) => p.side === w.mySide)?.id ?? this.ctx.selfId;
        if (ev.id !== sideOwner) {
          this.m.othersConceded++;
          // a goal against someone else within 4 s of our boost: the boost probably scored
          if (w && w.time - this.lastSmashTime <= 4) this.m.opponentGoalsAfterSmash++;
          continue;
        }
        this.m.goalsConceded++;
        if (!w) continue;
        const [x, y] = rotQuarter(ev.x - C, ev.y - C, (4 - w.mySide) % 4);
        out.push(classifyGoal(this.ring.toArray(), { x, y }, w.env.r, w.time, this.ctx.params));
      }
    }
    return out;
  }

  trace(): Record<string, unknown> | null {
    const d = this.last;
    const w = this.world;
    if (!d || !w?.me) return null;
    const t0 = d.threats[0];
    return {
      pos: +w.me.pos.toFixed(1),
      vel: Math.round(w.me.vel),
      target: +d.target.toFixed(1),
      mx: d.mx,
      chosen: d.chosen,
      threats: d.threats.length,
      t0: t0 ? { id: t0.id, t: +t0.t.toFixed(3), x: +t0.x.toFixed(1), slack: +t0.slack.toFixed(3) } : null,
      lives: w.lives[0],
      ...d.info,
    };
  }

  metrics(): Record<string, number> {
    return {
      ...this.m,
      livesLeft: this.world?.lives[0] ?? 0,
      opponentLivesLeft: this.world ? Math.min(...this.world.lives.slice(1).filter((_, i) => this.world!.alive[i + 1]), 99) : 0,
      trackCorrected: this.model.corrected,
      trackFallback: this.model.fallback,
    };
  }
}

export const ballistix: GamePlugin = {
  id: 'ballistix',
  kind: 'ext:ballistix',
  policies: ['predictive', 'greedy'],
  defaultPolicy: 'predictive',
  defaultParams: DEFAULT_PARAMS,
  levels: LEVELS,
  defaultLevel: 'normal',
  create: (ctx, policy) => new BallistixBot(ctx, policy),
};
