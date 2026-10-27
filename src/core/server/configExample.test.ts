import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publishedSettings } from '../shared';
import { renderGamesExample } from '../tools/gen-config-example';
import { parseConfigText, parseGameDefaults, parseGamesSection } from './configFile';

const example = readFileSync('config.example.yaml', 'utf8');

describe('config.example.yaml', () => {
  it('lists every published setting of every game and variant', () => {
    for (const g of publishedSettings()) {
      for (const s of g.settings) expect(example, `${g.target}.${s.id}`).toContain(`#   ${s.id}: `);
    }
  });

  it('matches the generated games section (run: npm run config:example)', () => {
    expect(example).toContain(renderGamesExample());
  });

  it('parses as a valid config', () => {
    expect(() => parseConfigText(example)).not.toThrow();
    expect(parseGameDefaults(example)).toEqual({});
  });
});

describe('games.defaults', () => {
  it('reads game and variant defaults', () => {
    const text = 'games:\n  defaults:\n    box-bonanza:\n      timeLimit: 120\n    drain-bonanza:\n      maxHp: 5\n';
    expect(parseGameDefaults(text)).toEqual({ 'box-bonanza': { timeLimit: 120 }, 'drain-bonanza': { maxHp: 5 } });
    expect(() => parseConfigText(text)).not.toThrow();
  });

  it.each([
    ['unknown game', 'games:\n  defaults:\n    nope:\n      timeLimit: 1\n'],
    ['unknown option', 'games:\n  defaults:\n    box-bonanza:\n      nope: 1\n'],
    ['out of range', 'games:\n  defaults:\n    box-bonanza:\n      timeLimit: 9999\n'],
    ['unknown games key', 'games:\n  other: 1\n'],
  ])('rejects %s', (_n, text) => {
    expect(() => parseConfigText(text)).toThrow(/games/);
  });
});

describe('games.playlists', () => {
  const ok = [
    'games:',
    '  playlists:',
    '    - name: Quick party',
    '      rounds:',
    '        - game: box-bonanza',
    '          variant: jungle-bonanza',
    '          options: { timeLimit: 60 }',
    '        - game: ballistix',
    '          variant: smashball',
    '',
  ].join('\n');

  it('reads playlists, deriving the id from the name', () => {
    const { playlists } = parseGamesSection(ok);
    expect(playlists).toHaveLength(1);
    expect(playlists[0]).toMatchObject({ id: 'quick-party', name: 'Quick party' });
    expect(playlists[0]!.rounds).toEqual([
      { game: 'box-bonanza', variant: 'jungle-bonanza', options: { timeLimit: 60 } },
      { game: 'ballistix', variant: 'smashball', options: {} },
    ]);
    expect(() => parseConfigText(ok)).not.toThrow();
  });

  it.each([
    ['unknown game', 'games:\n  playlists:\n    - name: A\n      rounds:\n        - game: nope\n'],
    ['bad option', 'games:\n  playlists:\n    - name: A\n      rounds:\n        - { game: box-bonanza, variant: jungle-bonanza, options: { timeLimit: 9999 } }\n'],
    ['no rounds', 'games:\n  playlists:\n    - name: A\n      rounds: []\n'],
    ['no name', 'games:\n  playlists:\n    - rounds:\n        - { game: box-bonanza, variant: jungle-bonanza }\n'],
    ['duplicate ids', 'games:\n  playlists:\n    - { name: A, rounds: [{ game: box-bonanza, variant: jungle-bonanza }] }\n    - { name: A, rounds: [{ game: box-bonanza, variant: jungle-bonanza }] }\n'],
    ['not a list', 'games:\n  playlists: {}\n'],
  ])('rejects %s', (_n, text) => {
    expect(() => parseConfigText(text)).toThrow(/games\.playlists/);
  });
});
