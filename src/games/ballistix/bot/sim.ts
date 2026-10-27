// Headless Ballistix rounds with the bot in every seat (no server, no network): for tests and for comparing bots
// (`variantAware: 0` plays a variant as smash ball). Snapshots reach the bots every `snapEvery` ticks, like the network does.
import type { InputState } from '../../../core/shared/types';
import { VARIANTS, applyOptions, createBallArena } from '../server/arena';
import { BallistixBot } from './index';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';

export interface SimSeat {
  /** a LEVELS key (default: full strength) */
  level?: string;
  params?: Record<string, number>;
  policy?: 'predictive' | 'greedy';
}

export interface SimResult {
  /** per seat: 1 = best */
  places: number[];
  /** lives left per seat */
  lives: number[];
  seconds: number;
  /** goals conceded per seat */
  conceded: number[];
  /** why lives were lost, per seat: incident cause -> count */
  causes: Record<string, number>[];
  /** events by kind and seat (e.g. `pickup`, `catch`): kind -> count per seat */
  events: Record<string, number[]>;
}

const TICK = 60;

export function playRound(variant: string, seats: SimSeat[], opts: { options?: Record<string, number | boolean | string>; seed?: number; maxSeconds?: number; snapEvery?: number } = {}): SimResult {
  const v = VARIANTS.find((x) => x.id === variant);
  if (!v) throw new Error(`no variant ${variant}`);
  const seed = opts.seed ?? 1;
  const g = createBallArena(applyOptions(v, { timeLimit: 120, ...opts.options }), seed);
  const ids = seats.map((_, i) => `p${i}`);
  g.init(ids.map((id) => ({ id, name: id })));
  const snapEvery = opts.snapEvery ?? 2;
  const bots = seats.map((s, i) => {
    const params = { ...DEFAULT_PARAMS, ...(s.level ? LEVELS[s.level] : {}), ...s.params };
    return new BallistixBot({ selfId: ids[i], name: ids[i], tickRate: TICK, networkRate: TICK / snapEvery, seed: seed * 31 + i, params }, s.policy ?? 'predictive');
  });
  const causes: Record<string, number>[] = bots.map(() => ({}));
  const events: Record<string, number[]> = {};
  const inputs: InputState[] = bots.map(() => ({ mx: 0, my: 0, a1: false, a2: false }));
  const max = Math.round((opts.maxSeconds ?? 120) * TICK);
  let tick = 0;
  for (; tick < max && !g.isFinished(); tick++) {
    const nowMs = (tick * 1000) / TICK;
    if (tick % snapEvery === 0) {
      const st = g.getState();
      for (const b of bots) b.onState(st, { tick, phase: 'playing', recvMs: nowMs });
    }
    bots.forEach((b, i) => {
      inputs[i] = b.decide(nowMs);
      g.handleInput(ids[i], inputs[i]);
    });
    g.update(1 / TICK);
    for (const ev of g.drainEvents()) {
      const seat = ids.indexOf((ev as { id?: string }).id ?? '');
      if (seat >= 0) (events[ev.kind] ??= ids.map(() => 0))[seat]++;
      bots.forEach((b, i) => {
        for (const inc of b.onEvents([ev])) causes[i][inc.cause] = (causes[i][inc.cause] ?? 0) + 1;
      });
    }
  }
  const st = g.getState();
  const place = new Map(g.getPlacements().map((p) => [p.id, p.place]));
  const sideOf = new Map(st.paddles.map((p) => [p.id, p.side]));
  return {
    places: ids.map((id) => place.get(id) ?? 99),
    lives: ids.map((id) => st.sides[sideOf.get(id)!].lives),
    conceded: bots.map((b) => b.metrics().goalsConceded),
    causes,
    events,
    seconds: tick / TICK,
  };
}
