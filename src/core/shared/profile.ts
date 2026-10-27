import type { Looks } from './character';
import { LANGS, type Lang } from './i18n';
import type { Presets } from './presets';
import type { Controls } from './controls';
import type { AccessPrefs } from './access-prefs';
import type { AudioPrefs } from './audio-prefs';
import type { EmoteKeys } from './emote-keys';
import type { TouchPrefs } from './touch-controls';

/** Per-minigame tally. */
export interface GameStats {
  played: number;
  wins: number;
  points: number;
}

/** What a player did on one UTC day (the leaderboard's weekly / monthly windows sum these). */
export interface DailyTally {
  matches: number;
  wins: number;
  points: number;
  games: Record<string, GameStats>;
}

/** Days of per-day tallies kept per profile (older ones are dropped as new results arrive). */
export const DAILY_KEEP_DAYS = 31;
const DAY_MS = 86_400_000;
/** UTC day number of a timestamp: the key of `ProfileRecord.daily`. */
export const dayOf = (ms: number): number => Math.floor(ms / DAY_MS);

/** Most past matches a profile can keep (the hard ceiling of `storage.recentMatches`) and the default. */
export const RECENT_MATCHES_MAX = 50;
export const RECENT_MATCHES_DEFAULT = 10;
/** Most rounds kept in one match summary. */
export const RECENT_ROUNDS_MAX = 30;

/** One finished match as the player remembers it (names of others are never stored). */
export interface MatchSummary {
  /** epoch ms the match ended */
  ts: number;
  /** players in the match */
  players: number;
  /** final place, 1 = best */
  place: number;
  score: number;
  won: boolean;
  /** was the match's most valuable player */
  mvp: boolean;
  /** the player's placement in every round, in order */
  rounds: { game: string; place: number; points: number }[];
}

export interface ProfileStats {
  matches: number;
  wins: number;
  /** total placement points over all games */
  points: number;
  gamesPlayed: number;
  /** best total of a single match */
  bestMatchScore: number;
  lastPlayed: number;
  games: Record<string, GameStats>;
}

/** Everything persisted about one player. The editable part is `name`/`color`/`looks`/`avatar`. */
export interface ProfileRecord {
  name: string;
  /** preferred palette index */
  color: number;
  /** one look per character model, by model id (models the player never customized are absent) */
  looks: Looks;
  /** the model the player is shown with outside games (leaderboard...); absent = the first installed model */
  avatar?: string;
  /** UI language; absent until the player picks one (the browser default applies) */
  lang?: Lang;
  /** saved custom variants and playlists (absent until the player saves one) */
  presets?: Presets;
  /** rebound keyboard controls; absent = the defaults */
  controls?: Controls;
  /** on-screen control preferences; absent = the defaults */
  touch?: TouchPrefs;
  /** rebound emote-bar keys; absent = the defaults */
  emoteKeys?: EmoteKeys;
  /** accessibility display options; absent = the defaults */
  access?: AccessPrefs;
  /** volume levels; absent = full volume */
  audio?: AudioPrefs;
  /** hidden from the public leaderboard by an operator; never sent to players */
  shadowBanned?: boolean;
  createdAt: number;
  lastSeen: number;
  stats: ProfileStats;
  /** recent per-day tallies keyed by `dayOf(ms)`; absent until the first result */
  daily?: Record<string, DailyTally>;
  /** last finished matches, newest first; absent until the first one (or when the operator turns it off) */
  recent?: MatchSummary[];
}

export type ProfilePatch = Partial<Pick<ProfileRecord, 'name' | 'color' | 'looks' | 'avatar' | 'lang' | 'presets' | 'controls' | 'touch' | 'emoteKeys' | 'access' | 'audio' | 'shadowBanned'>>;

export function sanitizeLang(raw: unknown): Lang | undefined {
  return LANGS.find((l) => l === raw);
}

