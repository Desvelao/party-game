// Watches the game server's open rooms and decides, through the AI router, where a bot should sit. Also lets the
// operator add or remove bots by hand, and sends away bots that have nothing to play for too long.
import { idleStart, type BotManager, type BotRow } from './manager';
import type { AiRouter, RoomSelection } from './router';
import { wsUrl, type EngineConfig, type ProbeResult } from './types';

/** /rooms?format=json of the game server */
export interface RoomSummary {
  code: string;
  game: string;
  phase: string;
  status: 'open' | 'playing';
  players: number;
  maxPlayers: number;
  spectators: number;
  locked: boolean;
  passwordProtected: boolean;
  /** the host's bot settings; present only when the game server lets hosts use bots */
  humans?: number;
  bots?: number;
  /** what installed plugins add (the bots plugin: the host's settings for this room) */
  ext?: { bots?: RoomBots };
}

/** The host's bot settings for a room (the bots plugin keeps them in the room and lists them in /rooms). */
export interface RoomBots {
  fill: boolean;
  level: string;
  seats: { id: string; level: string }[];
  /** where the game server plays its bots: `embedded` (inside it; an outside bot server stays out) or `external` */
  mode?: string;
}

export type RoomDecision =
  | 'off'
  | 'bot-present'
  | 'joining'
  | 'no-human'
  | 'not-open'
  | 'protected'
  | 'full'
  | 'bot-limit'
  | 'paused'
  | 'cooldown'
  | 'no-ai'
  | 'probe-failed';

export interface RoomView extends RoomSummary {
  decision: RoomDecision;
  detail: string;
  bots: number;
  humans: number;
}

interface Known {
  label: string;
  checkedAt: number;
  probe: ProbeResult;
}

/** What the watcher needs from the outside; replaced in tests. */
export interface WatcherDeps {
  fetchRooms(baseUrl: string): Promise<RoomSummary[]>;
  probe(wsUrl: string, code: string): Promise<ProbeResult>;
  now(): number;
}


export type AddResult = { ok: true; bot: string } | { ok: false; error: string };

const label = (sel: RoomSelection): string => (sel.variant && sel.variant !== 'all' ? `${sel.game}/${sel.variant}` : sel.game);

export class RoomWatcher {
  private known = new Map<string, Known>();
  private cooldown = new Map<string, number>();
  /** rooms whose bot left because it was idle: not joined again until the game of the room changes */
  private gaveUp = new Map<string, string>();
  private rooms: RoomSummary[] = [];
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private tick: () => void = () => {};
  private scheduled = 0;
  views: RoomView[] = [];
  serverUp = false;
  lastError = '';
  lastPoll = 0;

  constructor(
    private readonly cfg: EngineConfig,
    private readonly router: AiRouter,
    private readonly bots: BotManager,
    private readonly deps: WatcherDeps,
  ) {}

  start(): void {
    if (this.timer) return;
    this.tick = () => {
      if (this.busy) return;
      this.busy = true;
      this.poll()
        .catch((e: Error) => {
          this.serverUp = false;
          this.lastError = e.message;
        })
        .finally(() => (this.busy = false));
    };
    this.tick();
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.scheduled = this.cfg.join.pollSeconds;
    this.timer = setInterval(this.tick, this.scheduled * 1000);
    this.timer.unref();
  }

  /** the poll interval was changed in the panel */
  reschedule(): void {
    if (this.timer && this.scheduled !== this.cfg.join.pollSeconds) this.schedule();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** a bot left a room because something failed: leave that room alone for a while */
  coolOff(room: string): void {
    this.cooldown.set(room, this.deps.now() + this.cfg.join.cooldownSeconds * 1000);
  }

  async poll(): Promise<void> {
    const rooms = await this.deps.fetchRooms(this.cfg.gameServer.url);
    this.rooms = rooms;
    this.serverUp = true;
    this.lastError = '';
    const now = this.deps.now();
    this.lastPoll = now;
    const codes = new Set(rooms.map((r) => r.code));
    for (const code of [...this.known.keys()]) if (!codes.has(code)) this.known.delete(code);
    for (const [code, game] of [...this.gaveUp]) if (!codes.has(code) || rooms.find((r) => r.code === code)?.game !== game) this.gaveUp.delete(code);
    for (const [code, until] of this.cooldown) if (until <= now) this.cooldown.delete(code);
    // rooms that closed: their bots go
    for (const b of this.bots.active()) if (!codes.has(b.room)) this.bots.stop(b.id, 'room closed');
    this.sendAwayIdle(now);

    const views: RoomView[] = [];
    for (const r of rooms) {
      const mine = this.bots.botsIn(r.code);
      const humans = r.humans ?? Math.max(0, r.players - mine.length);
      const view = (decision: RoomDecision, detail = ''): RoomView => ({ ...r, decision, detail, bots: mine.length, humans });
      // the game server lets hosts choose bots: the room's settings decide, the automatic join of waiting humans is off there
      // the game server plays its own bots: an outside bot server leaves that room alone
      if (r.ext?.bots?.mode === 'embedded' && this.cfg.join.auto !== false) {
        views.push(view('off'));
        continue;
      }
      if (r.ext?.bots !== undefined) {
        const res = await this.followRoom(r, mine, humans);
        views.push(view(res.decision, res.detail));
        continue;
      }
      // no settings from the game server: the automatic join of waiting humans, unless the host of this watcher turned it off
      if (this.cfg.join.auto === false) {
        views.push(view('off'));
        continue;
      }
      if (mine.length) {
        // the last human left: the bots that came on their own leave too, whatever the phase (added by hand they stay)
        const auto = mine.filter((m) => !m.manual);
        if (humans === 0 && this.cfg.join.minHumans > 0 && auto.length && !auto.some((m) => m.state === 'joining')) {
          for (const b of auto) this.bots.stop(b.id, 'no humans left');
          views.push(view('no-human', 'bots leaving'));
          continue;
        }
        if (mine.length >= this.cfg.join.botsPerRoom || r.status !== 'open') {
          views.push(view('bot-present'));
          continue;
        }
      }
      const blocked = this.blocker(r);
      if (blocked) views.push(view(blocked, r.status !== 'open' ? r.phase : ''));
      else if (humans < this.cfg.join.minHumans) views.push(view('no-human'));
      else if (this.cooldown.has(r.code)) views.push(view('cooldown'));
      else if (this.gaveUp.has(r.code)) views.push(view('no-ai', 'a bot left it idle; waits for another game'));
      else {
        const res = await this.place(r);
        views.push(res.ok ? view('joining', res.bot) : view(res.decision, res.detail));
      }
    }
    this.views = views;
  }

  /**
   * Make the room's bots match the host's settings: one bot per reserved seat, then enough fill bots for the free
   * seats, at the room's level. Humans come first (the game server removes a fill bot when a human needs the seat).
   */
  private async followRoom(r: RoomSummary, mine: BotRow[], humans: number): Promise<{ decision: RoomDecision; detail: string }> {
    const hosted = mine.filter((m) => m.hosted);
    if (humans === 0) {
      for (const b of hosted) this.bots.stop(b.id, 'no humans left');
      return { decision: 'no-human', detail: hosted.length ? 'bots leaving' : '' };
    }
    if (r.phase !== 'lobby') return { decision: 'bot-present', detail: '' };
    const st = r.ext!.bots!;
    const level = st.level || this.cfg.ai.level;
    // fill bots at the wrong level are replaced (the freed seat is refilled below, on a later poll)
    if (level !== 'random') {
      const stale = hosted.filter((b) => !b.seat && b.level && b.level !== level && b.state !== 'joining');
      for (const b of stale) this.bots.stop(b.id, 'level changed');
      if (stale.length) return { decision: 'joining', detail: 'changing level' };
    }
    if (this.bots.paused) return { decision: 'paused', detail: '' };
    if (this.cooldown.has(r.code)) return { decision: 'cooldown', detail: '' };
    const seats = st.seats ?? [];
    const wantsSeat = seats.filter((s) => !hosted.some((b) => b.seat === s.id));
    const joiningFill = hosted.filter((b) => !b.seat && b.state === 'joining').length;
    const free = Math.max(0, r.maxPlayers - r.players - seats.length - joiningFill);
    const need = wantsSeat.length + (st.fill ? free : 0);
    if (!need) return { decision: 'bot-present', detail: '' };
    let started = 0;
    let last: { decision: RoomDecision; detail: string } = { decision: 'joining', detail: '' };
    for (let i = 0; i < need; i++) {
      const seat = wantsSeat[i];
      const res = await this.place(r, seat ? seat.level : level, false, { seat: seat?.id });
      if (!res.ok) {
        last = { decision: res.decision, detail: res.detail };
        break;
      }
      started++;
    }
    return started ? { decision: 'joining', detail: `${started} bot${started === 1 ? '' : 's'}` } : last;
  }

  /** Bots that have had nothing to play (no AI for the room's game or round) for too long leave. */
  private sendAwayIdle(now: number): void {
    const wait = this.cfg.ai.idleLeaveSeconds * 1000;
    for (const b of this.bots.active()) {
      // a lobby set to a game without an AI counts as idle too; once it is fine again that clock stops
      const unsupported = b.sel ? !this.router.supports(b.sel).ok : false;
      if (unsupported && b.noAiSince === null) b.noAiSince = now;
      else if (!unsupported && b.noAiSince !== null) b.noAiSince = null;
      const since = idleStart(b);
      if (wait > 0 && since !== null && now - since >= wait) {
        const game = this.rooms.find((r) => r.code === b.room)?.game;
        if (game !== undefined) this.gaveUp.set(b.room, game);
        this.bots.stop(b.id, 'idle');
      }
    }
  }

  /** why a bot cannot go into this room whatever else is true (the humans and cooldown rules are separate: a manual add skips them) */
  private blocker(r: RoomSummary): RoomDecision | null {
    if (r.passwordProtected || r.locked) return 'protected';
    if (r.status !== 'open') return 'not-open';
    if (r.players >= r.maxPlayers) return 'full';
    if (this.bots.paused) return 'paused';
    if (this.bots.count() >= this.cfg.join.maxBots) return 'bot-limit';
    return null;
  }

  private async selectionOf(r: RoomSummary): Promise<ProbeResult> {
    let k = this.known.get(r.code);
    if (!k || k.label !== r.game || this.deps.now() - k.checkedAt > this.cfg.join.recheckSeconds * 1000) {
      k = { label: r.game, checkedAt: this.deps.now(), probe: await this.deps.probe(wsUrl(this.cfg.gameServer.url), r.code) };
      this.known.set(r.code, k);
    }
    return k.probe;
  }

  private async place(r: RoomSummary, level?: string, manual = false, hosted?: { seat?: string }): Promise<{ ok: true; bot: string; row: BotRow } | { ok: false; decision: RoomDecision; detail: string }> {
    const probe = await this.selectionOf(r);
    if (!probe.ok) return { ok: false, decision: 'probe-failed', detail: probe.error };
    // the verdict is taken now, not when the room was probed, so panel changes (playlist rule, levels) count
    const verdict = this.router.supports(probe.selection);
    if (!verdict.ok) return { ok: false, decision: 'no-ai', detail: verdict.reason };
    const plan = this.router.plan(probe.selection, { level });
    if (!plan) return { ok: false, decision: 'no-ai', detail: '' };
    const row = this.bots.start(r.code, plan, label(probe.selection), manual, hosted);
    return row ? { ok: true, bot: row.name, row } : { ok: false, decision: 'bot-limit', detail: '' };
  }

  /** Put a bot into a room now (dashboard button): same limits and AI check, but no wait for humans or cooldown. */
  async addBot(code: string, level?: string): Promise<AddResult> {
    const r = this.rooms.find((x) => x.code === code.toUpperCase());
    if (!r) return { ok: false, error: 'no such room (it may have closed)' };
    const why: Record<string, string> = {
      protected: 'the room is locked or has a password',
      'not-open': 'the match has started; bots can only join a lobby',
      full: 'the room is full',
      paused: 'joining is paused',
      'bot-limit': `the bot limit (${this.cfg.join.maxBots}) is reached`,
    };
    const blocked = this.blocker(r);
    if (blocked) return { ok: false, error: why[blocked] };
    const res = await this.place(r, level, true);
    if (res.ok) return { ok: true, bot: res.bot };
    const text: Record<string, string> = {
      'probe-failed': `could not read the room (${res.detail})`,
      'no-ai': res.detail || 'no AI for the game of this room',
      'bot-limit': `the bot limit (${this.cfg.join.maxBots}) is reached`,
    };
    return { ok: false, error: text[res.decision] ?? res.decision };
  }

  /** Take the bots out of a room (dashboard button). */
  removeBots(code: string): number {
    const mine = this.bots.botsIn(code.toUpperCase());
    for (const b of mine) this.bots.stop(b.id, 'removed from the dashboard');
    if (mine.length) this.coolOff(code.toUpperCase());
    return mine.length;
  }
}
