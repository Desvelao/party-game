import { describe, expect, it } from 'vitest';
import { applyResult, newRecord } from '../../../core/server/profiles/profile';
import type { PluginHost, PluginHttpRequest, ProfileRecord } from '../../../core/shared';
import plugin from './index';

const player = (name: string, wins: number, shadowBanned = false): ProfileRecord => {
  const r = newRecord(0, { name });
  return { ...r, name, shadowBanned: shadowBanned || undefined, stats: { ...r.stats, wins, points: wins * 10, matches: wins } };
};

function host(profiles: ProfileRecord[] | null, top = 20): PluginHost & { reads: number } {
  const h = {
    reads: 0,
    coreVersion: '0.1.0',
    dataDir: '/tmp/pg-leaderboard-test',
    profile: 'NORMAL',
    tickRate: 60,
    config: { top },
    rooms: { list: () => [], get: () => undefined, on: () => () => {} },
    stats: () => ({ rooms: 0, maxRooms: 0, clients: 0, loop: { ticks: 0, overruns: 0, avgStepMs: 0, maxStepMs: 0, avgLagMs: 0, maxLagMs: 0 }, net: { msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0, rejected: 0, droppedFrames: 0 } }),
    matches: { playedSinceStart: () => 0, recent: () => [] },
    games: { ais: () => [], playableIds: (id: string) => (id === 'ballistix' ? new Set(['ballistix', 'smashball']) : null) },
    profiles: {
      list: async () => {
        h.reads++;
        return profiles;
      },
    },
    plugin: () => undefined,
    every: () => {},
    log: () => {},
  };
  return h as unknown as PluginHost & { reads: number };
}

const req = (query: Record<string, string> = {}, over: Partial<PluginHttpRequest> = {}): PluginHttpRequest => ({
  kind: 'api',
  method: 'GET',
  path: '/',
  query,
  body: {},
  ip: '10.0.0.1',
  admin: () => ({ ok: false, status: 401, error: 'no' }),
  requireAdmin: () => ({ status: 401, body: { error: 'no' } }),
  ...over,
});

type Body = { total: number; top: { name: string; rank: number }[]; results?: { name: string }[]; game?: string };

describe('leaderboard plugin', () => {
  it('ranks the profiles, hides shadow-banned ones, caps the list at `top` and searches by name', async () => {
    plugin.start(host([player('Ana', 5), player('Bea', 2), player('Cy', 9), player('Hidden', 99, true)], 2));
    const res = (await plugin.http!(req({ q: 'be' })))!;
    expect(res.status).toBe(200);
    const body = res.body as Body;
    expect(body.total).toBe(3);
    expect(body.top.map((r) => [r.rank, r.name])).toEqual([[1, 'Cy'], [2, 'Ana']]);
    expect(body.results).toMatchObject([{ name: 'Bea', rank: 3 }]);
    expect(JSON.stringify(body)).not.toContain('Hidden');
    plugin.stop!();
  });

  it('keeps a game filter only for a known game id, and reads the store once within the cache time', async () => {
    const h = host([player('Ana', 1)]);
    plugin.start(h);
    expect(((await plugin.http!(req({ game: 'ballistix' })))!.body as Body).game).toBe('ballistix');
    expect(((await plugin.http!(req({ game: 'nope' })))!.body as Body).game).toBeUndefined();
    await plugin.http!(req({ game: 'nope' }));
    expect(h.reads).toBe(2); // one per filter combination
    plugin.stop!();
  });

  it('says 501 when the store cannot be listed, 500 when reading fails, 429 past the rate limit, 405 for other methods', async () => {
    plugin.start(host(null));
    expect((await plugin.http!(req()))!.status).toBe(501);
    plugin.stop!();
    const broken = host([]);
    broken.profiles.list = async () => {
      throw new Error('disk');
    };
    plugin.start(broken);
    expect((await plugin.http!(req()))!.status).toBe(500);
    expect((await plugin.http!(req({}, { method: 'POST' })))!.status).toBe(405);
    plugin.stop!();
    plugin.start(host([]));
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await plugin.http!(req({}, { ip: '10.9.9.9' })))!.status;
    expect(last).toBe(429);
    plugin.stop!();
  });

  it('answers only its api root', async () => {
    plugin.start(host([]));
    expect(await plugin.http!(req({}, { path: '/x' }))).toBeUndefined();
    expect(await plugin.http!(req({}, { kind: 'page' }))).toBeUndefined();
    plugin.stop!();
    expect(await plugin.http!(req())).toBeUndefined(); // not started
  });
});
