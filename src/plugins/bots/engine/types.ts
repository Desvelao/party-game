// What the engine needs from the outside: how a bot is run, what a room looks like, how the host is configured.
import type { BotPlan, RoomSelection, RouterConfig } from './router';

export interface BotSpec {
  /** display name, also the seat name in the room */
  name: string;
  room: string;
  /** ws(s) URL of the game socket (ignored when the bot runs inside the game server) */
  url: string;
  plan: BotPlan;
  reports: { enabled: boolean; dir: string };
  seed: number;
  /** the plugin's secret and the reserved seat this bot fills (absent for a fill bot); absent = joins as an ordinary player */
  auth?: { token: string; seat?: string };
}

export interface RunnerHooks {
  onEvent(e: import('./brain').BotEvent): void;
  onLog(line: string): void;
  onExit(error?: string): void;
}

export interface BotUsage {
  /** % of one core used by the bot (event-loop busy share, or time spent deciding when it shares the server's loop) */
  cpu: number;
  heapMB: number;
  externalMB: number;
}

export interface BotHandle {
  stop(reason: string): void;
  usage(): BotUsage;
}

/** How a bot is run: a worker thread per bot (the bot server), or inside the game server. */
export interface BotRunner {
  start(spec: BotSpec, hooks: RunnerHooks): BotHandle;
}

export type ProbeResult = { ok: true; selection: RoomSelection; maxPlayers: number } | { ok: false; error: string };

/** The settings the manager and the watcher read; the bot server's whole configuration satisfies it, and so does the plugin's. */
export interface EngineConfig {
  gameServer: { url: string; botToken: string };
  join: {
    pollSeconds: number;
    botsPerRoom: number;
    maxBots: number;
    /** humans a lobby needs before a bot joins on its own */
    minHumans: number;
    /** seconds a room is left alone after a bot failed to stay in it */
    cooldownSeconds: number;
    /** seconds before the AI decision for an unchanged room is re-checked */
    recheckSeconds: number;
    /** join lobbies on its own when the host has not asked for bots (default true; the plugin turns it off) */
    auto?: boolean;
  };
  ai: RouterConfig & { namePrefix: string; idleLeaveSeconds: number };
  reports: { enabled: boolean; dir: string };
}

/** The game socket of a game server URL (http -> ws, https -> wss, path /ws). */
export function wsUrl(base: string): string {
  if (!base) return ''; // a bot inside the game server has no socket
  const u = new URL(base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws';
  return u.toString();
}
