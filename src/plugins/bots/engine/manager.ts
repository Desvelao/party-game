// Keeps the table of bots: starts them through a BotRunner, follows their events and limits how many run.
import type { BotEvent } from './brain';
import type { BotPlan, RoomSelection } from './router';
import { wsUrl, type BotHandle, type BotRunner, type BotUsage, type EngineConfig } from './types';

export type BotState = 'joining' | 'lobby' | 'playing' | 'idle' | 'results' | 'ended';

export interface BotRow {
  id: string;
  name: string;
  gameId: string;
  level: string;
  policy: string;
  room: string;
  state: BotState;
  /** what the room is set to play (selection id) and the round being played */
  selection: string;
  round: string;
  /** what the room is set to play, as the bot last saw it */
  sel: RoomSelection | null;
  /** added by hand from the dashboard: it stays even when no human is in the room */
  manual: boolean;
  /** put in the room by the host's bot settings (fill, or the reserved seat `seat`); these follow the room's settings, not the join rules */
  hosted: boolean;
  seat: string | null;
  /** since when the round being played has no AI for the bot (reported by the bot), null while it has */
  idleSince: number | null;
  /** since when the room is set to a game without an AI (seen by the watcher), null while it is fine */
  noAiSince: number | null;
  rounds: number;
  matches: number;
  lastPlace: number | null;
  points: number;
  incidents: number;
  startedAt: number;
  endedAt: number | null;
  endReason: string;
  cpu: number;
  heapMB: number;
  externalMB: number;
}

/** Lifetime counters for the Prometheus exporter; keys are `game|level[|extra]`. */
export interface BotCounters {
  started: Record<string, number>;
  ended: Record<string, number>;
  rounds: Record<string, number>;
  matches: Record<string, number>;
  incidents: Record<string, number>;
  points: Record<string, number>;
  results: Record<string, number>;
}

/** Since when the bot has had nothing to play, from either source; null while it has something. */
export function idleStart(r: Pick<BotRow, 'idleSince' | 'noAiSince'>): number | null {
  if (r.idleSince === null) return r.noAiSince;
  return r.noAiSince === null ? r.idleSince : Math.min(r.idleSince, r.noAiSince);
}

/** A small fixed set of reasons, so the label stays bounded. */
export function normalizeReason(reason: string, error?: string): string {
  switch (reason) {
    case 'no humans left': return 'no_humans_left';
    case 'room closed': return 'room_closed';
    case 'host': return 'host';
    case 'stopped from the dashboard':
    case 'removed from the dashboard': return 'dashboard';
    case 'idle': return 'idle';
    case 'paused': return 'paused';
    case 'companion shutting down': return 'shutdown';
  }
  if (error || /^closed |^[A-Z_]{4,}$/.test(reason)) return 'error';
  return 'other';
}

const bump = (m: Record<string, number>, key: string, n = 1): void => {
  m[key] = (m[key] ?? 0) + n;
};

const KEEP_ENDED = 25;
const KEEP_LOG = 200;

export class BotManager {
  private seq = 0;
  private rows = new Map<string, BotRow>();
  private handles = new Map<string, BotHandle>();
  readonly log: { ts: number; id: string; line: string }[] = [];
  paused = false;
  readonly counters: BotCounters = { started: {}, ended: {}, rounds: {}, matches: {}, incidents: {}, points: {}, results: {} };
  /** called when a bot has left, with the reason (failures put a room on cooldown) */
  onEnded: (row: BotRow, error?: string) => void = () => {};

  constructor(
    private readonly runner: BotRunner,
    /** the shared, live configuration: read on every use so panel changes apply at once */
    private readonly cfg: EngineConfig,
    /** clock, replaceable in tests */
    private readonly now: () => number = Date.now,
  ) {}

  active(): BotRow[] {
    return [...this.rows.values()].filter((r) => r.state !== 'ended');
  }

  count(): number {
    return this.handles.size;
  }

  botsIn(room: string): BotRow[] {
    return this.active().filter((r) => r.room === room);
  }

  /** active bots first (oldest first), then the most recently ended */
  list(): BotRow[] {
    const all = [...this.rows.values()];
    const live = all.filter((r) => r.state !== 'ended').sort((a, b) => a.startedAt - b.startedAt);
    const ended = all.filter((r) => r.state === 'ended').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    return [...live, ...ended];
  }

  canStart(): boolean {
    return !this.paused && this.handles.size < this.cfg.join.maxBots;
  }

  start(room: string, plan: BotPlan, selection: string, manual = false, hosted?: { seat?: string }): BotRow | null {
    if (!this.canStart()) return null;
    const id = `b${++this.seq}`;
    const level = plan.level ? plan.level.charAt(0).toUpperCase() + plan.level.slice(1) : plan.policy;
    const taken = new Set(this.botsIn(room).map((r) => r.name));
    let name = `${this.cfg.ai.namePrefix} ${level}`.slice(0, 16);
    for (let n = 2; taken.has(name); n++) name = `${this.cfg.ai.namePrefix} ${level}`.slice(0, 13) + ` ${n}`;
    const row: BotRow = {
      id, name, gameId: plan.gameId, level: plan.level, policy: plan.policy, room, state: 'joining', selection, manual, hosted: !!hosted, seat: hosted?.seat ?? null, round: '', sel: null, idleSince: null, noAiSince: null, rounds: 0, matches: 0,
      lastPlace: null, points: 0, incidents: 0, startedAt: Date.now(), endedAt: null, endReason: '', cpu: 0, heapMB: 0, externalMB: 0,
    };
    this.rows.set(id, row);
    bump(this.counters.started, `${plan.gameId}|${plan.level}`);
    const handle = this.runner.start(
      { name, room, url: wsUrl(this.cfg.gameServer.url), plan, ...(hosted ? { auth: { token: this.cfg.gameServer.botToken, ...(hosted.seat ? { seat: hosted.seat } : {}) } } : {}), reports: this.cfg.reports, seed: (Date.now() + this.seq * 7919) % 1e9 },
      {
        onEvent: (e) => this.apply(row, e),
        onLog: (line) => {
          this.log.push({ ts: Date.now(), id, line });
          if (this.log.length > KEEP_LOG) this.log.shift();
        },
        onExit: (error) => this.finish(row, error),
      },
    );
    this.handles.set(id, handle);
    return row;
  }

  stop(id: string, reason: string): boolean {
    const h = this.handles.get(id);
    if (!h) return false;
    h.stop(reason);
    return true;
  }

  stopRoom(room: string, reason: string): void {
    for (const r of this.botsIn(room)) this.stop(r.id, reason);
  }

  stopAll(reason: string): void {
    for (const id of this.handles.keys()) this.stop(id, reason);
  }

  /** Refresh each bot's resource numbers from its thread. */
  sampleUsage(): void {
    for (const [id, h] of this.handles) {
      const row = this.rows.get(id);
      if (!row) continue;
      const u: BotUsage = h.usage();
      row.cpu = u.cpu;
      row.heapMB = u.heapMB;
      row.externalMB = u.externalMB;
    }
  }

  private apply(row: BotRow, e: BotEvent): void {
    switch (e.kind) {
      case 'joined':
        row.state = 'lobby';
        break;
      case 'lobby':
        row.selection = e.variant && e.variant !== 'all' ? `${e.game}/${e.variant}` : e.game;
        row.sel = { game: e.game, variant: e.variant, playlist: e.playlist.map((game) => ({ game })) };
        row.state = e.phase === 'lobby' ? 'lobby' : e.phase === 'results' || e.phase === 'finished' ? 'results' : row.idleSince !== null ? 'idle' : 'playing';
        break;
      case 'round':
        row.state = row.idleSince !== null ? 'idle' : 'playing';
        row.round = e.name;
        row.rounds++;
        bump(this.counters.rounds, `${row.gameId}|${row.level}`);
        break;
      case 'result':
        row.state = 'results';
        row.lastPlace = e.place;
        row.points += e.points;
        bump(this.counters.points, `${row.gameId}|${row.level}`, e.points);
        bump(this.counters.results, `${row.gameId}|${row.level}|${e.place ?? 'none'}`);
        break;
      case 'match':
        row.matches = e.n;
        bump(this.counters.matches, `${row.gameId}|${row.level}`);
        break;
      case 'idle':
        row.idleSince = e.on ? (row.idleSince ?? this.now()) : null;
        if (e.on) row.state = 'idle';
        else if (row.state === 'idle') row.state = 'playing';
        break;
      case 'incident':
        row.incidents++;
        bump(this.counters.incidents, `${row.gameId}|${row.level}|${e.cause}`);
        break;
      case 'closed':
        row.endReason = e.reason;
        break;
    }
  }

  private finish(row: BotRow, error?: string): void {
    this.handles.delete(row.id);
    row.state = 'ended';
    row.endedAt = Date.now();
    row.cpu = 0;
    if (error && !row.endReason) row.endReason = error;
    bump(this.counters.ended, normalizeReason(row.endReason, error));
    const ended = [...this.rows.values()].filter((r) => r.state === 'ended').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    for (const old of ended.slice(KEEP_ENDED)) this.rows.delete(old.id);
    this.onEnded(row, error);
  }
}
