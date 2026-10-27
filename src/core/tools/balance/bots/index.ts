import { NO_INPUT, type GameState, type InputState } from '../../../shared';
import { greedyGeneric } from './generic';

export type PolicyName = 'random' | 'idle' | 'greedy';
export const POLICY_NAMES: PolicyName[] = ['random', 'idle', 'greedy'];

/** Bots decide this many times per second; the input is held in between. */
export const DECISION_HZ = 10;

/** One bot: called at DECISION_HZ with the current state, returns the input to hold. */
export type Bot = (state: GameState, t: number) => InputState;

export function makeBot(policy: PolicyName, id: string, rng: () => number, packBot?: (state: GameState, id: string, rng: () => number) => InputState): Bot {
  if (policy === 'idle') return () => NO_INPUT;
  if (policy === 'random') return () => randomInput(rng);
  if (packBot) return (state) => packBot(state, id, rng);
  return (state) => greedyGeneric(state, id, rng);
}

/** A held direction (or standing still) with the buttons tapped at random. */
function randomInput(rng: () => number): InputState {
  const stand = rng() < 0.2;
  const a = rng() * Math.PI * 2;
  return { mx: stand ? 0 : Math.cos(a), my: stand ? 0 : Math.sin(a), a1: rng() < 0.3, a2: rng() < 0.1 };
}
