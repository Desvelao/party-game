import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ALL_PLAYABLES,
  DEFAULT_SELECTION,
  COUNTDOWN_SECONDS,
  MAX_TEAMS,
  PALETTE,
  PROTOCOL_VERSION,
  RESULTS_SECONDS,
  nameKey,
  playerCountConflict,
  placementPoints,
  selectionPlayerLimit,
  selectionSupportsTeams,
  selectionTeamSizeLimit,
  stagesOf,
  type ErrorCode,
  type GameSelection,
  type GameEvent,
  type InputState,
  type Looks,
  type MatchRound,
  type MatchSummary,
  type Placement,
  type PlayerInfo,
  type RoomPhase,
  type ServerMessage,
  type TeamResult,
  type VoteInfo,
  type VoteKind,
  type PluginMember,
  type PluginRoom,
  type VirtualMessage,
  type VirtualSeat,
  type VoteOutcome,
  RECENT_ROUNDS_MAX,
} from '../../shared';
import type { ServerConfig } from '../config';
import { FixedWindowLimiter } from '../networking/limits';
import type { RoomClient as Client } from '../networking/Client';
import { createMinigame } from '../minigames';
import type { ResultDelta } from '../profiles/profile';
import type { Minigame } from '../minigames/Minigame';

/** Lets the owner persist per-profile stats without Room knowing about storage. */
export interface RoomHooks {
  recordResult?(profileId: string, delta: ResultDelta): void;
  /** a match ran to its end; names only, no profile ids */
  matchFinished?(record: MatchRecord): void;
  /** a player reported another one; the owner keeps it for the operator */
  reported?(report: { room: string; reporterId: string; reporter: string; targetId: string; target: string; targetProfileId?: string }): void;
  /** operator switch: may a round with this playable id be played? (absent = all) */
  isPlayableEnabled?(id: string): boolean;
  /** why a host-chosen selection is refused, or null */
  checkSelection?(selection: GameSelection): string | null;
  /** a room update went out to its players (RoomManager batches these per tick for plugins) */
  changed?(room: Room): void;
}

interface Member {
  client: Client;
  id: string;
  name: string;
  /** palette index, unique among members */
  color: number;
  looks: Looks;
  avatar?: string;
  /** team index while the room plays in teams (kept otherwise, so a toggle restores it) */
  team: number;
  /** persistent profile this seat plays as (stats are credited to it) */
  profileId: string | null;
  ready: boolean;
  score: number;
  /** round wins in the running stage */
  wins: number;
  /** stages (playlist entries) won in the running match */
  stagesWon: number;
  connected: boolean;
  /** secret re-attach token ('' when the feature is off or the grace period ran out); never broadcast */
  token: string;
  /** seconds since the socket dropped, while the token is still valid */
  droppedFor: number;
  /** re-attached mid-match: not part of the running round, plays again from the next game */
  sitOut: boolean;
  /** order of this member's last deliberate action (see Room.noteActive); higher = more recent */
  activeAt: number;
  /** last GAME_PRIVATE payload sent (JSON), so it is only resent when it changes */
  privateSent: string;
  /** seated by a plugin (a bot): which, whether a person takes its seat when the room is full, the reserved seat it filled, and what everyone sees next to it */
  virtual: { plugin: string; yields: boolean; seat: string | null; ext: unknown } | null;
}

/** Rank teams by points, best first; equal points share a place. */
function rankTeams(points: Map<number, number>): TeamResult[] {
  const order = [...points.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const out: TeamResult[] = [];
  order.forEach(([team, pts], i) => {
    const prev = out[i - 1];
    out.push({ team, points: pts, place: prev && prev.points === pts ? prev.place : i + 1 });
  });
  return out;
}

/** Seconds a vote stays open, and the pause after a failed one (anti-spam). */
const VOTE_SECONDS = 15;
const VOTE_COOLDOWN_SECONDS = 20;

interface Vote {
  kind: VoteKind;
  by: string;
  yes: Set<string>;
  no: Set<string>;
  left: number;
}

/** One finished match, as kept in the operator's history. */
export interface MatchRecord {
  /** epoch ms the match ended */
  ts: number;
  room: string;
  durationSec: number;
  /** the rounds that were played, in order */
  games: { id: string; name: string }[];
  /** final ranking, best first */
  ranking: { name: string; score: number; signedIn: boolean }[];
}

/** What an operator sees of one seat or watcher. */
export interface AdminMemberInfo {
  id: string;
  name: string;
  spectator: boolean;
  connected: boolean;
  host: boolean;
  ready: boolean;
  score: number;
  profileId: string | null;
  ip: string;
}

/** Largest plugin state kept per room (it goes out with every room update). */
const MAX_EXT_BYTES = 4096;
/** Report pairs a room remembers (one report per reporter and target); the oldest are forgotten beyond this. */
const MAX_REPORTED_PAIRS = 128;

export type JoinResult = { ok: true } | { ok: false; code: ErrorCode; message: string };

/** A lobby as saved across restarts (`savedAt`: epoch ms, set by the store). */
export interface RoomSnapshot {
  code: string;
  selection: GameSelection;
  requestedMax: number;
  locked: boolean;
  lateJoin: boolean;
  teams: boolean;
  public: boolean;
  savedAt: number;
}

export class Room implements PluginRoom {
  phase: RoomPhase = 'lobby';
  hostId = '';
  /** console mode: a spectator-side phone (no seat) that holds the host role; `hostId` is its id while it is connected */
  controllerId = '';
  /** console mode: the TV screen that owns this room (it keeps the room open with no players) */
  screenId = '';
  /** the host whose role was passed on when their socket dropped; they get it back if they return in time */
  private previousHostId = '';
  /** seconds the host has been silent while others could act (see hostIdleSeconds) */
  private hostIdleFor = 0;
  private activitySeq = 0;
  readonly createdAt = Date.now();

  private members = new Map<string, Member>();
  private spectators = new Map<string, Client>();
  /** kept so a spectator arriving during results / after the match sees them */
  private lastResult: ServerMessage | null = null;
  private lastScores: ServerMessage | null = null;
  private lastFinal: ServerMessage | null = null;
  private minigame: Minigame | null = null;
  private gameIndex = -1;
  /** running stage (custom-playlist entry; always 0 otherwise) and rounds played in it */
  private stageIndex = 0;
  private stageRound = 0;
  private timer = 0;
  private tick = 0;
  private events: GameEvent[] = [];
  private readonly netEvery: number;
  /** rate snapshots are actually sent at (tickRate / netEvery) */
  private readonly effectiveNetworkRate: number;
  private vote: Vote | null = null;
  /** rounds of the running match by index, and when it began (for the match history) */
  private playedGames: { id: string; name: string }[] = [];
  /** placements of every round of the running match, for the recap */
  private rounds: MatchRound[] = [];
  private matchStartedAt = 0;
  private voteCooldown = 0;
  /** seconds spent in lobby/finished without any activity (see touch) */
  idleSeconds = 0;
  /** the "closing soon" notice went out for the current idle stretch */
  private idleWarned = false;
  /** closed to newcomers by the host (reconnecting seats can still return) */
  locked = false;
  /** host setting: spectators and newcomers may take a seat while the results screen is up */
  lateJoin = false;
  /** chosen at creation: listed in the public room browser while it is an open lobby */
  isPublic = false;
  /** percent (0-100) of the lowest player score a late joiner starts with */
  catchUpPct = 50;
  /** state each plugin keeps for this room, sent to everyone with every room update (see setExt) */
  private exts = new Map<string, unknown>();
  /** seats held for virtual players that are about to join, by plugin */
  private reserved = new Map<string, Set<string>>();
  /** needed by newcomers and spectators; never persisted, logged or broadcast (only the host is told) */
  private password: string | null = null;
  /** wrong-password tally per client IP, so one guesser can't lock everyone else out; bounded, oldest evicted */
  private passwordFails = new Map<string, { fails: number; blockedUntil: number }>();
  /** Profiles the host removed from this room (oldest first, small cap); guests have no profile to remember. */
  private kicked = new Set<string>();
  /** `hostId + password` last sent to the host (ROOM_PASSWORD), to send it only when it changes */
  private passwordSentKey = '';
  private readonly reportLimiter = new FixedWindowLimiter(3, 60_000, 128);
  /** `reporter>target` pairs already reported, oldest first; capped so a long-lived room with many joiners stays small */
  private readonly reportedPairs = new Set<string>();
  /** emotes allowed per sender (3 per 5 s); excess ones are dropped silently */
  private readonly emoteLimiter = new FixedWindowLimiter(3, 5000, 128);
  /** the room plays in teams: members carry `team`, results are summed per team */
  teams = false;
  /** player cap for this room: host-adjustable, never above the server's nor the selected game's limit */
  maxPlayers: number;
  /** the cap before the game's own limit: the server's, or what the host chose */
  private requestedMax: number;
  private _selection: GameSelection;

  constructor(
    readonly code: string,
    private readonly cfg: ServerConfig,
    selection: GameSelection,
    private readonly hooks: RoomHooks = {},
  ) {
    this._selection = selection;
    this.requestedMax = cfg.maxPlayersPerRoom;
    this.maxPlayers = this.effectiveMax();
    this.netEvery = Math.max(1, Math.round(cfg.tickRate / cfg.networkRate));
    this.effectiveNetworkRate = cfg.tickRate / this.netEvery;
  }

  get selection(): GameSelection {
    return this._selection;
  }

  /** What a restart keeps of a lobby (never the people); null when the room is not worth keeping. */
  persistable(): RoomSnapshot | null {
    // a password is never written to disk, so a protected room is not restored as an open one
    if (this.phase !== 'lobby' || this.password !== null) return null;
    return { code: this.code, selection: this._selection, requestedMax: this.requestedMax, locked: this.locked, lateJoin: this.lateJoin, teams: this.teams, public: this.isPublic, savedAt: 0 };
  }

  /** Re-apply the host settings of a saved lobby. */
  applySnapshot(s: RoomSnapshot): void {
    this.requestedMax = Math.max(1, Math.min(s.requestedMax, this.cfg.maxPlayersPerRoom));
    this.maxPlayers = this.effectiveMax();
    this.locked = s.locked;
    this.lateJoin = s.lateJoin;
    this.teams = s.teams;
    this.isPublic = s.public;
  }

  /** The requested cap held down to what the selected game / playlist supports (a rotation is not limited). */
  private effectiveMax(): number {
    return Math.min(this.requestedMax, selectionPlayerLimit(this._selection) ?? Infinity);
  }

  /** Most members of one team for the current selection; Infinity when unlimited. */
  private get teamSize(): number {
    return selectionTeamSizeLimit(this._selection) ?? Infinity;
  }

  private teamMembers(team: number, except?: string): number {
    let n = 0;
    for (const m of this.members.values()) if (m.team === team && m.id !== except) n++;
    return n;
  }

  /** The team with the fewest members that still has room (null when every team is full). */
  private emptiestTeam(except?: string): number | null {
    let best: number | null = null;
    let bestN = Infinity;
    for (let t = 0; t < MAX_TEAMS; t++) {
      const n = this.teamMembers(t, except);
      if (n < this.teamSize && n < bestN) {
        best = t;
        bestN = n;
      }
    }
    return best;
  }

  /** Spread everyone over the teams as evenly as the team size allows (round robin, in seat order). */
  private balanceTeams(): void {
    const size = this.teamSize;
    const teams = Math.min(MAX_TEAMS, Math.max(2, Math.ceil(this.members.size / (Number.isFinite(size) ? size : this.members.size))));
    let i = 0;
    for (const m of this.members.values()) m.team = i++ % teams;
  }

  /** Why the lobby cannot start as teams, or null when the split is playable. */
  private teamsError(): string | null {
    if (!this.teams) return null;
    const counts = new Map<number, number>();
    for (const m of this.members.values()) if (m.connected) counts.set(m.team, (counts.get(m.team) ?? 0) + 1);
    if (counts.size < 2) return 'Teams need at least two teams with players';
    for (const n of counts.values()) {
      if (n > this.teamSize) return `A team can have at most ${this.teamSize} players`;
    }
    return null;
  }

  /** Why `players` people cannot play the current / a given selection, as an error message; null when fine. */
  private playerCountError(selection: GameSelection, players: number): string | null {
    const c = playerCountConflict(selection, players);
    return c ? `${c.name} supports at most ${c.max} players (${players} in the room)` : null;
  }

  /** Stages of this match: one per custom-playlist entry, otherwise a single one. */
  get totalGames(): number {
    return stagesOf(this._selection).length;
  }

  private get stageTarget(): number {
    const stages = stagesOf(this._selection);
    return (stages[Math.min(this.stageIndex, stages.length - 1)] ?? { roundsToWin: 3 }).roundsToWin;
  }

  private gameStartMessage(mg: Minigame): ServerMessage {
    return {
      t: 'GAME_START',
      game: { id: mg.id, name: mg.name },
      index: this.stageIndex,
      total: this.totalGames,
      roundsToWin: this.stageTarget,
      round: this.stageRound,
    };
  }

  /** Zero scores and wins and go back to the first stage. */
  private resetMatchState(): void {
    for (const m of this.members.values()) {
      m.score = 0;
      m.wins = 0;
      m.stagesWon = 0;
    }
    this.gameIndex = -1;
    this.stageIndex = 0;
    this.stageRound = 0;
  }

  get size(): number {
    return this.members.size;
  }

  get spectatorCount(): number {
    return this.spectators.size;
  }

  get connectedCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.connected) n++;
    return n;
  }

  /** Connected people (virtual players, such as bots, are not people). */
  get connectedHumans(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.connected && !m.virtual) n++;
    return n;
  }

  // ---- plugin view of the room (PluginRoom) --------------------------------------------------

  get humans(): number {
    return this.connectedHumans;
  }

  get players(): number {
    return this.connectedCount;
  }

  get freeSeats(): number {
    return Math.max(0, this.maxPlayers - this.seatsUsed);
  }

  isHost(id: string): boolean {
    return id === this.hostId && (this.members.has(id) || id === this.controllerId);
  }

  /** The TV screen is connected: the room stays open even with nobody seated. */
  get screenConnected(): boolean {
    return this.screenId !== '' && this.spectators.has(this.screenId);
  }

  /** A TV screen joins as a spectator and owns the room. */
  joinScreen(client: Client): JoinResult {
    this.screenId = client.id;
    return this.joinSpectator(client, undefined, true);
  }

  /** A paired phone watching the room takes the host role without a seat (the previous controller loses it). */
  claimControl(client: Client): JoinResult {
    if (!this.spectators.has(client.id) && !this.members.has(client.id)) return { ok: false, code: 'BAD_STATE', message: 'Join the room first' };
    this.controllerId = client.id;
    this.setHost(client.id);
    this.sendRoomUpdate();
    return { ok: true };
  }

  /** A watching host (console phone or a host who chose to watch) is connected: the room stays open. */
  get controllerConnected(): boolean {
    return this.controllerId !== '' && this.spectators.has(this.controllerId);
  }

  isController(id: string): boolean {
    return id !== '' && id === this.controllerId;
  }

  memberList(): PluginMember[] {
    return [...this.members.values()].map((m) => ({ id: m.id, name: m.name, virtual: !!m.virtual, connected: m.connected, host: m.id === this.hostId, ...(m.virtual ? { plugin: m.virtual.plugin, ext: m.virtual.ext } : {}) }));
  }

  getExt(plugin: string): unknown {
    return this.exts.get(plugin);
  }

  /** Keep `value` (small JSON) as the plugin's state for this room and tell everyone. */
  setExt(plugin: string, value: unknown): void {
    const json = value === undefined || value === null ? '' : JSON.stringify(value);
    if (json.length > MAX_EXT_BYTES) throw new Error(`plugin state of "${plugin}" is larger than ${MAX_EXT_BYTES} bytes`);
    if (json === (this.exts.has(plugin) ? JSON.stringify(this.exts.get(plugin)) : '')) return; // nothing changed: no update, no echo
    if (json === '') this.exts.delete(plugin);
    else this.exts.set(plugin, value);
    this.sendRoomUpdate();
  }

  /** Hold a seat for a virtual player about to join (lobby only). A virtual player that yields is sent away when it is the only way to make room. */
  reserveSeat(plugin: string): string | null {
    if (this.phase !== 'lobby') return null;
    if (this.seatsUsed >= this.maxPlayers && !this.evictYielding()) return null;
    const id = randomBytes(4).toString('hex');
    let set = this.reserved.get(plugin);
    if (!set) this.reserved.set(plugin, (set = new Set()));
    set.add(id);
    this.touch();
    return id;
  }

  releaseSeat(plugin: string, seat: string): boolean {
    const ok = this.reserved.get(plugin)?.delete(seat) ?? false;
    if (ok) this.sendRoomUpdate();
    return ok;
  }

  reservedSeats(plugin: string): string[] {
    return [...(this.reserved.get(plugin) ?? [])];
  }

  /** Seat a virtual player. */
  joinVirtual(client: Client, seat: VirtualSeat): JoinResult {
    if (seat.seat !== undefined && !this.reserved.get(seat.plugin)?.has(seat.seat)) return { ok: false, code: 'BAD_STATE', message: 'No such reserved seat' };
    return this.admit(client, seat);
  }

  removeVirtual(id: string): boolean {
    return this.members.get(id)?.virtual ? this.removeTarget(id, 'KICKED', 'Removed from the room') : false;
  }

  removeVirtuals(plugin: string, filter?: (m: PluginMember) => boolean): number {
    let n = 0;
    for (const m of [...this.members.values()]) {
      if (m.virtual?.plugin !== plugin) continue;
      if (filter && !filter(this.memberList().find((x) => x.id === m.id)!)) continue;
      if (this.removeTarget(m.id, 'KICKED', 'Removed from the room')) n++;
    }
    return n;
  }

  virtualSend(id: string, msg: VirtualMessage): void {
    if (!this.members.get(id)?.virtual) return;
    if (msg.t === 'READY') this.setReady(id, msg.ready);
    else if (msg.t === 'INPUT') this.handleInput(id, { mx: msg.mx, my: msg.my, a1: msg.a1, a2: msg.a2 });
    else if (msg.t === 'VOTE') this.castVote(id, msg.yes);
  }

  setMemberExt(id: string, plugin: string, value: unknown): void {
    const m = this.members.get(id);
    if (!m?.virtual || m.virtual.plugin !== plugin) return;
    m.virtual.ext = value;
    this.sendRoomUpdate();
  }

  /** Record activity (a member message, join or leave) so the room is not reaped as idle. */
  touch(): void {
    this.idleSeconds = 0;
    this.idleWarned = false;
  }

  // ---- membership ----------------------------------------------------------

  get passwordProtected(): boolean {
    return this.password !== null;
  }

  /** Set at creation or by the host; null / '' removes it. */
  setPassword(password: string | null): void {
    this.password = password || null;
    this.passwordFails.clear();
  }

  /** null when `supplied` may enter. After 5 wrong tries from one IP, that IP is refused for 30 s. */
  private checkPassword(client: Client, supplied: string | undefined): JoinResult | null {
    if (this.password === null) return null;
    if (supplied === undefined) return { ok: false, code: 'PASSWORD_REQUIRED', message: 'This room needs a password' };
    const now = Date.now();
    const key = client.ip ?? '';
    const entry = this.passwordFails.get(key) ?? { fails: 0, blockedUntil: 0 };
    if (now < entry.blockedUntil) {
      return { ok: false, code: 'WRONG_PASSWORD', message: 'Too many attempts, try again in a moment' };
    }
    const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
    if (timingSafeEqual(digest(supplied), digest(this.password))) {
      this.passwordFails.delete(key);
      return null;
    }
    if (++entry.fails >= 5) {
      entry.fails = 0;
      entry.blockedUntil = now + 30_000;
    }
    this.passwordFails.delete(key); // re-insert so the map stays oldest-first
    this.passwordFails.set(key, entry);
    if (this.passwordFails.size > 256) this.passwordFails.delete(this.passwordFails.keys().next().value as string);
    return { ok: false, code: 'WRONG_PASSWORD', message: 'Wrong password' };
  }

  join(client: Client, password?: string): JoinResult {
    const denied = this.checkPassword(client, password);
    if (denied) return denied;
    return this.admit(client);
  }

  /** Seats taken or held: connected players plus seats reserved for virtual players that have not joined yet. */
  private get seatsUsed(): number {
    let held = 0;
    for (const set of this.reserved.values()) held += set.size;
    return this.connectedCount + held;
  }

  /** Free a seat by removing one virtual player that yields to people. False when there is none. */
  private evictYielding(): boolean {
    for (const m of this.members.values()) {
      if (m.virtual?.yields && m.connected) return this.removeTarget(m.id, 'KICKED', 'A player took your seat');
    }
    return false;
  }

  /** Seat `client` as a player; callers have already cleared the password check. */
  private admit(client: Client, virtual?: VirtualSeat): JoinResult {
    this.touch();
    const out = this.kickedOut(client);
    if (out) return out;
    // one seat per signed-in profile: coming back (e.g. with a lost token) takes the old seat over
    if (client.profileId) {
      for (const m of this.members.values()) {
        if (m.profileId !== client.profileId) continue;
        if (m.token && this.resume(client, m.token)) return { ok: true };
        return { ok: false, code: 'ALREADY_IN_ROOM', message: 'You are already in this room' };
      }
    }
    const late = this.phase === 'results' && this.lateJoin && !virtual;
    if (this.phase !== 'lobby' && !late) {
      return { ok: false, code: 'ROOM_BUSY', message: 'A match is already in progress' };
    }
    if (this.locked && !virtual && client.id !== this.hostId) return { ok: false, code: 'ROOM_LOCKED', message: 'The host closed this room' };
    // a virtual player with a reserved seat uses that seat's share of the capacity
    const taken = (): number => this.seatsUsed - (virtual?.seat !== undefined ? 1 : 0);
    if (!virtual) while (taken() >= this.maxPlayers && this.evictYielding());
    if (taken() >= this.maxPlayers) {
      return { ok: false, code: 'ROOM_FULL', message: 'Room is full' };
    }
    if (virtual?.seat !== undefined) this.reserved.get(virtual.plugin)?.delete(virtual.seat);
    const member: Member = {
      client,
      id: client.id,
      name: this.uniqueName(client.name),
      color: this.pickColor(client.preferredColor),
      looks: client.looks,
      avatar: client.avatar,
      team: 0,
      profileId: client.profileId,
      ready: false,
      score: late ? this.catchUpScore() : 0,
      wins: 0,
      stagesWon: 0,
      connected: true,
      token: this.cfg.reconnectGraceSeconds > 0 ? randomBytes(16).toString('hex') : '',
      droppedFor: 0,
      sitOut: false,
      activeAt: ++this.activitySeq,
      privateSent: 'null',
      virtual: virtual ? { plugin: virtual.plugin, yields: virtual.yields === true, seat: virtual.seat ?? null, ext: virtual.ext } : null,
    };
    if (this.members.size === 0 && !virtual && !this.controllerId) this.hostId = member.id;
    member.team = this.emptiestTeam() ?? 0;
    this.members.set(member.id, member);
    if (this.teams && this.teamMembers(member.team) > this.teamSize) this.balanceTeams();
    client.roomCode = this.code;

    this.sendTo(client, this.welcome(member.id, false, member.token));
    this.broadcast({ t: 'PLAYER_JOINED', player: this.info(member) });
    this.sendRoomUpdate();
    // WELCOME reset the client's match data: resend the results it would otherwise miss
    if (late) this.catchUp(client);
    return { ok: true };
  }

  /** Points a late joiner starts with: `catchUpPct` percent of the lowest score at the table. */
  private catchUpScore(): number {
    let lowest = Infinity;
    for (const m of this.members.values()) if (m.connected) lowest = Math.min(lowest, m.score);
    return Number.isFinite(lowest) ? Math.round((lowest * this.catchUpPct) / 100) : 0;
  }

  isSpectator(clientId: string): boolean {
    return this.spectators.has(clientId);
  }

  /** Watch without playing: allowed in any phase, doesn't use a player slot. */
  joinSpectator(client: Client, password?: string, trusted = false): JoinResult {
    const denied = trusted ? null : this.checkPassword(client, password);
    if (denied) return denied;
    this.touch();
    const out = trusted ? null : this.kickedOut(client);
    if (out) return out;
    if (this.locked && !trusted) return { ok: false, code: 'ROOM_LOCKED', message: 'The host closed this room' };
    if (this.spectators.size >= this.cfg.maxSpectatorsPerRoom && !trusted) {
      return { ok: false, code: 'ROOM_FULL', message: 'Too many spectators in this room' };
    }
    this.spectators.set(client.id, client);
    client.roomCode = this.code;
    this.sendTo(client, this.welcome(client.id, true));
    this.sendRoomUpdate();
    this.catchUp(client);
    return { ok: true };
  }

  /** True while someone dropped could still re-attach (keeps the room alive). */
  hasResumable(): boolean {
    if (this.cfg.reconnectGraceSeconds <= 0) return false;
    for (const m of this.members.values()) if (!m.connected && m.token) return true;
    return false;
  }

  /**
   * Re-attach `client` to the member owning `token`: same id, name and score.
   * Returns false (and changes nothing) for an unknown/expired token so the caller
   * falls back to the normal join rules.
   */
  resume(client: Client, token: string): boolean {
    if (this.cfg.reconnectGraceSeconds <= 0) return false;
    const given = Buffer.from(token, 'utf8');
    let found: Member | undefined;
    for (const m of this.members.values()) {
      if (!m.token) continue;
      const want = Buffer.from(m.token, 'utf8');
      if (want.length === given.length && timingSafeEqual(want, given)) found = m;
    }
    if (!found) return false;
    this.touch();
    const old = found.client;
    if (found.connected && old !== client) {
      // half-open socket: the new connection wins
      old.roomCode = null;
      old.close(1000, 'replaced');
    }
    found.client = client;
    found.connected = true;
    found.droppedFor = 0;
    client.id = found.id;
    client.name = found.name;
    client.roomCode = this.code;
    const midMatch = this.phase !== 'lobby';
    found.sitOut = midMatch && this.phase !== 'finished';
    if (found.sitOut && (this.phase === 'countdown' || this.phase === 'playing') && this.minigame?.addPlayer) {
      // the game takes the returning player back into the round instead of making them sit it out
      this.minigame.addPlayer({ id: found.id, name: found.name });
      found.sitOut = false;
    }
    this.sendTo(client, this.welcome(found.id, false, found.token));
    this.passwordSentKey = ''; // a returning host's new socket has not been told the password yet
    if (found.id === this.previousHostId) {
      // back within the grace period: the role returns
      this.previousHostId = '';
      this.setHost(found.id);
    }
    this.reassignHost(); // the host may have dropped while nobody else was connected to take over
    this.sendRoomUpdate();
    this.catchUp(client);
    return true;
  }

  /** Send a late arrival what the players already saw of the running match. */
  private catchUp(client: Client): void {
    const mg = this.minigame;
    if ((this.phase === 'countdown' || this.phase === 'playing') && mg) {
      this.sendTo(client, this.gameStartMessage(mg));
      const m = this.members.get(client.id);
      if (m) {
        m.privateSent = 'null';
        this.sendPrivate(m);
      }
    } else if (this.phase === 'results') {
      if (this.lastResult) this.sendTo(client, this.lastResult);
      if (this.lastScores) this.sendTo(client, this.lastScores);
    } else if (this.phase === 'finished' && this.lastFinal) {
      this.sendTo(client, this.lastFinal);
    }
    if (this.vote) this.sendTo(client, { t: 'VOTE_UPDATE', vote: this.voteInfo() });
  }

  /** A spectator asks to become a player (lobby, or the results screen when the host allows late joins). */
  promote(client: Client): JoinResult {
    if (!this.spectators.has(client.id)) return { ok: false, code: 'BAD_STATE', message: 'Not spectating' };
    if (this.phase !== 'lobby' && !(this.phase === 'results' && this.lateJoin)) {
      return { ok: false, code: 'ROOM_BUSY', message: 'Wait for the next lobby to join as a player' };
    }
    this.spectators.delete(client.id);
    const res = this.admit(client); // already admitted as a spectator, so no password needed
    if (!res.ok) this.spectators.set(client.id, client); // stay a spectator
    // a host who watched (not a TV-paired phone) is an ordinary seated host again
    else if (client.id === this.controllerId && !this.screenId) this.controllerId = '';
    return res;
  }

  /** A player asks to watch instead (lobby or results only; the seat, score and ready flag are given up). */
  demote(clientId: string): JoinResult {
    const m = this.members.get(clientId);
    if (!m || m.virtual) return { ok: false, code: 'BAD_STATE', message: 'Not a player' };
    if (this.phase !== 'lobby' && this.phase !== 'results') {
      return { ok: false, code: 'ROOM_BUSY', message: 'Wait for the next lobby to change role' };
    }
    if (!m.connected) return { ok: false, code: 'BAD_STATE', message: 'Not a player' };
    if (this.spectators.size >= this.cfg.maxSpectatorsPerRoom) {
      return { ok: false, code: 'ROOM_FULL', message: 'Too many spectators in this room' };
    }
    this.touch();
    const client = m.client;
    m.token = '';
    this.members.delete(clientId);
    if (this.previousHostId === clientId) this.previousHostId = '';
    if (this.teams) this.balanceTeams();
    this.spectators.set(clientId, client);
    // the host keeps the role while watching, as a console controller does
    if (this.hostId === clientId) this.controllerId = clientId;
    if (this.vote) {
      this.vote.yes.delete(clientId);
      this.vote.no.delete(clientId);
    }
    this.broadcast({ t: 'PLAYER_LEFT', id: clientId });
    this.sendTo(client, this.welcome(clientId, true));
    if (this.hostId !== clientId && !this.members.get(this.hostId)) this.reassignHost();
    this.sendRoomUpdate();
    this.catchUp(client);
    if (this.vote) {
      this.evaluateVote();
      if (this.vote) this.sendVote(); // thresholds changed
    }
    return { ok: true };
  }

  /** The host moves a user (or themself) between the player seats and the spectators. */
  setRole(hostId: string, targetId: string, spectator: boolean): void {
    if (!this.hostOnly(hostId)) return;
    const asPlayer = this.members.get(targetId);
    const asSpectator = this.spectators.get(targetId);
    if (!asPlayer && !asSpectator) return this.error(hostId, 'BAD_STATE', 'No such player');
    if (this.screenId === targetId) return this.error(hostId, 'BAD_STATE', 'Cannot seat the TV screen');
    const res = spectator ? (asPlayer ? this.demote(targetId) : { ok: true as const }) : asSpectator ? this.promote(asSpectator) : { ok: true as const };
    if (!res.ok) this.error(hostId, res.code, res.message);
  }

  /** Room is going away: tell players and watchers and detach them so they can go elsewhere. */
  close(): void {
    this.kicked.clear();
    for (const m of this.members.values()) {
      if (!m.connected) continue;
      this.sendTo(m.client, { t: 'ERROR', code: 'ROOM_CLOSED', message: 'The room was closed' });
      m.client.roomCode = null;
    }
    for (const s of this.spectators.values()) {
      this.sendTo(s, { t: 'ERROR', code: 'ROOM_CLOSED', message: 'The room was closed' });
      s.roomCode = null;
    }
    this.spectators.clear();
  }

  /**
   * `client`, when given, must be the socket currently attached (a replaced one is ignored).
   * `voluntary`: the player closed the connection on purpose, so a lobby seat is freed at once
   * instead of being held for the reconnect grace period.
   */
  leave(clientId: string, client?: Client, voluntary = false): void {
    const current = this.members.get(clientId)?.client ?? this.spectators.get(clientId);
    if (client && current && current !== client) return;
    this.touch();
    if (this.spectators.delete(clientId)) {
      if (clientId === this.screenId) this.screenId = '';
      if (clientId === this.controllerId) this.dropController();
      this.sendRoomUpdate();
      return;
    }
    const m = this.members.get(clientId);
    if (!m) return;
    if (clientId === this.controllerId) this.controllerId = ''; // a watching host who took a seat
    m.connected = false;
    m.droppedFor = 0;
    // seats (lobby or mid-match) are kept for the grace period; without one they are freed at once
    if (this.cfg.reconnectGraceSeconds <= 0 || (voluntary && this.phase === 'lobby')) m.token = '';
    if (this.phase === 'lobby' && !m.token) this.members.delete(clientId);
    this.minigame?.removePlayer(clientId);
    this.broadcast({ t: 'PLAYER_LEFT', id: clientId });
    if (this.hostId === clientId) {
      this.reassignHost();
      // a seat still held for the grace period gets the role back if it returns
      if (this.hostId !== clientId && m.token && !this.previousHostId) this.previousHostId = clientId;
    }
    if (!this.members.has(clientId) && this.previousHostId === clientId) this.previousHostId = '';
    this.sendRoomUpdate();
    if (this.vote) {
      this.evaluateVote();
      if (this.vote) this.sendVote(); // thresholds changed
    }
  }

  private welcome(id: string, spectator: boolean, resume = ''): ServerMessage {
    return {
      t: 'WELCOME',
      v: PROTOCOL_VERSION,
      id,
      code: this.code,
      selection: this.selection,
      spectator,
      ...(resume ? { resume } : {}),
      config: {
        tickRate: this.cfg.tickRate,
        networkRate: this.effectiveNetworkRate,
        maxPlayers: this.maxPlayers,
        totalGames: this.totalGames,
      },
    };
  }

  /** Make sure the host is a connected member; hand the role to the first connected one otherwise. */
  private reassignHost(): void {
    if (this.members.get(this.hostId)?.connected) return;
    if (this.controllerId && this.hostId === this.controllerId && this.spectators.has(this.controllerId)) return;
    for (const m of this.members.values()) {
      if (m.connected && !m.virtual) {
        this.setHost(m.id);
        return;
      }
    }
  }

  /** The controller phone left: the role goes to the first connected player (or stays empty until one joins). */
  private dropController(): void {
    this.controllerId = '';
    this.hostId = '';
    this.reassignHost();
  }

  /** Give the host role to `id` and tell the room who holds it now. */
  private setHost(id: string): void {
    if (this.hostId === id) return;
    this.hostId = id;
    this.hostIdleFor = 0;
    const name = (this.members.get(id) ?? this.spectators.get(id))?.name ?? '';
    this.broadcast({ t: 'NOTICE', message: `${name} is now the host`, code: 'HOST_CHANGED', id, name });
  }

  /** Note a deliberate action by a member (anything but INPUT/PING); the host's silence is what hostIdleSeconds counts. */
  noteActive(clientId: string): void {
    const m = this.members.get(clientId);
    if (!m) return;
    m.activeAt = ++this.activitySeq;
    if (clientId === this.hostId) this.hostIdleFor = 0;
  }

  /** A host who walked away: after hostIdleSeconds the role goes to the most recently active connected player. */
  private checkHostIdle(dt: number): void {
    const host = this.members.get(this.hostId);
    if (this.phase === 'playing' || this.phase === 'countdown' || !host?.connected) {
      this.hostIdleFor = 0;
      return;
    }
    let best: Member | undefined;
    for (const m of this.members.values()) {
      if (m.id !== host.id && m.connected && !m.virtual && (!best || m.activeAt > best.activeAt)) best = m;
    }
    // only someone who acted more recently than the host: if everybody is away, nothing changes
    if (!best || best.activeAt <= host.activeAt) {
      this.hostIdleFor = 0;
      return;
    }
    this.hostIdleFor += dt;
    if (this.hostIdleFor >= this.cfg.hostIdleSeconds) this.setHost(best.id);
  }

  /** The preferred colour when free, else the first free palette entry. */
  private pickColor(preferred: number | null): number {
    const used = new Set([...this.members.values()].map((m) => m.color));
    if (preferred !== null && !used.has(preferred)) return preferred;
    for (let i = 0; i < PALETTE.length; i++) if (!used.has(i)) return i;
    return preferred ?? this.members.size % PALETTE.length;
  }

  private uniqueName(name: string): string {
    const taken = new Set([...this.members.values()].map((m) => nameKey(m.name)));
    if (!taken.has(nameKey(name))) return name;
    for (let i = 2; i < 100; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(nameKey(candidate))) return candidate;
    }
    return name;
  }

  // ---- host management ------------------------------------------------------

  private hostOnly(clientId: string): boolean {
    if (this.isHost(clientId)) return true;
    this.error(clientId, 'NOT_HOST', 'Only the host can do that');
    return false;
  }

  /** Remove a player or spectator from the room for good (the seat cannot be resumed). */
  kick(hostId: string, targetId: string): void {
    if (!this.hostOnly(hostId)) return;
    if (targetId === hostId) return this.error(hostId, 'BAD_STATE', 'You cannot remove yourself');
    const profileId = this.members.get(targetId)?.profileId ?? this.spectators.get(targetId)?.profileId ?? null;
    if (!this.removeTarget(targetId, 'KICKED', 'The host removed you from the room')) {
      this.error(hostId, 'BAD_STATE', 'No such player');
    } else if (profileId) {
      this.kicked.delete(profileId);
      this.kicked.add(profileId);
      if (this.kicked.size > 16) this.kicked.delete(this.kicked.values().next().value as string);
    }
  }

  private kickedOut(client: Client): JoinResult | null {
    if (!client.profileId || !this.kicked.has(client.profileId)) return null;
    return { ok: false, code: 'KICKED', message: 'The host removed you from this room' };
  }

  /** Operator removal: like `kick` but needs no host, and may remove the host (the seat passes on). */
  adminKick(targetId: string, code: 'KICKED' | 'BANNED' = 'KICKED', why: { reason?: string; minutes?: number } = {}): boolean {
    const message = code === 'BANNED' ? 'You have been banned from this server' : 'An administrator removed you from the room';
    return this.removeTarget(targetId, code, message, why);
  }

  private removeTarget(targetId: string, code: ErrorCode, message: string, why: { reason?: string; minutes?: number } = {}): boolean {
    this.touch();
    const told = (c: Client) => {
      c.send(JSON.stringify({ t: 'ERROR', code, message, ...(why.reason ? { reason: why.reason } : {}), ...(why.minutes ? { minutes: why.minutes } : {}) } satisfies ServerMessage));
      c.roomCode = null;
      c.close(code === 'BANNED' ? 1008 : 1000, code === 'BANNED' ? 'banned' : 'kicked');
    };
    const spectator = this.spectators.get(targetId);
    if (spectator) {
      this.spectators.delete(targetId);
      told(spectator);
      this.sendRoomUpdate();
      return true;
    }
    const m = this.members.get(targetId);
    if (!m) return false;
    m.token = '';
    this.members.delete(targetId);
    if (this.previousHostId === targetId) this.previousHostId = '';
    this.minigame?.removePlayer(targetId);
    // only an operator can remove the host; the seat must pass on before anyone is told
    if (this.hostId === targetId) this.reassignHost();
    if (m.connected) told(m.client);
    this.broadcast({ t: 'PLAYER_LEFT', id: targetId });
    this.sendRoomUpdate();
    if (this.vote) {
      this.vote.yes.delete(targetId);
      this.vote.no.delete(targetId);
      this.evaluateVote();
      if (this.vote) this.sendVote(); // thresholds changed
    }
    return true;
  }

  /** Lock or unlock the room to newcomers (operator). */
  adminSetLocked(locked: boolean): void {
    this.locked = locked;
    this.sendRoomUpdate();
  }

  /** Show every player and watcher a message from the operator. */
  adminNotice(message: string): void {
    this.broadcast({ t: 'NOTICE', message });
  }

  /** A notice the client words itself in the player's language (`message` is the English fallback). */
  adminCodedNotice(code: 'SELECTION_RESET', message: string): void {
    this.broadcast({ t: 'NOTICE', message, code });
  }

  /** Operator version of `resetName`. */
  adminResetName(targetId: string): boolean {
    const m = this.members.get(targetId);
    if (!m) return false;
    this.touch();
    m.name = '';
    m.name = this.uniqueName('Player');
    m.client.name = m.name;
    this.sendRoomUpdate();
    return true;
  }

  adminMembers(): AdminMemberInfo[] {
    const players = [...this.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      spectator: false,
      connected: m.connected,
      host: m.id === this.hostId,
      ready: m.ready,
      score: m.score,
      profileId: m.profileId,
      ip: m.client.ip,
    }));
    const watchers = [...this.spectators.values()].map((c) => ({
      id: c.id,
      name: c.name,
      spectator: true,
      connected: true,
      host: false,
      ready: false,
      score: 0,
      profileId: c.profileId,
      ip: c.ip,
    }));
    return [...players, ...watchers];
  }

  makeHost(hostId: string, targetId: string): void {
    if (!this.hostOnly(hostId)) return;
    const m = this.members.get(targetId);
    if (!m || !m.connected || targetId === hostId) return this.error(hostId, 'BAD_STATE', 'Cannot hand over to that player');
    this.touch();
    this.previousHostId = '';
    this.setHost(targetId);
    this.sendRoomUpdate();
  }

  /** Operator version of `makeHost`: hand the host role to a connected player. */
  adminMakeHost(targetId: string): boolean {
    const m = this.members.get(targetId);
    if (!m?.connected) return false;
    this.touch();
    this.previousHostId = '';
    this.setHost(targetId);
    this.sendRoomUpdate();
    return true;
  }

  setSettings(hostId: string, s: { locked?: boolean; maxPlayers?: number; teams?: boolean; password?: string | null; lateJoin?: boolean; catchUp?: number }): void {
    if (!this.hostOnly(hostId)) return;
    this.touch();
    if (s.teams !== undefined && s.teams !== this.teams) {
      if (this.phase !== 'lobby') return this.error(hostId, 'BAD_STATE', 'Teams can only change in the lobby');
      if (s.teams && !selectionSupportsTeams(this._selection)) {
        return this.error(hostId, 'BAD_STATE', 'This selection does not support teams');
      }
      this.teams = s.teams;
      if (this.teams) this.balanceTeams();
      for (const m of this.members.values()) m.ready = false;
    }
    if (s.maxPlayers !== undefined) {
      if (this.phase !== 'lobby') return this.error(hostId, 'BAD_STATE', 'Player cap can only change in the lobby');
      this.requestedMax = Math.min(this.cfg.maxPlayersPerRoom, Math.max(2, this.members.size, s.maxPlayers));
      this.maxPlayers = this.effectiveMax();
    }
    if (s.locked !== undefined) this.locked = s.locked;
    if (s.lateJoin !== undefined) this.lateJoin = s.lateJoin;
    if (s.catchUp !== undefined) this.catchUpPct = Math.min(100, Math.max(0, Math.round(s.catchUp)));
    if (s.password !== undefined) this.setPassword(s.password);
    this.sendRoomUpdate();
  }

  /** One report per reporter and target, at most 3 reports a minute per reporter; silent to the room. */
  report(reporterId: string, targetId: string): void {
    const reporter = this.members.get(reporterId) ?? this.spectators.get(reporterId);
    const target = this.members.get(targetId);
    if (!reporter || !target || targetId === reporterId) return;
    const key = `${reporterId}>${targetId}`;
    if (this.reportedPairs.has(key) || !this.reportLimiter.allow(reporterId)) return;
    if (this.reportedPairs.size >= MAX_REPORTED_PAIRS) this.reportedPairs.delete(this.reportedPairs.values().next().value!);
    this.reportedPairs.add(key);
    this.hooks.reported?.({
      room: this.code,
      reporterId,
      reporter: reporter.name,
      targetId,
      target: target.name,
      ...(target.profileId ? { targetProfileId: target.profileId } : {}),
    });
  }

  /** Relay a quick reaction from a player or spectator to everyone in the room. */
  emote(clientId: string, emote: number): void {
    const name = this.members.get(clientId)?.name ?? this.spectators.get(clientId)?.name;
    if (name === undefined || !this.emoteLimiter.allow(clientId)) return;
    this.broadcast({ t: 'EMOTE', from: clientId, name, emote }, true);
  }

  /** Move a player to a team in the lobby: oneself, or (host only) anyone. */
  setTeam(clientId: string, team: number, targetId?: string): void {
    const id = targetId ?? clientId;
    if (id !== clientId && !this.hostOnly(clientId)) return;
    if (this.phase !== 'lobby') return this.error(clientId, 'BAD_STATE', 'Teams can only change in the lobby');
    if (!this.teams) return this.error(clientId, 'BAD_STATE', 'The room is not playing in teams');
    const m = this.members.get(id);
    if (!m) return this.error(clientId, 'BAD_STATE', 'No such player');
    if (team < 0 || team >= MAX_TEAMS) return this.error(clientId, 'BAD_STATE', 'No such team');
    if (this.teamMembers(team, id) >= this.teamSize) return this.error(clientId, 'BAD_STATE', 'That team is full');
    this.touch();
    m.team = team;
    this.sendRoomUpdate();
  }

  /** Change game / variant / options before the match starts. Everyone must confirm readiness again. */
  setSelection(hostId: string, selection: GameSelection): void {
    if (!this.hostOnly(hostId)) return;
    if (this.phase !== 'lobby') return this.error(hostId, 'BAD_STATE', 'The game can only change in the lobby');
    const refused = this.hooks.checkSelection?.(selection);
    if (refused) return this.error(hostId, 'GAME_DISABLED', refused);
    const tooMany = this.playerCountError(selection, this.connectedCount);
    if (tooMany) return this.error(hostId, 'TOO_MANY_PLAYERS', tooMany);
    this.touch();
    this._selection = selection;
    this.maxPlayers = this.effectiveMax();
    if (this.teams) {
      if (!selectionSupportsTeams(selection)) this.teams = false;
      else if ([...this.members.values()].some((m) => this.teamMembers(m.team) > this.teamSize)) this.balanceTeams();
    }
    for (const m of this.members.values()) m.ready = false;
    this.sendRoomUpdate();
  }

  /** Operator reset to the default mix (the chosen game was switched off). Everyone must ready up again. */
  adminResetSelection(): void {
    this._selection = DEFAULT_SELECTION;
    this.maxPlayers = this.effectiveMax();
    for (const m of this.members.values()) m.ready = false;
    this.touch();
    this.sendRoomUpdate();
  }

  /** The game / variant / playlist the lobby is set to is not allowed any more. Only idle phases are touched. */
  get canResetSelection(): boolean {
    return this.phase === 'lobby' || this.phase === 'finished';
  }

  resetName(hostId: string, targetId: string): void {
    if (!this.hostOnly(hostId)) return;
    const m = this.members.get(targetId);
    if (!m) return this.error(hostId, 'BAD_STATE', 'No such player');
    this.touch();
    // free the old name first so "Player" can be reused when it was the target's own
    m.name = '';
    m.name = this.uniqueName('Player');
    m.client.name = m.name;
    this.sendRoomUpdate();
  }

  // ---- client intents ------------------------------------------------------

  setReady(clientId: string, ready: boolean): void {
    const m = this.members.get(clientId);
    if (!m || this.phase !== 'lobby') return this.error(clientId, 'BAD_STATE', 'Not in lobby');
    m.ready = ready;
    this.sendRoomUpdate();
  }

  /** `force`: start even though some players are not ready (they are counted as ready). */
  startMatch(clientId: string, force = false): void {
    if (clientId !== this.hostId) return this.error(clientId, 'NOT_HOST', 'Only the host can start');
    if (this.phase !== 'lobby') return this.error(clientId, 'BAD_STATE', 'Match already started');
    if (!ALL_PLAYABLES.some((p) => this.hooks.isPlayableEnabled?.(p.id) ?? true)) return this.error(clientId, 'NO_GAMES', 'No games are installed on this server');
    const waiting: string[] = [];
    for (const m of this.members.values()) if (m.id !== this.hostId && m.connected && !m.ready) waiting.push(m.name);
    if (waiting.length > 0 && !force) {
      const shown = waiting.slice(0, 3).join(', ');
      return this.error(clientId, 'NOT_READY', `Waiting for: ${shown}${waiting.length > 3 ? ` +${waiting.length - 3}` : ''}`);
    }
    const tooMany = this.playerCountError(this._selection, this.connectedCount);
    if (tooMany) return this.error(clientId, 'TOO_MANY_PLAYERS', tooMany);
    const badTeams = this.teamsError();
    if (badTeams) return this.error(clientId, 'BAD_STATE', badTeams);
    for (const m of this.members.values()) if (m.connected) m.ready = true;
    this.resetMatchState();
    this.startNextGame();
  }

  nextGame(clientId: string): void {
    if (clientId !== this.hostId) return this.error(clientId, 'NOT_HOST', 'Only the host can continue');
    if (this.phase !== 'results') return this.error(clientId, 'BAD_STATE', 'Not showing results');
    this.advance();
  }

  /** Host asks to leave the finished match for the lobby; the players vote on it. */
  rematch(clientId: string): void {
    this.startVote(clientId, 'change');
  }

  /** The host sends everyone back to the lobby right now (no vote): a running round is cut off and no result is recorded. */
  forceLobby(clientId: string): void {
    if (!this.hostOnly(clientId)) return;
    if (this.phase === 'lobby') return this.error(clientId, 'BAD_STATE', 'Already in the lobby');
    if (this.vote) {
      const kind = this.vote.kind;
      this.vote = null;
      this.broadcast({ t: 'VOTE_UPDATE', vote: null, outcome: 'cancelled', kind });
    }
    this.backToLobby();
    this.broadcast({ t: 'NOTICE', message: 'The host sent everyone back to the lobby', code: 'BACK_TO_LOBBY' });
  }

  /** Everyone back to the lobby with the selection kept (the host can change it there). */
  private backToLobby(): void {
    for (const [id, m] of this.members) {
      if (!m.connected) this.members.delete(id);
      else m.ready = false;
    }
    this.reassignHost();
    this.resetMatchState();
    this.minigame = null;
    this.phase = 'lobby';
    this.sendRoomUpdate();
  }

  handleInput(clientId: string, input: InputState): void {
    const m = this.members.get(clientId);
    if (!m || !m.connected || m.sitOut) return;
    if (this.phase === 'playing') this.minigame?.handleInput(clientId, input);
  }

  /** A game-defined message from a player (GAME_ACTION); only the running minigame sees it. */
  handleAction(clientId: string, data: Record<string, unknown>): void {
    const m = this.members.get(clientId);
    if (!m || !m.connected || m.sitOut) return;
    if (this.phase === 'playing') this.minigame?.handleAction?.(clientId, data);
  }

  // ---- restart votes ------------------------------------------------------

  /** A player asks to restart the round or the match; everyone else votes. */
  startVote(clientId: string, kind: VoteKind): void {
    const endKind = kind === 'again' || kind === 'change';
    // the controller phone has no seat but may choose what happens after a match
    const seated = this.members.get(clientId);
    const asker = seated ?? (endKind && this.isController(clientId) ? this.spectators.get(clientId) : undefined);
    if (!asker || (seated && !seated.connected)) return this.error(clientId, 'BAD_STATE', 'Not in this match');
    if (endKind && clientId !== this.hostId) return this.error(clientId, 'NOT_HOST', 'Only the host can choose');
    const phases: RoomPhase[] = endKind
      ? ['finished']
      : kind === 'round'
        ? ['countdown', 'playing']
        : ['countdown', 'playing', 'results'];
    if (!phases.includes(this.phase)) return this.error(clientId, 'BAD_STATE', 'Cannot restart right now');
    if (this.vote) return this.error(clientId, 'VOTE_ACTIVE', 'A vote is already in progress');
    if (this.voteCooldown > 0) {
      return this.error(clientId, 'VOTE_COOLDOWN', `Wait ${Math.ceil(this.voteCooldown)}s before asking again`);
    }
    this.vote = { kind, by: asker.name, yes: new Set([clientId]), no: new Set(), left: VOTE_SECONDS };
    // a controller is not in the head count, so what it chooses after a match stands without a vote
    if (!seated) return this.endVote('passed');
    this.sendVote();
    this.evaluateVote();
  }

  castVote(clientId: string, yes: boolean): void {
    const m = this.members.get(clientId);
    if (!m || !m.connected) return;
    const v = this.vote;
    if (!v) return this.error(clientId, 'BAD_STATE', 'No vote in progress');
    v.yes.delete(clientId);
    v.no.delete(clientId);
    (yes ? v.yes : v.no).add(clientId);
    this.sendVote();
    this.evaluateVote();
  }

  private connectedIds(): string[] {
    return [...this.members.values()].filter((m) => m.connected).map((m) => m.id);
  }

  private voteInfo(): VoteInfo | null {
    const v = this.vote;
    if (!v) return null;
    const ids = this.connectedIds();
    return {
      kind: v.kind,
      by: v.by,
      yes: ids.filter((id) => v.yes.has(id)),
      no: ids.filter((id) => v.no.has(id)),
      needed: Math.floor(ids.length / 2) + 1,
      total: ids.length,
      left: Math.max(0, Math.round(v.left * 10) / 10),
    };
  }

  private sendVote(outcome?: VoteOutcome, kind?: VoteKind): void {
    this.broadcast({ t: 'VOTE_UPDATE', vote: this.voteInfo(), ...(outcome ? { outcome, kind } : {}) });
  }

  /** Pass / fail as soon as the result can no longer change. */
  private evaluateVote(): void {
    const v = this.voteInfo();
    if (!this.vote || !v) return;
    if (v.total === 0) return this.endVote('cancelled');
    if (v.yes.length >= v.needed) return this.endVote('passed');
    if (v.no.length > v.total - v.needed) return this.endVote('failed');
  }

  private endVote(outcome: VoteOutcome): void {
    const v = this.vote;
    if (!v) return;
    this.vote = null;
    if (outcome === 'failed') this.voteCooldown = VOTE_COOLDOWN_SECONDS;
    this.broadcast({ t: 'VOTE_UPDATE', vote: null, outcome, kind: v.kind });
    if (outcome !== 'passed') return;
    if (v.kind === 'change') {
      this.backToLobby();
    } else if (v.kind === 'again' || v.kind === 'match') {
      if (v.kind === 'again') {
        for (const [id, m] of this.members) if (!m.connected) this.members.delete(id);
        this.reassignHost();
        this.matchStartedAt = 0;
      }
      this.resetMatchState();
      this.startNextGame();
    } else {
      this.startGame(); // same round, same variant, scores untouched
    }
  }

  // ---- simulation ----------------------------------------------------------

  /** Called by the global fixed-step loop. dt in seconds. */
  update(dt: number): void {
    if (this.phase === 'lobby' || this.phase === 'finished') this.idleSeconds += dt;
    else this.idleSeconds = 0;
    const idleLimit = this.cfg.idleRoomSeconds;
    if (idleLimit > 0 && !this.idleWarned) {
      // one heads-up before the idle reaper closes the room (a message or any touch() resets it)
      const lead = Math.min(this.cfg.idleWarnSeconds, Math.floor(idleLimit / 2));
      if (lead > 0 && this.idleSeconds >= idleLimit - lead) {
        this.idleWarned = true;
        this.broadcast({ t: 'NOTICE', message: 'This room will close soon because nobody is playing', code: 'IDLE_CLOSING', seconds: lead });
      }
    }
    this.voteCooldown = Math.max(0, this.voteCooldown - dt);
    if (this.cfg.hostIdleSeconds > 0) this.checkHostIdle(dt);
    for (const [id, m] of this.members) {
      if (m.connected || !m.token) continue;
      m.droppedFor += dt;
      if (m.droppedFor < this.cfg.reconnectGraceSeconds) continue;
      m.token = ''; // grace over
      if (this.previousHostId === id) this.previousHostId = '';
      // a lobby seat has nothing left to keep; with nobody else connected it stays so the
      // manager sees a room with no one able to come back and closes it
      if (this.phase === 'lobby' && this.connectedCount > 0) {
        this.members.delete(id);
        this.reassignHost();
        this.sendRoomUpdate();
      }
    }
    if (this.vote) {
      this.vote.left -= dt;
      if (this.vote.left <= 0) this.endVote('failed');
    }
    switch (this.phase) {
      case 'countdown':
        this.timer -= dt;
        this.afterTick();
        if (this.timer <= 0) {
          this.phase = 'playing';
          this.sendRoomUpdate();
        }
        break;
      case 'playing': {
        const mg = this.minigame!;
        mg.update(dt);
        this.events.push(...mg.drainEvents());
        if (mg.isFinished()) {
          this.finishGame();
        } else {
          this.afterTick();
        }
        break;
      }
      case 'results':
        this.timer -= dt;
        if (this.timer <= 0) this.advance();
        break;
      default:
        break;
    }
  }

  private afterTick(): void {
    this.tick++;
    if (this.tick % this.netEvery === 0) this.broadcastState();
  }

  private broadcastState(): void {
    const mg = this.minigame;
    if (!mg) return;
    const playing = this.phase === 'playing';
    this.broadcast(
      {
        t: 'GAME_STATE',
        tick: this.tick,
        phase: playing ? 'playing' : 'countdown',
        countdown: playing ? 0 : Math.max(0, Math.round(this.timer * 10) / 10),
        state: mg.getState(),
      },
      true,
    );
    if (mg.getPrivateState) for (const m of this.members.values()) this.sendPrivate(m);
    this.flushEvents();
  }

  /** Send a player their private state (see Minigame.getPrivateState) when it changed since the last send. */
  private sendPrivate(m: Member): void {
    const mg = this.minigame;
    if (!mg?.getPrivateState || !m.connected || m.sitOut) return;
    const json = JSON.stringify(mg.getPrivateState(m.id) ?? null);
    if (json === m.privateSent) return;
    m.privateSent = json;
    m.client.send(`{"t":"GAME_PRIVATE","data":${json}}`);
  }

  private flushEvents(): void {
    if (this.events.length === 0) return;
    this.broadcast({ t: 'GAME_EVENT', events: this.events });
    this.events = [];
  }

  private startNextGame(): void {
    this.gameIndex++;
    this.stageRound++;
    this.startGame();
  }

  /** (Re)start the minigame of the current `gameIndex` with a fresh countdown. */
  private startGame(): void {
    if (this.vote) this.endVote('cancelled');
    const players = [...this.members.values()]
      .filter((m) => m.connected)
      .map((m) => ({ id: m.id, name: m.name }));
    const mg = createMinigame(this.selection, this._selection.playlist?.length ? this.stageIndex : this.gameIndex, this.hooks.isPlayableEnabled, players.length);
    for (const m of this.members.values()) {
      m.sitOut = false;
      m.privateSent = 'null';
    }
    mg.init(players);
    this.minigame = mg;
    if (this.gameIndex === 0 || this.matchStartedAt === 0) {
      this.playedGames = [];
      this.rounds = [];
      this.matchStartedAt = Date.now();
    }
    this.playedGames[this.gameIndex] = { id: mg.id, name: mg.name };
    this.events = [];
    this.tick = 0;
    this.phase = 'countdown';
    this.timer = COUNTDOWN_SECONDS;
    this.broadcast(this.gameStartMessage(mg));
    this.sendRoomUpdate();
    this.broadcastState();
  }

  private finishGame(): void {
    if (this.vote) this.endVote('cancelled');
    const mg = this.minigame!;
    // final snapshot + remaining events so clients see the last elimination
    this.broadcastState();

    const names = new Map([...this.members.values()].map((m) => [m.id, m.name]));
    const placements: Placement[] = mg
      .getPlacements()
      .map((p) => ({
        id: p.id,
        name: names.get(p.id) ?? '?',
        place: p.place,
        points: placementPoints(p.place),
        ...(this.teams && this.members.has(p.id) ? { team: this.members.get(p.id)!.team } : {}),
      }))
      .sort((a, b) => a.place - b.place);
    for (const p of placements) {
      const m = this.members.get(p.id);
      if (m) m.score += p.points;
    }
    // in teams the members' points are summed and the best team wins the round for all its members
    let teamResults: TeamResult[] | undefined;
    if (this.teams) {
      const sums = new Map<number, number>();
      for (const p of placements) if (p.team !== undefined) sums.set(p.team, (sums.get(p.team) ?? 0) + p.points);
      teamResults = rankTeams(sums);
      const winners = new Set(teamResults.filter((r) => r.place === 1).map((r) => r.team));
      for (const p of placements) {
        const m = this.members.get(p.id);
        if (m && winners.has(m.team)) m.wins++;
      }
    } else {
      // every player sharing 1st place wins the round
      for (const p of placements) if (p.place === 1) {
        const m = this.members.get(p.id);
        if (m) m.wins++;
      }
    }
    this.rounds.push({ game: { id: mg.id, name: mg.name }, placements: placements.map((p) => ({ id: p.id, name: p.name, place: p.place, points: p.points })) });
    if (this.hooks.recordResult) {
      for (const p of placements) {
        const m = this.members.get(p.id);
        if (m?.profileId) {
          this.hooks.recordResult(m.profileId, { name: m.name, game: { id: mg.id, place: p.place, points: p.points } });
        }
      }
    }

    const stats = mg.getStats?.();
    this.phase = 'results';
    this.timer = RESULTS_SECONDS;
    this.lastResult = { t: 'GAME_RESULT', game: { id: mg.id, name: mg.name }, placements, ...(stats ? { stats } : {}), last: this.matchEndsAfterThisRound(), stage: { n: this.stageIndex + 1, of: this.totalGames, target: this.stageTarget }, ...(teamResults ? { teams: teamResults } : {}) };
    this.lastScores = { t: 'SCORE_UPDATE', scores: this.scores() };
    this.broadcast(this.lastResult);
    this.broadcast(this.lastScores);
    this.sendRoomUpdate();
  }

  private advance(): void {
    if (this.vote) this.endVote('cancelled');
    const reached = [...this.members.values()].filter((m) => m.wins >= this.stageTarget);
    if (reached.length === 0) {
      this.startNextGame(); // nobody has enough wins yet: another round of this stage
      return;
    }
    for (const m of reached) m.stagesWon++;
    if (this.stageIndex + 1 < this.totalGames) {
      this.stageIndex++;
      this.stageRound = 0;
      for (const m of this.members.values()) m.wins = 0;
      this.startNextGame();
      return;
    }
    {
      // a playlist is decided by stages won, a single game by its round wins
      const wins = (m: Member) => (this.totalGames > 1 ? m.stagesWon : m.wins);
      const ranking = [...this.members.values()]
        .map((m) => ({ id: m.id, name: m.name, score: m.score, wins: wins(m), ...(this.teams ? { team: m.team } : {}) }))
        .sort((a, b) => b.wins - a.wins || b.score - a.score);
      // the MVP won the most rounds (ties: most points); playing alone has none
      const roundWins = new Map<string, number>();
      for (const round of this.rounds) for (const p of round.placements) if (p.place === 1) roundWins.set(p.id, (roundWins.get(p.id) ?? 0) + 1);
      const mvpPick = ranking.length >= 2 ? [...ranking].sort((a, b) => (roundWins.get(b.id) ?? 0) - (roundWins.get(a.id) ?? 0) || b.score - a.score)[0] : undefined;
      const mvp = mvpPick && (roundWins.get(mvpPick.id) ?? 0) > 0 ? mvpPick.id : undefined;
      if (this.hooks.recordResult) {
        const top = ranking[0];
        const ts = Date.now();
        for (let i = 0; i < ranking.length; i++) {
          const r = ranking[i]!;
          const m = this.members.get(r.id);
          if (!m?.profileId) continue;
          // a win needs an opponent: playing alone is practice
          const won = ranking.length >= 2 && !!top && r.wins === top.wins && r.score === top.score && top.wins > 0;
          // ties share a place
          let place = i + 1;
          while (place > 1 && ranking[place - 2]!.wins === r.wins && ranking[place - 2]!.score === r.score) place--;
          const rounds: MatchSummary['rounds'] = [];
          for (const round of this.rounds) {
            const p = round.placements.find((q) => q.id === r.id);
            if (p && rounds.length < RECENT_ROUNDS_MAX) rounds.push({ game: round.game.id, place: p.place, points: p.points });
          }
          this.hooks.recordResult(m.profileId, { name: m.name, match: { score: r.score, won, summary: { ts, players: ranking.length, place, score: r.score, won, mvp: mvp === r.id, rounds } } });
        }
      }
      this.hooks.matchFinished?.({
        ts: Date.now(),
        room: this.code,
        durationSec: Math.round((Date.now() - this.matchStartedAt) / 1000),
        games: this.playedGames.filter(Boolean),
        ranking: ranking.map((r) => ({
          // guests are never stored under the name they picked
          name: this.members.get(r.id)?.profileId ? r.name : 'Guest',
          score: r.score,
          signedIn: !!this.members.get(r.id)?.profileId,
        })),
      });
      this.matchStartedAt = 0;
      this.phase = 'finished';
      this.minigame = null;
      let teamRanking: (TeamResult & { wins: number })[] | undefined;
      if (this.teams) {
        const byTeam = new Map<number, { points: number; wins: number }>();
        for (const r of ranking) {
          if (r.team === undefined) continue;
          const cur = byTeam.get(r.team) ?? { points: 0, wins: 0 };
          byTeam.set(r.team, { points: cur.points + r.score, wins: Math.max(cur.wins, r.wins) });
        }
        const order = [...byTeam.entries()].sort((a, b) => b[1].wins - a[1].wins || b[1].points - a[1].points);
        teamRanking = order.map(([team, v], i) => {
          const prev = order[i - 1];
          const tie = prev && prev[1].wins === v.wins && prev[1].points === v.points;
          return { team, points: v.points, wins: v.wins, place: tie ? 0 : i + 1 };
        });
        for (let i = 0; i < teamRanking.length; i++) if (teamRanking[i]!.place === 0) teamRanking[i]!.place = teamRanking[i - 1]!.place;
      }
      this.lastFinal = { t: 'MATCH_FINISHED', ranking, ...(teamRanking ? { teams: teamRanking } : {}), ...(mvp ? { mvp } : {}), rounds: this.rounds };
      this.broadcast(this.lastFinal);
      this.sendRoomUpdate();
    }
  }

  /** True when the stage that just ended was the last one and somebody has reached its target. */
  private matchEndsAfterThisRound(): boolean {
    const target = this.stageTarget;
    return this.stageIndex + 1 >= this.totalGames && [...this.members.values()].some((m) => m.wins >= target);
  }

  // ---- helpers -------------------------------------------------------------

  private scores(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const m of this.members.values()) out[m.id] = m.score;
    return out;
  }

  private info(m: Member): PlayerInfo {
    return {
      id: m.id,
      name: m.name,
      ready: m.ready,
      score: m.score,
      wins: m.wins,
      connected: m.connected,
      color: m.color,
      looks: m.looks,
      ...(m.avatar ? { avatar: m.avatar } : {}),
      ...(this.teams ? { team: m.team } : {}),
      ...(m.virtual ? { virtual: true, ...(m.virtual.ext !== undefined ? { ext: { [m.virtual.plugin]: m.virtual.ext } } : {}) } : {}),
    };
  }

  private sendRoomUpdate(): void {
    this.hooks.changed?.(this);
    this.broadcast({
      t: 'ROOM_UPDATE',
      phase: this.phase,
      hostId: this.hostId,
      ...(this.controllerId ? { controller: true } : {}),
      selection: this.selection,
      spectators: this.spectators.size,
      watchers: [...this.spectators.values()].map((c) => ({ id: c.id, name: c.name })),
      locked: this.locked,
      lateJoin: this.lateJoin,
      catchUp: this.catchUpPct,
      maxPlayers: this.maxPlayers,
      teams: this.teams,
      ...(this.teams && Number.isFinite(this.teamSize) ? { teamSize: this.teamSize } : {}),
      passwordProtected: this.passwordProtected,
      ...(this.exts.size > 0 ? { ext: Object.fromEntries(this.exts) } : {}),
      players: [...this.members.values()].map((m) => this.info(m)),
    });
    // only the host learns the password, and only when it (or the host) changed
    const host = this.members.get(this.hostId);
    const key = `${this.hostId}\0${this.password ?? ''}`;
    if (host?.connected && key !== this.passwordSentKey) {
      this.passwordSentKey = key;
      this.sendTo(host.client, { t: 'ROOM_PASSWORD', password: this.password });
    }
  }

  private error(clientId: string, code: ErrorCode, message: string): void {
    const m = this.members.get(clientId);
    if (m) this.sendTo(m.client, { t: 'ERROR', code, message });
    else if (this.isController(clientId)) this.sendTo(this.spectators.get(clientId)!, { t: 'ERROR', code, message });
  }

  private sendTo(client: Client, msg: ServerMessage): void {
    client.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage, droppable = false): void {
    const json = JSON.stringify(msg);
    for (const m of this.members.values()) {
      if (m.connected) m.client.send(json, droppable);
    }
    for (const s of this.spectators.values()) s.send(json, droppable);
  }
}
