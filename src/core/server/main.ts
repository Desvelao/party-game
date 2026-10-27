import { resolve } from 'node:path';
import { loadConfig } from './config';
import { ConfigError, USAGE, loadConfigFile, loadGamesSection, loadPluginsSection, parseArgs, resolveConfigPath } from './configFile';
import { startServer } from './networking/server';
import { installedPluginsDir, loadPlugins } from './plugins/features';
import { scanSourceGames, scanSourcePlugins, sourceServerEntry } from './plugins/sourcePacks';
import { installedGamesDir, loadGames } from './plugins/loader';
import { createProfileRepository } from './profiles';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const resolved = resolveConfigPath(args);
  const overrides = resolved ? loadConfigFile(resolved.path) : {};
  console.log(
    resolved ? `[party-game] config: ${resolved.path} (${resolved.source})` : '[party-game] config: environment only',
  );
  const cfg = loadConfig(overrides);

  // game packs register into the catalog, so they load before anything validates game ids
  // DEV_SOURCE=1 (npm run dev:server): the games and plugins under src/ run from their source, nothing is built
  const fromSource = process.env.DEV_SOURCE === '1';
  if (fromSource) console.log('[party-game] dev source mode: games and plugins load from src/');
  const registry = await loadGames(
    { bundled: cfg.bundledGamesDir ? resolve(cfg.bundledGamesDir) : null, installed: installedGamesDir(cfg) },
    console.log,
    fromSource ? { scan: scanSourceGames, entry: sourceServerEntry } : {},
  );
  if (registry.games.length === 0) console.warn('[party-game] no games installed: players can join, but no match can start (see `npm run games -- list`)');
  const games = resolved ? loadGamesSection(resolved.path) : { defaults: {}, playlists: [] };

  // plugins come after the games (they may use the games' AIs) and start once the rooms exist
  const pluginSettings = resolved ? loadPluginsSection(resolved.path).settings : {};
  const plugins = await loadPlugins(
    { bundled: cfg.bundledPluginsDir ? resolve(cfg.bundledPluginsDir) : null, installed: installedPluginsDir(cfg) },
    { enabled: cfg.pluginsEnabled, settings: pluginSettings, ...(fromSource ? { scan: scanSourcePlugins, entry: sourceServerEntry } : {}) },
  );
  // a game drawn with a character model that no game or plugin provides cannot be played
  if (registry.pruneMissingCharacters().length > 0 && registry.games.length === 0) console.warn('[party-game] no playable games left: install the plugins or games that provide their character models');

  // open the profile store before serving, so a bad path / driver fails here with one clear line
  const profiles = createProfileRepository(cfg);
  try {
    await profiles.init?.();
  } catch (err) {
    throw new ConfigError((err as Error).message);
  }
  console.log(`[party-game] profile store: ${cfg.profileStore}`);
  startServer(cfg, { profiles, gameDefaults: games.defaults, playlists: games.playlists, games: registry, plugins });
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`[party-game] ${err.message}`);
    process.exit(err.exitCode);
  }
  console.error(err);
  process.exit(1);
});
