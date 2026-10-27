import { normalizeSelection, type GameSelection } from './catalog';
import { EMOTES, MAX_ID_LENGTH, MAX_NAME_LENGTH, MAX_ROOM_PLAYERS, MAX_TEAMS, PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './constants';
import type {
  GameEvent,
  GameState,
  InputState,
  MatchRound,
  Placement,
  PlayerInfo,
  RoomPhase,
  ServerConfigInfo,
  TeamResult,
} from './types';

export { PROTOCOL_VERSION };

// ---- client -> server ------------------------------------------------------

export type ClientMessage =
  | { t: 'JOIN_ROOM'; v: number; name: string; code?: string; selection?: GameSelection; spectate?: boolean; /** join as a spectator instead of failing when the match already started */ spectateIfBusy?: boolean; /** console mode: the TV screen opens (or re-attaches to) the room it owns */ screen?: boolean; /** console mode: a paired phone claims the host role while watching */ console?: string; resume?: string; profileKey?: string; password?: string; /** creating a room: list it in the public room browser (GET /api/rooms) */ public?: boolean; /** an outside process seating a virtual player of a plugin (a bot): `token` proves it, `data` is the plugin's own claim */ plugin?: { id: string; token?: string; data: Record<string, unknown> } }
  | { t: 'JOIN_AS_PLAYER' }
  /** a player gives up the seat and watches instead (lobby / results only) */
  | { t: 'LEAVE_SEAT' }
  | { t: 'READY'; ready: boolean }
  /** `force`: host starts anyway, treating everyone still not ready as ready */
  | { t: 'START_GAME'; force?: boolean }
  | { t: 'INPUT'; seq: number; mx: number; my: number; a1: boolean; a2: boolean }
  /** game-defined message for the running minigame (cards, bids, answers...); `data` is a small plain JSON object, see parseGameActionData */
  | { t: 'GAME_ACTION'; data: Record<string, unknown> }
  | { t: 'NEXT_GAME' }
  /** host-only: everyone back to the lobby now, whatever is running (no vote) */
  | { t: 'BACK_TO_LOBBY' }
  | { t: 'REMATCH' }
  /** ask the room to restart the current round or the whole match (needs a majority vote) */
  | { t: 'VOTE_START'; kind: VoteKind }
  | { t: 'VOTE'; yes: boolean }
  // host-only room management
  | { t: 'KICK'; id: string }
  | { t: 'MAKE_HOST'; id: string }
  | { t: 'RESET_NAME'; id: string }
  /** host-only: move a user (or the host) between the player seats and the spectators */
  | { t: 'SET_ROLE'; id: string; spectator: boolean }
  | { t: 'ROOM_SETTINGS'; locked?: boolean; maxPlayers?: number; teams?: boolean; /** null / '' removes the password */ password?: string | null; lateJoin?: boolean; /** percent (0-100) of the lowest score a late joiner starts with */ catchUp?: number }
  /** a message for an installed plugin (its lobby controls, for instance); `data` is a small plain JSON object like GAME_ACTION's */
  | { t: 'PLUGIN_ACTION'; plugin: string; data: Record<string, unknown> }
  /** move to a team in the lobby; the host may also move another player (`id`) */
  | { t: 'SET_TEAM'; team: number; id?: string }
  | { t: 'SET_SELECTION'; selection: GameSelection }
  /** tell the operator about another player in the room (rate limited; the room is not told) */
  | { t: 'REPORT'; id: string }
  /** a quick reaction (index into EMOTES); players and spectators may send it, rate-limited */
  | { t: 'EMOTE'; emote: number }
  | { t: 'PING'; ts: number };

/** `round`/`match` restart the running game; `again`/`change` are the host's choices after a match ends */
export type VoteKind = 'round' | 'match' | 'again' | 'change';
export type VoteOutcome = 'passed' | 'failed' | 'cancelled';

/** A running vote. yes/no hold ids of connected players only. */
export interface VoteInfo {
  kind: VoteKind;
  /** name of the player who asked */
  by: string;
  yes: string[];
  no: string[];
  /** yes votes needed to pass */
  needed: number;
  /** connected players who may vote */
  total: number;
  /** seconds left before it fails */
  left: number;
}

// ---- server -> client ------------------------------------------------------

export type ServerMessage =
  | {
      t: 'WELCOME';
      v: number;
      id: string;
      code: string;
      config: ServerConfigInfo;
      selection: GameSelection;
      /** true when watching only (no paddle, not in the player list) */
      spectator: boolean;
      /** secret re-attach token, sent only to the member it belongs to (absent when disabled / spectating) */
      resume?: string;
    }
  | {
      t: 'ROOM_UPDATE';
      phase: RoomPhase;
      hostId: string;
      /** console mode: the host is a phone without a seat (it is `hostId` too) */
      controller?: boolean;
      players: PlayerInfo[];
      selection: GameSelection;
      spectators: number;
      /** spectators by name, so the host can remove one */
      watchers: { id: string; name: string }[];
      /** closed to newcomers (reconnecting seats can still return) */
      locked: boolean;
      /** spectators and newcomers may take a seat while the results screen is up */
      lateJoin: boolean;
      /** percent (0-100) of the lowest player score a late joiner starts with */
      catchUp: number;
      /** player cap for this room (host-adjustable, <= server max) */
      maxPlayers: number;
      /** the room plays in teams (players carry `team`) */
      teams: boolean;
      /** most members of one team for the selection, when teams are on and it is limited */
      teamSize?: number;
      /** newcomers need a password (the password itself only goes to the host, see ROOM_PASSWORD) */
      passwordProtected: boolean;
      /** state kept by installed plugins for this room, by plugin id (absent when there is none) */
      ext?: Record<string, unknown>;
    }
  /** sent to the host only: the current room password (null = none), so the share link can carry it */
  | { t: 'ROOM_PASSWORD'; password: string | null }
  | { t: 'PLAYER_JOINED'; player: PlayerInfo }
  | { t: 'PLAYER_LEFT'; id: string }
  /** `index`/`total`: stage of the match; `roundsToWin`: wins that end the stage; `round`: 1-based round in it */
  | { t: 'GAME_START'; game: { id: string; name: string }; index: number; total: number; roundsToWin: number; round: number }
  | {
      t: 'GAME_STATE';
      tick: number;
      phase: 'countdown' | 'playing';
      countdown: number;
      state: GameState;
    }
  | { t: 'GAME_EVENT'; events: GameEvent[] }
  /** state only this player may see (e.g. a hand of cards), sent when it changes; `data` is null when there is none */
  | { t: 'GAME_PRIVATE'; data: unknown }
  /** `last`: this round decides the whole match */
  | { t: 'GAME_RESULT'; game: { id: string; name: string }; placements: Placement[]; last: boolean; /** extra per-player numbers the game reported (id -> name -> value) */ stats?: Record<string, Record<string, number>>; /** team standings, when teams are on */ teams?: TeamResult[]; /** where the match stands: playlist stage n of `of`, `target` round wins decide a stage */ stage?: { n: number; of: number; target: number } }
  | { t: 'SCORE_UPDATE'; scores: Record<string, number> }
  /** `mvp`: id of the match's most valuable player (most round wins); `rounds`: how every round of the match went */
  | { t: 'MATCH_FINISHED'; ranking: { id: string; name: string; score: number; wins: number; team?: number }[]; teams?: (TeamResult & { wins: number })[]; mvp?: string; rounds?: MatchRound[] }
  /** `reason`/`minutes`: why a BANNED/KICKED player was removed, and how long the ban lasts (absent = until lifted) */
  | { t: 'ERROR'; code: ErrorCode; message: string; reason?: string; minutes?: number }
  /** operator announcement shown as a toast; clients that do not know it ignore it */
  /** `code`: a server-generated notice the client words itself (in its language); `seconds` fills it in */
  | { t: 'NOTICE'; message: string; code?: NoticeCode; seconds?: number; /** HOST_CHANGED: the new host */ id?: string; name?: string }
  /** `vote` is null once it ended; `outcome`/`kind` then say how */
  | { t: 'VOTE_UPDATE'; vote: VoteInfo | null; outcome?: VoteOutcome; kind?: VoteKind }
  /** someone reacted; shown as a floating icon */
  | { t: 'EMOTE'; from: string; name: string; emote: number }
  /** drain mode and operator announcements: sent on connect and whenever they change */
  | ({ t: 'MAINTENANCE_STATE' } & MaintenanceInfo)
  | { t: 'PONG'; ts: number };

/**
 * `draining`: no new rooms; running matches finish. `banners`: pinned announcements to keep on screen.
 * `recent`: the latest announcements sent (newest first), to re-read a toast that was missed.
 */
export interface MaintenanceInfo {
  draining: boolean;
  /** the operator's words for the drain banner (absent: the client says it) */
  message?: string;
  banners: { id: string; message: string }[];
  recent: { id: string; message: string; at: number }[];
}

export type NoticeCode = 'IDLE_CLOSING' | 'SERVER_RESTARTING' | 'HOST_CHANGED' | 'SELECTION_RESET' | 'SEAT_EXPIRED' | 'BACK_TO_LOBBY';

export type ErrorCode =
  | 'BAD_VERSION'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_CLOSED'
  | 'ROOM_FULL'
  | 'ROOM_BUSY'
  | 'ROOM_LOCKED'
  | 'PASSWORD_REQUIRED'
  | 'WRONG_PASSWORD'
  | 'KICKED'
  | 'BANNED'
  | 'GAME_DISABLED'
  | 'NO_GAMES'
  | 'TOO_MANY_PLAYERS'
  | 'SERVER_FULL'
  | 'SERVER_DRAINING'
  | 'TOO_MANY_CONNECTIONS'
  | 'RATE_LIMITED'
  | 'JOIN_TIMEOUT'
  | 'ALREADY_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_READY'
  | 'VOTE_ACTIVE'
  | 'VOTE_COOLDOWN'
  | 'BAD_STATE';

// ---- validation ------------------------------------------------------------

export const MAX_PASSWORD_LENGTH = 32;

/** A room password: 1-32 characters after trimming, no control characters; null when unusable. */
export function sanitizePassword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (s.length < 1 || s.length > MAX_PASSWORD_LENGTH || /[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/** Invisible / format / bidi characters that enable spoofed or unreadable names. */
const INVISIBLE_CHARS = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/** Display-text cleaner: NFC, control/`<>`/invisible/bidi chars removed, trimmed, capped at `max`. */
export function cleanText(raw: string, max: number): string {
  return raw
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(INVISIBLE_CHARS, '')
    .trim()
    .slice(0, max)
    .trim();
}

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Player';
  const cleaned = cleanText(raw, MAX_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : 'Player';
}

/** Key for comparing names: normalized, invisible chars removed, case-folded. */
export function nameKey(name: string): string {
  return String(name ?? '').normalize('NFC').replace(INVISIBLE_CHARS, '').trim().toLowerCase();
}

export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** Lowercase hex, 128..256 bits (the server issues 128-bit tokens). */
export const RESUME_TOKEN_RE = /^[0-9a-f]{32,64}$/;

/** Client-generated secret that identifies a persistent profile: lowercase hex, 128..256 bits. */
export const PROFILE_KEY_RE = /^[0-9a-f]{32,64}$/;

const clamp1 = (n: number) => (n > 1 ? 1 : n < -1 ? -1 : n);
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export const MAX_GAME_ACTION_BYTES = 512;
const MAX_GAME_ACTION_KEYS = 16;
const MAX_GAME_ACTION_DEPTH = 3;

/** Plain JSON copy of `v` (own enumerable keys only, no prototypes), or undefined when it breaks the depth/key limits. */
function plainJson(v: unknown, depth: number): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (depth >= MAX_GAME_ACTION_DEPTH || typeof v !== 'object') return undefined;
  if (Array.isArray(v)) {
    if (v.length > MAX_GAME_ACTION_KEYS) return undefined;
    const out: unknown[] = [];
    for (const x of v) {
      const c = plainJson(x, depth + 1);
      if (c === undefined) return undefined;
      out.push(c);
    }
    return out;
  }
  const keys = Object.keys(v as object);
  if (keys.length > MAX_GAME_ACTION_KEYS) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k === '__proto__') return undefined;
    const c = plainJson((v as Record<string, unknown>)[k], depth + 1);
    if (c === undefined) return undefined;
    out[k] = c;
  }
  return out;
}

const PLUGIN_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Validate the `data` of a GAME_ACTION: a plain JSON object within the size, key and depth limits. */
export function parseGameActionData(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const data = plainJson(v, 0);
  if (data === undefined || JSON.stringify(data).length > MAX_GAME_ACTION_BYTES) return null;
  return data as Record<string, unknown>;
}

/** Parse + validate an untrusted client frame. Returns null when invalid. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null || typeof m.t !== 'string') return null;

  switch (m.t) {
    case 'JOIN_ROOM': {
      if (!isNum(m.v)) return null;
      let code: string | undefined;
      if (m.code !== undefined && m.code !== '') {
        const c = normalizeRoomCode(m.code);
        if (!c) return null;
        code = c;
      }
      // the game choice is only meaningful when creating a room
      let selection: GameSelection | undefined;
      if (!code) {
        const sel = normalizeSelection(m.game, m.variant, m.options, m.playlist, m.playlistRoundsToWin);
        if (!sel) return null;
        selection = sel;
      }
      const spectate = m.spectate === true;
      const spectateIfBusy = m.spectateIfBusy === true && !!code && !spectate;
      if (spectate && !code) return null; // only an existing room can be watched
      const screen = m.screen === true;
      if (m.screen !== undefined && (typeof m.screen !== 'boolean' || (screen && (code || spectate)))) return null;
      let consoleToken: string | undefined;
      if (m.console !== undefined) {
        // a console token only makes sense for a phone watching an existing room
        if (!code || !spectate || typeof m.console !== 'string' || !/^[0-9a-f]{16,128}$/.test(m.console)) return null;
        consoleToken = m.console;
      }
      let resume: string | undefined;
      if (m.resume !== undefined) {
        // a re-attach token only makes sense together with a room code
        if (!code || typeof m.resume !== 'string' || !RESUME_TOKEN_RE.test(m.resume)) return null;
        resume = m.resume;
      }
      const profileKey =
        typeof m.profileKey === 'string' && PROFILE_KEY_RE.test(m.profileKey) ? m.profileKey : undefined;
      let password: string | undefined;
      if (m.password !== undefined) {
        const p = sanitizePassword(m.password);
        // an unusable password cannot protect a new room; when joining it is kept as '' (never matches
        // a real password) so the server answers WRONG_PASSWORD instead of PASSWORD_REQUIRED
        if (p === null && !code) return null;
        password = p ?? '';
      }
      if (m.public !== undefined && (typeof m.public !== 'boolean' || (m.public && code))) return null;
      const isPublic = m.public === true;
      let plugin: { id: string; token?: string; data: Record<string, unknown> } | undefined;
      if (m.plugin !== undefined) {
        const c = m.plugin;
        if (typeof c !== 'object' || c === null || !code || spectate || typeof c.id !== 'string' || !PLUGIN_ID_RE.test(c.id)) return null;
        if (c.token !== undefined && (typeof c.token !== 'string' || c.token.length === 0 || c.token.length > 200)) return null;
        const data = c.data === undefined ? {} : parseGameActionData(c.data);
        if (!data) return null;
        plugin = { id: c.id, ...(c.token !== undefined ? { token: c.token } : {}), data };
      }
      return {
        t: 'JOIN_ROOM',
        v: m.v,
        name: sanitizeName(m.name),
        code,
        selection,
        ...(spectate ? { spectate } : {}),
        ...(spectateIfBusy ? { spectateIfBusy } : {}),
        ...(screen ? { screen } : {}),
        ...(consoleToken ? { console: consoleToken } : {}),
        ...(resume ? { resume } : {}),
        ...(profileKey ? { profileKey } : {}),
        ...(password !== undefined ? { password } : {}),
        ...(isPublic ? { public: true } : {}),
        ...(plugin ? { plugin } : {}),
      };
    }
    case 'READY':
      return typeof m.ready === 'boolean' ? { t: 'READY', ready: m.ready } : null;
    case 'START_GAME':
      return m.force === true ? { t: 'START_GAME', force: true } : { t: 'START_GAME' };
    case 'JOIN_AS_PLAYER':
    case 'LEAVE_SEAT':
    case 'NEXT_GAME':
    case 'BACK_TO_LOBBY':
    case 'REMATCH':
      return { t: m.t };
    case 'VOTE_START':
      return m.kind === 'round' || m.kind === 'match' || m.kind === 'again' || m.kind === 'change'
        ? { t: 'VOTE_START', kind: m.kind }
        : null;
    case 'VOTE':
      return typeof m.yes === 'boolean' ? { t: 'VOTE', yes: m.yes } : null;
    case 'KICK':
    case 'MAKE_HOST':
    case 'RESET_NAME':
      return typeof m.id === 'string' && m.id.length > 0 && m.id.length <= MAX_ID_LENGTH ? { t: m.t, id: m.id } : null;
    case 'SET_ROLE':
      return typeof m.id === 'string' && m.id.length > 0 && m.id.length <= MAX_ID_LENGTH && typeof m.spectator === 'boolean' ? { t: 'SET_ROLE', id: m.id, spectator: m.spectator } : null;
    case 'ROOM_SETTINGS': {
      const out: { t: 'ROOM_SETTINGS'; locked?: boolean; maxPlayers?: number; teams?: boolean; password?: string | null; lateJoin?: boolean; catchUp?: number } = { t: 'ROOM_SETTINGS' };
      if (m.teams !== undefined) {
        if (typeof m.teams !== 'boolean') return null;
        out.teams = m.teams;
      }
      if (m.locked !== undefined) {
        if (typeof m.locked !== 'boolean') return null;
        out.locked = m.locked;
      }
      if (m.lateJoin !== undefined) {
        if (typeof m.lateJoin !== 'boolean') return null;
        out.lateJoin = m.lateJoin;
      }
      if (m.catchUp !== undefined) {
        if (!isNum(m.catchUp) || !Number.isInteger(m.catchUp) || m.catchUp < 0 || m.catchUp > 100) return null;
        out.catchUp = m.catchUp;
      }
      if (m.maxPlayers !== undefined) {
        if (!isNum(m.maxPlayers) || !Number.isInteger(m.maxPlayers) || m.maxPlayers < 1 || m.maxPlayers > MAX_ROOM_PLAYERS) return null;
        out.maxPlayers = m.maxPlayers;
      }
      if (m.password !== undefined) {
        if (m.password === null || m.password === '') out.password = null;
        else {
          const p = sanitizePassword(m.password);
          if (p === null) return null;
          out.password = p;
        }
      }
      return Object.keys(out).length === 1 ? null : out;
    }
    case 'PLUGIN_ACTION': {
      if (typeof m.plugin !== 'string' || !PLUGIN_ID_RE.test(m.plugin)) return null;
      const data = parseGameActionData(m.data);
      return data ? { t: 'PLUGIN_ACTION', plugin: m.plugin, data } : null;
    }
    case 'SET_TEAM': {
      if (!isNum(m.team) || !Number.isInteger(m.team) || m.team < 0 || m.team >= MAX_TEAMS) return null;
      if (m.id === undefined) return { t: 'SET_TEAM', team: m.team };
      return typeof m.id === 'string' && m.id.length > 0 && m.id.length <= MAX_ID_LENGTH ? { t: 'SET_TEAM', team: m.team, id: m.id } : null;
    }
    case 'SET_SELECTION': {
      const selection = normalizeSelection(m.game, m.variant, m.options, m.playlist, m.playlistRoundsToWin);
      return selection ? { t: 'SET_SELECTION', selection } : null;
    }
    case 'INPUT': {
      if (!isNum(m.mx) || !isNum(m.my)) return null;
      return {
        t: 'INPUT',
        seq: isNum(m.seq) ? m.seq | 0 : 0,
        mx: clamp1(m.mx),
        my: clamp1(m.my),
        a1: m.a1 === true,
        a2: m.a2 === true,
      };
    }
    case 'GAME_ACTION': {
      const data = parseGameActionData(m.data);
      return data ? { t: 'GAME_ACTION', data } : null;
    }
    case 'REPORT':
      return typeof m.id === 'string' && m.id.length > 0 && m.id.length <= MAX_ID_LENGTH ? { t: 'REPORT', id: m.id } : null;
    case 'EMOTE':
      return isNum(m.emote) && Number.isInteger(m.emote) && m.emote >= 0 && m.emote < EMOTES.length
        ? { t: 'EMOTE', emote: m.emote }
        : null;
    case 'PING':
      return isNum(m.ts) ? { t: 'PING', ts: m.ts } : null;
    default:
      return null;
  }
}

/**
 * For a frame that parseClientMessage rejected: when it was a JOIN_ROOM, the
 * error code to answer with (so the client's pending join does not hang).
 * Returns null for anything else (genuine garbage gets no reply).
 */
export function rejectedJoinError(raw: string): { code: ErrorCode; message: string } | null {
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null || m.t !== 'JOIN_ROOM') return null;
  if (m.code !== undefined && m.code !== '' && normalizeRoomCode(m.code) === null) {
    return { code: 'ROOM_NOT_FOUND', message: 'Invalid room code' };
  }
  return { code: 'BAD_STATE', message: 'Invalid join request' };
}

export function toInputState(m: Extract<ClientMessage, { t: 'INPUT' }>): InputState {
  return { mx: m.mx, my: m.my, a1: m.a1, a2: m.a2 };
}
