import type { OptionDef } from './catalog';

/**
 * How the host UI groups a game's advanced options, the same five sections for every game:
 * what decides the match, how the player handles, active abilities, things that appear to
 * help or score, a power-up feature, and things that hurt or disturb.
 *
 * Keep the options of one variant feature (magnet, enemy, engines, power-up) in one group so a
 * feature is never split across sections.
 */
export type OptionGroup = 'match' | 'player' | 'abilities' | 'spawns' | 'powerups' | 'hazards';

export const OPTION_GROUPS: readonly OptionGroup[] = ['match', 'player', 'abilities', 'spawns', 'powerups', 'hazards'];

/**
 * Group of the options the core defines itself (`roundsToWin`). A game puts each of its options in a
 * group with `OptionDef.group` in its game.json; a test fails when one has none.
 */
export const OPTION_GROUP_OF: Record<string, OptionGroup> = {
  roundsToWin: 'match',
};

/** Group an option is shown in (its own `group`, else the id's entry, else `match`). */
export function groupOf(def: Pick<OptionDef, 'id' | 'group'>): OptionGroup {
  return def.group ?? OPTION_GROUP_OF[def.id] ?? 'match';
}
