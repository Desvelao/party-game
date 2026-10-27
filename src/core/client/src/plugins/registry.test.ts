import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_PLAYABLES, CATALOG, setLang, tr, unregisterGames } from '../../../shared';
import { bootGames, pluginForKind, resetPlugins } from './registry';
import { fixtureManifest } from '../../../test-fixtures/pack';

const entry = () => {
  const m = fixtureManifest(new Map());
  return { id: m.id, version: m.version, digest: 'abc', catalog: m.catalog, locales: m.locales };
};
const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

afterEach(() => {
  unregisterGames(['fixture-game']);
  resetPlugins();
  setLang('en');
});

describe('bootGames', () => {
  it('registers the installed games and their translations', async () => {
    await bootGames(reply({ games: [entry()] }));
    expect(CATALOG.some((g) => g.id === 'fixture-game')).toBe(true);
    expect(ALL_PLAYABLES.some((p) => p.id === 'fixture-game')).toBe(true);
    setLang('es');
    expect(tr('Press the button faster than the others.')).toBe('Pulsa el botón más rápido que los demás.');
  });

  it('never throws: a failed or odd response just leaves the built-in games', async () => {
    const before = CATALOG.length;
    await bootGames(reply({}, false));
    await bootGames((async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch);
    await bootGames(reply({ games: [{ id: 'x', digest: 'd', catalog: null }] }));
    await bootGames(reply('nonsense'));
    expect(CATALOG.length).toBe(before);
  });

  it('skips a game that clashes with one already registered and keeps the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await bootGames(reply({ games: [entry(), entry()] }));
    expect(CATALOG.filter((g) => g.id === 'fixture-game')).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('has no plugin for kinds nobody loaded', () => {
    expect(pluginForKind('ext:fixture-game')).toBeUndefined();
  });
});
