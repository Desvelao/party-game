import { ALL_VARIANTS, CATALOG, CUSTOM, MIXED, filterByTags, filterCatalog, setDefaultOverrides, validateDefaults, validatePlaylists, type OperatorPlaylist, type CatalogGame, type GameTag, type GameSelection, type PlaylistEntry } from '../../shared';
import { parseMaintenance, setMaintenance } from './maintenance';

/** Ids the operator switched off (game families and/or variants), as last reported by the server. */
let disabled: string[] = [];
/** Playlists the operator offers, as last reported by the server. */
let operatorPlaylists: OperatorPlaylist[] = [];

export function serverPlaylists(): readonly OperatorPlaylist[] {
  return operatorPlaylists;
}


/** Operator branding, as last reported by the server (the built-in defaults until then). */
const DEFAULT_BRAND_NAME = 'Party Game';
let brand = { name: DEFAULT_BRAND_NAME, welcomeMessage: '' };
export const brandName = (): string => brand.name;
/** Empty means "use the built-in translated tagline". */
export const welcomeMessage = (): string => brand.welcomeMessage;
/** The address phones use to reach the server (`server.publicUrl`); empty until known. A TV on `localhost` needs it for join links and QR codes. */
let publicBase = '';
export const linkOrigin = (): string => publicBase || location.origin;
/** Called after a refresh brought a different brand (the open menu updates in place). */
export let onBrandChange: () => void = () => {};
export function setOnBrandChange(fn: () => void): void {
  onBrandChange = fn;
}

export function disabledIds(): readonly string[] {
  return disabled;
}

/** For tests. */
export function setDisabledIds(ids: string[]): void {
  disabled = [...ids];
}

/**
 * The catalog the pickers may offer. Never empty: if the (stale or odd) list would hide everything,
 * show everything and let the server decide.
 */
export function enabledCatalog(tags: readonly GameTag[] = []): CatalogGame[] {
  const list = filterCatalog(disabled);
  const offered = list.length > 0 ? list : CATALOG;
  return filterByTags(offered, tags);
}

/** Is this concrete round (game + variant) offered? Games without variants only need the game. */
export function isEntryEnabled(e: Pick<PlaylistEntry, 'game' | 'variant'>): boolean {
  if (disabled.length === 0) return true;
  const g = enabledCatalog().find((c) => c.id === e.game);
  if (!g) return false;
  return g.variants.length === 0 || e.variant === ALL_VARIANTS || g.variants.some((v) => v.id === e.variant);
}

/** Is a whole room selection (mixed, one game, a custom playlist) offered? */
export function isSelectionEnabled(sel: Pick<GameSelection, 'game' | 'variant'> & Partial<GameSelection>): boolean {
  if (sel.game === MIXED) return true;
  if (sel.game === CUSTOM) return (sel.playlist ?? []).every(isEntryEnabled);
  return isEntryEnabled(sel);
}

/**
 * Ask the server what is switched off. Resolves true when the answer differs from what was known.
 * A failure keeps the last known list: a broken request must never hide games.
 */
export async function refreshDisabled(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher('/api/catalog', { cache: 'no-store' });
    if (!res.ok) return false;
    const body = (await res.json()) as { disabled?: unknown; defaults?: unknown; playlists?: unknown; brand?: unknown; maintenance?: unknown };
    // an older server says nothing: keep what the socket told us
    if (body.maintenance !== undefined) setMaintenance(parseMaintenance(body.maintenance));
    const b = body.brand as { name?: unknown; welcomeMessage?: unknown; publicUrl?: unknown } | undefined;
    if (b && typeof b === 'object') {
      publicBase = typeof b.publicUrl === 'string' ? b.publicUrl.replace(/\/+$/, '') : '';
      const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : DEFAULT_BRAND_NAME;
      const welcome = typeof b.welcomeMessage === 'string' ? b.welcomeMessage.trim() : '';
      if (name !== brand.name || welcome !== brand.welcomeMessage) {
        brand = { name, welcomeMessage: welcome };
        onBrandChange();
      }
    }
    // operator-set option defaults; unusable values are dropped by validation
    if (body.defaults !== undefined) setDefaultOverrides(validateDefaults(body.defaults).value);
    let playlistsChanged = false;
    if (body.playlists !== undefined) {
      const next = validatePlaylists(body.playlists).value;
      playlistsChanged = JSON.stringify(next) !== JSON.stringify(operatorPlaylists);
      operatorPlaylists = next;
    }
    if (!Array.isArray(body.disabled)) return false;
    const next = body.disabled.filter((x): x is string => typeof x === 'string').sort();
    const same = next.length === disabled.length && next.every((x, i) => x === [...disabled].sort()[i]);
    disabled = next;
    return !same || playlistsChanged;
  } catch {
    return false;
  }
}
