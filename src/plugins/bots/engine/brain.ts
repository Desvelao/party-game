// The bot's decision-making and lobby behaviour, free of any transport. A host feeds it the server's messages
// (`handle`), calls `tick` at its decision rate and sends what it emits: the WebSocket client (`client.ts`) does that over
// a socket, the bots plugin does it with a virtual client inside the game server.
import { performance } from 'node:perf_hooks';
import type { ClientMessage, GameBrain as GameBot, Incident, InputState, PlayerInfo, RoomPhase, ServerMessage } from '../../../core/shared';
import { pluginForKind } from './registry';

/** What a dashboard needs to know about a running bot. */
export type BotEvent =
  | { kind: 'joined'; room: string; id: string }
  | { kind: 'lobby'; phase: RoomPhase; players: number; game: string; variant: string; /** games of a custom playlist */ playlist: string[] }
  /** the round being played has no AI: the bot sits it out (on) / plays again (off) */
  | { kind: 'idle'; on: boolean; game: string }
  | { kind: 'round'; gameId: string; name: string; variant: string; round: number }
  | { kind: 'result'; place: number | null; points: number }
  | { kind: 'match'; n: number }
  | { kind: 'incident'; cause: string }
  | { kind: 'closed'; reason: string };

/** The per-match report writer the brain feeds (the bot tools implement it; a bot inside the game server has none). */
export interface BrainRecorder {
  readonly dir: string;
  rtts: number[];
  snapshotGapsMs: number[];
  inputsSent: number;
  roundStart(gameId: string, name: string): void;
  roundEnd(placements: unknown, metrics: Record<string, number>): void;
  matchEnd(ranking: unknown): void;
  setPolicy(policy: string, params: Record<string, number>): void;
  setVariant(variant: string): void;
  log(kind: string, data: Record<string, unknown>): void;
  incident(inc: Incident, context: { states: unknown[]; inputs: unknown[]; traces: unknown[] }): void;
  close(): void;
}

export interface BrainOptions {
  name: string;
  /** host only: start once this many players (bot included) are in the room and ready */
  minPlayers: number;
  startDelayMs: number;
  resultsDelayMs: number;
  /** stop after this many finished matches; 0 = run until killed */
  matches: number;
  /** policy name override; default is the plugin's */
  policy?: string;
  params: Record<string, number>;
  seed: number;
  /** difficulty preset of the game's plugin (e.g. easy, hard) */
  level?: string;
  /** companion mode: never host or start games; leave the room if the host role falls to this bot */
  passive?: boolean;
  /** structured progress for dashboards (the companion server) */
  onEvent?: (e: BotEvent) => void;
  log: (line: string) => void;
  /** per-match report writer; called once after joining. Absent = no reports (the embedded default) */
  makeRecorder?: (welcome: Extract<ServerMessage, { t: 'WELCOME' }>) => BrainRecorder | undefined;
  /** called once with the room code after joining */
  onJoined?: (code: string) => void;
}

/** How a host lets the brain act: send a message, run something later, end the bot. */
export interface BrainIo {
  send(m: ClientMessage): void;
  /** run `fn` after `ms`; returns a cancel function */
  after(ms: number, fn: () => void): () => void;
  /** the bot is done (`error`: it never got into a room) */
  stop(reason: string, error?: Error): void;
  /** the clock in ms (default performance.now(); the offline arena passes simulated time) */
  now?(): number;
}

const FATAL = new Set(['ROOM_NOT_FOUND', 'ROOM_FULL', 'ROOM_BUSY', 'ROOM_LOCKED', 'BANNED', 'KICKED', 'BAD_VERSION', 'PASSWORD_REQUIRED', 'SERVER_FULL', 'SERVER_DRAINING', 'GAME_DISABLED', 'ALREADY_IN_ROOM', 'ROOM_CLOSED']);
const KEEPALIVE_MS = 250;
const RING = 60;

export class BotBrain {
  selfId = '';
  code = '';
  /** token to re-attach to the seat after a dropped connection */
  resume = '';
  /** true once the server accepted the bot into a room */
  joined = false;
  private welcomeConfig: { tickRate: number; networkRate: number } = { tickRate: 60, networkRate: 20 };
  private selection: unknown = null;
  private phase: RoomPhase = 'lobby';
  private players: PlayerInfo[] = [];
  private hostId = '';
  private recorder?: BrainRecorder;
  private bot: GameBot | null = null;
  private policyName = '';
  private params: Record<string, number> = {};
  private gamePhase: 'countdown' | 'playing' = 'countdown';
  private matchesDone = 0;
  private cancelStart: (() => void) | null = null;
  private lastSent: InputState | null = null;
  private lastSentAt = 0;
  private seq = 0;
  private lastTraceAt = 0;
  private lastStateAt = 0;
  private lastTick = 0;
  private statesRing: { tick: number; state: unknown }[] = [];
  private inputRing: { tick: number; input: InputState }[] = [];
  private traceRing: unknown[] = [];
  private unknownKind = '';
  /** last GAME_PRIVATE payload of the round, replayed to a bot created after it arrived */
  private privateData: unknown = undefined;
  private readonly now: () => number;

  constructor(
    private readonly o: BrainOptions,
    private readonly io: BrainIo,
  ) {
    this.now = io.now ? () => io.now!() : () => performance.now();
  }

  get report(): BrainRecorder | undefined {
    return this.recorder;
  }

  /** The bot ended: release what it holds. */
  close(): void {
    this.cancelStart?.();
    this.cancelStart = null;
    this.recorder?.close();
  }

  private send(m: ClientMessage): void {
    this.io.send(m);
  }

  handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'WELCOME': {
        this.selfId = msg.id;
        this.code = msg.code;
        this.resume = msg.resume ?? this.resume;
        this.welcomeConfig = msg.config;
        this.selection = msg.selection;
        this.joined = true;
        this.o.onEvent?.({ kind: 'joined', room: msg.code, id: msg.id });
        if (!this.recorder) {
          this.recorder = this.o.makeRecorder?.(msg);
          if (this.recorder) this.o.log(`joined room ${msg.code} as ${this.o.name} (${msg.id}); reports: ${this.recorder.dir}`);
        }
        this.o.onJoined?.(msg.code);
        break;
      }
      case 'PONG':
        this.recorder?.rtts.push(this.now() - msg.ts);
        break;
      case 'ROOM_UPDATE':
        this.phase = msg.phase;
        this.players = msg.players;
        this.hostId = msg.hostId;
        this.selection = msg.selection;
        this.o.onEvent?.({ kind: 'lobby', phase: msg.phase, players: msg.players.length, game: msg.selection.game, variant: msg.selection.variant, playlist: [...new Set((msg.selection.playlist ?? []).map((e) => e.game))] });
        this.lobby();
        if (msg.phase === 'results' && this.selfId === this.hostId) this.io.after(this.o.resultsDelayMs, () => this.send({ t: 'NEXT_GAME' }));
        break;
      case 'GAME_START':
        this.bot = null;
        this.statesRing = [];
        this.inputRing = [];
        this.traceRing = [];
        this.lastSent = null;
        this.privateData = undefined;
        this.recorder?.roundStart(msg.game.id, msg.game.name);
        this.o.log(`round ${msg.round}: ${msg.game.name}`);
        this.o.onEvent?.({ kind: 'round', gameId: msg.game.id, name: msg.game.name, round: msg.round, variant: '' });
        break;
      case 'GAME_STATE':
        this.onState(msg.tick, msg.phase, msg.state as { kind: string; variant?: string });
        break;
      case 'GAME_PRIVATE':
        this.privateData = msg.data;
        this.bot?.onPrivate?.(msg.data);
        break;
      case 'GAME_EVENT': {
        for (const ev of msg.events) this.recorder?.log('event', { tick: this.lastTick, ...ev });
        if (!this.bot) break;
        for (const inc of this.bot.onEvents(msg.events)) {
          this.o.log(`incident: ${inc.cause} - ${inc.summary}`);
          this.o.onEvent?.({ kind: 'incident', cause: inc.cause });
          this.recorder?.incident(inc, { states: this.statesRing.slice(-40), inputs: this.inputRing.slice(-80), traces: this.traceRing.slice(-40) });
        }
        break;
      }
      case 'GAME_RESULT': {
        const mine = msg.placements.find((p) => p.id === this.selfId);
        this.o.log(`result: place ${mine?.place ?? '?'} (+${mine?.points ?? 0})`);
        this.recorder?.roundEnd(msg.placements, this.bot?.metrics() ?? {});
        this.o.onEvent?.({ kind: 'result', place: mine?.place ?? null, points: mine?.points ?? 0 });
        this.bot = null;
        break;
      }
      case 'MATCH_FINISHED':
        this.recorder?.matchEnd(msg.ranking);
        this.matchesDone++;
        this.o.log(`match ${this.matchesDone} finished`);
        this.o.onEvent?.({ kind: 'match', n: this.matchesDone });
        if (this.o.matches > 0 && this.matchesDone >= this.o.matches) this.io.stop('stopped');
        else if (this.selfId === this.hostId) this.io.after(1000, () => this.send({ t: 'REMATCH' }));
        break;
      case 'VOTE_UPDATE': {
        // a host asked to go back to the lobby for another match: bots always agree
        const v = msg.vote;
        if (v && (v.kind === 'change' || v.kind === 'again') && !v.yes.includes(this.selfId) && !v.no.includes(this.selfId)) this.send({ t: 'VOTE', yes: true });
        break;
      }
      case 'NOTICE':
        this.o.log(`notice ${msg.code ?? ''}: ${msg.message}`);
        if (this.o.passive && msg.code === 'HOST_CHANGED' && msg.id === this.selfId) this.io.stop('host');
        break;
      case 'ERROR':
        this.o.log(`error ${msg.code}: ${msg.message}`);
        if (!this.joined || FATAL.has(msg.code)) {
          this.io.stop(msg.code, this.joined ? undefined : new Error(`${msg.code}: ${msg.message}`));
        }
        break;
    }
  }

  private lobby(): void {
    this.cancelStart?.();
    this.cancelStart = null;
    if (this.phase !== 'lobby') return;
    const me = this.players.find((p) => p.id === this.selfId);
    if (this.selfId !== this.hostId) {
      if (me && !me.ready) this.send({ t: 'READY', ready: true });
      return;
    }
    if (this.o.passive) {
      // a companion bot never runs the room: the host role passes to a human when it leaves
      this.o.log('became host, leaving the room');
      this.io.stop('host');
      return;
    }
    const others = this.players.filter((p) => p.id !== this.selfId && p.connected);
    if (this.players.length >= this.o.minPlayers && others.every((p) => p.ready)) {
      this.cancelStart = this.io.after(this.o.startDelayMs, () => this.send({ t: 'START_GAME' }));
    }
  }

  private onState(tick: number, phase: string, state: { kind: string; variant?: string }): void {
    const now = this.now();
    if (this.lastStateAt) this.recorder?.snapshotGapsMs.push(now - this.lastStateAt);
    this.lastStateAt = now;
    this.lastTick = tick;
    this.gamePhase = phase === 'playing' ? 'playing' : 'countdown';
    if (!this.bot) {
      const plugin = pluginForKind(state.kind);
      if (!plugin) {
        // once per round, not once per snapshot
        if (this.unknownKind !== state.kind) {
          this.unknownKind = state.kind;
          this.o.log(`no bot registered for ${state.kind}; idling this round`);
          this.o.onEvent?.({ kind: 'idle', on: true, game: state.kind });
        }
        return;
      }
      if (this.unknownKind) {
        this.unknownKind = '';
        this.o.onEvent?.({ kind: 'idle', on: false, game: state.kind });
      }
      this.policyName = this.o.policy ?? plugin.defaultPolicy;
      const preset = this.o.level ? plugin.levels?.[this.o.level] : undefined;
      if (this.o.level && !preset) this.o.log(`${plugin.id} has no level '${this.o.level}' (${Object.keys(plugin.levels ?? {}).join(', ') || 'none'}); using defaults`);
      this.params = { ...plugin.defaultParams, ...preset, ...this.o.params };
      // teammates (same team while the room plays in teams): games have no teams, so the AI avoids hurting them itself
      const team = this.players.find((p) => p.id === this.selfId)?.team;
      const allies = team === undefined ? [] : this.players.filter((p) => p.id !== this.selfId && p.team === team).map((p) => p.id);
      this.bot = plugin.create(
        { selfId: this.selfId, name: this.o.name, tickRate: this.welcomeConfig.tickRate, networkRate: this.welcomeConfig.networkRate, seed: this.o.seed, params: this.params, allies },
        this.policyName,
      );
      if (this.privateData !== undefined) this.bot.onPrivate?.(this.privateData);
      this.recorder?.setPolicy(this.policyName, this.params);
      this.recorder?.setVariant(state.variant ?? '');
      this.recorder?.log('bot', { plugin: plugin.id, policy: this.policyName, params: this.params, variant: state.variant });
    }
    this.bot.onState(state, { tick, phase: this.gamePhase, recvMs: now });
    this.statesRing.push({ tick, state });
    if (this.statesRing.length > RING) this.statesRing.shift();
  }

  /** Decide and send the bot's input; the host calls this at its decision rate. */
  tick(): void {
    if (!this.bot || this.gamePhase !== 'playing' || this.phase === 'lobby') return;
    const now = this.now();
    const raw = this.bot.decide(now);
    const input: InputState = { mx: Math.round(raw.mx * 100) / 100, my: Math.round(raw.my * 100) / 100, a1: raw.a1, a2: raw.a2 };
    const l = this.lastSent;
    if (!l || l.mx !== input.mx || l.my !== input.my || l.a1 !== input.a1 || l.a2 !== input.a2 || now - this.lastSentAt >= KEEPALIVE_MS) {
      this.send({ t: 'INPUT', seq: ++this.seq, ...input });
      this.recorder && this.recorder.inputsSent++;
      this.lastSent = input;
      this.lastSentAt = now;
    }
    this.inputRing.push({ tick: this.lastTick, input });
    if (this.inputRing.length > 90) this.inputRing.shift();
    if (now - this.lastTraceAt >= 100) {
      this.lastTraceAt = now;
      const tr = this.bot.trace();
      if (tr) {
        const entry = { tick: this.lastTick, ...tr };
        this.traceRing.push(entry);
        if (this.traceRing.length > 40) this.traceRing.shift();
        this.recorder?.log('trace', entry);
      }
    }
  }
}
