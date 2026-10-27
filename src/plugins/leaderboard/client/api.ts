import type { Looks } from '../../../core/shared';

export type LeaderboardSort = 'wins' | 'points' | 'winrate';
export type LeaderboardPeriod = 'all' | 'week' | 'month';

export interface LeaderboardRow {
  rank: number;
  name: string;
  color: number;
  looks: Looks;
  avatar?: string;
  wins: number;
  points: number;
  matches: number;
  winRate: number;
  bestMatchScore: number;
}

export interface LeaderboardData {
  sort: LeaderboardSort;
  total: number;
  top: LeaderboardRow[];
  /** present when a name was searched for */
  results: LeaderboardRow[] | null;
}

/** 'disabled' = the operator switched the leaderboard off; 'error' = unreachable or unusable answer. */
export type LeaderboardResult = { ok: true; data: LeaderboardData } | { ok: false; reason: 'disabled' | 'error' };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function row(v: unknown): LeaderboardRow | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.looks || typeof r.looks !== 'object') return null;
  return {
    rank: num(r.rank),
    name: r.name,
    color: num(r.color),
    looks: r.looks as Looks,
    ...(typeof r.avatar === 'string' ? { avatar: r.avatar } : {}),
    wins: num(r.wins),
    points: num(r.points),
    matches: num(r.matches),
    winRate: num(r.winRate),
    bestMatchScore: num(r.bestMatchScore),
  };
}

const rows = (v: unknown): LeaderboardRow[] => (Array.isArray(v) ? v.map(row).filter((r): r is LeaderboardRow => r !== null) : []);

export async function fetchLeaderboard(
  opts: { q?: string; sort?: LeaderboardSort; game?: string; period?: LeaderboardPeriod } = {},
  fetcher: typeof fetch = fetch,
): Promise<LeaderboardResult> {
  const qs = new URLSearchParams();
  if (opts.sort === 'points' || opts.sort === 'winrate') qs.set('sort', opts.sort);
  if (opts.game) qs.set('game', opts.game);
  if (opts.period === 'week' || opts.period === 'month') qs.set('period', opts.period);
  if (opts.q?.trim()) qs.set('q', opts.q.trim());
  try {
    const res = await fetcher(`/api/leaderboard${qs.size ? `?${qs}` : ''}`, { cache: 'no-store' });
    if (res.status === 404) return { ok: false, reason: 'disabled' };
    if (!res.ok) return { ok: false, reason: 'error' };
    const body = (await res.json()) as Record<string, unknown>;
    return {
      ok: true,
      data: {
        sort: body.sort === 'points' || body.sort === 'winrate' ? body.sort : 'wins',
        total: num(body.total),
        top: rows(body.top),
        results: Array.isArray(body.results) ? rows(body.results) : null,
      },
    };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Podium avatar edge in px: the better the rank, the bigger the character. */
export function podiumSize(rank: number): number {
  return rank === 1 ? 128 : rank === 2 ? 104 : 88;
}
