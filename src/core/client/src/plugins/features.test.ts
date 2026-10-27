import { afterEach, describe, expect, it } from 'vitest';
import { addFeatureForTest, bootFeatures, lobbyInfoSlots, pluginScreenAt, pluginScreens, recoveryHashes, renderPluginScreen, resetFeatures } from './features';

afterEach(() => resetFeatures());

describe('plugin screens', () => {
  const screen = { path: '/top', navLabel: 'Top', render: () => ({ tag: 'panel' }) as unknown as HTMLElement };

  it('lists the screens plugins draw and finds one by its address', () => {
    addFeatureForTest('plain', {});
    addFeatureForTest('lb', { screen });
    expect(pluginScreens()).toEqual([{ id: 'lb', path: '/top', navLabel: 'Top' }]);
    expect(pluginScreenAt('/top')?.id).toBe('lb');
    expect(pluginScreenAt('/top/')?.id).toBe('lb');
    expect(pluginScreenAt('/other')).toBeUndefined();
  });

  it('draws a screen with the context, and survives a plugin that throws or has none', () => {
    let seen: { back?: () => void; id?: string } = {};
    addFeatureForTest('lb', { screen: { ...screen, render: (ctx) => ((seen = { back: ctx.back }), { tag: 'ok' } as unknown as HTMLElement) } });
    addFeatureForTest('bad', { screen: { ...screen, path: '/bad', render: () => { throw new Error('boom'); } } });
    addFeatureForTest('none', {});
    const extra = { avatar: () => null as unknown as HTMLCanvasElement, games: () => [], presence: () => null as unknown as HTMLElement, back: () => {} };
    expect(renderPluginScreen('lb', extra)).toEqual({ tag: 'ok' });
    expect(seen.back).toBe(extra.back);
    expect(renderPluginScreen('bad', extra)).toBeNull();
    expect(renderPluginScreen('none', extra)).toBeNull();
    expect(renderPluginScreen('missing', extra)).toBeNull();
  });

  it('knows the link fragments that carry a profile', () => {
    expect(recoveryHashes()).toEqual(['recover']);
    addFeatureForTest('transfer', { recoveryInput: { hash: 'transfer', resolve: async () => null } });
    expect(recoveryHashes()).toEqual(['recover', 'transfer']);
  });
});

describe('bootFeatures', () => {
  it('registers plugins in list order even when their interfaces load out of order', async () => {
    const list = { plugins: ['a', 'b', 'c'].map((id) => ({ id, digest: id, client: true })) };
    const fetcher = (async () => ({ ok: true, json: async () => list })) as unknown as typeof fetch;
    const delay: Record<string, number> = { a: 30, b: 0, c: 15 };
    const load = async (url: string) => {
      const id = url.split('/')[2];
      await new Promise((r) => setTimeout(r, delay[id]));
      return { default: { lobbyInfo: () => ({ tag: id }) as unknown as HTMLElement } };
    };
    await bootFeatures(fetcher, load);
    expect(lobbyInfoSlots().map((e) => (e as unknown as { tag: string }).tag)).toEqual(['a', 'b', 'c']);
  });
});
