import { describe, expect, it } from 'vitest';
import { DEFAULT_SELECTION, normalizeSelection } from '../../shared';
import { CatalogState } from './catalogState';

const sel = (game: string, variant?: string) => normalizeSelection(game, variant)!;

describe('CatalogState', () => {
  it('disabling a family disables its variants; a variant alone only itself', () => {
    const c = new CatalogState();
    expect(c.set(['ballistix', 'jungle-bonanza'])).toEqual({ ok: true });
    expect(c.isPlayableEnabled('smashball')).toBe(false);
    expect(c.isPlayableEnabled('jungle-bonanza')).toBe(false);
    expect(c.isPlayableEnabled('space-bonanza')).toBe(true);
    expect(c.isPlayableEnabled('crazy-logs')).toBe(true);
  });

  it('refuses unknown ids and disabling everything', () => {
    const c = new CatalogState();
    expect(c.set(['nope'])).toMatchObject({ ok: false });
    const all = ['crazy-logs', 'crazy-logs', 'ballistix', 'frost-shove', 'spring-showdown', 'box-bonanza', 'sprint-smash', 'tank-wars', 'rumble-cards'];
    expect(c.set(all)).toMatchObject({ ok: false });
    expect(c.list()).toEqual([]);
  });

  it('check() refuses explicit picks of disabled games but lets mixes through', () => {
    const c = new CatalogState();
    c.set(['box-bonanza', 'frost-classic']);
    expect(c.check(DEFAULT_SELECTION)).toBeNull();
    expect(c.check(sel('box-bonanza'))).toMatch(/disabled/);
    expect(c.check(sel('frost-shove', 'frost-classic'))).toMatch(/disabled/);
    expect(c.check(sel('frost-shove', 'frost-frenzy'))).toBeNull();
    // a family with only some variants off still plays
    expect(c.check(sel('frost-shove'))).toBeNull();
    const playlist = normalizeSelection('custom', undefined, undefined, [{ game: 'box-bonanza', variant: 'space-bonanza' }])!;
    expect(c.check(playlist)).toMatch(/disabled/);
  });
});
