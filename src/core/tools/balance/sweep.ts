import { ALL_PLAYABLES, ROUNDS_TO_WIN, effectiveDefaults, optionsFor, playerLimitOf, type OptionDef, type OptionValue } from '../../shared';
import type { PolicyName } from './bots';

/** Who plays: `random`/`greedy` fill every slot with that policy; `skill` puts one greedy bot among random ones; `idle` one idle bot among random ones. */
export type Scenario = 'random' | 'greedy' | 'skill' | 'idle';
export const SCENARIOS: Scenario[] = ['random', 'greedy', 'skill', 'idle'];

export interface RunSpec {
  variant: string;
  /** options that differ from the variant's defaults (the label of the sweep point) */
  options: Record<string, OptionValue>;
  playerCount: number;
  seed: number;
  scenario: Scenario;
}

export interface SweepArgs {
  variants: string[];
  players: number[];
  seeds: number;
  scenarios: Scenario[];
  /** also run each option at its min / max (numbers), each choice, and the flipped boolean */
  options: boolean;
}

/** Values to try for one option besides its default. */
export function alternatives(def: OptionDef): OptionValue[] {
  if (def.type === 'boolean') return [!def.default];
  if (def.type === 'choice') return (def.choices ?? []).map((c) => c.value).filter((v) => v !== def.default);
  const out = [def.min, def.max].filter((v): v is number => v !== undefined && v !== def.default);
  return [...new Set(out)];
}

/** Sweep points of one variant: the defaults, then every option moved on its own. */
export function optionPoints(variant: string, withOptions: boolean): Record<string, OptionValue>[] {
  const points: Record<string, OptionValue>[] = [{}];
  if (!withOptions) return points;
  const game = ALL_PLAYABLES.find((p) => p.id === variant)?.game ?? variant;
  const defs = optionsFor(game, ALL_PLAYABLES.some((p) => p.id === variant && p.game !== variant) ? variant : 'all');
  for (const def of defs) {
    if (def.id === ROUNDS_TO_WIN) continue; // a match setting, not a round one
    for (const v of alternatives(def)) points.push({ [def.id]: v });
  }
  return points;
}

/** The full option set a run plays with: defaults plus the sweep point. */
export function fullOptions(variant: string, point: Record<string, OptionValue>): Record<string, OptionValue> {
  return { ...effectiveDefaults(variant), ...point };
}

export function buildSweep(args: SweepArgs): RunSpec[] {
  const specs: RunSpec[] = [];
  for (const variant of args.variants) {
    const limit = playerLimitOf(variant);
    for (const options of optionPoints(variant, args.options)) {
      for (const playerCount of args.players) {
        if (limit !== undefined && playerCount > limit) continue;
        for (const scenario of args.scenarios) {
          for (let seed = 1; seed <= args.seeds; seed++) specs.push({ variant, options, playerCount, seed, scenario });
        }
      }
    }
  }
  return specs;
}

/** Policy of each slot in a run. The special bot's slot rotates with the seed so no slot is favoured. */
export function policiesFor(spec: RunSpec): PolicyName[] {
  const n = spec.playerCount;
  if (spec.scenario === 'random' || spec.scenario === 'greedy') return Array<PolicyName>(n).fill(spec.scenario);
  const special = spec.seed % n;
  return Array.from({ length: n }, (_, i) => (i !== special ? 'random' : spec.scenario === 'skill' ? 'greedy' : 'idle'));
}
