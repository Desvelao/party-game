import { createHash } from 'node:crypto';
import {
  DAILY_KEEP_DAYS,
  RECENT_MATCHES_DEFAULT,
  RECENT_MATCHES_MAX,
  RECENT_ROUNDS_MAX,
  PALETTE,
  dayOf,
  isDefaultAccessPrefs,
  isDefaultAudioPrefs,
  isDefaultControls,
  isDefaultEmoteKeys,
  isDefaultTouchPrefs,
  sanitizeColor,
  sanitizeControls,
  sanitizeLang,
  sanitizePresets,
  MAX_LOOK_MODELS,
  sanitizeAvatar,
  sanitizeLooks,
  sanitizeName,
  sanitizeAccessPrefs,
  sanitizeAudioPrefs,
  sanitizeEmoteKeys,
  sanitizeTouchPrefs,
  type DailyTally,
  type GameStats,
  type MatchSummary,
  type ProfilePatch,
  type ProfileRecord,
  type ProfileStats,
} from '../../shared';

export type { GameStats, MatchSummary, ProfilePatch, ProfileRecord, ProfileStats };

/** One finished game and/or match, as seen by a member. Computed by the server only. */
export interface ResultDelta {
  /** name used when the record has to be created by a result */
  name: string;
  game?: { id: string; place: number; points: number };
  match?: { score: number; won: boolean; summary?: MatchSummary };
  /** how many past matches the record keeps (`storage.recentMatches`); absent = the default */
  keepRecent?: number;
}

export const MAX_GAME_ID_LENGTH = 48;

/** Opaque, stable storage id for a client-held profile key (the key itself is never stored). */
export function profileIdOf(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function emptyStats(): ProfileStats {
  return { matches: 0, wins: 0, points: 0, gamesPlayed: 0, bestMatchScore: 0, lastPlayed: 0, games: {} };
}

export function newRecord(now: number, patch: ProfilePatch = {}): ProfileRecord {
  const lang = sanitizeLang(patch.lang);
  const presets = patch.presets !== undefined ? sanitizePresets(patch.presets) : undefined;
  const controls = patch.controls !== undefined ? sanitizeControls(patch.controls) : undefined;
  const touch = patch.touch !== undefined ? sanitizeTouchPrefs(patch.touch) : undefined;
  const emoteKeys = patch.emoteKeys !== undefined ? sanitizeEmoteKeys(patch.emoteKeys) : undefined;
  const access = patch.access !== undefined ? sanitizeAccessPrefs(patch.access) : undefined;
  const audio = patch.audio !== undefined ? sanitizeAudioPrefs(patch.audio) : undefined;
  return {
    name: sanitizeName(patch.name),
    color: sanitizeColor(patch.color),
    looks: sanitizeLooks(patch.looks),
    ...(sanitizeAvatar(patch.avatar) ? { avatar: sanitizeAvatar(patch.avatar) } : {}),
    ...(lang ? { lang } : {}),
    ...(presets ? { presets } : {}),
    ...(controls && !isDefaultControls(controls) ? { controls } : {}),
    ...(touch && !isDefaultTouchPrefs(touch) ? { touch } : {}),
    ...(emoteKeys && !isDefaultEmoteKeys(emoteKeys) ? { emoteKeys } : {}),
    ...(access && !isDefaultAccessPrefs(access) ? { access } : {}),
    ...(audio && !isDefaultAudioPrefs(audio) ? { audio } : {}),
    ...(patch.shadowBanned === true ? { shadowBanned: true } : {}),
    createdAt: now,
    lastSeen: now,
    stats: emptyStats(),
  };
}

/** The saved looks with the models of `patch` replaced (models it does not name are kept, up to the cap). */
function mergeLooks(saved: ProfileRecord['looks'], patch: unknown): ProfileRecord['looks'] {
  const next = { ...sanitizeLooks(saved), ...sanitizeLooks(patch) };
  const ids = Object.keys(next);
  for (const id of ids.slice(MAX_LOOK_MODELS)) delete next[id];
  return next;
}

/** Apply the editable fields of `patch` (sanitized); absent fields are kept. Pure. */
export function applyPatch(rec: ProfileRecord, patch: ProfilePatch, now: number): ProfileRecord {
  const next: ProfileRecord = {
    ...rec,
    name: patch.name !== undefined ? sanitizeName(patch.name) : rec.name,
    color: patch.color !== undefined ? sanitizeColor(patch.color) % PALETTE.length : rec.color,
    looks: patch.looks !== undefined ? mergeLooks(rec.looks, patch.looks) : rec.looks,
    ...(sanitizeLang(patch.lang) ? { lang: sanitizeLang(patch.lang) } : {}),
    ...(patch.presets !== undefined ? { presets: sanitizePresets(patch.presets) } : {}),
    lastSeen: now,
  };
  if (patch.avatar !== undefined) {
    const avatar = sanitizeAvatar(patch.avatar);
    if (avatar) next.avatar = avatar;
    else delete next.avatar;
  }
  if (patch.controls !== undefined) {
    // only non-default bindings are stored; resetting removes them
    const controls = sanitizeControls(patch.controls);
    if (isDefaultControls(controls)) delete next.controls;
    else next.controls = controls;
  }
  if (patch.touch !== undefined) {
    const touch = sanitizeTouchPrefs(patch.touch);
    if (isDefaultTouchPrefs(touch)) delete next.touch;
    else next.touch = touch;
  }
  if (patch.emoteKeys !== undefined) {
    const emoteKeys = sanitizeEmoteKeys(patch.emoteKeys);
    if (isDefaultEmoteKeys(emoteKeys)) delete next.emoteKeys;
    else next.emoteKeys = emoteKeys;
  }
  if (patch.access !== undefined) {
    const access = sanitizeAccessPrefs(patch.access);
    if (isDefaultAccessPrefs(access)) delete next.access;
    else next.access = access;
  }
  if (patch.shadowBanned !== undefined) {
    if (patch.shadowBanned === true) next.shadowBanned = true;
    else delete next.shadowBanned;
  }
  if (patch.audio !== undefined) {
    const audio = sanitizeAudioPrefs(patch.audio);
    if (isDefaultAudioPrefs(audio)) delete next.audio;
    else next.audio = audio;
  }
  return next;
}

/** Add one result to the stats. Pure. */
export function applyResult(rec: ProfileRecord, delta: ResultDelta, now: number): ProfileRecord {
  const s = rec.stats;
  const stats: ProfileStats = { ...s, games: { ...s.games }, lastPlayed: now };
  if (delta.game) {
    const id = delta.game.id.slice(0, MAX_GAME_ID_LENGTH);
    const g = stats.games[id] ?? { played: 0, wins: 0, points: 0 };
    stats.games[id] = {
      played: g.played + 1,
      wins: g.wins + (delta.game.place === 1 ? 1 : 0),
      points: g.points + delta.game.points,
    };
    stats.gamesPlayed += 1;
    stats.points += delta.game.points;
  }
  if (delta.match) {
    stats.matches += 1;
    if (delta.match.won) stats.wins += 1;
    stats.bestMatchScore = Math.max(stats.bestMatchScore, delta.match.score);
  }
  // the same result, added to today's tally for the weekly / monthly leaderboards
  const today = String(dayOf(now));
  const prev = rec.daily?.[today];
  const day: DailyTally = { matches: prev?.matches ?? 0, wins: prev?.wins ?? 0, points: prev?.points ?? 0, games: { ...prev?.games } };
  if (delta.game) {
    const id = delta.game.id.slice(0, MAX_GAME_ID_LENGTH);
    const g = day.games[id] ?? { played: 0, wins: 0, points: 0 };
    day.games[id] = { played: g.played + 1, wins: g.wins + (delta.game.place === 1 ? 1 : 0), points: g.points + delta.game.points };
    day.points += delta.game.points;
  }
  if (delta.match) {
    day.matches += 1;
    if (delta.match.won) day.wins += 1;
  }
  const daily = pruneDaily({ ...rec.daily, [today]: day }, now);
  const next: ProfileRecord = { ...rec, stats, daily, lastSeen: now };
  if (delta.match?.summary) {
    const keep = Math.max(0, Math.min(RECENT_MATCHES_MAX, Math.floor(delta.keepRecent ?? RECENT_MATCHES_DEFAULT)));
    const recent = [delta.match.summary, ...(rec.recent ?? [])].slice(0, keep);
    if (recent.length) next.recent = recent;
    else delete next.recent;
  }
  return next;
}

/** Keep only the most recent DAILY_KEEP_DAYS days. */
function pruneDaily(daily: Record<string, DailyTally>, now: number): Record<string, DailyTally> {
  const oldest = dayOf(now) - DAILY_KEEP_DAYS + 1;
  return Object.fromEntries(Object.entries(daily).filter(([k]) => Number(k) >= oldest));
}

/** Defensive parse of stored per-day tallies. */
function reviveDaily(raw: unknown, now: number): Record<string, DailyTally> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const out: Record<string, DailyTally> = {};
  for (const [k, v] of Object.entries<any>(raw as Record<string, any>).slice(0, DAILY_KEEP_DAYS * 2)) {
    if (!/^\d{1,6}$/.test(k) || !v || typeof v !== 'object') continue;
    const games: Record<string, GameStats> = {};
    if (typeof v.games === 'object' && v.games !== null) {
      for (const [id, g] of Object.entries<any>(v.games).slice(0, 64)) {
        if (g && typeof g === 'object') games[id.slice(0, MAX_GAME_ID_LENGTH)] = { played: n(g.played), wins: n(g.wins), points: n(g.points) };
      }
    }
    out[k] = { matches: n(v.matches), wins: n(v.wins), points: n(v.points), games };
  }
  const kept = pruneDaily(out, now);
  return Object.keys(kept).length ? kept : undefined;
}

/** Defensive parse of stored past matches. */
function reviveRecent(raw: unknown): MatchSummary[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const out: MatchSummary[] = [];
  for (const v of raw.slice(0, RECENT_MATCHES_MAX)) {
    if (!v || typeof v !== 'object') continue;
    const rounds = Array.isArray(v.rounds)
      ? v.rounds
          .slice(0, RECENT_ROUNDS_MAX)
          .filter((r: any) => r && typeof r === 'object' && typeof r.game === 'string')
          .map((r: any) => ({ game: String(r.game).slice(0, MAX_GAME_ID_LENGTH), place: n(r.place), points: n(r.points) }))
      : [];
    out.push({ ts: n(v.ts), players: n(v.players), place: n(v.place), score: n(v.score), won: v.won === true, mvp: v.mvp === true, rounds });
  }
  return out.length ? out : undefined;
}

/** Defensive parse of a stored record (hand-edited / older file / future DB row). */
export function reviveRecord(raw: unknown, now: number): ProfileRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, any>;
  // records saved before character models had one flat `look` (sanitizeLooks reads it as the legacy model's)
  const base = newRecord(typeof r.createdAt === 'number' ? r.createdAt : now, { ...r, looks: r.looks ?? r.look } as ProfilePatch);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const st = typeof r.stats === 'object' && r.stats !== null ? r.stats : {};
  const games: Record<string, GameStats> = {};
  if (typeof st.games === 'object' && st.games !== null) {
    for (const [id, g] of Object.entries<any>(st.games).slice(0, 64)) {
      if (g && typeof g === 'object') games[id.slice(0, MAX_GAME_ID_LENGTH)] = { played: num(g.played), wins: num(g.wins), points: num(g.points) };
    }
  }
  const daily = reviveDaily(r.daily, Date.now());
  const recent = reviveRecent(r.recent);
  return {
    ...base,
    ...(daily ? { daily } : {}),
    ...(recent ? { recent } : {}),
    lastSeen: num(r.lastSeen) || base.createdAt,
    stats: {
      matches: num(st.matches),
      wins: num(st.wins),
      points: num(st.points),
      gamesPlayed: num(st.gamesPlayed),
      bestMatchScore: num(st.bestMatchScore),
      lastPlayed: num(st.lastPlayed),
      games,
    },
  };
}
