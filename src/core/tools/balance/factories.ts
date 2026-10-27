import type { OptionValue } from '../../shared';
import { mulberry32 } from '../../shared/kit/util';
import { createSeeded, seededIds } from '../../server/minigames';
import type { Minigame } from '../../server/minigames/Minigame';

type Options = Record<string, OptionValue>;
/** Ids the balance tool can build: every installed game, through the seeded factory its pack registered. */
export const factoryIds = (): string[] => [...seededIds()];

export function makeGame(playableId: string, options: Options, seed: number): Minigame {
  const game = createSeeded(playableId, options, mulberry32(seed));
  if (!game) throw new Error(`no minigame registered for "${playableId}"`);
  return game;
}
