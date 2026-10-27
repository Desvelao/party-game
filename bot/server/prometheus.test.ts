import { describe, expect, it } from 'vitest';
import { AiRouter } from '../router/router';
import '../games';
import { DEFAULTS } from './config';
import { BotManager, normalizeReason } from './manager';
import type { MetricPoint } from './metrics';
import { renderMetrics, type MetricsSource } from './prometheus';
import type { BotRunner, RunnerHooks } from './runner';

class FakeRunner implements BotRunner {
  hooks: RunnerHooks[] = [];
  start(_spec: unknown, hooks: RunnerHooks) {
    this.hooks.push(hooks);
    return {
      stop: (reason: string) => {
        hooks.onEvent({ kind: 'closed', reason });
        hooks.onExit();
      },
      usage: () => ({ cpu: 4.2, heapMB: 10, externalMB: 2 }),
    };
  }
}

const point = (main: MetricPoint['main']): MetricPoint => ({
  ts: 1,
  host: { cpu: 12.5, memPct: 40, memUsedMB: 4000, memTotalMB: 16000, load1: 0.5, cores: 8 },
  companion: { cpu: 6, rssMB: 120, heapMB: 14 },
  bots: { count: 1, cpu: 4.2, heapMB: 12 },
  core: { cpu: 1.8 },
  main,
  perBot: {},
});

function setup(main: MetricPoint['main'], watcherUp = true) {
  const runner = new FakeRunner();
  const cfg = structuredClone(DEFAULTS);
  cfg.join.maxBots = 4;
  cfg.reports.enabled = false;
  const bots = new BotManager(runner, cfg);
  const src: MetricsSource = {
    cfg,
    router: new AiRouter({ level: 'normal' }),
    bots,
    metrics: { latest: () => point(main) } as never,
    watcher: { serverUp: watcherUp, lastPoll: 1700000000000, views: [{ decision: 'bot-present' }, { decision: 'no-ai' }, { decision: 'no-ai' }] } as never,
    startedAt: 0,
  };
  return { runner, bots, src };
}

const up = { reachable: true, cpu: 3.1, rssMB: 80, heapMB: 12, rooms: 2, maxRooms: 4, clients: 5, host: { cpuPercent: 20, memUsedMB: 5000, memTotalMB: 32000, cpuCount: 12, temperatureC: 51 }, instant: true, version: '1.0.0' };

/** every sample must follow its own HELP/TYPE, names declared once, values finite */
function check(text: string): Map<string, string[]> {
  const samples = new Map<string, string[]>();
  const types = new Map<string, string>();
  const helps = new Set<string>();
  for (const line of text.trim().split('\n')) {
    if (line.startsWith('# HELP ')) {
      const n = line.split(' ')[2];
      expect(helps.has(n), `HELP twice for ${n}`).toBe(false);
      helps.add(n);
    } else if (line.startsWith('# TYPE ')) {
      const [, , n, t] = line.split(' ');
      expect(types.has(n), `TYPE twice for ${n}`).toBe(false);
      expect(['gauge', 'counter']).toContain(t);
      types.set(n, t);
    } else {
      const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{.*\})? (-?\d+(\.\d+)?(e[+-]?\d+)?)$/.exec(line);
      expect(m, `bad sample line: ${line}`).not.toBeNull();
      expect(types.has(m![1]), `sample before TYPE: ${line}`).toBe(true);
      samples.set(m![1], [...(samples.get(m![1]) ?? []), line]);
    }
  }
  return samples;
}

describe('renderMetrics', () => {
  it('is valid exposition text with bots, resources and the game server', () => {
    const { runner, bots, src } = setup(up);
    bots.start('AB3K', { gameId: 'ballistix', level: 'hard', policy: 'predictive', params: {} }, 'ballistix');
    runner.hooks[0].onEvent({ kind: 'joined', room: 'AB3K', id: 'x' });
    runner.hooks[0].onEvent({ kind: 'round', gameId: 'smashball', name: 'Smashball', variant: '', round: 1 });
    runner.hooks[0].onEvent({ kind: 'incident', cause: 'unreachable' });
    runner.hooks[0].onEvent({ kind: 'result', place: 1, points: 10 });
    bots.sampleUsage();
    const s = check(renderMetrics(src, 60_000));
    expect(s.get('party_game_bots_started_total')).toEqual(['party_game_bots_started_total{game="ballistix",level="hard"} 1']);
    expect(s.get('party_game_bots_results_total')).toEqual(['party_game_bots_results_total{game="ballistix",level="hard",place="1"} 1']);
    expect(s.get('party_game_bots_incidents_total')![0]).toContain('cause="unreachable"');
    expect(s.get('party_game_bots_points_total')![0]).toMatch(/ 10$/);
    expect(s.get('party_game_bot_cpu_percent')![0]).toContain('bot="b1"');
    expect(s.get('party_game_bot_cpu_percent')![0]).toMatch(/ 4\.2$/);
    expect(s.get('party_game_bot_memory_bytes')![0]).toMatch(/ 12582912$/);
    expect(s.get('party_game_bot_state')![0]).toContain('state="results"');
    expect(s.get('party_game_bots_rooms')).toHaveLength(2);
    expect(s.get('party_game_bots_running')![0]).toMatch(/ 1$/);
    expect(s.get('party_game_server_up')).toEqual(['party_game_server_up 1']);
    expect(s.get('party_game_server_host_temperature_celsius')).toEqual(['party_game_server_host_temperature_celsius 51']);
    expect(s.get('party_game_bots_host_memory_total_bytes')![0]).toMatch(/ 16777216000$/);
    expect(s.has('process_cpu_seconds_total')).toBe(true);
    expect(s.get('party_game_bots_uptime_seconds')).toEqual(['party_game_bots_uptime_seconds 60']);
  });

  it('drops per-bot series when the bot leaves but keeps the counters', () => {
    const { bots, src } = setup(up);
    bots.start('AB3K', { gameId: 'ballistix', level: 'hard', policy: 'predictive', params: {} }, 'ballistix');
    bots.stopRoom('AB3K', 'no humans left');
    const s = check(renderMetrics(src));
    expect(s.has('party_game_bot_cpu_percent')).toBe(false);
    expect(s.get('party_game_bots_ended_total')).toEqual(['party_game_bots_ended_total{reason="no_humans_left"} 1']);
    expect(s.get('party_game_bots_started_total')).toHaveLength(1);
  });

  it('reports an unreachable game server without inventing its numbers', () => {
    const { src } = setup({ ...up, reachable: false });
    const s = check(renderMetrics(src));
    expect(s.get('party_game_server_up')).toEqual(['party_game_server_up 0']);
    expect(s.has('party_game_server_rss_bytes')).toBe(false);
  });

  it('escapes label values', () => {
    const { bots, src } = setup(up);
    src.cfg.gameServer.url = 'http://a"b\\c';
    bots.start('AB3K', { gameId: 'ballistix', level: 'hard', policy: 'predictive', params: {} }, 'x');
    expect(renderMetrics(src)).toContain('game_server="http://a\\"b\\\\c"');
  });
});

describe('normalizeReason', () => {
  it('keeps the label set small', () => {
    expect(normalizeReason('no humans left')).toBe('no_humans_left');
    expect(normalizeReason('stopped from the dashboard')).toBe('dashboard');
    expect(normalizeReason('ROOM_BUSY')).toBe('error');
    expect(normalizeReason('closed 1006')).toBe('error');
    expect(normalizeReason('', 'boom')).toBe('error');
    expect(normalizeReason('whatever')).toBe('other');
  });
});

describe('GET /metrics', () => {
  const get = async (cfgPatch: (c: MetricsSource['cfg']) => void, headers: Record<string, string> = {}) => {
    const { src } = setup(up);
    cfgPatch(src.cfg);
    const { createApi } = await import('./http');
    const api = createApi(src as never);
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
    const port = (api.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/metrics`, { headers });
      return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
    } finally {
      api.close();
    }
  };

  it('serves the text format to the local machine', async () => {
    const r = await get(() => {});
    expect(r.status).toBe(200);
    expect(r.type).toContain('version=0.0.4');
    expect(r.body).toContain('party_game_bots_info');
  });

  it('needs the token when one is set', async () => {
    expect((await get((c) => (c.server.adminToken = 'sekret'))).status).toBe(401);
    expect((await get((c) => (c.server.adminToken = 'sekret'), { Authorization: 'Bearer sekret' })).status).toBe(200);
  });

  it('is not there when turned off', async () => {
    expect((await get((c) => (c.metrics.enabled = false))).status).toBe(404);
  });
});
