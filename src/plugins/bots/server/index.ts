// Server half of the bots plugin: the room's bot settings, the host's actions, who may seat a bot, the management
// API and dashboard, and (in `embedded` mode) the engine that plays the bots inside this server. In `external` mode
// the separate bot server plays them, joins with the token, and reads these settings from the room list.
import { createHash, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { PluginHost, PluginHttpRequest, PluginHttpResponse, ServerPlugin, VirtualPlayerRoom, VirtualSeat } from '../../../core/shared';
import { InProcessRunner } from '../engine/inprocess';
import { isBotLevel, type BotLevel } from '../engine/levels';
import { BotManager } from '../engine/manager';
import { handleApi, type Services } from '../engine/ops/api';
import { AuditLog } from '../engine/ops/audit';
import { MetricsSampler } from '../engine/ops/metrics';
import { dashboardPage } from '../engine/ops/page';
import { RuntimeConfig } from '../engine/ops/runtime';
import { defaultConfig, type CompanionConfig } from '../engine/ops/settings';
import { registerGame, registeredGames } from '../engine/registry';
import { AiRouter } from '../engine/router';
import { RoomWatcher, type RoomDecision, type RoomSummary } from '../engine/watcher';

const ID = 'bots';

/** What the plugin keeps in a room (shown to everyone; the bot server reads it from the room list). */
interface RoomState {
  fill: boolean;
  level: BotLevel;
  seats: { id: string; level: BotLevel }[];
  /** why the bots the host asked for cannot come (shown to the host) */
  note?: { code: string; detail?: string };
}

const PER_PROFILE = {
  LOW_POWER: { maxBots: 2, hz: 10 },
  NORMAL: { maxBots: 8, hz: 20 },
  HIGH: { maxBots: 16, hz: 30 },
} as const;

/** The decisions that mean "the host asked for bots and none can come" (the others are normal states). */
const BLOCKED: Partial<Record<RoomDecision, string>> = { 'no-ai': 'no-ai', 'probe-failed': 'unreadable', paused: 'paused', 'bot-limit': 'limit', cooldown: 'cooldown' };

const same = (a: string, b: string): boolean => {
  const d = (v: string) => createHash('sha256').update(v, 'utf8').digest();
  return timingSafeEqual(d(a), d(b));
};

let state: { host: PluginHost; defaultLevel: BotLevel; token: string; mode: string } | null = null;
let engine: { services: Services; options: { api: boolean; dashboard: boolean }; stop: () => void } | null = null;

const plugin: ServerPlugin = {
  start(host: PluginHost) {
    const cfg = host.config;
    if (cfg.allowFill !== true) {
      host.log('bots are not allowed (set allowFill); nothing to do');
      state = null;
      return;
    }
    const defaultLevel = (isBotLevel(cfg.defaultLevel) ? cfg.defaultLevel : 'normal') as BotLevel;
    state = { host, defaultLevel, token: String(cfg.token || ''), mode: String(cfg.mode) };

    const init = (room: VirtualPlayerRoom): void => {
      if (room.getExt(ID) === undefined) room.setExt(ID, { fill: false, level: defaultLevel, seats: [] } satisfies RoomState);
    };
    const rooms = host.virtualRooms;
    if (!rooms) {
      host.log('the virtualPlayers capability is missing; nothing to do');
      state = null;
      return;
    }
    rooms.on('created', init);
    for (const r of rooms.list()) init(r);
    // keep the shown state in step with the room: a bot that took its seat is no longer pending, and seats left over when the match starts can never be filled
    rooms.on('changed', (room) => {
      const st = room.getExt(ID) as RoomState | undefined;
      if (!st) return;
      if (room.phase !== 'lobby') {
        for (const seat of room.reservedSeats(ID)) room.releaseSeat(ID, seat);
        if (st.seats.length > 0 || st.note) room.setExt(ID, { ...st, seats: [], note: undefined });
        return;
      }
      const held = room.reservedSeats(ID);
      const seats = st.seats.filter((s) => held.includes(s.id));
      if (seats.length !== st.seats.length) room.setExt(ID, { ...st, seats });
    });

    if (cfg.mode === 'embedded') engine = startEngine(host, rooms, defaultLevel);
    else host.log('external mode: the bot server plays the bots');
  },

  stop() {
    engine?.stop();
    engine = null;
    state = null;
  },

  http(req) {
    if (!engine) return undefined;
    // the page holds no data (every call it makes is authenticated), like the game's own /admin shell
    if (req.kind === 'page') {
      if (!engine.options.dashboard || !engine.options.api || (req.path !== '/' && req.path !== '/index.html')) return undefined;
      return { status: 200, type: 'text/html; charset=utf-8', body: dashboardPage('/api/bots', true) };
    }
    if (!engine.options.api) return undefined;
    return api(engine.services, req);
  },

  onAction(base, clientId, data) {
    const room = base as VirtualPlayerRoom; // the same room object; this plugin declares `virtualPlayers`
    const st = room.getExt(ID) as RoomState | undefined;
    if (!st || !room.isHost(clientId) || room.phase !== 'lobby') return;
    switch (data.a) {
      case 'fill': {
        if (typeof data.on !== 'boolean') return;
        room.setExt(ID, { ...st, fill: data.on });
        // fill bots go when filling stops; the ones the host added stay
        if (!data.on) room.removeVirtuals(ID, (m) => (m.ext as { added?: boolean } | undefined)?.added !== true);
        return;
      }
      case 'level':
        if (isBotLevel(data.level)) room.setExt(ID, { ...st, level: data.level });
        return;
      case 'add': {
        const level = data.level === undefined ? st.level : data.level;
        if (!isBotLevel(level)) return;
        const seat = room.reserveSeat(ID);
        if (seat) room.setExt(ID, { ...st, seats: [...st.seats, { id: seat, level }] });
        return;
      }
      case 'remove': {
        if (typeof data.id !== 'string') return;
        if (st.seats.some((s) => s.id === data.id)) {
          room.releaseSeat(ID, data.id);
          room.setExt(ID, { ...st, seats: st.seats.filter((s) => s.id !== data.id) });
        } else {
          const m = room.memberList().find((x) => x.id === data.id && x.plugin === ID && (x.ext as { added?: boolean } | undefined)?.added === true);
          if (m) room.removeVirtual(m.id);
        }
        return;
      }
    }
  },

  virtualPlayers: {
    authorizeJoin(room, claim): VirtualSeat | string {
      const st = room.getExt(ID) as RoomState | undefined;
      if (!state || !st) return 'Bots are not enabled';
      if (!state.token || !claim.token || !same(claim.token, state.token)) return 'Bot token rejected';
      const level = claim.data.level;
      if (!isBotLevel(level)) return 'Unknown bot level';
      const seat = claim.data.seat;
      if (seat !== undefined) {
        if (typeof seat !== 'string' || !st.seats.some((s) => s.id === seat)) return 'No such bot seat';
        return { plugin: ID, seat, yields: false, ext: { level, added: true } };
      }
      if (!st.fill) return 'This room does not take fill bots';
      return { plugin: ID, yields: true, ext: { level, added: false } };
    },
  },

  roomSummary(room) {
    const st = room.getExt(ID) as RoomState | undefined;
    return st && state ? { ...st, mode: state.mode } : undefined;
  },
};

/** The management API behind the game server's admin check. */
async function api(services: Services, req: PluginHttpRequest): Promise<PluginHttpResponse> {
  const denied = req.requireAdmin();
  if (denied) return denied;
  const r = await handleApi(services, { method: req.method, path: req.path, query: req.query, body: req.body, ip: req.ip });
  return r;
}

/** The engine inside the server: router + manager + watcher, with bots as virtual players, driven by one shared timer. */
function startEngine(host: PluginHost, rooms: NonNullable<PluginHost['virtualRooms']>, defaultLevel: BotLevel): NonNullable<typeof engine> {
  const c = host.config;
  const per = PER_PROFILE[host.profile];
  const maxBots = Number(c.maxBots) > 0 ? Number(c.maxBots) : per.maxBots;
  const hz = Number(c.decisionHz) > 0 ? Math.min(Number(c.decisionHz), host.tickRate) : Math.min(per.hz, host.tickRate);
  for (const ai of host.games.ais()) registerGame(ai);

  // the engine's configuration: the settings that apply inside a game server come from the plugin's, the rest stay at their defaults
  const cfg: CompanionConfig = defaultConfig();
  cfg.gameServer = { ...cfg.gameServer, url: '' };
  cfg.join = { ...cfg.join, maxBots, cooldownSeconds: 10, recheckSeconds: 60, auto: false };
  cfg.ai = { ...cfg.ai, level: defaultLevel, mixed: c.mixed === 'always' ? 'always' : 'never', playlistJoin: c.playlistJoin === 'all' ? 'all' : 'any', idleLeaveSeconds: Number(c.idleLeaveSeconds), namePrefix: String(c.namePrefix || 'Bot').slice(0, 8) };
  cfg.reports = { enabled: c.reports === true, dir: String(c.reportsDir || join(host.dataDir, 'reports')) };
  cfg.metrics = { enabled: c.metrics === true };

  const runner = new InProcessRunner({ get: (code) => rooms.get(code) }, ID, host.characters.models);
  const bots = new BotManager(runner, cfg);
  const router = new AiRouter(cfg.ai, registeredGames);
  const toSummary = (r: VirtualPlayerRoom): RoomSummary => ({
    code: r.code,
    game: `${r.selection.game}/${r.selection.variant}`,
    phase: r.phase,
    status: r.phase === 'lobby' ? 'open' : 'playing',
    players: r.players,
    maxPlayers: r.maxPlayers,
    spectators: 0,
    locked: false,
    passwordProtected: false,
    humans: r.humans,
    ext: { bots: r.getExt(ID) as RoomState | undefined },
  });
  const watcher = new RoomWatcher(cfg, router, bots, {
    fetchRooms: async () => rooms.list().map(toSummary),
    probe: async (_url, code) => {
      const r = rooms.get(code);
      return r ? { ok: true, selection: { game: r.selection.game, variant: r.selection.variant, playlist: r.selection.playlist }, maxPlayers: r.maxPlayers } : { ok: false, error: 'room closed' };
    },
    now: () => Date.now(),
  });
  // a bot the room's own settings sent away is no failure; anything else cools the room off for a moment
  bots.onEnded = (row) => {
    const settled = ['no humans left', 'room closed', 'host'].includes(row.endReason) || (row.hosted && ['KICKED', 'level changed'].includes(row.endReason));
    if (!settled) watcher.coolOff(row.room);
  };

  const audit = c.audit === true ? new AuditLog(host.dataDir) : null;
  // live changes to the settings that apply here are kept in the plugin's data folder
  const runtime = c.liveConfig === true ? new RuntimeConfig(cfg, host.dataDir, () => router.catalog().map((g) => ({ id: g.id, levels: g.levels, policies: g.policies })), () => {}, true) : null;
  // the dashboard's resource tab: this machine and this process (the bots are part of the game server's process)
  const metrics = c.api === true ? new MetricsSampler(bots, async () => null) : null;
  metrics?.start();
  const services: Services = { cfg, router, bots, watcher, startedAt: Date.now(), metrics, runtime, audit, tokenConfigured: true };

  // tell the host why the bots they asked for do not come, instead of leaving a seat on "joining"
  const explain = (): void => {
    for (const v of watcher.views) {
      const room = rooms.get(v.code);
      const st = room?.getExt(ID) as RoomState | undefined;
      if (!room || !st) continue;
      const code = (st.fill || st.seats.length > 0) && room.phase === 'lobby' ? BLOCKED[v.decision] : undefined;
      const note = code ? { code, ...(v.detail ? { detail: v.detail } : {}) } : undefined;
      if (JSON.stringify(note) !== JSON.stringify(st.note)) room.setExt(ID, { ...st, note });
    }
  };

  let polling = false;
  let again = false;
  const poll = (): void => {
    if (polling) {
      again = true;
      return;
    }
    polling = true;
    watcher
      .poll()
      .then(explain)
      .catch((e: Error) => host.log(`poll failed: ${e.message}`))
      .finally(() => {
        polling = false;
        if (again) {
          again = false;
          poll();
        }
      });
  };
  const off = [rooms.on('changed', poll), rooms.on('created', poll)];
  host.every(2000, poll);
  host.every(Math.round(1000 / hz), () => runner.tick());
  host.every(5000, () => bots.sampleUsage());
  host.log(`embedded bots: up to ${maxBots}, ${hz} decisions/s${c.api === true ? ', management API at /api/bots' : ''}${c.dashboard === true && c.api === true ? ' and dashboard at /plugins/bots/' : ''}`);
  return {
    services,
    options: { api: c.api === true, dashboard: c.dashboard === true },
    stop: () => {
      off.forEach((f) => f());
      metrics?.stop();
      bots.stopAll('shutting down');
      void runtime?.flush();
    },
  };
}

export default plugin;
