import { describe, expect, it } from 'vitest';
import {
  CUSTOM,
  MAX_PLAYLIST,
  normalizeSelection,
  describeSelection,
  playlistFor,
  selectionRounds,
  stagesOf,
} from './catalog';
import { MAX_SAVED_VARIANTS, newPresetId, sanitizePresets } from './presets';

const round = (game: string, variant?: string, options?: unknown) => ({ game, variant, options });

describe('custom playlist selection', () => {
  it('accepts concrete rounds in order, each with its own options', () => {
    const sel = normalizeSelection(undefined, undefined, undefined, [
      round('spring-showdown', 'spring-painter', { gridSize: 10 }),
      round('crazy-logs'),
      round('ballistix', 'smashball'),
    ]);
    expect(sel).not.toBeNull();
    expect(sel!.game).toBe(CUSTOM);
    expect(sel!.playlist!.map((e) => e.variant)).toEqual(['spring-painter', 'all', 'smashball']);
    expect(sel!.playlist![0].options).toEqual({ gridSize: 10 });
    expect(playlistFor(sel!).map((p) => p.id)).toEqual(['spring-painter', 'crazy-logs', 'smashball']);
    expect(selectionRounds(sel!)[0].options).toEqual({ gridSize: 10 });
    expect(selectionRounds(sel!)[1].options).toEqual({});
  });

  it('defaults are dropped and values are coerced like a single selection', () => {
    const sel = normalizeSelection(undefined, undefined, undefined, [round('spring-showdown', 'spring-painter', { gridSize: 8, hopTime: 99 })]);
    expect(sel!.playlist![0].options).toEqual({ hopTime: 0.6 });
  });

  it('rejects invalid playlists', () => {
    expect(normalizeSelection(undefined, undefined, undefined, [])).toBeNull();
    expect(normalizeSelection(undefined, undefined, undefined, 'x')).toBeNull();
    expect(normalizeSelection(undefined, undefined, undefined, [round('mixed')])).toBeNull();
    expect(normalizeSelection(undefined, undefined, undefined, [round('custom')])).toBeNull();
    expect(normalizeSelection(undefined, undefined, undefined, [round('nope')])).toBeNull();
    expect(normalizeSelection(undefined, undefined, undefined, [round('ballistix', 'all')])).toBeNull();
    expect(normalizeSelection(undefined, undefined, undefined, [round('ballistix')])).toBeNull();
    expect(normalizeSelection(undefined, undefined, undefined, [round('ballistix', 'smashball', { bogus: 1 })])).toBeNull();
    expect(normalizeSelection(undefined, undefined, undefined, [null])).toBeNull();
    const tooMany = Array.from({ length: MAX_PLAYLIST + 1 }, () => round('crazy-logs'));
    expect(normalizeSelection(undefined, undefined, undefined, tooMany)).toBeNull();
  });

  it('single selections are unaffected', () => {
    expect(normalizeSelection('ballistix', 'smashball')).toEqual({ game: 'ballistix', variant: 'smashball', options: {} });
    expect(normalizeSelection()).toMatchObject({ game: 'mixed', variant: 'all' });
  });

  it('has one stage per entry, with its own wins, else the playlist default, else the arena default', () => {
    const sel = normalizeSelection(
      undefined,
      undefined,
      undefined,
      [{ ...round('crazy-logs'), options: { roundsToWin: 5 } }, round('crazy-logs')],
      2,
    )!;
    expect(sel.playlistRoundsToWin).toBe(2);
    expect(stagesOf(sel)).toEqual([{ roundsToWin: 5 }, { roundsToWin: 2 }]);
    const plain = normalizeSelection(undefined, undefined, undefined, [round('crazy-logs')])!;
    expect(stagesOf(plain)).toEqual([{ roundsToWin: 3 }]);
    expect(stagesOf({ game: 'mixed', variant: 'all', options: { roundsToWin: 7 } })).toEqual([{ roundsToWin: 7 }]);
  });

  it('describes itself', () => {
    const sel = normalizeSelection(undefined, undefined, undefined, [round('crazy-logs')])!;
    expect(describeSelection(sel)).toContain('1');
  });
});

describe('sanitizePresets', () => {
  const variant = { id: 'v1', name: ' Fast Pogo ', game: 'spring-showdown', variant: 'spring-painter', options: { hopTime: 0.2 } };
  const playlist = { id: 'p1', name: 'Night', entries: [round('crazy-logs'), round('ballistix', 'smashball')] };

  it('keeps valid presets and normalizes them', () => {
    const p = sanitizePresets({ variants: [variant], playlists: [playlist] });
    expect(p.variants).toEqual([{ id: 'v1', name: 'Fast Pogo', game: 'spring-showdown', variant: 'spring-painter', options: { hopTime: 0.2 } }]);
    expect(p.playlists[0].entries.map((e) => e.game)).toEqual(['crazy-logs', 'ballistix']);
  });

  it('strips invisible and bidi characters from names, rejecting invisible-only ones', () => {
    const p = sanitizePresets({
      variants: [
        { ...variant, id: 'v1', name: '\u202eFast\u200b Pogo' },
        { ...variant, id: 'v2', name: '\u200b\u202e\u2060' },
      ],
      playlists: [{ ...playlist, name: '\u200f\u200b' }],
    });
    expect(p.variants.map((v) => v.name)).toEqual(['Fast Pogo']);
    expect(p.playlists).toHaveLength(0);
  });

  it('drops invalid items and duplicates', () => {
    const p = sanitizePresets({
      variants: [
        { ...variant, id: 'bad id!' },
        { ...variant, name: '   ' },
        { ...variant, game: 'mixed', variant: 'all' },
        { ...variant, options: { nope: 1 } },
        variant,
        { ...variant }, // duplicate id
      ],
      playlists: [{ ...playlist, entries: [] }, playlist],
    });
    expect(p.variants).toHaveLength(1);
    expect(p.playlists).toHaveLength(1);
  });

  it('enforces caps and garbage input', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...variant, id: `v${i}`, name: `n${i}` }));
    expect(sanitizePresets({ variants: many }).variants).toHaveLength(MAX_SAVED_VARIANTS);
    for (const g of [null, 5, 'x', [], { variants: 'x', playlists: {} }]) {
      expect(sanitizePresets(g)).toEqual({ variants: [], playlists: [] });
    }
  });

  it('makes ids that pass the id check', () => {
    const id = newPresetId();
    expect(sanitizePresets({ variants: [{ ...variant, id }] }).variants).toHaveLength(1);
  });
});
