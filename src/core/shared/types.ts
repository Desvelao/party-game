import type { Looks } from './character';

export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'results' | 'finished';

export interface PlayerInfo {
  id: string;
  name: string;
  ready: boolean;
  score: number;
  /** round wins in the running stage (reset between playlist entries) */
  wins: number;
  connected: boolean;
  /** palette index (server-assigned, unique inside the room) */
  color: number;
  /** the player's looks by character model (the running game draws its own model's) */
  looks: Looks;
  /** the model the player is shown with outside games */
  avatar?: string;
  /** team index (0..MAX_TEAMS-1) while the room plays in teams, otherwise absent */
  team?: number;
  /** seated by a plugin (a bot), not a person */
  virtual?: boolean;
  /** what plugins show next to this player, by plugin id */
  ext?: Record<string, unknown>;
}

/** Player *intentions*. The server never accepts positions or scores. */
export interface InputState {
  mx: number; // -1..1
  my: number; // -1..1
  a1: boolean; // primary action (dash)
  a2: boolean; // secondary action
}

export const NO_INPUT: InputState = { mx: 0, my: 0, a1: false, a2: false };

/**
 * State of a game that comes from an installed pack. The core knows only `kind` (always `ext:` + the
 * pack's own name) and `t`; the pack's server and client code agree on the rest.
 */
export interface ExternalState {
  kind: `ext:${string}`;
  /** seconds since the round started */
  t: number;
  [field: string]: unknown;
}

/** What a running game sends: the core has no game of its own, so it is always a pack's state. */
export type GameState = ExternalState;

export type GameEventKind = 'dash' | 'bump' | 'eliminated' | 'goal' | 'hit' | 'smash' | 'spawn' | 'catch' | 'release' | 'enemy' | 'engine' | 'pickup' | 'splash' | 'bolt' | 'boom' | 'bank' | 'fill' | 'zap' | 'stun' | 'wipe' | 'tnt' | 'rocket' | 'throw' | 'kick' | 'explode' | 'heal' | 'crack' | 'jet' | `ext:${string}`;
export interface GameEvent {
  kind: GameEventKind;
  id: string;
  x: number;
  y: number;
}

export interface Placement {
  id: string;
  name: string;
  place: number;
  points: number;
  /** team index, when the room plays in teams */
  team?: number;
}

/** How one round of a finished match went (the recap): who placed where. */
export interface MatchRound {
  game: { id: string; name: string };
  placements: { id: string; name: string; place: number; points: number }[];
}

/** A team's standing in a round or match (points = sum of its members'). */
export interface TeamResult {
  team: number;
  points: number;
  place: number;
}

export interface ServerConfigInfo {
  tickRate: number;
  networkRate: number;
  maxPlayers: number;
  totalGames: number;
}
