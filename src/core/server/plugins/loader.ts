/**
 * Boot-time discovery of installed game packs. Two directories are scanned (games baked into the
 * build, and games the operator installed); when an id appears in both the higher version wins and
 * a tie goes to the operator's copy. A pack that fails verification or loading is logged and
 * skipped: it must never stop the server.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  characterModel,
  compareVersions,
  playablesOf,
  registerCharacterModels,
  registerGames,
  registerTranslations,
  unregisterCharacterModels,
  unregisterGames,
  type GameManifest,
  type ServerGamePlugin,
} from '../../shared';
import { registerAi, registerMinigame, unregisterAi, unregisterMinigames } from '../minigames';
import { PackError, loadPack } from './pack';

/** Picker order: the manifest's `order`, then the id. */
export const byOrder = (a: InstalledGame, b: InstalledGame): number => (a.manifest.order ?? 1000) - (b.manifest.order ?? 1000) || a.manifest.id.localeCompare(b.manifest.id);

export type GameSource = 'bundled' | 'installed';

export interface InstalledGame {
  manifest: GameManifest;
  source: GameSource;
  dir: string;
  /** identifies this exact pack; clients use it to bust their cache */
  digest: string;
}

export interface GameDirs {
  bundled: string | null;
  installed: string | null;
}

/** Where the operator's games live: `games.dir`, else `games` inside the data directory. */
export function installedGamesDir(cfg: { gamesDir: string; dataDir: string }): string {
  return resolve(cfg.gamesDir || join(cfg.dataDir, 'games'));
}

export interface ScanResult {
  games: InstalledGame[];
  /** packs that were found but could not be used, with the reason */
  skipped: { dir: string; reason: string }[];
}

/** Verify every pack in the directories and pick one per id. Does not run any pack code. */
export function scanGames(dirs: GameDirs): ScanResult {
  const found = new Map<string, InstalledGame>();
  const skipped: ScanResult['skipped'] = [];
  const scan = (root: string | null, source: GameSource) => {
    if (!root || !existsSync(root)) return;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dir = join(root, entry.name);
      try {
        const { manifest, digest } = loadPack(dir);
        if (manifest.id !== entry.name) throw new PackError(`directory "${entry.name}" does not match the game id "${manifest.id}"`);
        const game: InstalledGame = { manifest, source, dir, digest };
        const prev = found.get(manifest.id);
        // scanning bundled first, so `>= 0` lets the operator's copy win ties
        if (!prev || compareVersions(manifest.version, prev.manifest.version) >= 0) found.set(manifest.id, game);
      } catch (err) {
        skipped.push({ dir, reason: (err as Error).message });
      }
    }
  };
  scan(dirs.bundled, 'bundled');
  scan(dirs.installed, 'installed');
  return { games: [...found.values()].sort(byOrder), skipped };
}

/** Games that are loaded and served. */
export class GameRegistry {
  constructor(readonly games: InstalledGame[]) {}

  /**
   * Drop the games whose `character` no loaded game or plugin provides (call it once the plugins are loaded): they
   * leave the catalog, the minigames and the AIs, as if they had failed to load. Returns them with the reason.
   */
  pruneMissingCharacters(log: (msg: string) => void = console.log): { id: string; reason: string }[] {
    const out: { id: string; reason: string }[] = [];
    for (const g of [...this.games]) {
      const need = g.manifest.character;
      if (!need || characterModel(need)) continue;
      const reason = `needs character model "${need}", which no installed game or plugin provides`;
      unloadGame(g.manifest);
      this.games.splice(this.games.indexOf(g), 1);
      out.push({ id: g.manifest.id, reason });
      log(`[party-game] skipped game ${g.manifest.id}: ${reason}`);
    }
    return out;
  }

  get(id: string): InstalledGame | undefined {
    return this.games.find((g) => g.manifest.id === id);
  }

  /** Body of `/games/index.json`: what a client needs to show the games and fetch their code. */
  index(): {
    games: { id: string; version: string; digest: string; catalog: GameManifest['catalog']; locales?: GameManifest['locales']; character?: string; characters?: GameManifest['characters'] }[];
  } {
    return {
      games: this.games.map((g) => ({
        id: g.manifest.id,
        version: g.manifest.version,
        digest: g.digest,
        catalog: g.manifest.catalog,
        locales: g.manifest.locales,
        character: g.manifest.character,
        characters: g.manifest.characters,
      })),
    };
  }
}

/** Undo the registrations of a loaded game. */
function unloadGame(manifest: GameManifest): void {
  unregisterMinigames(playablesOf(manifest.catalog).map((p) => p.id));
  unregisterAi(manifest.id);
  unregisterGames([manifest.id]);
  unregisterCharacterModels({ kind: 'game', id: manifest.id });
}

const isPlugin = (v: unknown): v is ServerGamePlugin => typeof v === 'object' && v !== null && typeof (v as ServerGamePlugin).createMinigame === 'function';

/** Dev source mode (`DEV_SOURCE=1`): where the packs come from and which file holds their server code. */
export interface GameSourceOptions {
  scan?: () => ScanResult;
  entry?: (dir: string) => string;
}

/**
 * Scan, import and register every usable pack. Registers into the shared catalog and the minigame
 * registry, so call it once at boot before the catalog state, config games section or server start.
 */
export async function loadGames(dirs: GameDirs, log: (msg: string) => void = console.log, source: GameSourceOptions = {}): Promise<GameRegistry> {
  const { games, skipped } = source.scan ? source.scan() : scanGames(dirs);
  for (const s of skipped) log(`[party-game] skipped game pack ${s.dir}: ${s.reason.split('\n')[0]}`);
  const loaded: InstalledGame[] = [];
  for (const game of games) {
    const { manifest } = game;
    const ids = playablesOf(manifest.catalog).map((p) => p.id);
    try {
      const mod = (await import(pathToFileURL(source.entry ? source.entry(game.dir) : join(game.dir, 'server.mjs')).href)) as { default?: unknown };
      if (!isPlugin(mod.default)) throw new PackError('server.mjs must export default { createMinigame }');
      const plugin = mod.default;
      registerGames([manifest.catalog]);
      try {
        for (const id of ids) {
          registerMinigame(id, (options) => plugin.createMinigame(id, options), {
            seeded: (options, rng) => plugin.createMinigame(id, options, rng),
            bot: plugin.bot?.bind(plugin),
          });
        }
      } catch (err) {
        unloadGame(manifest);
        throw err;
      }
      registerTranslations(manifest.locales);
      for (const id of registerCharacterModels({ kind: 'game', id: manifest.id }, manifest.characters)) log(`[party-game] game ${manifest.id}: character model "${id}" is already provided by another game or plugin; ignoring this one`);
      if (plugin.ai) registerAi(plugin.ai);
      loaded.push(game);
      log(`[party-game] game: ${manifest.name} ${manifest.version} (${game.source})`);
    } catch (err) {
      log(`[party-game] skipped game ${manifest.id}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  return new GameRegistry(loaded);
}
