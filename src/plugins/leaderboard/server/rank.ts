import type { Looks, ProfileRecord } from '../../../core/shared';

/** UTC day number of a timestamp: the key of `ProfileRecord.daily` (a plugin may not import the core's own copy). */
const dayOf = (ms: number): number => Math.floor(ms / 86_400_000);

export type LeaderboardSort = 'wins' | 'points' | 'winrate';
/** all time, or the last 7 / 30 UTC days (today included) */
export type LeaderboardPeriod = 'all' | 'week' | 'month';

export const PERIOD_DAYS: Record<Exclude<LeaderboardPeriod, 'all'>, number> = { week: 7, month: 30 };
/** A win rate only competes with others once the player has at least this many games / matches in scope. */
export const MIN_WINRATE_PLAYED = 3;

export interface LeaderboardRow {
  rank: number;
  name: string;
  color: number;
  looks: Looks;
  /** the model the player is shown with here */
  avatar?: string;
  wins: number;
  points: number;
  /** matches in the global view, rounds played of the chosen game otherwise */
  matches: number;
  /** wins / matches, 0..1 */
  winRate: number;
  bestMatchScore: number;
}

export interface RankOptions {
  sort?: LeaderboardSort;
  /** playable ids to count (a family's variants, or one variant); absent = whole profile */
  games?: ReadonlySet<string>;
  period?: LeaderboardPeriod;
  now?: number;
}

interface Tally {
  wins: number;
  points: number;
  matches: number;
}

/** What a record scored inside the chosen game filter and period. */
function tallyOf(r: ProfileRecord, games: ReadonlySet<string> | undefined, period: LeaderboardPeriod, now: number): Tally {
  if (period === 'all') {
    if (!games) return { wins: r.stats.wins, points: r.stats.points, matches: r.stats.matches };
    const t = { wins: 0, points: 0, matches: 0 };
    for (const [id, g] of Object.entries(r.stats.games)) {
      if (games.has(id)) {
        t.wins += g.wins;
        t.points += g.points;
        t.matches += g.played;
      }
    }
    return t;
  }
  const today = dayOf(now);
  const first = today - PERIOD_DAYS[period] + 1;
  const t = { wins: 0, points: 0, matches: 0 };
  for (const [k, d] of Object.entries(r.daily ?? {})) {
    const day = Number(k);
    if (day < first || day > today) continue;
    if (!games) {
      t.wins += d.wins;
      t.points += d.points;
      t.matches += d.matches;
      continue;
    }
    for (const [id, g] of Object.entries(d.games)) {
      if (games.has(id)) {
        t.wins += g.wins;
        t.points += g.points;
        t.matches += g.played;
      }
    }
  }
  return t;
}

/**
 * Every profile ranked by wins, points or win rate, ties broken by the other measures, then games
 * played, then name, so the order is stable. A game or period filter drops players with no activity
 * in it. Ranks are 1-based and unique. Profile keys are never part of a row.
 */
export function rankProfiles(records: Iterable<ProfileRecord>, opts: RankOptions | LeaderboardSort = {}): LeaderboardRow[] {
  const o: RankOptions = typeof opts === 'string' ? { sort: opts } : opts;
  const sort = o.sort ?? 'wins';
  const period = o.period ?? 'all';
  const now = o.now ?? Date.now();
  const scoped = o.games !== undefined || period !== 'all';
  const rows: Omit<LeaderboardRow, 'rank'>[] = [];
  for (const r of records) {
    if (r.shadowBanned) continue; // hidden by an operator
    const t = tallyOf(r, o.games, period, now);
    if (scoped && t.matches === 0) continue;
    rows.push({
      name: r.name,
      color: r.color,
      looks: r.looks,
      ...(r.avatar ? { avatar: r.avatar } : {}),
      wins: t.wins,
      points: t.points,
      matches: t.matches,
      winRate: t.matches > 0 ? t.wins / t.matches : 0,
      bestMatchScore: o.games ? 0 : r.stats.bestMatchScore,
    });
  }
  const eligible = (r: Omit<LeaderboardRow, 'rank'>) => (r.matches >= MIN_WINRATE_PLAYED ? 1 : 0);
  rows.sort((a, b) => {
    if (sort === 'winrate') {
      return eligible(b) - eligible(a) || b.winRate - a.winRate || b.wins - a.wins || b.matches - a.matches || a.name.localeCompare(b.name);
    }
    const other = sort === 'wins' ? 'points' : 'wins';
    return b[sort] - a[sort] || b[other] - a[other] || b.matches - a.matches || a.name.localeCompare(b.name);
  });
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

/** Case-insensitive substring search over names, keeping each player's global rank. */
export function searchLeaderboard(rows: LeaderboardRow[], query: string, limit = 20): LeaderboardRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return rows.filter((r) => r.name.toLowerCase().includes(q)).slice(0, limit);
}
