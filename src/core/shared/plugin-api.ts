/**
 * Contract between the core and an installable game pack (see docs/development/game-packs.md).
 * A pack ships `game.json` (GameManifest), `server.mjs` (default export: ServerGamePlugin) and
 * `client.mjs` (default export: ClientGamePlugin). Pack authors import types from here only.
 */
import type { GameAi } from './ai';
import type { CatalogGame, OptionValue } from './catalog';
import type { CharacterModelDef } from './character';
import type { PackLocales } from './i18n';
import type { GameEvent, GameState, InputState } from './types';

/** Bumped when the plugin contract changes incompatibly; a pack states the one it was built for. */
export const PACK_API_VERSION = 1;

/** Largest accepted pack (unpacked), in bytes. */
export const MAX_PACK_BYTES = 2 * 1024 * 1024;

/** Files a pack may contain. */
export const PACK_FILES = ['game.json', 'plugin.json', 'server.mjs', 'client.mjs', 'README.md'] as const;

export interface MinigamePlayer {
  id: string;
  name: string;
}

export interface RawPlacement {
  id: string;
  /** 1-based; ties share a place */
  place: number;
}

/**
 * Contract every minigame implements. Minigames own their simulation only:
 * lobby, networking, countdown and scoring tables live in the core.
 */
export interface Minigame {
  readonly id: string;
  readonly name: string;

  init(players: MinigamePlayer[]): void;
  handleInput(playerId: string, input: InputState): void;
  /** Optional: a game-defined message from a player (GAME_ACTION), already validated as a small plain JSON object. */
  handleAction?(playerId: string, data: Record<string, unknown>): void;
  /** Optional: state only this player may see (e.g. their hand), sent when it changes; null for none. Keep it small (2 KB). */
  getPrivateState?(playerId: string): unknown;
  /** Player disconnected mid-game. */
  removePlayer(playerId: string): void;
  /**
   * Optional: a player who was in `init()` and was removed with `removePlayer` is back while the round runs
   * (countdown or playing). Put them back in play; ignore unknown ids. Without it they sit the round out.
   */
  addPlayer?(player: MinigamePlayer): void;
  /**
   * Optional: extra numbers of the finished round per player id (e.g. `{ p1: { hits: 12 } }`), asked once when the
   * round ends and sent with its result. Keep it small: plain finite numbers, a handful per player.
   */
  getStats?(): Record<string, Record<string, number>>;
  /** Advance the simulation by dt seconds (only called once the countdown ends). */
  update(dt: number): void;
  /** State for the countdown + playing phases (sent to every client). */
  getState(): GameState;
  /** Events since the last call (hits, eliminations...) */
  drainEvents(): GameEvent[];
  isFinished(): boolean;
  /** Valid once isFinished(). Every initial player appears exactly once. */
  getPlacements(): RawPlacement[];
}

/** What `server.mjs` exports by default. */
export interface ServerGamePlugin {
  /**
   * Round of the playable `playableId` (a variant id, or the game id for games without variants).
   * `options` are already validated and complete; ignore ids you don't know. `rng` is injected by
   * tests and tools for reproducible runs (default `Math.random`).
   */
  createMinigame(playableId: string, options: Record<string, OptionValue>, rng?: () => number): Minigame;
  /**
   * Optional "greedy" bot for `npm run balance`: the input to hold for player `id` given the state.
   * Without it the balance tool falls back to a generic chase-the-nearest bot.
   */
  bot?(state: GameState, id: string, rng: () => number): InputState;
  /**
   * The game's AI player for the bots plugin / bot server: levels, policies and a brain that plays a round from the
   * snapshots a player receives (see ai.ts). Without it no bot plays this game.
   */
  ai?: GameAi;
}

export interface GameManifest {
  /** `^[a-z0-9-]{2,32}$`; equals `catalog.id`. */
  id: string;
  name: string;
  /** semver `x.y.z` */
  version: string;
  apiVersion: number;
  author: string;
  license: string;
  description: string;
  /** Position in the game picker (lower first, default 1000); ties sort by id. */
  order?: number;
  /** What the host UI shows and validates: options, limits, variants, guide. */
  catalog: CatalogGame;
  /** Translations for `tr()` per language, keyed by the English sentence used in `catalog`. */
  locales?: PackLocales;
  /** Character models this pack provides (drawn by `characters` of its client code); other games may use them too. */
  characters?: CharacterModelDef[];
  /**
   * The character model its players are drawn with (`ctx.drawCharacter`), provided by this or another game pack or by a
   * plugin. The game is skipped when no installed pack or plugin provides it. Absent: the game draws no characters.
   */
  character?: string;
  /** sha256 (hex) of every shipped file except game.json. */
  files: Record<string, string>;
}
