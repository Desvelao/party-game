/**
 * Contract between the core and an installable plugin (see docs/development/plugins.md). A plugin ships
 * `plugin.json` (PluginManifest), `server.mjs` (default export: ServerPlugin) and, when it has a user interface,
 * `client.mjs` (default export: ClientPlugin). Plugin authors import types from here only.
 */
import type { GameAi } from './ai';
import type { GameSelection } from './catalog';
import type { CharacterModelDef, Looks } from './character';
import type { PackLocales } from './i18n';
import type { ProfileRecord } from './profile';
import type { RoomPhase } from './types';

/** Bumped when the plugin contract changes incompatibly; a plugin states the one it was built for. */
export const PLUGIN_API_VERSION = 2;

/** Contract versions the server still loads: 1 plugins are adapted (see `virtualPlayers` below). */
export const SUPPORTED_PLUGIN_API_VERSIONS: readonly number[] = [1, 2];

/** Things a plugin must declare in its manifest to use them. */
export const PLUGIN_CAPABILITIES = ['virtualPlayers'] as const;
export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

/** Files a plugin pack may contain (the shared pack container also allows the game files). */
export const PLUGIN_FILES = ['plugin.json', 'server.mjs', 'client.mjs', 'README.md'] as const;

/** One setting of a plugin, validated in the `plugins.<id>` section of the configuration file. */
export interface PluginOption {
  id: string;
  label: string;
  description: string;
  type: 'number' | 'boolean' | 'string' | 'choice';
  default: number | boolean | string;
  min?: number;
  max?: number;
  choices?: { value: string; label: string }[];
  /** environment variable that sets it when the file does not */
  env?: string;
  /** never shown or logged (tokens) */
  secret?: boolean;
}

export type PluginConfigValue = number | boolean | string;

export interface PluginManifest {
  kind: 'plugin';
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  author: string;
  license: string;
  description: string;
  order?: number;
  /** plugins that must be loaded first: id -> version range like ">=1.0.0 <2.0.0" */
  requires?: Record<string, string>;
  /** the core versions this plugin works with, like ">=1.0.0" */
  engines?: { core?: string };
  config?: PluginOption[];
  /**
   * Features that are not for every plugin. `virtualPlayers`: the plugin may seat players of its own (bots) through
   * `host.virtualRooms`, and outside processes may ask it for a seat (`virtualPlayers.authorizeJoin`).
   */
  capabilities?: PluginCapability[];
  /** top-level paths this plugin answers (like "/metrics"), for what must live outside `/api/<id>/` */
  rootRoutes?: string[];
  /** pages of the app this plugin draws (like "/leaderboard"): the server answers them with the app, the plugin's `screen` shows */
  clientRoutes?: string[];
  locales?: PackLocales;
  /** character models this plugin provides (drawn by `characters` of its client code), for the games that name them */
  characters?: CharacterModelDef[];
  /** sha256 of every shipped file except plugin.json */
  files: Record<string, string>;
}

/** A player or watcher seat as a plugin sees it. */
export interface PluginMember {
  id: string;
  name: string;
  /** seated by a plugin (a bot), not a person */
  virtual: boolean;
  connected: boolean;
  /** the plugin that seated it, when virtual */
  plugin?: string;
  host: boolean;
  /** what the plugin that seated it shows next to it */
  ext?: unknown;
}

/** What a virtual (plugin-driven) player is: it never counts as a person and gives its seat to one who needs it. */
export interface VirtualSeat {
  plugin: string;
  /** a person who joins a full room takes this seat */
  yields?: boolean;
  /** the id returned by `reserveSeat` that this player fills */
  seat?: string;
  /** shown to everyone next to the player (PlayerInfo.ext[plugin]) */
  ext?: unknown;
}

/** The messages a virtual player may send. */
export type VirtualMessage = { t: 'READY'; ready: boolean } | { t: 'INPUT'; mx: number; my: number; a1: boolean; a2: boolean } | { t: 'VOTE'; yes: boolean };

/** A virtual player: the part of a connection a room needs (the same shape as the WebSocket client). */
export interface PluginClient {
  id: string;
  name: string;
  profileId: string | null;
  looks: Looks;
  avatar?: string;
  preferredColor: number | null;
  roomCode: string | null;
  ip: string;
  send(json: string, droppable?: boolean): void;
  close(code?: number, reason?: string): void;
}

export type PluginJoinResult = { ok: true } | { ok: false; code: string; message: string };

/** What a plugin may do with a room. */
export interface PluginRoom {
  readonly code: string;
  readonly phase: RoomPhase;
  readonly selection: GameSelection;
  readonly maxPlayers: number;
  readonly hostId: string;
  /** connected people (not virtual players) */
  readonly humans: number;
  /** connected players of any kind */
  readonly players: number;
  /** seats not taken, not held for a plugin and not locked away */
  readonly freeSeats: number;
  isHost(id: string): boolean;
  memberList(): PluginMember[];
  /** state of this plugin for the room, sent to everyone with every room update */
  getExt(plugin: string): unknown;
  setExt(plugin: string, value: unknown): void;
}

/** A room as a plugin with the `virtualPlayers` capability sees it: it can also seat and drive players of its own. */
export interface VirtualPlayerRoom extends PluginRoom {
  /** hold a seat for a virtual player that is about to join; returns its id, or null when there is no room */
  reserveSeat(plugin: string): string | null;
  releaseSeat(plugin: string, seat: string): boolean;
  reservedSeats(plugin: string): string[];
  /** seat a virtual player (bypasses lock and password; only in the lobby) */
  joinVirtual(client: PluginClient, seat: VirtualSeat): PluginJoinResult;
  /** take a player out of the room (virtual players only) */
  removeVirtual(id: string): boolean;
  /** remove every virtual player of the plugin matching `filter` (all when absent) */
  removeVirtuals(plugin: string, filter?: (m: PluginMember) => boolean): number;
  /** what a virtual player does: get ready, move, vote (the same as a person's messages) */
  virtualSend(id: string, msg: VirtualMessage): void;
  /** update what everyone sees next to a virtual player */
  setMemberExt(id: string, plugin: string, value: unknown): void;
}

/** The room list entry of the server (GET /rooms?format=json), as plugins extend it. */
export interface PluginRoomSummary {
  code: string;
  [key: string]: unknown;
}

/** What the server counts about itself, read when asked (nothing is sampled for plugins). */
export interface PluginServerStats {
  rooms: number;
  maxRooms: number;
  /** connected websocket clients (players and spectators) */
  clients: number;
  /** the game loop since the last stats reset */
  loop: { ticks: number; overruns: number; avgStepMs: number; maxStepMs: number; avgLagMs: number; maxLagMs: number };
  net: { msgsIn: number; msgsOut: number; bytesIn: number; bytesOut: number; rejected: number; droppedFrames: number };
}

/** A finished match, as far as a plugin may see it. */
export interface PluginMatch {
  durationSec: number;
  games: { id: string }[];
}

/** What the server tells plugins as it happens (`host.events`). Payloads are plain data: no profile keys, no live objects. */
export interface PluginEventMap {
  /** a match ended in a room */
  matchFinished: PluginMatch & { ts: number; room: string };
  /** a game or match result was written to a signed-in player's profile (after the store accepted it) */
  resultRecorded: { profileId: string; game?: { id: string; place: number; points: number }; match?: { score: number; won: boolean; place?: number; players?: number } };
  /** a stored profile was edited by its player (`edit`), by an operator (`admin`) or by a result (`result`) */
  profileChanged: { profileId: string; reason: 'edit' | 'admin' | 'result' };
}

/** Everything a plugin gets from the server when it starts. */
export interface PluginHost {
  readonly coreVersion: string;
  /** a folder this plugin may write to (audit log, saved settings, reports); created on first use */
  readonly dataDir: string;
  /** hardware profile of the server (LOW_POWER | NORMAL | HIGH) and its simulation rate */
  readonly profile: 'LOW_POWER' | 'NORMAL' | 'HIGH';
  readonly tickRate: number;
  /** this plugin's settings, validated against the manifest (file > environment > default) */
  readonly config: Readonly<Record<string, PluginConfigValue>>;
  rooms: {
    list(): PluginRoom[];
    get(code: string): PluginRoom | undefined;
    /** a room was created, changed (any update sent to its players) or closed */
    on(event: 'created' | 'changed' | 'closed', fn: (room: PluginRoom) => void): () => void;
  };
  /** The same rooms with the virtual player methods. Only for plugins whose manifest lists the `virtualPlayers` capability. */
  readonly virtualRooms?: {
    list(): VirtualPlayerRoom[];
    get(code: string): VirtualPlayerRoom | undefined;
    on(event: 'created' | 'changed' | 'closed', fn: (room: VirtualPlayerRoom) => void): () => void;
  };
  events: {
    /** listen to a server event; returns the function that stops listening. A listener that throws is logged and ignored. */
    on<E extends keyof PluginEventMap>(event: E, fn: (payload: PluginEventMap[E]) => void): () => void;
  };
  games: {
    /** AIs shipped by the installed game packs */
    ais(): GameAi[];
    /** the playable ids a game family id (every variant) or a variant id stands for; null when the id is unknown */
    playableIds(id: string): Set<string> | null;
  };
  characters: {
    /** the character models the installed games and plugins provide (a plugin's own copy of the core holds none: ask here) */
    models(): readonly CharacterModelDef[];
  };
  profiles: {
    /**
     * Every stored profile, read only (never change what it returns; profile keys are not part of a record). Null when the
     * profile store cannot be listed (`memory`). A full scan of the store: cache the answer.
     */
    list(): Promise<ProfileRecord[] | null>;
  };
  /** counters of the running server */
  stats(): PluginServerStats;
  matches: {
    /** matches finished since the server started */
    playedSinceStart(): number;
    /** the most recent finished matches (at most `limit`) */
    recent(limit: number): PluginMatch[];
  };
  /** another started plugin's `api` (declare it in `requires`) */
  plugin<T = unknown>(id: string): T | undefined;
  /** run `fn` every `ms` on the server's timer (stopped with the plugin) */
  every(ms: number, fn: () => void): void;
  log(message: string): void;
}

/** The server's admin check (token, else loopback only) for one request. */
export type PluginAdminCheck = { ok: true } | { ok: false; status: 401 | 403 | 429; error: string };

/**
 * A request to a plugin's endpoints: its API under `/api/<plugin id>/**` (`kind: 'api'`) or its pages under
 * `/plugins/<plugin id>/**` (`kind: 'page'`), or a top-level path its manifest lists in `rootRoutes` (`kind: 'root'`). Nothing is checked for the plugin: call `requireAdmin()` on every route that is not public.
 */
export interface PluginHttpRequest {
  kind: 'api' | 'page' | 'root';
  method: string;
  /** the part after the prefix, starting with `/` (`/` for the root); for `kind: 'root'` the whole path, like `/metrics` */
  path: string;
  query: Record<string, string>;
  /** the JSON object sent (`{}` when there is none), or null when it was not a JSON object or larger than 16 KB */
  body: Record<string, unknown> | null;
  ip: string;
  /** the admin check for this request (counts a wrong token against the caller's attempts) */
  admin(): PluginAdminCheck;
  /** the response to send when the caller is not an admin, or null when they are */
  requireAdmin(): PluginHttpResponse | null;
}

/** A string body is sent as is (set `type`, `text/html; charset=utf-8` for a page); anything else as JSON. */
export interface PluginHttpResponse {
  status: number;
  body: unknown;
  type?: string;
}

export interface ServerPlugin {
  start(host: PluginHost): void | Promise<void>;
  stop?(): void;
  /** offered to plugins that list this one in `requires` */
  api?: unknown;
  /** a player or watcher sent `data` for this plugin (PLUGIN_ACTION); check rights with `room.isHost` */
  onAction?(room: PluginRoom, clientId: string, data: Record<string, unknown>): void;
  /** Needs the `virtualPlayers` capability; without it the plugin cannot seat players or be joined from outside. */
  virtualPlayers?: {
    /**
     * An outside process asks to seat a virtual player (JOIN_ROOM with `plugin`). Return what to seat, or an error text.
     * Without this a plugin cannot be joined from outside.
     */
    authorizeJoin(room: VirtualPlayerRoom, claim: { token?: string; data: Record<string, unknown> }): VirtualSeat | string;
  };
  /**
   * API 1 only (deprecated): the same as `virtualPlayers.authorizeJoin`. A plugin built for API 1 that has it is
   * treated as if it declared the `virtualPlayers` capability.
   */
  authorizeJoin?(room: VirtualPlayerRoom, claim: { token?: string; data: Record<string, unknown> }): VirtualSeat | string;
  /** serve this plugin's endpoints: `/api/<id>/**`, its pages under `/plugins/<id>/**` (`client.mjs` is reserved) and its `rootRoutes`; undefined = 404 */
  http?(req: PluginHttpRequest): PluginHttpResponse | undefined | Promise<PluginHttpResponse | undefined>;
  /** extra fields for this plugin's entry in the room list (what an outside process needs to see) */
  roomSummary?(room: PluginRoom): unknown;
}
