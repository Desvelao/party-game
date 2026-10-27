export type ProfileName = 'LOW_POWER' | 'NORMAL' | 'HIGH';

export interface ServerConfig {
  profile: ProfileName;
  port: number;
  host: string;
  tickRate: number;
  networkRate: number;
  maxPlayersPerRoom: number;
  maxRooms: number;
  /** watchers per room (they only receive state, so cheap, but not free) */
  maxSpectatorsPerRoom: number;
  staticDir: string;
  /** PEM certificate and private key files: both set serves HTTPS and wss on the same port; both empty keeps plain HTTP */
  tlsCert?: string;
  tlsKey?: string;
  /** games installed by the operator (`games install`); empty = `games` inside dataDir */
  gamesDir: string;
  /** games baked into the build (`npm run build`) */
  bundledGamesDir: string;
  /** a socket that has not joined a room within this many ms is closed (0 = off) */
  joinTimeoutMs: number;
  /** ws ping interval; a socket that misses a whole interval is terminated (0 = off) */
  pingIntervalMs: number;
  /** concurrent sockets per client IP (0 = unlimited); generous so shared NATs/classrooms work */
  maxConnectionsPerIp: number;
  /** use the last X-Forwarded-For entry as the client IP (only enable behind one trusted reverse proxy that appends the peer address) */
  trustProxy: boolean;
  /** public address of the server (e.g. `http://partygame.local`) used for the QR join link; empty = taken from the request Host header */
  publicUrl: string;
  /** party-box mode: answer the captive-portal probes of phones and redirect unknown hostnames to the game */
  captivePortal: boolean;
  /** console mode: a TV screen (`/tv`) owns a room and a phone paired with its PIN is the host and admin */
  consoleMode: boolean;
  /** console mode, for development in Docker or on another machine: any address may open the TV room (default: only the machine itself, so nobody on the Wi-Fi can take it over and read the PIN) */
  consoleScreenAny: boolean;
  /** keep the match history, player reports and metrics time series behind the admin History/Health tabs (off: lighter server, those endpoints answer 404) */
  adminInsights: boolean;
  /** bearer token for /api/admin/* and /stats?reset=1 (?token= or Bearer); if empty, both are loopback-only */
  adminToken: string;
  /** lobby/finished rooms with no activity for this many seconds are closed (0 = off) */
  idleRoomSeconds: number;
  /** keep open lobbies across a restart for this long (seconds; 0 = do not keep rooms) */
  roomRestoreSeconds: number;
  /** seconds before an idle room closes that its players are warned; 0 = no warning */
  idleWarnSeconds: number;
  /** a host silent this long (outside a running round) while others are waiting passes the role on; 0 = off */
  hostIdleSeconds: number;
  /** seconds a dropped player may re-attach to their seat with their resume token (0 = off) */
  reconnectGraceSeconds: number;
  /** where player profiles/stats live: 'json' (file in dataDir), 'sqlite' (database file) or 'memory' (lost on restart) */
  profileStore: 'json' | 'sqlite' | 'memory';
  /** directory of the json profile store (profiles.json) */
  dataDir: string;
  /** database file of the sqlite profile store */
  sqlitePath: string;
  /** how long sqlite waits for a locked database before failing a statement */
  sqliteBusyTimeoutMs: number;
  /** most profiles the store will hold (guards the file against junk keys) */
  maxProfiles: number;
  /** past matches each profile keeps (0 = none) */
  recentMatches: number;
  /** plugins installed by the operator (`plugins install`); empty = `plugins` inside dataDir */
  pluginsDir: string;
  /** plugins baked into the build (`npm run build`) */
  bundledPluginsDir: string;
  /** which plugins to load: `all`, `none` or a comma separated list of ids */
  pluginsEnabled: string;
  /** product name shown in the menu and the browser title */
  brandName: string;
  /** main-menu tagline; empty = the built-in (translated) one */
  welcomeMessage: string;
}

export const BRAND_NAME_MAX = 40;
export const WELCOME_MESSAGE_MAX = 140;
export const DEFAULT_BRAND_NAME = 'Party Game';

/** Trim, drop control characters and cut to `max` (for branding text that ends up in the UI). */
export function cleanBrandText(raw: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Starting hypotheses only - tune from real benchmarks (see BENCHMARKS.md).
export const PROFILES: Record<ProfileName, Pick<ServerConfig, 'tickRate' | 'networkRate' | 'maxPlayersPerRoom' | 'maxRooms' | 'maxSpectatorsPerRoom'>> = {
  LOW_POWER: { tickRate: 30, networkRate: 15, maxPlayersPerRoom: 8, maxRooms: 2, maxSpectatorsPerRoom: 4 },
  NORMAL: { tickRate: 60, networkRate: 20, maxPlayersPerRoom: 8, maxRooms: 4, maxSpectatorsPerRoom: 8 },
  HIGH: { tickRate: 60, networkRate: 30, maxPlayersPerRoom: 16, maxRooms: 8, maxSpectatorsPerRoom: 16 },
};

/** Receives human-readable warnings about env values that were ignored or adjusted (never secret values). */
export type ConfigWarn = (message: string) => void;

const defaultWarn: ConfigWarn = (m) => console.warn(`[party-game] ${m}`);

function intEnv(name: string, fallback: number, min: number, max: number, warn: ConfigWarn = defaultWarn): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const trimmed = raw.trim();
  // strict: parseInt would accept "12abc" as 12
  if (!/^[+-]?\d+$/.test(trimmed)) {
    warn(`ignoring ${name}=${JSON.stringify(raw)}: not an integer, using ${fallback}`);
    return fallback;
  }
  const n = Number.parseInt(trimmed, 10);
  const clamped = Math.min(max, Math.max(min, n));
  if (clamped !== n) warn(`${name}=${n} is outside ${min}..${max}, using ${clamped}`);
  return clamped;
}

/** Boolean env var: 1/true/yes/on and 0/false/no/off (case-insensitive); anything else warns and uses the fallback. */
function boolEnv(name: string, fallback: boolean, warn: ConfigWarn = defaultWarn): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  warn(`ignoring ${name}=${JSON.stringify(raw)}: expected 1/true/yes or 0/false/no, using ${fallback}`);
  return fallback;
}

/** String env var; unset and '' both mean "use the fallback". */
function strEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/**
 * Snapshots go out every round(tickRate / networkRate) ticks, so the rate actually
 * sent is tickRate / that divisor. Never send faster than we simulate.
 */
export function effectiveNetworkRate(tickRate: number, networkRate: number): number {
  return tickRate / Math.max(1, Math.round(tickRate / networkRate));
}

/** Where a setting lives in the YAML file (`namespace.key`) and how it is validated there. */
export interface SettingDef {
  /** location in the file: namespace(s) then key, e.g. ['storage', 'sqlite', 'path'] */
  path: string[];
  field: keyof ServerConfig;
  env: string;
  type: 'int' | 'string' | 'bool' | 'enum';
  /** range in the file's unit */
  min?: number;
  max?: number;
  values?: string[];
  /** file value x scale = ServerConfig value (durations are seconds in the file, ms internally) */
  scale?: number;
  /** longest accepted string (strings only) */
  maxLength?: number;
}

/** Single source of truth for the file schema: namespace, key, ServerConfig field, env var, type, range. */
export const SETTINGS: SettingDef[] = [
  { path: ['server', 'host'], field: 'host', env: 'HOST', type: 'string' },
  { path: ['server', 'port'], field: 'port', env: 'PORT', type: 'int', min: 1, max: 65535 },
  { path: ['server', 'staticDir'], field: 'staticDir', env: 'STATIC_DIR', type: 'string' },
  { path: ['server', 'tlsCert'], field: 'tlsCert', env: 'TLS_CERT', type: 'string' },
  { path: ['server', 'tlsKey'], field: 'tlsKey', env: 'TLS_KEY', type: 'string' },
  { path: ['gamePacks', 'dir'], field: 'gamesDir', env: 'GAMES_DIR', type: 'string' },
  { path: ['gamePacks', 'bundledDir'], field: 'bundledGamesDir', env: 'BUNDLED_GAMES_DIR', type: 'string' },
  { path: ['server', 'trustProxy'], field: 'trustProxy', env: 'TRUST_PROXY', type: 'bool' },
  { path: ['server', 'publicUrl'], field: 'publicUrl', env: 'PUBLIC_URL', type: 'string' },
  { path: ['server', 'captivePortal'], field: 'captivePortal', env: 'CAPTIVE_PORTAL', type: 'bool' },
  { path: ['server', 'consoleMode'], field: 'consoleMode', env: 'CONSOLE_MODE', type: 'bool' },
  { path: ['server', 'consoleScreenAny'], field: 'consoleScreenAny', env: 'CONSOLE_SCREEN_ANY', type: 'bool' },
  { path: ['server', 'adminInsights'], field: 'adminInsights', env: 'ADMIN_INSIGHTS', type: 'bool' },
  { path: ['server', 'adminToken'], field: 'adminToken', env: 'ADMIN_TOKEN', type: 'string' },

  { path: ['performance', 'profile'], field: 'profile', env: 'PROFILE', type: 'enum', values: ['LOW_POWER', 'NORMAL', 'HIGH'] },
  { path: ['performance', 'tickRate'], field: 'tickRate', env: 'TICK_RATE', type: 'int', min: 10, max: 120 },
  { path: ['performance', 'networkRate'], field: 'networkRate', env: 'NET_RATE', type: 'int', min: 1, max: 60 },
  { path: ['performance', 'maxRooms'], field: 'maxRooms', env: 'MAX_ROOMS', type: 'int', min: 1, max: 64 },
  { path: ['performance', 'maxPlayersPerRoom'], field: 'maxPlayersPerRoom', env: 'MAX_PLAYERS', type: 'int', min: 1, max: 32 },
  { path: ['performance', 'maxSpectatorsPerRoom'], field: 'maxSpectatorsPerRoom', env: 'MAX_SPECTATORS', type: 'int', min: 0, max: 64 },

  { path: ['game', 'idleRoomSeconds'], field: 'idleRoomSeconds', env: 'IDLE_ROOM_SECONDS', type: 'int', min: 0, max: 86_400 },
  { path: ['game', 'roomRestoreSeconds'], field: 'roomRestoreSeconds', env: 'ROOM_RESTORE_SECONDS', type: 'int', min: 0, max: 86_400 },
  { path: ['game', 'idleWarnSeconds'], field: 'idleWarnSeconds', env: 'IDLE_WARN_SECONDS', type: 'int', min: 0, max: 3600 },
  { path: ['game', 'hostIdleSeconds'], field: 'hostIdleSeconds', env: 'HOST_IDLE_SECONDS', type: 'int', min: 0, max: 3600 },
  { path: ['game', 'reconnectGraceSeconds'], field: 'reconnectGraceSeconds', env: 'RECONNECT_GRACE_SECONDS', type: 'int', min: 0, max: 3600 },

  { path: ['limits', 'joinTimeoutSeconds'], field: 'joinTimeoutMs', env: 'JOIN_TIMEOUT_MS', type: 'int', min: 0, max: 600, scale: 1000 },
  { path: ['limits', 'pingIntervalSeconds'], field: 'pingIntervalMs', env: 'PING_INTERVAL_MS', type: 'int', min: 0, max: 600, scale: 1000 },
  { path: ['limits', 'maxConnectionsPerIp'], field: 'maxConnectionsPerIp', env: 'MAX_CONNECTIONS_PER_IP', type: 'int', min: 0, max: 10_000 },


  { path: ['storage', 'store'], field: 'profileStore', env: 'PROFILE_STORE', type: 'enum', values: ['json', 'sqlite', 'memory'] },
  { path: ['storage', 'json', 'dataDir'], field: 'dataDir', env: 'DATA_DIR', type: 'string' },
  { path: ['storage', 'sqlite', 'path'], field: 'sqlitePath', env: 'SQLITE_PATH', type: 'string' },
  { path: ['storage', 'sqlite', 'busyTimeoutSeconds'], field: 'sqliteBusyTimeoutMs', env: 'SQLITE_BUSY_TIMEOUT_MS', type: 'int', min: 0, max: 600, scale: 1000 },
  { path: ['storage', 'maxProfiles'], field: 'maxProfiles', env: 'MAX_PROFILES', type: 'int', min: 1, max: 1_000_000 },
  { path: ['storage', 'recentMatches'], field: 'recentMatches', env: 'RECENT_MATCHES', type: 'int', min: 0, max: 50 },

  { path: ['branding', 'name'], field: 'brandName', env: 'BRAND_NAME', type: 'string', maxLength: BRAND_NAME_MAX },
  { path: ['branding', 'welcomeMessage'], field: 'welcomeMessage', env: 'WELCOME_MESSAGE', type: 'string', maxLength: WELCOME_MESSAGE_MAX },
];

/** Values from the config file, flattened to ServerConfig field names (already validated). */
export type ConfigOverrides = Partial<Record<keyof ServerConfig, string | number | boolean>>;

/**
 * Resolve every setting as: config file > environment variable > hardware profile default.
 * Environment values are clamped / ignored when malformed, with a warning via `warn`; file values were
 * validated strictly by `loadConfigFile`.
 */
export function loadConfig(overrides: ConfigOverrides = {}, warn: ConfigWarn = defaultWarn): ServerConfig {
  const num = (field: keyof ServerConfig, env: string, fallback: number, min: number, max: number): number => {
    const v = overrides[field];
    return typeof v === 'number' ? v : intEnv(env, fallback, min, max, warn);
  };
  const str = (field: keyof ServerConfig, env: string, fallback: string): string => {
    const v = overrides[field];
    return typeof v === 'string' && v !== '' ? v : strEnv(env, fallback);
  };

  const rawProfile = typeof overrides.profile === 'string' ? overrides.profile : strEnv('PROFILE', 'NORMAL');
  const requested = rawProfile.toUpperCase();
  if (!(requested in PROFILES)) warn(`unknown profile "${rawProfile}" (use ${Object.keys(PROFILES).join(', ')}); using NORMAL`);
  const profile: ProfileName = requested in PROFILES ? (requested as ProfileName) : 'NORMAL';
  const base = PROFILES[profile];
  const tickRate = num('tickRate', 'TICK_RATE', base.tickRate, 10, 120);
  let store = str('profileStore', 'PROFILE_STORE', 'json').toLowerCase();
  if (store === 'file') {
    // the JSON driver used to be called "file"
    warn('storage store "file" is now called "json"; please update your configuration');
    store = 'json';
  }
  if (!['json', 'sqlite', 'memory'].includes(store)) warn(`unknown profile store "${store}" (use json, sqlite or memory); using json, which starts from the JSON file in the data directory`);
  return {
    profile,
    port: num('port', 'PORT', 8080, 1, 65535),
    host: str('host', 'HOST', '0.0.0.0'),
    tickRate,
    networkRate: effectiveNetworkRate(tickRate, num('networkRate', 'NET_RATE', base.networkRate, 1, 60)),
    maxPlayersPerRoom: num('maxPlayersPerRoom', 'MAX_PLAYERS', base.maxPlayersPerRoom, 1, 32),
    maxRooms: num('maxRooms', 'MAX_ROOMS', base.maxRooms, 1, 64),
    maxSpectatorsPerRoom: num('maxSpectatorsPerRoom', 'MAX_SPECTATORS', base.maxSpectatorsPerRoom, 0, 64),
    staticDir: str('staticDir', 'STATIC_DIR', 'dist/client'),
    tlsCert: str('tlsCert', 'TLS_CERT', ''),
    tlsKey: str('tlsKey', 'TLS_KEY', ''),
    gamesDir: str('gamesDir', 'GAMES_DIR', ''),
    bundledGamesDir: str('bundledGamesDir', 'BUNDLED_GAMES_DIR', 'dist/games'),
    joinTimeoutMs: num('joinTimeoutMs', 'JOIN_TIMEOUT_MS', 10_000, 0, 600_000),
    pingIntervalMs: num('pingIntervalMs', 'PING_INTERVAL_MS', 30_000, 0, 600_000),
    maxConnectionsPerIp: num('maxConnectionsPerIp', 'MAX_CONNECTIONS_PER_IP', 50, 0, 10_000),
    trustProxy: typeof overrides.trustProxy === 'boolean' ? overrides.trustProxy : boolEnv('TRUST_PROXY', false, warn),
    publicUrl: str('publicUrl', 'PUBLIC_URL', '').replace(/\/+$/, ''),
    captivePortal: typeof overrides.captivePortal === 'boolean' ? overrides.captivePortal : boolEnv('CAPTIVE_PORTAL', false, warn),
    consoleMode: typeof overrides.consoleMode === 'boolean' ? overrides.consoleMode : boolEnv('CONSOLE_MODE', false, warn),
    consoleScreenAny: typeof overrides.consoleScreenAny === 'boolean' ? overrides.consoleScreenAny : boolEnv('CONSOLE_SCREEN_ANY', false, warn),
    adminInsights: typeof overrides.adminInsights === 'boolean' ? overrides.adminInsights : boolEnv('ADMIN_INSIGHTS', true, warn),
    adminToken: str('adminToken', 'ADMIN_TOKEN', '').trim(),
    idleRoomSeconds: num('idleRoomSeconds', 'IDLE_ROOM_SECONDS', 600, 0, 86_400),
    roomRestoreSeconds: num('roomRestoreSeconds', 'ROOM_RESTORE_SECONDS', 900, 0, 86_400),
    idleWarnSeconds: num('idleWarnSeconds', 'IDLE_WARN_SECONDS', 60, 0, 3600),
    hostIdleSeconds: num('hostIdleSeconds', 'HOST_IDLE_SECONDS', 90, 0, 3600),
    reconnectGraceSeconds: num('reconnectGraceSeconds', 'RECONNECT_GRACE_SECONDS', 60, 0, 3600),
    profileStore: store === 'memory' ? 'memory' : store === 'sqlite' ? 'sqlite' : 'json',
    dataDir: str('dataDir', 'DATA_DIR', 'data'),
    sqlitePath: str('sqlitePath', 'SQLITE_PATH', 'data/profiles.db'),
    sqliteBusyTimeoutMs: num('sqliteBusyTimeoutMs', 'SQLITE_BUSY_TIMEOUT_MS', 5000, 0, 600_000),
    maxProfiles: num('maxProfiles', 'MAX_PROFILES', 10_000, 1, 1_000_000),
    recentMatches: num('recentMatches', 'RECENT_MATCHES', 10, 0, 50),
    pluginsDir: str('pluginsDir', 'PLUGINS_DIR', ''),
    bundledPluginsDir: str('bundledPluginsDir', 'BUNDLED_PLUGINS_DIR', 'dist/plugins'),
    pluginsEnabled: str('pluginsEnabled', 'PLUGINS', 'all'),
    brandName: cleanBrandText(str('brandName', 'BRAND_NAME', DEFAULT_BRAND_NAME), BRAND_NAME_MAX) || DEFAULT_BRAND_NAME,
    welcomeMessage: cleanBrandText(str('welcomeMessage', 'WELCOME_MESSAGE', ''), WELCOME_MESSAGE_MAX),
  };
}
