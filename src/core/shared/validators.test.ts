import { describe, expect, it } from 'vitest';
import { MAX_PLAYLIST } from './catalog';
import { MAX_OPERATOR_PLAYLISTS, slugOf, validatePlaylist, validatePlaylists } from './playlists';
import { MAX_PASSWORD_LENGTH, PROTOCOL_VERSION, nameKey, parseClientMessage, sanitizePassword } from './protocol';
import { sanitizeLang } from './profile';

const round = (game: string, variant?: string, options?: unknown) => ({ game, variant, options });
const pl = (o: Record<string, unknown> = {}) => ({ name: 'Mix', rounds: [round('crazy-logs')], ...o });

describe('sanitizePassword', () => {
  it('trims and accepts 1..MAX_PASSWORD_LENGTH characters', () => {
    expect(sanitizePassword('  sesame ')).toBe('sesame');
    expect(sanitizePassword('x'.repeat(MAX_PASSWORD_LENGTH))).toBe('x'.repeat(MAX_PASSWORD_LENGTH));
    expect(sanitizePassword('x'.repeat(MAX_PASSWORD_LENGTH + 1))).toBeNull();
  });
  it('rejects empty, non-string and control characters', () => {
    expect(sanitizePassword('')).toBeNull();
    expect(sanitizePassword('   ')).toBeNull();
    expect(sanitizePassword(5)).toBeNull();
    expect(sanitizePassword(null)).toBeNull();
    expect(sanitizePassword('a\nb')).toBeNull();
    expect(sanitizePassword('a\u007fb')).toBeNull();
  });
  it('measures length after trimming', () => {
    expect(sanitizePassword(` ${'x'.repeat(MAX_PASSWORD_LENGTH)} `)).toBe('x'.repeat(MAX_PASSWORD_LENGTH));
  });
});

describe('nameKey', () => {
  it('folds case, whitespace, invisible chars and unicode normalization', () => {
    expect(nameKey('  BoB ')).toBe('bob');
    expect(nameKey('B​o‮b')).toBe('bob');
    expect(nameKey('Café')).toBe(nameKey('Café'));
  });
  it('tolerates non-string input', () => {
    expect(nameKey(undefined as unknown as string)).toBe('');
    expect(nameKey(null as unknown as string)).toBe('');
  });
});

describe('sanitizeLang', () => {
  it('returns known languages and undefined otherwise', () => {
    expect(sanitizeLang('en')).toBe('en');
    expect(sanitizeLang('xx')).toBeUndefined();
    expect(sanitizeLang('EN')).toBeUndefined();
    expect(sanitizeLang(undefined)).toBeUndefined();
    expect(sanitizeLang(3)).toBeUndefined();
  });
});

describe('ROOM_SETTINGS parsing', () => {
  const p = (o: unknown) => parseClientMessage(JSON.stringify(o));
  it('accepts maxPlayers bounds 1..64 only', () => {
    expect(p({ t: 'ROOM_SETTINGS', maxPlayers: 1 })).toEqual({ t: 'ROOM_SETTINGS', maxPlayers: 1 });
    expect(p({ t: 'ROOM_SETTINGS', maxPlayers: 64 })).toEqual({ t: 'ROOM_SETTINGS', maxPlayers: 64 });
    expect(p({ t: 'ROOM_SETTINGS', maxPlayers: 65 })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', maxPlayers: -1 })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', maxPlayers: '4' })).toBeNull();
  });
  it('treats empty password like null and trims others', () => {
    expect(p({ t: 'ROOM_SETTINGS', password: '' })).toEqual({ t: 'ROOM_SETTINGS', password: null });
    expect(p({ t: 'ROOM_SETTINGS', password: ' pw ' })).toEqual({ t: 'ROOM_SETTINGS', password: 'pw' });
    expect(p({ t: 'ROOM_SETTINGS', password: '   ' })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', password: 7 })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', password: 'a\tb' })).toBeNull();
  });
  it('combines fields and still requires at least one', () => {
    expect(p({ t: 'ROOM_SETTINGS', locked: true, maxPlayers: 8, password: 'pw' })).toEqual({
      t: 'ROOM_SETTINGS', locked: true, maxPlayers: 8, password: 'pw',
    });
    expect(p({ t: 'ROOM_SETTINGS', unknown: 1 })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', teams: true })).toEqual({ t: 'ROOM_SETTINGS', teams: true });
    expect(p({ t: 'ROOM_SETTINGS', teams: 'yes' })).toBeNull();
  });

  it('parses SET_TEAM', () => {
    expect(p({ t: 'SET_TEAM', team: 1 })).toEqual({ t: 'SET_TEAM', team: 1 });
    expect(p({ t: 'SET_TEAM', team: 3, id: 'abc' })).toEqual({ t: 'SET_TEAM', team: 3, id: 'abc' });
    expect(p({ t: 'SET_TEAM', team: 4 })).toBeNull();
    expect(p({ t: 'SET_TEAM', team: -1 })).toBeNull();
    expect(p({ t: 'SET_TEAM', team: 0.5 })).toBeNull();
    expect(p({ t: 'SET_TEAM', team: 0, id: '' })).toBeNull();
  });
  it('rejects a mismatched protocol-free join sanity check', () => {
    expect(p({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'A', code: 'ABCD' })).not.toBeNull();
  });
});

describe('slugOf', () => {
  it('lowercases and collapses non-alphanumerics to single dashes', () => {
    expect(slugOf('Friday Night!!')).toBe('friday-night');
    expect(slugOf('  --A  B-- ')).toBe('a-b');
    expect(slugOf('***')).toBe('');
  });
  it('caps at 12 chars without a trailing dash', () => {
    expect(slugOf('abcdefghijk lmnop')).toBe('abcdefghijk');
    expect(slugOf('a'.repeat(30))).toBe('a'.repeat(12));
  });
});

describe('validatePlaylist', () => {
  it('accepts a valid playlist and derives the id from the name', () => {
    const r = validatePlaylist(pl({ name: 'Friday Mix' }));
    expect(r.errors).toEqual([]);
    expect(r.value).toMatchObject({ id: 'friday-mix', name: 'Friday Mix' });
    expect(r.value!.rounds).toHaveLength(1);
  });
  it('prefers explicit id, then idHint', () => {
    expect(validatePlaylist(pl({ id: 'mine' })).value!.id).toBe('mine');
    expect(validatePlaylist(pl(), 'hint').value!.id).toBe('hint');
  });
  it('rejects non-mappings', () => {
    for (const bad of [null, 'x', 3, [pl()]]) {
      const r = validatePlaylist(bad);
      expect(r.value).toBeNull();
      expect(r.errors).toEqual(['a playlist must be a mapping with name and rounds']);
    }
  });
  it('requires a name', () => {
    const r = validatePlaylist(pl({ name: '  ', id: 'abc' }));
    expect(r.value).toBeNull();
    expect(r.errors).toContain('abc: name is required');
  });
  it('rejects bad ids', () => {
    const r = validatePlaylist(pl({ id: 'has space' }));
    expect(r.value).toBeNull();
    expect(r.errors[0]).toContain('id must be 1-12 letters, digits');
    expect(validatePlaylist(pl({ id: 'a'.repeat(13) })).value).toBeNull();
    expect(validatePlaylist(pl({ id: 5 })).value).toBeNull();
    // a name that slugs to nothing has no usable id
    expect(validatePlaylist(pl({ name: '***' })).value).toBeNull();
  });
  it('enforces MAX_PLAYLIST bounds', () => {
    const rounds = (n: number) => Array.from({ length: n }, () => round('crazy-logs'));
    expect(validatePlaylist(pl({ rounds: rounds(1) })).value).not.toBeNull();
    expect(validatePlaylist(pl({ rounds: rounds(MAX_PLAYLIST) })).value!.rounds).toHaveLength(MAX_PLAYLIST);
    for (const bad of [rounds(0), rounds(MAX_PLAYLIST + 1), 'x', undefined]) {
      const r = validatePlaylist(pl({ rounds: bad }));
      expect(r.value).toBeNull();
      expect(r.errors).toEqual([`Mix: rounds must be a list of 1 to ${MAX_PLAYLIST} rounds`]);
    }
  });
  it('names the invalid round', () => {
    const r = validatePlaylist(pl({ rounds: [round('crazy-logs'), round('nope')] }));
    expect(r.value).toBeNull();
    expect(r.errors).toEqual(['Mix: round 2 is not a valid game, variant and options']);
  });
  it('reports out-of-range options instead of clamping', () => {
    const r = validatePlaylist(pl({ rounds: [round('spring-showdown', 'spring-painter', { gridSize: 999 })] }));
    expect(r.value).toBeNull();
    expect(r.errors).toEqual(['Mix: round 1: option "gridSize" must be within its allowed values (got 999)']);
    const ok = validatePlaylist(pl({ rounds: [round('spring-showdown', 'spring-painter', { gridSize: 10 })] }));
    expect(ok.errors).toEqual([]);
    expect(ok.value!.rounds[0]!.options).toEqual({ gridSize: 10 });
  });
});

describe('validatePlaylists', () => {
  it('treats null/undefined as empty and non-arrays as an error', () => {
    expect(validatePlaylists(undefined)).toEqual({ value: [], errors: [] });
    expect(validatePlaylists(null)).toEqual({ value: [], errors: [] });
    expect(validatePlaylists({})).toEqual({ value: [], errors: ['playlists must be a list'] });
  });
  it('reports duplicate ids and keeps the first', () => {
    const r = validatePlaylists([pl({ id: 'a', name: 'One' }), pl({ id: 'a', name: 'Two' })]);
    expect(r.value.map((v) => v.name)).toEqual(['One']);
    expect(r.errors).toEqual(['Two: duplicate playlist id "a"']);
  });
  it('keeps valid playlists next to invalid ones', () => {
    const r = validatePlaylists([pl({ id: 'a' }), { name: 'Bad', id: 'b', rounds: [] }, pl({ id: 'c' })]);
    expect(r.value.map((v) => v.id)).toEqual(['a', 'c']);
    expect(r.errors).toHaveLength(1);
  });
  it('caps at MAX_OPERATOR_PLAYLISTS', () => {
    const many = Array.from({ length: MAX_OPERATOR_PLAYLISTS + 1 }, (_, i) => pl({ id: `p${i}`, name: `P${i}` }));
    const r = validatePlaylists(many);
    expect(r.value).toHaveLength(MAX_OPERATOR_PLAYLISTS);
    expect(r.errors).toEqual([`at most ${MAX_OPERATOR_PLAYLISTS} playlists are allowed`]);
  });
});

describe('EMOTE parsing', () => {
  it('accepts a known emote index only', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'EMOTE', emote: 0 }))).toEqual({ t: 'EMOTE', emote: 0 });
    for (const bad of [-1, 99, 1.5, '1']) expect(parseClientMessage(JSON.stringify({ t: 'EMOTE', emote: bad }))).toBeNull();
  });
});

describe('REPORT parsing', () => {
  it('needs a player id', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'REPORT', id: 'abc123' }))).toEqual({ t: 'REPORT', id: 'abc123' });
    expect(parseClientMessage(JSON.stringify({ t: 'REPORT', id: '' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'REPORT' }))).toBeNull();
  });
});
