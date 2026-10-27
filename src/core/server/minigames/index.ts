import { ALL_PLAYABLES, effectiveDefaults, fitsPlayers, selectionRounds, type GameSelection, type GameState, type InputState, type OptionValue } from '../../shared';
import type { GameAi } from '../../shared/ai';
import type { Minigame } from './Minigame';

export type Factory = (options: Record<string, OptionValue>) => Minigame;
/** Same game with an injected rng, for tests and the balance tool. */
export type SeededFactory = (options: Record<string, OptionValue>, rng: () => number) => Minigame;
export type Bot = (state: GameState, id: string, rng: () => number) => InputState;

const SEEDED = new Map<string, SeededFactory>();
const BOTS = new Map<string, Bot>();

/**
 * The core has no game of its own: every minigame comes from an installed game pack, which registers a
 * factory per playable id (the variant id, or the game id for games without variants) at boot, see
 * `registerMinigame`. A factory receives the already-validated option values; it must ignore ids it
 * doesn't know.
 */
const REGISTRY = new Map<string, Factory>();

/** Round `gameIndex` (0-based) of a match with the given room selection. */
export function createMinigame(
  selection: Pick<GameSelection, 'game' | 'variant'> & Partial<GameSelection>,
  gameIndex: number,
  isEnabled: (id: string) => boolean = () => true,
  playerCount?: number,
): Minigame {
  // operator-disabled games and games that cannot hold `playerCount` are skipped; if that leaves nothing
  // (a stale selection) any enabled game runs
  const usable = (id: string) => isEnabled(id) && (playerCount === undefined || fitsPlayers(id, playerCount));
  let list = selectionRounds(selection).filter((r) => usable(r.id));
  if (list.length === 0) list = selectionRounds(selection).filter((r) => isEnabled(r.id));
  if (list.length === 0) list = ALL_PLAYABLES.filter((p) => usable(p.id)).map((p) => ({ ...p, options: {} }));
  if (list.length === 0) list = ALL_PLAYABLES.filter((p) => isEnabled(p.id)).map((p) => ({ ...p, options: {} }));
  if (list.length === 0) list = selectionRounds(selection);
  if (list.length === 0) throw new Error('no minigame registered: no game is installed');
  const entry = list[gameIndex % list.length];
  const factory = REGISTRY.get(entry.id);
  if (!factory) throw new Error(`no minigame registered for "${entry.id}"`);
  // stored selections omit default-equal values, so the operator's defaults fill the gaps
  return factory({ ...effectiveDefaults(entry.id, true), ...entry.options });
}

/** Ids with a factory. Updated in place by `registerMinigame` / `unregisterMinigames`. */
export const REGISTERED_IDS: string[] = [...REGISTRY.keys()];

/** Add the factory of a playable id (installed game packs call this at boot). Throws on a duplicate. */
export function registerMinigame(id: string, factory: Factory, extra: { seeded?: SeededFactory; bot?: Bot } = {}): void {
  if (REGISTRY.has(id)) throw new Error(`minigame "${id}" is already registered`);
  REGISTRY.set(id, factory);
  if (extra.seeded) SEEDED.set(id, extra.seeded);
  if (extra.bot) BOTS.set(id, extra.bot);
  REGISTERED_IDS.push(id);
}

export function unregisterMinigames(ids: Iterable<string>): void {
  for (const id of ids) {
    REGISTRY.delete(id);
    SEEDED.delete(id);
    BOTS.delete(id);
  }
  REGISTERED_IDS.length = 0;
  REGISTERED_IDS.push(...REGISTRY.keys());
}

/** A game from a pack with an injected rng, or undefined when it has no seeded factory (built-in games). */
export const createSeeded = (id: string, options: Record<string, OptionValue>, rng: () => number): Minigame | undefined => SEEDED.get(id)?.(options, rng);
/** The pack's own balance bot for a playable id, if it ships one. */
export const botOf = (id: string): Bot | undefined => BOTS.get(id);

/** AIs shipped by game packs (their `ai` export), by game id; the bots plugin plays with these. */
const AIS = new Map<string, GameAi>();
export function registerAi(ai: GameAi): void {
  AIS.set(ai.id, ai);
}
export const unregisterAi = (id: string): boolean => AIS.delete(id);
export const registeredAis = (): GameAi[] => [...AIS.values()];

export const seededIds = (): string[] => [...SEEDED.keys()];
