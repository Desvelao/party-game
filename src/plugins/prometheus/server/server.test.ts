import { describe, expect, it } from 'vitest';
import type { PluginHost, PluginHttpRequest } from '../../../core/shared';
import plugin, { render } from './index';

const stats: ReturnType<PluginHost['stats']> = {
  rooms: 2,
  maxRooms: 8,
  clients: 5,
  loop: { ticks: 10, overruns: 1, avgStepMs: 0.2, maxStepMs: 1.5, avgLagMs: 0.1, maxLagMs: 0.9 },
  net: { msgsIn: 3, msgsOut: 4, bytesIn: 5, bytesOut: 6, rejected: 0, droppedFrames: 2 },
};

function host(enabled: boolean): PluginHost {
  return {
    coreVersion: '0.1.0',
    dataDir: '/tmp/pg-prometheus-test',
    profile: 'NORMAL',
    tickRate: 60,
    config: { enabled },
    rooms: { list: () => [], get: () => undefined, on: () => () => {} },
    stats: () => stats,
    matches: {
      playedSinceStart: () => 3,
      recent: () => [
        { durationSec: 60, games: [{ id: 'ballistix' }, { id: 'frost-shove' }] },
        { durationSec: 30, games: [{ id: 'ballistix' }] },
      ],
    },
    games: { ais: () => [], playableIds: () => null },
    characters: { models: () => [] },
    profiles: { list: async () => null },
    events: { on: () => () => {} },
    plugin: () => undefined,
    every: () => {},
    log: () => {},
  };
}

const request = (over: Partial<PluginHttpRequest> = {}, admin = true): PluginHttpRequest => ({
  kind: 'root',
  method: 'GET',
  path: '/metrics',
  query: {},
  body: {},
  ip: '127.0.0.1',
  admin: () => (admin ? { ok: true } : { ok: false, status: 401, error: 'unauthorized' }),
  requireAdmin: () => (admin ? null : { status: 401, body: { error: 'unauthorized' } }),
  ...over,
});

describe('prometheus plugin', () => {
  it('renders the counters and the per-game rounds', () => {
    const text = render(host(true));
    expect(text).toContain('# TYPE party_game_rooms gauge');
    expect(text).toContain('party_game_rooms 2\n');
    expect(text).toContain('party_game_clients 5\n');
    expect(text).toContain('party_game_matches_finished_total 3\n');
    expect(text).toContain('party_game_recent_rounds{game="ballistix"} 2\n');
    expect(text).toContain('party_game_recent_round_seconds{game="ballistix"} 60\n'); // 60/2 + 30
    expect(text).toMatch(/^process_resident_memory_bytes \d+$/m);
  });

  it('answers /metrics only while enabled, and only to the admin', async () => {
    plugin.start(host(false));
    expect(await plugin.http!(request())).toBeUndefined(); // off: nothing is served
    plugin.stop!();
    plugin.start(host(true));
    const ok = (await plugin.http!(request()))!;
    expect(ok.status).toBe(200);
    expect(ok.type).toContain('text/plain');
    expect(String(ok.body)).toContain('party_game_rooms 2');
    expect((await plugin.http!(request({}, false)))!.status).toBe(401);
    expect((await plugin.http!(request({ method: 'POST' })))!.status).toBe(405);
    expect(await plugin.http!(request({ path: '/other' }))).toBeUndefined();
    expect(await plugin.http!(request({ kind: 'api' }))).toBeUndefined();
    plugin.stop!();
  });
});
