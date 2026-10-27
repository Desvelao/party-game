// The rules of the progression plugin: XP, levels, win streaks, best places and achievements. Pure functions, no I/O.

export interface Progress {
  xp: number;
  rounds: number;
  matches: number;
  wins: number;
  /** wins in a row (a lost match with other players resets it; playing alone leaves it) */
  streak: number;
  bestStreak: number;
  /** best (lowest) place per game id */
  bests: Record<string, number>;
  /** achievement id -> unlock time */
  achievements: Record<string, number>;
}

export type ProgressEvent =
  | { game: { id: string; place: number; points: number }; match?: undefined }
  | { game?: undefined; match: { score: number; won: boolean; place?: number; players?: number } };

/** Longest game id kept (the core caps them too); bounds the size of one record. */
const MAX_ID = 48;
const MAX_BESTS = 200;

export const emptyProgress = (): Progress => ({ xp: 0, rounds: 0, matches: 0, wins: 0, streak: 0, bestStreak: 0, bests: {}, achievements: {} });

/** XP needed to reach `level` (level 1 starts at 0): 50, 150, 300, 500... */
export const xpForLevel = (level: number): number => 25 * level * (level - 1);
export const levelFromXp = (xp: number): number => Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, xp)) / 50)) / 2);

const ROUND_XP = 5;
const PLACE_XP = [0, 10, 6, 3];
const MATCH_XP = 20;
const WIN_XP = 30;

/** An achievement: its id and the test on a record. The texts live in the plugin's client. */
export const ACHIEVEMENTS: { id: string; test(p: Progress): boolean }[] = [
  { id: 'first-match', test: (p) => p.matches >= 1 },
  { id: 'first-win', test: (p) => p.wins >= 1 },
  { id: 'matches-10', test: (p) => p.matches >= 10 },
  { id: 'matches-50', test: (p) => p.matches >= 50 },
  { id: 'streak-3', test: (p) => p.bestStreak >= 3 },
  { id: 'streak-5', test: (p) => p.bestStreak >= 5 },
  { id: 'rounds-100', test: (p) => p.rounds >= 100 },
  { id: 'games-5', test: (p) => Object.keys(p.bests).length >= 5 },
  { id: 'level-5', test: (p) => levelFromXp(p.xp) >= 5 },
];

/** Apply one result to `p` (changed in place); returns the achievements it unlocked. */
export function applyEvent(p: Progress, ev: ProgressEvent, now: number): string[] {
  if (ev.game) {
    const { id, place } = ev.game;
    p.rounds++;
    p.xp += ROUND_XP + (PLACE_XP[place] ?? 0);
    if (id.length <= MAX_ID && place >= 1 && (id in p.bests || Object.keys(p.bests).length < MAX_BESTS)) p.bests[id] = Math.min(p.bests[id] ?? place, place);
  } else {
    const { won, players } = ev.match;
    p.matches++;
    p.xp += MATCH_XP;
    if (won) {
      p.wins++;
      p.xp += WIN_XP;
      p.streak++;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
    } else if ((players ?? 2) >= 2) p.streak = 0;
  }
  const unlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!(a.id in p.achievements) && a.test(p)) {
      p.achievements[a.id] = now;
      unlocked.push(a.id);
    }
  }
  return unlocked;
}

export interface ProgressView extends Progress {
  level: number;
  /** XP into the current level and the XP the level needs, for a bar */
  into: number;
  need: number;
}

export function viewOf(p: Progress): ProgressView {
  const level = levelFromXp(p.xp);
  return { ...p, level, into: p.xp - xpForLevel(level), need: xpForLevel(level + 1) - xpForLevel(level) };
}

/** Parse what was stored, defensively: anything unexpected becomes the default. */
export function reviveProgress(raw: unknown): Progress {
  const out = emptyProgress();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  out.xp = n(r.xp);
  out.rounds = n(r.rounds);
  out.matches = n(r.matches);
  out.wins = n(r.wins);
  out.streak = n(r.streak);
  out.bestStreak = n(r.bestStreak);
  if (r.bests && typeof r.bests === 'object') {
    for (const [k, v] of Object.entries(r.bests).slice(0, MAX_BESTS)) if (k.length <= MAX_ID && n(v) >= 1) out.bests[k] = n(v);
  }
  if (r.achievements && typeof r.achievements === 'object') {
    for (const [k, v] of Object.entries(r.achievements)) if (ACHIEVEMENTS.some((a) => a.id === k)) out.achievements[k] = n(v);
  }
  return out;
}
