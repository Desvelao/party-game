import type { GameState } from '../../shared';
import { makeBot, DECISION_HZ, type Bot } from './bots';
import { mulberry32 } from '../../shared/kit/util';
import { botOf } from '../../server/minigames';
import { makeGame } from './factories';
import { fullOptions, policiesFor, type RunSpec, type Scenario } from './sweep';

const DT = 1 / 60;
const TICKS_PER_DECISION = Math.round(60 / DECISION_HZ);
/** Seconds past the time limit before a round that still has not ended counts as stuck. */
export const GRACE_SECONDS = 10;
const FALLBACK_LIMIT = 180;

export interface Row {
  variant: string;
  options: Record<string, number | boolean | string>;
  playerCount: number;
  seed: number;
  scenario: Scenario;
  policy: string;
  slot: number;
  place: number;
  /** how many players share first place; a round where all do is a draw, not a win */
  firstPlaces: number;
  durationSec: number;
  /** the round's time limit, s */
  limitSec: number;
  /** the simulation never finished (a bug or a stuck round), not a normal time-limit end */
  timedOut: boolean;
  /** hp / score / laps of the player at the end, when the game has one */
  metric: number | null;
}

/** Read the round length and a per-player number from whichever state the family has. */
export function limitOf(state: GameState, options: Record<string, unknown>): number {
  if ('limit' in state && typeof state.limit === 'number') return state.limit;
  return typeof options.timeLimit === 'number' ? options.timeLimit : FALLBACK_LIMIT;
}

function metricOf(state: GameState, id: string): number | null {
  if (!('players' in state)) return null;
  const p = (state.players as unknown as Record<string, unknown>[]).find((q) => q.id === id);
  if (!p) return null;
  for (const k of ['score', 'hp', 'p']) if (typeof p[k] === 'number') return p[k] as number;
  return null;
}

/** Play one seeded round start to finish and return one row per player. */
export function runOne(spec: RunSpec): Row[] {
  const options = fullOptions(spec.variant, spec.options);
  const game = makeGame(spec.variant, options, spec.seed);
  const ids = Array.from({ length: spec.playerCount }, (_, i) => `p${i}`);
  game.init(ids.map((id, i) => ({ id, name: `P${i}` })));
  const policies = policiesFor(spec);
  const bots: Bot[] = ids.map((id, i) => makeBot(policies[i], id, mulberry32((spec.seed * 7919 + i * 104729) >>> 0), botOf(spec.variant)));

  const first = game.getState();
  const limitSec = limitOf(first, options);
  const maxTicks = Math.ceil((limitSec + GRACE_SECONDS) / DT);
  let ticks = 0;
  while (!game.isFinished() && ticks < maxTicks) {
    if (ticks % TICKS_PER_DECISION === 0) {
      const state = game.getState();
      for (let i = 0; i < ids.length; i++) game.handleInput(ids[i], bots[i](state, ticks * DT));
    }
    game.update(DT);
    ticks++;
  }
  const timedOut = !game.isFinished();
  const state = game.getState();
  const place = new Map(timedOut ? [] : game.getPlacements().map((p) => [p.id, p.place] as const));
  const firstPlaces = ids.filter((id) => place.get(id) === 1).length || ids.length;
  return ids.map((id, i) => ({
    variant: spec.variant,
    options: spec.options,
    playerCount: spec.playerCount,
    seed: spec.seed,
    scenario: spec.scenario,
    policy: policies[i],
    slot: i,
    place: place.get(id) ?? spec.playerCount,
    firstPlaces,
    durationSec: Math.round(ticks * DT * 100) / 100,
    limitSec,
    timedOut,
    metric: metricOf(state, id),
  }));
}

