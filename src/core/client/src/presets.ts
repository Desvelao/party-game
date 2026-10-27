import {
  EMPTY_PRESETS,
  MAX_SAVED_PLAYLISTS,
  MAX_SAVED_VARIANTS,
  newPresetId,
  type PlaylistEntry,
  type Presets,
  type SavedPlaylist,
  type SavedVariant,
} from '../../shared';
import { cachedProfile, fetchProfile, isGuest, loadProfileKey, saveProfile } from './profile';

// ---- pure list operations (return a new Presets, or null when a cap is hit) -----

export function addVariant(p: Presets, v: Omit<SavedVariant, 'id'>, id = newPresetId()): Presets | null {
  if (p.variants.length >= MAX_SAVED_VARIANTS) return null;
  return { ...p, variants: [...p.variants, { ...v, id }] };
}

export function addPlaylist(p: Presets, name: string, entries: PlaylistEntry[], id = newPresetId()): Presets | null {
  if (p.playlists.length >= MAX_SAVED_PLAYLISTS) return null;
  const pl: SavedPlaylist = { id, name, entries };
  return { ...p, playlists: [...p.playlists, pl] };
}

export function removePreset(p: Presets, kind: 'variant' | 'playlist', id: string): Presets {
  return kind === 'variant'
    ? { ...p, variants: p.variants.filter((v) => v.id !== id) }
    : { ...p, playlists: p.playlists.filter((v) => v.id !== id) };
}

export function renamePreset(p: Presets, kind: 'variant' | 'playlist', id: string, name: string): Presets {
  const re = <T extends { id: string; name: string }>(list: T[]) => list.map((x) => (x.id === id ? { ...x, name } : x));
  return kind === 'variant' ? { ...p, variants: re(p.variants) } : { ...p, playlists: re(p.playlists) };
}

// ---- profile-backed access ------------------------------------------------------

/** What this browser last knew (instant, may be stale or empty). */
export function currentPresets(): Presets {
  return cachedProfile()?.presets ?? EMPTY_PRESETS;
}

/** Fresh from the server; falls back to the cache when it cannot be reached. */
export async function refreshPresets(): Promise<Presets> {
  if (isGuest()) return EMPTY_PRESETS;
  try {
    return (await fetchProfile(loadProfileKey()))?.presets ?? EMPTY_PRESETS;
  } catch {
    return currentPresets();
  }
}

/** Persist the whole set; resolves to what the server stored (it re-validates). */
export async function savePresets(p: Presets): Promise<Presets> {
  if (isGuest()) return p;
  const rec = await saveProfile(loadProfileKey(), { presets: p });
  return rec.presets ?? EMPTY_PRESETS;
}
