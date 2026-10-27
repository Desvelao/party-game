// Contract between a bot host (the bots plugin, the external bot server, the CLI) and one game's AI.
// A game pack ships its AI as the optional `ai` export of its server entry; the host knows nothing else about the game.
import type { GameEvent, InputState } from './types';

export interface AiContext {
  selfId: string;
  name: string;
  tickRate: number;
  networkRate: number;
  seed: number;
  /** numeric tuning parameters (defaults of the AI, overridden by the level and by --param k=v) */
  params: Record<string, number>;
  /** ids of the bot's teammates while the room plays in teams (games know no teams: friendly fire is on), else empty */
  allies?: string[];
}

export interface StateMeta {
  tick: number;
  phase: 'countdown' | 'playing';
  /** performance.now() when the snapshot was received */
  recvMs: number;
}

/** Something that went wrong in a round (e.g. a life lost), classified by the game's own logic. */
export interface Incident {
  cause: string;
  /** game time in seconds */
  t: number;
  summary: string;
  /** free-form evidence written to incidents/*.json for later analysis */
  detail: Record<string, unknown>;
}

/** One bot playing one round. */
export interface GameBrain {
  readonly policy: string;
  onState(state: any, meta: StateMeta): void;
  onEvents(events: GameEvent[]): Incident[];
  /** called at the host's decision rate (~30 Hz externally, lower when embedded) while the round is playing */
  decide(nowMs: number): InputState;
  /** state only this bot may see (e.g. a hand of cards), when the game has any */
  onPrivate?(data: unknown): void;
  /** compact snapshot of the last decision, logged to events.jsonl at ~10 Hz; null when nothing to say */
  trace(): Record<string, unknown> | null;
  /** numeric counters for the round report; summed/averaged by analyze.ts */
  metrics(): Record<string, number>;
}

/** The AI of one game (a pack's `ai` export, or one registered by a plugin). */
export interface GameAi {
  /** pack id, e.g. 'ballistix' */
  id: string;
  /** GAME_STATE.state.kind this AI plays, e.g. 'ext:ballistix' */
  kind: string;
  policies: string[];
  defaultPolicy: string;
  defaultParams: Record<string, number>;
  /** difficulty presets: name -> parameter overrides on top of defaultParams, ordered weakest to strongest */
  levels?: Record<string, Record<string, number>>;
  /** level used when a configured one does not exist */
  defaultLevel?: string;
  create(ctx: AiContext, policy: string): GameBrain;
}
