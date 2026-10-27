import { describe, expect, it } from 'vitest';
import { applyResult, newRecord } from '../../../core/server/profiles/profile';
import { rankProfiles, searchLeaderboard } from './rank';

const player = (name: string, wins: number, points: number, matches = wins) => {
  const r = newRecord(0, { name });
  return { ...r, name, stats: { ...r.stats, wins, points, matches } };
};

describe('rankProfiles', () => {
  const all = [player('Bea', 2, 10), player('Ana', 5, 4), player('Cy', 2, 30), player('Dee', 0, 0, 0)];

  it('ranks by wins, ties by points, with 1-based ranks', () => {
    expect(rankProfiles(all).map((r) => [r.rank, r.name])).toEqual([[1, 'Ana'], [2, 'Cy'], [3, 'Bea'], [4, 'Dee']]);
  });

  it('can rank by points', () => {
    expect(rankProfiles(all, 'points').map((r) => r.name)).toEqual(['Cy', 'Bea', 'Ana', 'Dee']);
  });

  it('finds players by name and keeps their global rank', () => {
    const ranked = rankProfiles(all);
    expect(searchLeaderboard(ranked, ' be ').map((r) => [r.rank, r.name, r.wins])).toEqual([[3, 'Bea', 2]]);
    expect(searchLeaderboard(ranked, '')).toEqual([]);
  });

  it('exposes no profile identifiers', () => {
    expect(Object.keys(rankProfiles(all)[0]!).sort()).toEqual(['bestMatchScore', 'color', 'looks', 'matches', 'name', 'points', 'rank', 'winRate', 'wins']);
  });
});

describe('per-game and period leaderboards', () => {
  const DAY = 86_400_000;
  const now = 100 * DAY + 5000;
  const play = (name: string, plays: { daysAgo: number; game: string; place: number; points: number }[]) => {
    let r = newRecord(0, { name });
    for (const p of plays) {
      const at = now - p.daysAgo * DAY;
      r = applyResult(r, { name, game: { id: p.game, place: p.place, points: p.points } }, at);
      r = applyResult(r, { name, match: { score: p.points, won: p.place === 1 } }, at);
    }
    return r;
  };
  const ana = play('Ana', [
    { daysAgo: 0, game: 'smashball', place: 1, points: 10 },
    { daysAgo: 20, game: 'smashball', place: 1, points: 10 },
    { daysAgo: 20, game: 'crazy-logs', place: 2, points: 7 },
  ]);
  const bob = play('Bob', [{ daysAgo: 3, game: 'crazy-logs', place: 1, points: 10 }]);
  const cy = play('Cy', [{ daysAgo: 60, game: 'smashball', place: 1, points: 10 }]);
  const all = [ana, bob, cy];

  it('filters to a set of playable ids and drops players without activity', () => {
    const rows = rankProfiles(all, { games: new Set(['smashball']), now });
    expect(rows.map((r) => [r.name, r.wins, r.matches])).toEqual([['Ana', 2, 2], ['Cy', 1, 1]]);
  });

  it('windows the results to the last 7 or 30 days', () => {
    expect(rankProfiles(all, { period: 'week', now }).map((r) => r.name)).toEqual(['Ana', 'Bob']);
    const month = rankProfiles(all, { period: 'month', now });
    expect(month.map((r) => [r.name, r.wins])).toEqual([['Ana', 2], ['Bob', 1]]);
    expect(rankProfiles(all, { period: 'week', games: new Set(['crazy-logs']), now }).map((r) => r.name)).toEqual(['Bob']);
  });

  it('ranks by win rate, with enough games first', () => {
    const grinder = play('Grind', [
      ...Array.from({ length: 4 }, () => ({ daysAgo: 1, game: 'smashball', place: 1, points: 10 })),
      { daysAgo: 1, game: 'smashball', place: 2, points: 7 },
    ]);
    const lucky = play('Lucky', [{ daysAgo: 1, game: 'smashball', place: 1, points: 10 }]); // 100% of 1
    const rows = rankProfiles([lucky, grinder], { sort: 'winrate', now });
    expect(rows.map((r) => r.name)).toEqual(['Grind', 'Lucky']);
    expect(rows[0]!.winRate).toBeCloseTo(0.8);
  });

  it('keeps only 31 days of tallies', () => {
    let r = newRecord(0, { name: 'Old' });
    r = applyResult(r, { name: 'Old', match: { score: 1, won: true } }, now - 40 * DAY);
    r = applyResult(r, { name: 'Old', match: { score: 1, won: true } }, now);
    expect(Object.keys(r.daily!)).toHaveLength(1);
  });
});

describe('shadow ban', () => {
  it('hides flagged profiles from every ranking', () => {
    const hidden = { ...player('Hidden', 99, 99), shadowBanned: true as const };
    const rows = rankProfiles([player('Ana', 1, 1), hidden]);
    expect(rows.map((r) => r.name)).toEqual(['Ana']);
    expect(rankProfiles([hidden], { sort: 'points', period: 'all', games: new Set(['x']) })).toEqual([]);
  });
});
