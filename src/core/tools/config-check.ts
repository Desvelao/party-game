/**
 * Validate the configuration without starting the server: loads the same file, environment and
 * hardware-profile layers as the server, prints each effective value with where it came from and
 * exits non-zero on any error.
 *
 *   npm run config:check -- [-c config.yaml]     (built: node dist/config-check.js [-c config.yaml])
 */
import { SETTINGS, loadConfig } from '../server/config';
import { ConfigError, USAGE, loadConfigFile, loadGamesSection, loadPluginsSection, parseArgs, resolveConfigPath } from '../server/configFile';
import { tlsFiles } from '../server/networking/tls';
import { installedPluginsDir, loadPlugins } from '../server/plugins/features';
import { installedGamesDir, loadGames } from '../server/plugins/loader';
import { resolve } from 'node:path';

const SECRETS = new Set<string>(['adminToken']);

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE.replace('node dist/server.js', 'node dist/config-check.js'));
    return 0;
  }
  const resolved = resolveConfigPath(args);
  const overrides = resolved ? loadConfigFile(resolved.path) : {};
  const warnings: string[] = [];
  const cfg = loadConfig(overrides, (m) => warnings.push(m));
  try {
    tlsFiles(cfg);
  } catch (err) {
    throw new ConfigError((err as Error).message);
  }
  // installed games register into the catalog, which the games section is checked against
  const registry = await loadGames({ bundled: cfg.bundledGamesDir ? resolve(cfg.bundledGamesDir) : null, installed: installedGamesDir(cfg) }, (m) => warnings.push(m));
  const games = resolved ? loadGamesSection(resolved.path) : { defaults: {}, playlists: [] };
  // plugins are imported and their settings checked (nothing is started)
  const plugins = await loadPlugins({ bundled: cfg.bundledPluginsDir ? resolve(cfg.bundledPluginsDir) : null, installed: installedPluginsDir(cfg) }, { enabled: cfg.pluginsEnabled, settings: resolved ? loadPluginsSection(resolved.path).settings : {} }, (m) => warnings.push(m));

  console.log(resolved ? `config file: ${resolved.path} (${resolved.source})` : 'config file: none (environment and profile defaults only)');
  console.log('');
  for (const def of SETTINGS) {
    const source = overrides[def.field] !== undefined ? 'file' : process.env[def.env] ? 'env' : 'default';
    const raw = cfg[def.field];
    const value = SECRETS.has(def.field) ? (raw ? '(set)' : '(unset)') : JSON.stringify(raw);
    console.log(`${def.path.join('.').padEnd(34)} ${value.padEnd(24)} ${source}`);
  }
  const defaults = Object.keys(games.defaults).length;
  console.log('');
  console.log(`games installed: ${registry.games.length}${registry.games.length ? ` (${registry.games.map((g) => g.manifest.id).join(', ')})` : ''}`);
  console.log(`plugins loaded: ${plugins.plugins.length}${plugins.plugins.length ? ` (${plugins.plugins.map((p) => p.manifest.id).join(', ')})` : ''}`);
  console.log(`games.defaults: ${defaults} game/variant override(s); games.playlists: ${games.playlists.length}`);
  for (const w of warnings) console.warn(`warning: ${w}`);
  console.log(warnings.length ? `OK with ${warnings.length} warning(s)` : 'OK');
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`config error: ${err.message}`);
    process.exitCode = err.exitCode;
  },
);
