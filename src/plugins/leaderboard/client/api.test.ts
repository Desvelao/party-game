import { describe, expect, it } from 'vitest';
import { fetchLeaderboard, podiumSize } from './api';

const looks = { blob: { body: 0, eyes: 0, mouth: 0, hat: 0 } };
const json = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('podiumSize', () => {
  it('grows with the rank', () => {
    expect(podiumSize(1)).toBeGreaterThan(podiumSize(2));
    expect(podiumSize(2)).toBeGreaterThan(podiumSize(3));
  });
});

describe('fetchLeaderboard', () => {
  it('normalizes rows and keeps search results separate', async () => {
    const r = await fetchLeaderboard(
      { q: 'al' },
      json(200, { sort: 'wins', total: 2, top: [{ rank: 1, name: 'Al', color: 2, looks, avatar: 'blob', wins: 3, points: 9, matches: 4, bestMatchScore: 7 }, { junk: true }], results: [] }),
    );
    expect(r.ok && r.data.top).toHaveLength(1);
    expect(r.ok && r.data.top[0]).toMatchObject({ looks, avatar: 'blob' });
    expect(r.ok && r.data.results).toEqual([]);
  });

  it('reports a disabled leaderboard and failures', async () => {
    expect(await fetchLeaderboard({}, json(404, { error: 'disabled' }))).toEqual({ ok: false, reason: 'disabled' });
    expect(await fetchLeaderboard({}, json(500, {}))).toEqual({ ok: false, reason: 'error' });
    expect(await fetchLeaderboard({}, (async () => { throw new Error('x'); }) as unknown as typeof fetch)).toEqual({ ok: false, reason: 'error' });
  });
});
