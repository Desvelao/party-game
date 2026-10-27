// The settings schema of the bots' management side: one list that drives the bot server's YAML file and environment
// variables, its generated example file, `--check` and the live config panel, which the bots plugin shows too (only the
// settings that apply inside a game server). Pure: no files, no YAML; reading them is the bot server's job (bot/server/settings.ts).
import type { RouterConfig } from '../router';

export interface CompanionConfig {
  /** the party-game server this companion serves */
  gameServer: { url: string; adminToken: string; botToken: string };
  /** this server's dashboard, API and /metrics */
  server: { host: string; port: number; adminToken: string; dataDir: string };
  join: {
    pollSeconds: number;
    botsPerRoom: number;
    maxBots: number;
    /** humans a lobby needs before a bot joins */
    minHumans: number;
    /** seconds a room is left alone after a bot failed to stay in it */
    cooldownSeconds: number;
    /** seconds before the AI decision for an unchanged room is re-checked */
    recheckSeconds: number;
    /** join lobbies on its own when the host did not ask for bots (the bot server does; the bots plugin never does) */
    auto?: boolean;
  };
  ai: RouterConfig & { namePrefix: string; idleLeaveSeconds: number };
  reports: { enabled: boolean; dir: string };
  metrics: { enabled: boolean };
}

export type Scalar = string | number | boolean;

export interface SettingDef {
  /** location in the YAML file and in CompanionConfig */
  path: string[];
  /** environment variables, first is the main one, the rest are aliases */
  env: string[];
  type: 'int' | 'string' | 'bool' | 'enum';
  default: Scalar;
  min?: number;
  max?: number;
  values?: string[];
  maxLength?: number;
  /** can be changed while running (admin panel) */
  live: boolean;
  secret?: boolean;
  /** extra command-line flag (value taking), highest precedence */
  flag?: string;
  help: string;
}

export const SETTINGS: SettingDef[] = [
  { path: ['gameServer', 'url'], env: ['GAME_SERVER_URL'], type: 'string', default: 'http://localhost:8080', live: false, flag: '--server', help: 'the party-game server to serve (http:// or https://)' },
  { path: ['gameServer', 'adminToken'], env: ['GAME_SERVER_ADMIN_TOKEN'], type: 'string', default: '', live: false, secret: true, flag: '--admin-token', help: "that server's ADMIN_TOKEN: adds its machine CPU/RAM and live CPU to the dashboard (empty = server.adminToken)" },

  { path: ['gameServer', 'botToken'], env: ['GAME_SERVER_BOT_TOKEN'], type: 'string', default: '', live: false, secret: true, flag: '--bot-token', help: "that server's bots.token: lets the bots join rooms whose host asked for bots (empty = only the automatic join of waiting humans)" },

  { path: ['server', 'host'], env: ['BOT_HOST'], type: 'string', default: '127.0.0.1', live: false, flag: '--host', help: 'address of the dashboard/API (beyond loopback needs an admin token)' },
  { path: ['server', 'port'], env: ['BOT_PORT'], type: 'int', default: 8090, min: 0, max: 65535, live: false, flag: '--port', help: 'port of the dashboard/API' },
  { path: ['server', 'adminToken'], env: ['ADMIN_TOKEN', 'BOT_TOKEN'], type: 'string', default: '', live: false, secret: true, flag: '--token', help: 'bearer token for the dashboard, /api/* and /metrics; empty = this machine only' },
  { path: ['server', 'dataDir'], env: ['BOT_DATA_DIR'], type: 'string', default: 'bot/data', live: false, flag: '--data-dir', help: 'where live settings and the audit log are kept' },

  { path: ['join', 'pollSeconds'], env: ['BOT_POLL_SECONDS'], type: 'int', default: 3, min: 1, max: 300, live: true, flag: '--poll', help: 'seconds between checks of the game server rooms' },
  { path: ['join', 'botsPerRoom'], env: ['BOT_BOTS_PER_ROOM'], type: 'int', default: 1, min: 1, max: 8, live: true, flag: '--bots-per-room', help: 'bots put into one room' },
  { path: ['join', 'maxBots'], env: ['BOT_MAX_BOTS'], type: 'int', default: 8, min: 0, max: 64, live: true, flag: '--max-bots', help: 'bots running at once (lowering it stops no bot, it only blocks new ones)' },
  { path: ['join', 'minHumans'], env: ['BOT_MIN_HUMANS'], type: 'int', default: 1, min: 0, max: 8, live: true, flag: '--min-humans', help: 'humans a lobby needs before a bot joins (0 = join empty lobbies too)' },
  { path: ['join', 'cooldownSeconds'], env: ['BOT_COOLDOWN_SECONDS'], type: 'int', default: 30, min: 0, max: 3600, live: true, help: 'seconds a room is left alone after a bot failed to stay in it' },
  { path: ['join', 'recheckSeconds'], env: ['BOT_RECHECK_SECONDS'], type: 'int', default: 60, min: 5, max: 3600, live: true, help: 'seconds before the AI decision for an unchanged room is checked again' },

  { path: ['ai', 'level'], env: ['BOT_LEVEL'], type: 'string', default: 'normal', maxLength: 20, live: true, flag: '--level', help: 'default difficulty: easy | normal | hard | expert | semigod | random' },
  { path: ['ai', 'mixed'], env: ['BOT_MIXED'], type: 'enum', default: 'never', values: ['never', 'always'], live: true, help: 'also join rooms that rotate through every game (the bot idles in rounds it cannot play)' },
  { path: ['ai', 'playlistJoin'], env: ['BOT_PLAYLIST_JOIN'], type: 'enum', default: 'any', values: ['any', 'all'], live: true, help: 'custom playlists: join when the AI knows any game of it (it idles in the others) or only when it knows all of them' },
  { path: ['ai', 'idleLeaveSeconds'], env: ['BOT_IDLE_LEAVE_SECONDS'], type: 'int', default: 120, min: 0, max: 86400, live: true, help: 'seconds a bot may sit idle (the room plays a game it has no AI for) before it leaves; 0 = never leaves' },
  { path: ['ai', 'namePrefix'], env: ['BOT_NAME_PREFIX'], type: 'string', default: 'Bot', maxLength: 8, live: true, help: 'start of the bots\' display names, e.g. "Bot Hard"' },

  { path: ['reports', 'enabled'], env: ['BOT_REPORTS'], type: 'bool', default: true, live: true, help: 'write the per-match report of every bot' },
  { path: ['reports', 'dir'], env: ['BOT_REPORTS_DIR'], type: 'string', default: 'bot/reports/companion', live: false, flag: '--reports', help: 'folder of those reports' },

  { path: ['metrics', 'enabled'], env: ['BOT_METRICS'], type: 'bool', default: true, live: true, help: 'serve Prometheus metrics at GET /metrics' },
];

/** Map settings: only in the file (and in the panel); keys are game ids. */
export interface MapDef {
  path: string[];
  kind: 'strings' | 'numbers';
  example: string;
  help: string;
}
export const MAPS: MapDef[] = [
  { path: ['ai', 'levels'], kind: 'strings', example: 'ballistix: hard', help: 'difficulty per game id, e.g. ballistix: hard (overrides ai.level)' },
  { path: ['ai', 'policies'], kind: 'strings', example: 'ballistix: greedy', help: 'AI policy per game id, e.g. ballistix: greedy' },
  { path: ['ai', 'params'], kind: 'numbers', example: 'aim: 0.8', help: 'parameter overrides applied on top of the level, e.g. aim: 0.8' },
];

export const key = (path: string[]): string => path.join('.');

export class ConfigError extends Error {
  constructor(
    message: string,
    /** process exit code: 1 = bad configuration, 2 = bad command line */
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

// ---- tiny path helpers over plain nested objects ---------------------------------------------------------------

export function getAt(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function setAt(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = obj;
  for (const p of path.slice(0, -1)) {
    if (cur[p] === null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

export function defaultConfig(): CompanionConfig {
  const cfg: Record<string, unknown> = {};
  for (const d of SETTINGS) setAt(cfg, d.path, d.default);
  for (const m of MAPS) setAt(cfg, m.path, {});
  return cfg as unknown as CompanionConfig;
}

// ---- validation -------------------------------------------------------------------------------------------------

/** Strict check of one value (file, panel). Returns the value or throws a message. */
export function checkValue(def: SettingDef, value: unknown): Scalar {
  const bad = (why: string) => new Error(why);
  switch (def.type) {
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) throw bad(`must be an integer (got ${JSON.stringify(value)})`);
      if (value < (def.min ?? -Infinity) || value > (def.max ?? Infinity)) throw bad(`must be between ${def.min} and ${def.max} (got ${value})`);
      return value;
    case 'bool':
      if (typeof value !== 'boolean') throw bad(`must be true or false (got ${JSON.stringify(value)})`);
      return value;
    case 'enum': {
      const v = typeof value === 'string' ? value : '';
      const match = def.values?.find((x) => x.toLowerCase() === v.toLowerCase());
      if (!match) throw bad(`must be one of ${def.values?.join(', ')} (got ${JSON.stringify(value)})`);
      return match;
    }
    case 'string':
      if (typeof value !== 'string') throw bad(`must be a string (got ${JSON.stringify(value)})`);
      if (def.maxLength !== undefined && value.length > def.maxLength) throw bad(`must be at most ${def.maxLength} characters (got ${value.length})`);
      return value;
  }
}

export function checkMap(def: MapDef, value: unknown): Record<string, string | number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('must be a mapping');
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z0-9-]{1,40}$/i.test(k) && def.kind === 'strings') throw new Error(`bad key ${JSON.stringify(k)}`);
    if (def.kind === 'strings') {
      if (typeof v !== 'string' || !v) throw new Error(`${k} must be a non-empty string`);
    } else if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${k} must be a number`);
    out[k] = v as string | number;
  }
  return out;
}


/**
 * Settings that only mean something in the separate bot server: its own listener and token, the game server it
 * serves and how it polls it, and the join rules for lobbies nobody asked bots for. The bots plugin leaves them out.
 */
const EXTERNAL_ONLY = new Set(['gameServer.url', 'gameServer.adminToken', 'gameServer.botToken', 'server.host', 'server.port', 'server.adminToken', 'server.dataDir', 'join.pollSeconds', 'join.botsPerRoom', 'join.minHumans']);

/** Does this setting apply to bots running inside a game server? */
export const appliesEmbedded = (path: string[]): boolean => !EXTERNAL_ONLY.has(key(path));
