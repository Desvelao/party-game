import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGames } from './loader';
import { SOURCE_GAMES_ROOT, SOURCE_PLUGINS_ROOT, scanSourceGames, scanSourcePlugins, sourceServerEntry } from './sourcePacks';

const dirs = (root: string): string[] => readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

describe('source packs (dev mode)', () => {
  it('finds every game under src/games with a valid manifest', () => {
    const { games, skipped } = scanSourceGames();
    expect(skipped).toEqual([]);
    expect(games.map((g) => g.manifest.id).sort()).toEqual(dirs(SOURCE_GAMES_ROOT).sort());
    expect(games.every((g) => 'client.mjs' in g.manifest.files && /^[0-9a-f]{64}$/.test(g.digest))).toBe(true);
  });

  it('finds every plugin under src/plugins with a valid manifest', () => {
    const { plugins, skipped } = scanSourcePlugins();
    expect(skipped).toEqual([]);
    expect(plugins.map((p) => p.manifest.id).sort()).toEqual(dirs(SOURCE_PLUGINS_ROOT).sort());
  });

  it('skips a folder whose manifest is broken', () => {
    const root = mkdtempSync(join(tmpdir(), 'src-games-'));
    try {
      mkdirSync(join(root, 'bad'));
      writeFileSync(join(root, 'bad', 'game.json'), '{ nope');
      const { games, skipped } = scanSourceGames(root);
      expect(games).toEqual([]);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]!.reason).toContain('not valid JSON');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('imports the server code of every game from source', async () => {
    // the test setup has already registered the source games, so each one is reported as "already registered":
    // that error comes after the import, which means the entry resolved and exports a game
    const logs: string[] = [];
    const registry = await loadGames({ bundled: null, installed: null }, (m) => logs.push(m), { scan: scanSourceGames, entry: sourceServerEntry });
    expect(registry.games).toEqual([]);
    expect(logs).toHaveLength(scanSourceGames().games.length);
    expect(logs.every((l) => l.includes('is already registered'))).toBe(true);
  });
});
