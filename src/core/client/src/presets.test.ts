import { describe, expect, it } from 'vitest';
import { MAX_SAVED_PLAYLISTS, MAX_SAVED_VARIANTS } from '../../shared';
import { addPlaylist, addVariant, removePreset, renamePreset } from './presets';

const empty = { variants: [], playlists: [] };
const v = { name: 'Fast', game: 'spring-showdown', variant: 'spring-painter', options: { hopTime: 0.2 } };

describe('preset list operations', () => {
  it('adds, renames and removes without mutating', () => {
    const a = addVariant(empty, v, 'a1')!;
    expect(empty.variants).toHaveLength(0);
    expect(a.variants[0]).toMatchObject({ id: 'a1', name: 'Fast' });
    const b = renamePreset(a, 'variant', 'a1', 'Faster');
    expect(b.variants[0].name).toBe('Faster');
    expect(a.variants[0].name).toBe('Fast');
    expect(removePreset(b, 'variant', 'a1').variants).toHaveLength(0);
  });

  it('playlists work the same and respect caps', () => {
    const p = addPlaylist(empty, 'Night', [{ game: 'crazy-logs', variant: 'all', options: {} }], 'p1')!;
    expect(p.playlists[0].entries).toHaveLength(1);
    expect(removePreset(p, 'playlist', 'p1').playlists).toHaveLength(0);
    let full = empty as ReturnType<typeof addVariant>;
    for (let i = 0; i < MAX_SAVED_VARIANTS; i++) full = addVariant(full!, v, `v${i}`);
    expect(addVariant(full!, v, 'x')).toBeNull();
    let pl = empty as ReturnType<typeof addPlaylist>;
    for (let i = 0; i < MAX_SAVED_PLAYLISTS; i++) pl = addPlaylist(pl!, 'n', [], `p${i}`);
    expect(addPlaylist(pl!, 'n', [], 'x')).toBeNull();
  });
});
