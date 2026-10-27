import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTROLS, defaultControls } from '../../shared';
import { applyPatch, applyResult, newRecord, profileIdOf, reviveRecord } from './profile';

describe('profile logic', () => {
  it('hashes keys without leaking them', () => {
    const id = profileIdOf('a'.repeat(32));
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toContain('a'.repeat(32));
    expect(profileIdOf('a'.repeat(32))).toBe(id);
  });

  it('sanitizes new records and patches', () => {
    const r = newRecord(1000, { name: '  <b>Zed</b> ', color: 99, looks: { blob: { hat: 77 } } as any, avatar: 'Not An Id' });
    expect(r.name).toBe('bZed/b');
    expect(r.color).toBe(0);
    expect(r.looks).toEqual({});
    expect(r.avatar).toBeUndefined();
    const p = applyPatch(r, { color: 5 }, 2000);
    expect(p.color).toBe(5);
    expect(p.name).toBe(r.name);
    expect(p.lastSeen).toBe(2000);
  });

  it('merges looks per model and sets or clears the avatar', () => {
    const r = newRecord(0, { looks: { blob: { hat: 1 }, robot: { head: 2 } }, avatar: 'blob' });
    expect(r.avatar).toBe('blob');
    const p = applyPatch(r, { looks: { robot: { head: 0 } }, avatar: 'robot' }, 1);
    expect(p.looks).toEqual({ blob: { hat: 1 }, robot: { head: 0 } });
    expect(p.avatar).toBe('robot');
    expect(applyPatch(p, { avatar: '' }, 2).avatar).toBeUndefined();
    expect(applyPatch(p, { name: 'x' }, 2).avatar).toBe('robot');
  });

  it('reads an old record with one flat look as the legacy model', () => {
    const rec = reviveRecord({ name: 'Old', look: { body: 1, hat: 2 } }, 0)!;
    expect(rec.looks).toEqual({ blob: { body: 1, hat: 2 } });
  });

  it('keeps only supported languages', () => {
    expect(newRecord(0, { lang: 'xx' as any }).lang).toBeUndefined();
    const r = newRecord(0, { lang: 'es' });
    expect(r.lang).toBe('es');
    expect(applyPatch(r, { name: 'B' }, 1).lang).toBe('es');
    expect(applyPatch(r, { lang: 'en' }, 1).lang).toBe('en');
    expect(applyPatch(r, { lang: 5 as any }, 1).lang).toBe('es');
    expect(reviveRecord({ name: 'x' }, 1)!.lang).toBeUndefined();
    expect(reviveRecord({ name: 'x', lang: 'es' }, 1)!.lang).toBe('es');
  });

  it('keeps presets sanitized, and a patch without them keeps the stored ones', () => {
    const presets = {
      variants: [{ id: 'v1', name: 'Fast', game: 'spring-showdown', variant: 'spring-painter', options: { hopTime: 0.2 } }],
      playlists: [],
    };
    const r = newRecord(0, { presets });
    expect(r.presets!.variants).toHaveLength(1);
    expect(applyPatch(r, { name: 'B' }, 1).presets!.variants).toHaveLength(1);
    expect(applyPatch(r, { presets: { variants: [{ id: 'x', name: 'bad', game: 'zz' }], playlists: [] } as any }, 1).presets!.variants).toEqual([]);
    expect(reviveRecord({ name: 'x', presets }, 1)!.presets!.variants).toHaveLength(1);
    expect(reviveRecord({ name: 'x' }, 1)!.presets).toBeUndefined();
  });

  it('accumulates game and match results', () => {
    let r = newRecord(0, { name: 'A' });
    r = applyResult(r, { name: 'A', game: { id: 'arena', place: 1, points: 10 } }, 5);
    r = applyResult(r, { name: 'A', game: { id: 'arena', place: 3, points: 5 } }, 6);
    r = applyResult(r, { name: 'A', game: { id: 'pogo', place: 2, points: 7 } }, 7);
    r = applyResult(r, { name: 'A', match: { score: 22, won: true } }, 8);
    r = applyResult(r, { name: 'A', match: { score: 10, won: false } }, 9);
    expect(r.stats).toMatchObject({ matches: 2, wins: 1, points: 22, gamesPlayed: 3, bestMatchScore: 22, lastPlayed: 9 });
    expect(r.stats.games.arena).toEqual({ played: 2, wins: 1, points: 15 });
    expect(r.stats.games.pogo).toEqual({ played: 1, wins: 0, points: 7 });
  });

  it('keeps the last matches, newest first, up to the configured cap', () => {
    const sum = (ts: number) => ({ ts, players: 2, place: 1, score: ts, won: true, mvp: false, rounds: [{ game: 'arena', place: 1, points: 3 }] });
    let r = newRecord(0, { name: 'A' });
    for (let i = 1; i <= 4; i++) r = applyResult(r, { name: 'A', match: { score: i, won: true, summary: sum(i) }, keepRecent: 3 }, i);
    expect(r.recent!.map((m) => m.ts)).toEqual([4, 3, 2]);
    r = applyResult(r, { name: 'A', match: { score: 5, won: true, summary: sum(5) }, keepRecent: 0 }, 5);
    expect(r.recent).toBeUndefined();
    expect(applyResult(newRecord(0), { name: 'A', match: { score: 1, won: false, summary: sum(1) } }, 1).recent).toHaveLength(1);
  });

  it('revives stored recent matches defensively', () => {
    const r = reviveRecord({ recent: [{ ts: 5, players: 3, place: 2, score: 9, won: 'yes', rounds: [{ game: 'g', place: 1, points: 3 }, { nope: 1 }] }, 7, null] }, 1)!;
    expect(r.recent).toEqual([{ ts: 5, players: 3, place: 2, score: 9, won: false, mvp: false, rounds: [{ game: 'g', place: 1, points: 3 }] }]);
    expect(reviveRecord({ recent: 'x' }, 1)!.recent).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const r = newRecord(0);
    const before = JSON.stringify(r);
    applyResult(r, { name: 'x', game: { id: 'g', place: 1, points: 1 } }, 1);
    expect(JSON.stringify(r)).toBe(before);
  });

  it('revives stored garbage defensively', () => {
    expect(reviveRecord(null, 1)).toBeNull();
    const r = reviveRecord({ name: 5, color: 'x', stats: { matches: -4, wins: 'a', games: { g: { played: 2 } } } }, 1)!;
    expect(r.name).toBe('Player');
    expect(r.stats.matches).toBe(0);
    expect(r.stats.games.g).toEqual({ played: 2, wins: 0, points: 0 });
  });

  it('stores rebound controls sanitized, drops the defaults and keeps them across other patches', () => {
    const custom = { ...defaultControls(), action: ['KeyF', 'ControlLeft'], action2: ['KeyG'] };
    const r = newRecord(0, { controls: custom });
    expect(r.controls).toMatchObject({ action: ['KeyF'], action2: ['KeyG'] }); // Ctrl is not bindable
    expect(applyPatch(r, { name: 'B' }, 1).controls).toEqual(r.controls);
    expect(applyPatch(r, { controls: { action: ['KeyH'] } as any }, 1).controls!.action).toEqual(['KeyH']);
    // resetting to the defaults removes the stored copy
    expect(applyPatch(r, { controls: DEFAULT_CONTROLS }, 1).controls).toBeUndefined();
    expect(newRecord(0, { controls: DEFAULT_CONTROLS }).controls).toBeUndefined();
    // junk never gets in, and a hand-edited record is repaired on load
    expect(newRecord(0, { controls: 5 as any }).controls).toBeUndefined();
    expect(reviveRecord({ name: 'x', controls: { up: ['Tab'], action: ['KeyF'] } }, 1)!.controls!.action).toEqual(['KeyF']);
    expect(reviveRecord({ name: 'x' }, 1)!.controls).toBeUndefined();
  });
});

describe('profile emote keys', () => {
  const custom = { toggle: 'KeyG', emotes: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN'] };

  it('stores only non-default keys, sanitized, and resetting removes them', () => {
    const r = newRecord(1, {});
    expect(r.emoteKeys).toBeUndefined();
    const set = applyPatch(r, { emoteKeys: { ...custom, toggle: 'Escape' } }, 2);
    expect(set.emoteKeys!.toggle).toBe('KeyT');
    expect(set.emoteKeys!.emotes[0]).toBe('KeyZ');
    expect(applyPatch(set, { name: 'B' }, 3).emoteKeys).toEqual(set.emoteKeys);
    expect(applyPatch(set, { emoteKeys: {} as any }, 3).emoteKeys).toBeUndefined();
  });

  it('survives revive', () => {
    const r = applyPatch(newRecord(1, {}), { emoteKeys: custom }, 2);
    expect(reviveRecord(JSON.parse(JSON.stringify(r)), 5)!.emoteKeys).toEqual(custom);
  });
});

describe('profile accessibility prefs', () => {
  it('stores only non-default options and resetting removes them', () => {
    const r = newRecord(1, {});
    expect(r.access).toBeUndefined();
    const set = applyPatch(r, { access: { colorblind: true, markers: false, motion: 'auto' } }, 2);
    expect(set.access).toEqual({ colorblind: true, markers: false, motion: 'auto' });
    expect(applyPatch(set, { name: 'B' }, 3).access).toEqual(set.access);
    expect(applyPatch(set, { access: { colorblind: false, markers: false, motion: 'auto' } }, 3).access).toBeUndefined();
    expect(reviveRecord(JSON.parse(JSON.stringify(set)), 5)!.access).toEqual(set.access);
  });
});

describe('profile audio prefs', () => {
  it('stores only non-default volumes and resetting removes them', () => {
    const r = newRecord(1, {});
    expect(r.audio).toBeUndefined();
    const set = applyPatch(r, { audio: { master: 70, sfx: 100, music: 10 } }, 2);
    expect(set.audio).toEqual({ master: 70, sfx: 100, music: 10 });
    expect(applyPatch(set, { name: 'B' }, 3).audio).toEqual(set.audio);
    expect(applyPatch(set, { audio: { master: 100, sfx: 100, music: 100 } }, 3).audio).toBeUndefined();
    expect(reviveRecord(JSON.parse(JSON.stringify(set)), 5)!.audio).toEqual(set.audio);
  });
});

describe('profile shadow ban', () => {
  it('is set and cleared by a patch and survives revive', () => {
    const r = newRecord(1, {});
    expect(r.shadowBanned).toBeUndefined();
    const hidden = applyPatch(r, { shadowBanned: true }, 2);
    expect(hidden.shadowBanned).toBe(true);
    expect(applyPatch(hidden, { name: 'B' }, 3).shadowBanned).toBe(true);
    expect(reviveRecord(JSON.parse(JSON.stringify(hidden)), 5)!.shadowBanned).toBe(true);
    expect(applyPatch(hidden, { shadowBanned: false }, 3).shadowBanned).toBeUndefined();
  });
});
