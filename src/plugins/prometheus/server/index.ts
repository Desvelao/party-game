// Prometheus text exporter: GET /metrics behind the admin token (loopback-only without one). Everything is pulled at
// scrape time from the host, nothing is sampled in the background.
import type { PluginHost, PluginHttpRequest, PluginHttpResponse, ServerPlugin } from '../../../core/shared';

const esc = (v: string): string => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/** The page the exporter renders, from the host's counters. */
export function render(host: Pick<PluginHost, 'stats' | 'matches' | 'coreVersion'>): string {
  const lines: string[] = [];
  const metric = (name: string, type: 'gauge' | 'counter', help: string, samples: [string, number][]) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of samples) lines.push(`${name}${labels} ${Number.isFinite(value) ? value : 0}`);
  };
  const one = (name: string, type: 'gauge' | 'counter', help: string, value: number) => metric(name, type, help, [['', value]]);

  const { rooms, maxRooms, clients, loop, net } = host.stats();
  const mem = process.memoryUsage();
  metric('party_game_info', 'gauge', 'Server build information.', [[`{version="${esc(host.coreVersion)}"}`, 1]]);
  one('party_game_rooms', 'gauge', 'Open rooms.', rooms);
  one('party_game_rooms_max', 'gauge', 'Configured room limit.', maxRooms);
  one('party_game_clients', 'gauge', 'Connected websocket clients (players and spectators).', clients);
  one('party_game_ticks_total', 'counter', 'Simulation ticks since the last stats reset.', loop.ticks);
  one('party_game_tick_overruns_total', 'counter', 'Ticks that exceeded their time budget since the last stats reset.', loop.overruns);
  one('party_game_tick_step_avg_ms', 'gauge', 'Average time computing one tick.', loop.avgStepMs);
  one('party_game_tick_step_max_ms', 'gauge', 'Slowest tick.', loop.maxStepMs);
  one('party_game_tick_lag_avg_ms', 'gauge', 'Average tick start lateness.', loop.avgLagMs);
  one('party_game_tick_lag_max_ms', 'gauge', 'Worst tick start lateness.', loop.maxLagMs);
  one('party_game_messages_in_total', 'counter', 'Client messages received.', net.msgsIn);
  one('party_game_messages_out_total', 'counter', 'Messages sent to clients.', net.msgsOut);
  one('party_game_bytes_in_total', 'counter', 'Bytes received.', net.bytesIn);
  one('party_game_bytes_out_total', 'counter', 'Bytes sent.', net.bytesOut);
  one('party_game_messages_rejected_total', 'counter', 'Messages rejected (invalid or rate limited).', net.rejected);
  one('party_game_frames_dropped_total', 'counter', 'Droppable frames skipped for slow clients.', net.droppedFrames);
  one('party_game_matches_finished_total', 'counter', 'Matches finished since the server started.', host.matches.playedSinceStart());
  const byGame = new Map<string, { n: number; sec: number }>();
  for (const r of host.matches.recent(200)) {
    for (const g of r.games) {
      const cur = byGame.get(g.id) ?? { n: 0, sec: 0 };
      byGame.set(g.id, { n: cur.n + 1, sec: cur.sec + r.durationSec / Math.max(1, r.games.length) });
    }
  }
  const label = (id: string) => `{game="${esc(id)}"}`;
  metric('party_game_recent_rounds', 'gauge', 'Rounds per game among the recent match history.', [...byGame].map(([id, v]) => [label(id), v.n]));
  metric('party_game_recent_round_seconds', 'gauge', 'Approximate seconds played per game among the recent match history.', [...byGame].map(([id, v]) => [label(id), Math.round(v.sec)]));
  one('process_resident_memory_bytes', 'gauge', 'Resident memory of the server process.', mem.rss);
  one('process_heap_used_bytes', 'gauge', 'JavaScript heap in use.', mem.heapUsed);
  one('process_uptime_seconds', 'gauge', 'Seconds since the process started.', Math.round(process.uptime()));
  return lines.join('\n') + '\n';
}

let host: PluginHost | null = null;

const plugin: ServerPlugin = {
  start(h) {
    host = h;
  },
  stop() {
    host = null;
  },
  http(req: PluginHttpRequest): PluginHttpResponse | undefined {
    if (!host || req.kind !== 'root' || req.path !== '/metrics' || host.config.enabled !== true) return undefined;
    const denied = req.requireAdmin();
    if (denied) return denied;
    if (req.method !== 'GET' && req.method !== 'HEAD') return { status: 405, body: { error: 'method not allowed' } };
    return { status: 200, type: 'text/plain; version=0.0.4; charset=utf-8', body: render(host) };
  },
};
export default plugin;
