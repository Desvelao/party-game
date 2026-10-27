import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_PLAYABLES, CATALOG, DEFAULT_SELECTION, filterCatalog, normalizeSelection, playlistFor, publishedSettings, unregisterGames } from './catalog';
import { createMinigame } from '../server/minigames';

/** The core ships with no game: a server with no pack installed must still work, with an empty catalog. */
describe('a core without games', () => {
  beforeAll(() => unregisterGames(CATALOG.map((g) => g.id)));

  it('has an empty catalog', () => {
    expect(CATALOG).toEqual([]);
    expect(ALL_PLAYABLES).toEqual([]);
    expect(filterCatalog(['x'])).toEqual([]);
    expect(playlistFor(DEFAULT_SELECTION)).toEqual([]);
  });

  it('does not throw when the default or a stale selection is checked', () => {
    expect(() => normalizeSelection(DEFAULT_SELECTION.game, DEFAULT_SELECTION.variant, DEFAULT_SELECTION.options)).not.toThrow();
    expect(normalizeSelection('ballistix', 'smashball', {})).toBeNull();
    expect(() => publishedSettings()).not.toThrow();
  });

  it('cannot start a round and says so', () => {
    expect(() => createMinigame(DEFAULT_SELECTION, 0)).toThrow(/no minigame registered/);
  });
});
