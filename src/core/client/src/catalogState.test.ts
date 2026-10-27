import { afterEach, describe, expect, it } from 'vitest';
import { CATALOG } from '../../shared';
import { brandName, enabledCatalog, isEntryEnabled, isSelectionEnabled, refreshDisabled, setDisabledIds, setOnBrandChange, welcomeMessage } from './catalogState';

afterEach(() => setDisabledIds([]));

const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe('client catalog state', () => {
  it('offers everything until told otherwise', () => {
    expect(enabledCatalog()).toBe(CATALOG);
    expect(isSelectionEnabled({ game: 'frost-shove', variant: 'frost-classic' })).toBe(true);
  });

  it('hides a disabled family and a disabled variant', () => {
    setDisabledIds(['frost-shove', 'jungle-bonanza']);
    const ids = enabledCatalog().map((g) => g.id);
    expect(ids).not.toContain('frost-shove');
    expect(enabledCatalog().find((g) => g.id === 'box-bonanza')!.variants.map((v) => v.id)).not.toContain('jungle-bonanza');
    expect(isEntryEnabled({ game: 'frost-shove', variant: 'frost-classic' })).toBe(false);
    expect(isEntryEnabled({ game: 'box-bonanza', variant: 'jungle-bonanza' })).toBe(false);
    expect(isEntryEnabled({ game: 'box-bonanza', variant: 'space-bonanza' })).toBe(true);
    expect(isEntryEnabled({ game: 'crazy-logs', variant: 'all' })).toBe(true);
  });

  it('judges whole selections, including playlists', () => {
    setDisabledIds(['frost-shove']);
    expect(isSelectionEnabled({ game: 'mixed', variant: 'all' })).toBe(true);
    expect(isSelectionEnabled({ game: 'frost-shove', variant: 'all' })).toBe(false);
    const ok = { game: 'custom', variant: 'all', options: {}, playlist: [{ game: 'box-bonanza', variant: 'space-bonanza', options: {} }] };
    const bad = { ...ok, playlist: [...ok.playlist, { game: 'frost-shove', variant: 'frost-frenzy', options: {} }] };
    expect(isSelectionEnabled(ok)).toBe(true);
    expect(isSelectionEnabled(bad)).toBe(false);
  });

  it('follows the server branding and tells when it changed', async () => {
    expect(brandName()).toBe('Party Game');
    expect(welcomeMessage()).toBe('');
    let changed = 0;
    setOnBrandChange(() => changed++);
    await refreshDisabled(reply({ disabled: [], brand: { name: ' Bonk Night ', welcomeMessage: 'Hi!' } }));
    expect(brandName()).toBe('Bonk Night');
    expect(welcomeMessage()).toBe('Hi!');
    expect(changed).toBe(1);
    await refreshDisabled(reply({ disabled: [], brand: { name: 'Bonk Night', welcomeMessage: 'Hi!' } }));
    expect(changed).toBe(1);
    await refreshDisabled(reply({ disabled: [], brand: { name: '', welcomeMessage: 7 } }));
    expect(brandName()).toBe('Party Game');
    expect(welcomeMessage()).toBe('');
    setOnBrandChange(() => {});
  });

  it('never ends up with an empty menu', () => {
    setDisabledIds(CATALOG.map((g) => g.id));
    expect(enabledCatalog()).toBe(CATALOG);
  });

  it('refreshes from the server, reports changes, and keeps the list on failure', async () => {
    expect(await refreshDisabled(reply({ disabled: ['frost-shove'] }))).toBe(true);
    expect(enabledCatalog().map((g) => g.id)).not.toContain('frost-shove');
    expect(await refreshDisabled(reply({ disabled: ['frost-shove'] }))).toBe(false);
    expect(await refreshDisabled((async () => Promise.reject(new Error('down'))) as unknown as typeof fetch)).toBe(false);
    expect(await refreshDisabled(reply({}, false))).toBe(false);
    expect(await refreshDisabled(reply({ disabled: 'nope' }))).toBe(false);
    expect(enabledCatalog().map((g) => g.id)).not.toContain('frost-shove');
    expect(await refreshDisabled(reply({ disabled: [] }))).toBe(true);
    expect(enabledCatalog()).toBe(CATALOG);
  });
});
