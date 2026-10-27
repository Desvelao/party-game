// Prometheus text exporter (GET /metrics) of the companion server. Same conventions as the game server's exporter
// (src/core/server/features/prometheus.ts): text format 0.0.4, everything read at scrape time, nothing sampled
// in the background. Bot, resource and game-server figures come from the same objects the dashboard uses.
import type { AiRouter } from '../router';
import type { CompanionConfig } from './settings';
import type { BotManager } from '../manager';
import type { MetricsSampler } from './metrics';
import type { RoomWatcher } from '../watcher';

export interface MetricsSource {
  cfg: CompanionConfig;
  router: AiRouter;
  bots: BotManager;
  metrics: MetricsSampler;
  watcher: RoomWatcher;
  startedAt: number;
}

const esc = (v: string): string => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const labels = (l: Record<string, string | number>): string => {
  const parts = Object.entries(l).map(([k, v]) => `${k}="${esc(String(v))}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
};

type Sample = [Record<string, string | number>, number];

export function renderMetrics(src: MetricsSource, now = Date.now()): string {
  const lines: string[] = [];
  const metric = (name: string, type: 'gauge' | 'counter', help: string, samples: Sample[]): void => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [l, v] of samples) lines.push(`${name}${labels(l)} ${Number.isFinite(v) ? v : 0}`);
  };
  const one = (name: string, type: 'gauge' | 'counter', help: string, v: number): void => metric(name, type, help, [[{}, v]]);
  const MB = 1048576;

  const active = src.bots.active();
  const point = src.metrics.latest();

  // ---- companion state ----
  metric('party_game_bots_info', 'gauge', 'Companion server information.', [[{ game_server: src.cfg.gameServer.url, node: process.version }, 1]]);
  one('party_game_bots_uptime_seconds', 'gauge', 'Seconds since the companion server started.', Math.round((now - src.startedAt) / 1000));
  one('party_game_bots_paused', 'gauge', '1 while joining is paused from the dashboard.', src.bots.paused ? 1 : 0);
  one('party_game_bots_max', 'gauge', 'Configured limit of bots running at once.', src.cfg.join.maxBots);
  one('party_game_bots_game_server_up', 'gauge', '1 when the last room poll of the game server worked.', src.watcher.serverUp ? 1 : 0);
  one('party_game_bots_last_poll_timestamp_seconds', 'gauge', 'Unix time of the last successful room poll.', Math.round(src.watcher.lastPoll / 1000));
  metric('party_game_bots_ai_games', 'gauge', 'Games that have an AI (1 each).', src.router.catalog().map((g): Sample => [{ game: g.id }, 1]));
  const running = new Map<string, number>();
  for (const b of active) running.set(`${b.gameId}|${b.level}`, (running.get(`${b.gameId}|${b.level}`) ?? 0) + 1);
  metric('party_game_bots_running', 'gauge', 'Bots currently in a room, by game and level.', [...running].map(([k, n]): Sample => [{ game: k.split('|')[0], level: k.split('|')[1] }, n]));
  const decisions = new Map<string, number>();
  for (const r of src.watcher.views) decisions.set(r.decision, (decisions.get(r.decision) ?? 0) + 1);
  metric('party_game_bots_rooms', 'gauge', 'Rooms of the game server by the decision taken for them.', [...decisions].map(([d, n]): Sample => [{ decision: d }, n]));

  // ---- lifetime counters ----
  const c = src.bots.counters;
  const gl = (k: string): Record<string, string> => {
    const [game, level] = k.split('|');
    return { game, level };
  };
  const counter = (name: string, help: string, m: Record<string, number>, fn: (k: string) => Record<string, string>): void =>
    metric(name, 'counter', help, Object.entries(m).map(([k, v]): Sample => [fn(k), v]));
  counter('party_game_bots_started_total', 'Bots started.', c.started, gl);
  counter('party_game_bots_ended_total', 'Bots that left a room, by reason.', c.ended, (k) => ({ reason: k }));
  counter('party_game_bots_rounds_total', 'Rounds played by bots.', c.rounds, gl);
  counter('party_game_bots_matches_total', 'Matches finished with a bot in the room.', c.matches, gl);
  counter('party_game_bots_points_total', 'Points won by bots.', c.points, gl);
  counter('party_game_bots_results_total', 'Round results of bots by place (none = no placement).', c.results, (k) => {
    const [game, level, place] = k.split('|');
    return { game, level, place };
  });
  counter('party_game_bots_incidents_total', 'Lives lost by bots, by classified cause.', c.incidents, (k) => {
    const [game, level, cause] = k.split('|');
    return { game, level, cause };
  });

  // ---- each running bot (bounded by maxBots) ----
  const id = (b: (typeof active)[number]): Record<string, string> => ({ bot: b.id, name: b.name, game: b.gameId, level: b.level, room: b.room });
  metric('party_game_bot_cpu_percent', 'gauge', 'Busy share of the bot thread, 100 = one core.', active.map((b): Sample => [id(b), b.cpu]));
  metric('party_game_bot_memory_bytes', 'gauge', 'V8 heap plus external memory of the bot thread.', active.map((b): Sample => [id(b), Math.round((b.heapMB + b.externalMB) * MB)]));
  metric('party_game_bot_uptime_seconds', 'gauge', 'Seconds since the bot started.', active.map((b): Sample => [id(b), Math.round((now - b.startedAt) / 1000)]));
  metric('party_game_bot_rounds', 'gauge', 'Rounds played by this bot.', active.map((b): Sample => [id(b), b.rounds]));
  metric('party_game_bot_points', 'gauge', 'Points won by this bot.', active.map((b): Sample => [id(b), b.points]));
  metric('party_game_bot_last_place', 'gauge', 'Place in the last finished round (0 = none yet).', active.map((b): Sample => [id(b), b.lastPlace ?? 0]));
  metric('party_game_bot_state', 'gauge', '1 for the bot\'s current state.', active.map((b): Sample => [{ ...id(b), state: b.state }, 1]));

  // ---- resources ----
  if (point) {
    one('party_game_bots_count', 'gauge', 'Bots running (all bot threads together).', point.bots.count);
    one('party_game_bots_cpu_percent', 'gauge', 'CPU of all bot threads together, 100 = one core.', point.bots.cpu);
    one('party_game_bots_memory_bytes', 'gauge', 'Heap plus external memory of all bot threads.', Math.round(point.bots.heapMB * MB));
    one('party_game_bots_core_cpu_percent', 'gauge', 'CPU of the companion without the bots (manager, watcher, dashboard).', point.core.cpu);
    one('party_game_bots_host_cpu_percent', 'gauge', 'CPU in use on the machine running the companion.', point.host.cpu);
    one('party_game_bots_host_memory_used_bytes', 'gauge', 'Memory in use on that machine.', point.host.memUsedMB * MB);
    one('party_game_bots_host_memory_total_bytes', 'gauge', 'Memory installed on that machine.', point.host.memTotalMB * MB);
    one('party_game_bots_host_load1', 'gauge', 'Load average over 1 minute.', point.host.load1);
    one('party_game_bots_host_cores', 'gauge', 'Logical CPU cores of that machine.', point.host.cores);
  }
  const cpu = process.cpuUsage();
  const mem = process.memoryUsage();
  one('process_cpu_seconds_total', 'counter', 'User plus system CPU time of the companion process (all threads).', Math.round(((cpu.user + cpu.system) / 1e6) * 1000) / 1000);
  one('process_resident_memory_bytes', 'gauge', 'Resident memory of the companion process.', mem.rss);
  one('process_heap_used_bytes', 'gauge', 'JavaScript heap in use on the main thread.', mem.heapUsed);

  // ---- the game server being served ----
  const m = point?.main;
  one('party_game_server_up', 'gauge', '1 when the game server answered its stats.', m?.reachable ? 1 : 0);
  if (m?.reachable) {
    one('party_game_server_cpu_percent', 'gauge', 'CPU of the game server process, 100 = one core.', m.cpu);
    one('party_game_server_cpu_instant', 'gauge', '1 when the CPU value is live (admin token), 0 when it is an average since its last stats reset.', m.instant ? 1 : 0);
    one('party_game_server_rss_bytes', 'gauge', 'Resident memory of the game server.', Math.round(m.rssMB * MB));
    one('party_game_server_heap_bytes', 'gauge', 'JavaScript heap of the game server.', Math.round(m.heapMB * MB));
    one('party_game_server_rooms', 'gauge', 'Rooms open on the game server.', m.rooms);
    one('party_game_server_rooms_max', 'gauge', 'Room limit of the game server.', m.maxRooms);
    one('party_game_server_clients', 'gauge', 'Websocket clients on the game server.', m.clients);
    if (m.host) {
      one('party_game_server_host_cpu_percent', 'gauge', 'CPU in use on the game server machine.', m.host.cpuPercent);
      one('party_game_server_host_memory_used_bytes', 'gauge', 'Memory in use on the game server machine.', Math.round(m.host.memUsedMB * MB));
      one('party_game_server_host_memory_total_bytes', 'gauge', 'Memory installed on the game server machine.', Math.round(m.host.memTotalMB * MB));
      if (m.host.temperatureC != null) one('party_game_server_host_temperature_celsius', 'gauge', 'CPU temperature of the game server machine.', m.host.temperatureC);
    }
  }
  return lines.join('\n') + '\n';
}
