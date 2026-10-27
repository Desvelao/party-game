import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_PLAYABLES, ALL_VARIANTS, CATALOG, characterModel, normalizeSelection, optionsFor, tr, setLang, unregisterCharacterModels, unregisterGames } from '../../shared';
import { fixturePack } from '../../test-fixtures/pack';
import { createMinigame, REGISTERED_IDS, unregisterMinigames } from '../minigames';
import { GameRegistry, loadGames, scanGames } from './loader';
import { writePackDir } from './pack';

let root: string;
let bundled: string;
let installed: string;
const logs: string[] = [];
const log = (m: string) => logs.push(m);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pgload-'));
  bundled = join(root, 'bundled');
  installed = join(root, 'installed');
  mkdirSync(bundled);
  mkdirSync(installed);
  logs.length = 0;
});
afterEach(() => {
  unregisterCharacterModels({ kind: 'game', id: 'fixture-game' });
  unregisterGames(['fixture-game']);
  unregisterMinigames(['fixture-game']);
  setLang('en');
  rmSync(root, { recursive: true, force: true });
});

const put = (dir: string, version = '1.0.0', name = 'fixture-game') => writePackDir(fixturePack({ version }), join(dir, name));

describe('scanGames', () => {
  it('is empty for missing or empty directories', () => {
    expect(scanGames({ bundled: join(root, 'nope'), installed: null }).games).toEqual([]);
    expect(scanGames({ bundled, installed }).games).toEqual([]);
  });

  it('prefers the higher version, and the installed copy on a tie', () => {
    put(bundled, '1.0.0');
    put(installed, '1.2.0');
    expect(scanGames({ bundled, installed }).games[0]).toMatchObject({ source: 'installed' });
    rmSync(join(installed, 'fixture-game'), { recursive: true });
    put(installed, '1.0.0');
    expect(scanGames({ bundled, installed }).games[0]).toMatchObject({ source: 'installed' });
    rmSync(join(installed, 'fixture-game'), { recursive: true });
    put(installed, '0.9.0');
    expect(scanGames({ bundled, installed }).games[0]).toMatchObject({ source: 'bundled' });
  });

  it('skips broken packs with a reason and keeps the rest', () => {
    put(bundled);
    mkdirSync(join(installed, 'broken'));
    writeFileSync(join(installed, 'broken', 'game.json'), '{');
    put(installed, '1.0.0', 'wrong-dir-name');
    mkdirSync(join(installed, '.tmp-install'));
    const r = scanGames({ bundled, installed });
    expect(r.games.map((g) => g.manifest.id)).toEqual(['fixture-game']);
    expect(r.skipped.map((s) => s.dir.split('/').pop()).sort()).toEqual(['broken', 'wrong-dir-name']);
  });
});

describe('loadGames', () => {
  const ROBOT = { id: 'robot', name: 'Robot', slots: [{ id: 'head', label: 'Head', options: [{ label: 'Round' }, { label: 'Square' }], default: 0 }] };

  it('registers the character models a pack provides and keeps a game whose model is there', async () => {
    writePackDir(fixturePack({ characters: [ROBOT], character: 'robot' }), join(installed, 'fixture-game'));
    const reg = await loadGames({ bundled, installed }, log);
    expect(characterModel('robot')?.owner).toEqual({ kind: 'game', id: 'fixture-game' });
    expect(reg.pruneMissingCharacters(log)).toEqual([]);
    expect(reg.index().games[0]).toMatchObject({ character: 'robot', characters: [ROBOT] });
  });

  it('drops a game whose character model nobody provides, as if it had not loaded', async () => {
    writePackDir(fixturePack({ character: 'ghost' }), join(installed, 'fixture-game'));
    const reg = await loadGames({ bundled, installed }, log);
    expect(reg.games).toHaveLength(1);
    expect(reg.pruneMissingCharacters(log)).toEqual([{ id: 'fixture-game', reason: expect.stringContaining('"ghost"') }]);
    expect(reg.games).toEqual([]);
    expect(CATALOG.some((g) => g.id === 'fixture-game')).toBe(false);
    expect(REGISTERED_IDS).not.toContain('fixture-game');
    expect(logs.join('\n')).toMatch(/skipped game fixture-game: needs character model "ghost"/);
  });

  it('registers catalog, options, translations and a working minigame', async () => {
    put(installed);
    const reg = await loadGames({ bundled, installed }, log);
    expect(reg.games.map((g) => g.manifest.id)).toEqual(['fixture-game']);
    expect(CATALOG.some((g) => g.id === 'fixture-game')).toBe(true);
    expect(ALL_PLAYABLES.some((p) => p.id === 'fixture-game')).toBe(true);
    expect(REGISTERED_IDS).toContain('fixture-game');
    expect(optionsFor('fixture-game', '').some((o) => o.id === 'limit')).toBe(true);
    setLang('es');
    expect(tr('Press the button faster than the others.')).toBe('Pulsa el botón más rápido que los demás.');

    const mg = createMinigame({ game: 'fixture-game', variant: ALL_VARIANTS }, 0);
    mg.init([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    mg.handleInput('b', { mx: 0, my: 0, a1: true, a2: false });
    mg.update(5);
    expect(mg.isFinished()).toBe(true);
    expect(mg.getPlacements()).toEqual([{ id: 'b', place: 1 }, { id: 'a', place: 2 }]);
    expect(reg.index().games[0]).toMatchObject({ id: 'fixture-game', version: '1.0.0' });
  });

  it('skips a pack whose server module is not a plugin, without registering anything', async () => {
    writePackDir(fixturePack({}, 'export default { nope: 1 };'), join(installed, 'fixture-game'));
    const reg = await loadGames({ bundled, installed }, log);
    expect(reg.games).toEqual([]);
    expect(CATALOG.some((g) => g.id === 'fixture-game')).toBe(false);
    expect(logs.join('\n')).toMatch(/createMinigame/);
  });

  it('refuses a pack that clashes with an already registered game', async () => {
    put(installed);
    await loadGames({ bundled: null, installed }, log);
    const again = await loadGames({ bundled: null, installed }, log);
    expect(again.games).toEqual([]);
    expect(logs.join('\n')).toMatch(/already registered/);
  });

  it('a selection of a game that is no longer installed is refused, and a running room still falls back', async () => {
    put(installed);
    await loadGames({ bundled, installed }, log);
    const sel = normalizeSelection('fixture-game', ALL_VARIANTS, {});
    expect(sel?.game).toBe('fixture-game');
    unregisterGames(['fixture-game']);
    unregisterMinigames(['fixture-game']);
    // new selections of it are refused; a room that already holds one plays what is installed instead
    expect(normalizeSelection('fixture-game', ALL_VARIANTS, {})).toBeNull();
    const mg = createMinigame({ game: 'fixture-game', variant: ALL_VARIANTS }, 0);
    expect(mg.id).not.toBe('fixture-game');
  });

  it('works with no games at all', async () => {
    const reg = await loadGames({ bundled: null, installed: null }, log);
    expect(reg).toBeInstanceOf(GameRegistry);
    expect(reg.index()).toEqual({ games: [] });
  });
});
