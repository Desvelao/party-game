import { MAX_PLAYLIST, coerceOption, normalizeSelection, optionsFor, type PlaylistEntry } from './catalog';
import { MAX_PRESET_ID, PRESET_ID_RE, cleanName } from './presets';

/** A named, ordered list of rounds the operator offers to every host. */
export interface OperatorPlaylist {
  id: string;
  name: string;
  rounds: PlaylistEntry[];
}

export const MAX_OPERATOR_PLAYLISTS = 20;

/** Id of a playlist written without one: the name, lower-cased, reduced to `[a-z0-9-]`. */
export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_PRESET_ID)
    .replace(/-+$/g, '');
}

/** Validate one playlist (`id` optional). Returns the cleaned playlist or one message per problem. */
export function validatePlaylist(raw: unknown, idHint?: string): { value: OperatorPlaylist | null; errors: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { value: null, errors: ['a playlist must be a mapping with name and rounds'] };
  const o = raw as Record<string, unknown>;
  const name = cleanName(o.name);
  const label = name || (typeof o.id === 'string' ? o.id : idHint) || 'playlist';
  const errors: string[] = [];
  if (!name) errors.push(`${label}: name is required`);
  const id = o.id === undefined || o.id === null ? (idHint ?? slugOf(name)) : o.id;
  if (typeof id !== 'string' || !PRESET_ID_RE.test(id)) errors.push(`${label}: id must be 1-${MAX_PRESET_ID} letters, digits, "-" or "_"`);
  if (!Array.isArray(o.rounds) || o.rounds.length < 1 || o.rounds.length > MAX_PLAYLIST) {
    errors.push(`${label}: rounds must be a list of 1 to ${MAX_PLAYLIST} rounds`);
  }
  let rounds: PlaylistEntry[] = [];
  if (Array.isArray(o.rounds) && o.rounds.length >= 1 && o.rounds.length <= MAX_PLAYLIST) {
    for (const [i, r] of o.rounds.entries()) {
      // one round at a time so the message names it
      const sel = normalizeSelection(undefined, undefined, undefined, [r]);
      if (!sel?.playlist) errors.push(`${label}: round ${i + 1} is not a valid game, variant and options`);
      else {
        // normalizing clamps; an operator should hear about a value that is out of range
        const raw = (r as { options?: Record<string, unknown> }).options ?? {};
        const e = sel.playlist[0]!;
        const defs = optionsFor(e.game, e.variant);
        const bad = Object.entries(raw).find(([k, v]) => {
          const d = defs.find((x) => x.id === k);
          return d !== undefined && coerceOption(d, v) !== v;
        });
        if (bad) errors.push(`${label}: round ${i + 1}: option "${bad[0]}" must be within its allowed values (got ${JSON.stringify(bad[1])})`);
        else rounds.push(e);
      }
    }
    if (errors.length > 0) rounds = [];
  }
  if (errors.length > 0) return { value: null, errors };
  return { value: { id: id as string, name, rounds }, errors };
}

/** Validate a list of playlists: invalid ones are reported, duplicate ids and the cap too. */
export function validatePlaylists(raw: unknown): { value: OperatorPlaylist[]; errors: string[] } {
  const value: OperatorPlaylist[] = [];
  if (raw === null || raw === undefined) return { value, errors: [] };
  if (!Array.isArray(raw)) return { value, errors: ['playlists must be a list'] };
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const res = validatePlaylist(item);
    if (!res.value) {
      errors.push(...res.errors);
      continue;
    }
    if (seen.has(res.value.id)) {
      errors.push(`${res.value.name}: duplicate playlist id "${res.value.id}"`);
      continue;
    }
    seen.add(res.value.id);
    value.push(res.value);
  }
  if (value.length > MAX_OPERATOR_PLAYLISTS) {
    errors.push(`at most ${MAX_OPERATOR_PLAYLISTS} playlists are allowed`);
    value.length = MAX_OPERATOR_PLAYLISTS;
  }
  return { value, errors };
}
