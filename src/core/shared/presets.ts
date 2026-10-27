import { cleanText } from './protocol';
import { normalizeSelection, type PlaylistEntry } from './catalog';

/** A named game/variant with customized options ("create a variant"). */
export interface SavedVariant {
  id: string;
  name: string;
  game: string;
  variant: string;
  options: PlaylistEntry['options'];
}

/** A named ordered list of rounds. */
export interface SavedPlaylist {
  id: string;
  name: string;
  entries: PlaylistEntry[];
}

export interface Presets {
  variants: SavedVariant[];
  playlists: SavedPlaylist[];
}

export const MAX_SAVED_VARIANTS = 20;
export const MAX_SAVED_PLAYLISTS = 20;
export const MAX_PRESET_NAME = 24;
export const MAX_PRESET_ID = 12;

export const EMPTY_PRESETS: Presets = { variants: [], playlists: [] };

/** Shape of a preset/playlist id (length matches MAX_PRESET_ID). */
export const PRESET_ID_RE = /^[A-Za-z0-9_-]{1,12}$/;

/** Preset/playlist display name: cleaned text capped at MAX_PRESET_NAME, '' for non-strings. */
export function cleanName(raw: unknown): string {
  return typeof raw === 'string' ? cleanText(raw, MAX_PRESET_NAME) : '';
}

/** Random short id for a new preset. */
export function newPresetId(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)];
  return s;
}

/**
 * Validate untrusted presets. Anything invalid is dropped (not repaired), options are
 * re-validated against the catalog, caps are enforced, ids made unique.
 */
export function sanitizePresets(raw: unknown): Presets {
  const out: Presets = { variants: [], playlists: [] };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;

  const seen = new Set<string>();
  const idOf = (v: unknown): string | null => {
    if (typeof v !== 'string' || !PRESET_ID_RE.test(v) || seen.has(v)) return null;
    seen.add(v);
    return v;
  };

  if (Array.isArray(r.variants)) {
    for (const v of r.variants) {
      if (out.variants.length >= MAX_SAVED_VARIANTS) break;
      if (typeof v !== 'object' || v === null) continue;
      const o = v as Record<string, unknown>;
      const name = cleanName(o.name);
      if (!name) continue;
      const sel = normalizeSelection(o.game, o.variant, o.options, undefined);
      // a saved variant is one concrete game/variant, not mixed / all variants
      if (!sel || sel.playlist || sel.game === 'mixed') continue;
      const id = idOf(o.id);
      if (!id) continue;
      out.variants.push({ id, name, game: sel.game, variant: sel.variant, options: sel.options });
    }
  }

  if (Array.isArray(r.playlists)) {
    for (const p of r.playlists) {
      if (out.playlists.length >= MAX_SAVED_PLAYLISTS) break;
      if (typeof p !== 'object' || p === null) continue;
      const o = p as Record<string, unknown>;
      const name = cleanName(o.name);
      if (!name) continue;
      const sel = normalizeSelection(undefined, undefined, undefined, o.entries);
      if (!sel?.playlist) continue;
      const id = idOf(o.id);
      if (!id) continue;
      out.playlists.push({ id, name, entries: sel.playlist });
    }
  }
  return out;
}
