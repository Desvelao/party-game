/**
 * Dev source mode (`DEV_SOURCE=1`): the games under `src/games/` and the plugins under `src/plugins/` are loaded
 * straight from their source folders (tsx runs the TypeScript), with no build step. The browser gets the client code
 * from Vite (`src/core/client/vite.config.ts`). Production always loads built packs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_API_VERSION, PLUGIN_API_VERSION, validateManifest, validatePluginManifest } from '../../shared';
import { byOrder, type InstalledGame, type ScanResult } from './loader';
import { PackError } from './pack';
import type { InstalledPlugin, PluginScan } from './features';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const SOURCE_GAMES_ROOT = join(SRC, 'games');
export const SOURCE_PLUGINS_ROOT = join(SRC, 'plugins');

const EXTS = ['ts', 'js', 'mjs'];
/** `<dir>/<side>/index.(ts|js|mjs)`, or undefined. */
export const sourceEntryOf = (dir: string, side: 'server' | 'client'): string | undefined => EXTS.map((e) => join(dir, side, `index.${e}`)).find(existsSync);

/** The file `import()` loads for the server code of a source pack. */
export function sourceServerEntry(dir: string): string {
  const entry = sourceEntryOf(dir, 'server');
  if (!entry) throw new PackError(`server/index.ts is missing in ${dir}`);
  return entry;
}

// the hashes are never checked in source mode; the manifest only needs well-formed ones
const NO_HASH = '0'.repeat(64);

/** A different value on every start, so the client's `?v=` cache busts whenever the (watched) server restarts. */
const startedAt = (): string => Date.now().toString(16).padStart(64, '0');

function files(dir: string, client: boolean): Record<string, string> {
  return { 'server.mjs': NO_HASH, ...(client && sourceEntryOf(dir, 'client') ? { 'client.mjs': NO_HASH } : {}) };
}

function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new PackError(`${path} is not valid JSON (${(err as Error).message})`);
  }
}

function folders(root: string, manifest: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && existsSync(join(root, e.name, manifest)))
    .map((e) => e.name)
    .sort();
}

/** The games in `src/games/`, as `scanGames` would return them from built packs. */
export function scanSourceGames(root = SOURCE_GAMES_ROOT): ScanResult {
  const games: InstalledGame[] = [];
  const skipped: ScanResult['skipped'] = [];
  const digest = startedAt();
  for (const id of folders(root, 'game.json')) {
    const dir = join(root, id);
    try {
      const source = readJson(join(dir, 'game.json'));
      const checked = validateManifest({ ...source, apiVersion: source.apiVersion ?? PACK_API_VERSION, files: files(dir, true) });
      if (!checked.ok) throw new PackError(`game.json is invalid:\n  - ${checked.errors.join('\n  - ')}`);
      if (checked.manifest.id !== id) throw new PackError(`directory "${id}" does not match the game id "${checked.manifest.id}"`);
      sourceServerEntry(dir);
      if (!sourceEntryOf(dir, 'client')) throw new PackError(`client/index.ts is missing in ${dir}`);
      games.push({ manifest: checked.manifest, source: 'bundled', dir, digest });
    } catch (err) {
      skipped.push({ dir, reason: (err as Error).message });
    }
  }
  return { games: games.sort(byOrder), skipped };
}

/** The plugins in `src/plugins/`, as `scanPlugins` would return them from built packs. */
export function scanSourcePlugins(root = SOURCE_PLUGINS_ROOT): PluginScan {
  const plugins: InstalledPlugin[] = [];
  const skipped: PluginScan['skipped'] = [];
  const digest = startedAt();
  for (const id of folders(root, 'plugin.json')) {
    const dir = join(root, id);
    try {
      const source = readJson(join(dir, 'plugin.json'));
      const checked = validatePluginManifest({ ...source, kind: 'plugin', apiVersion: source.apiVersion ?? PLUGIN_API_VERSION, files: files(dir, true) });
      if (!checked.ok) throw new PackError(`plugin.json is invalid:\n  - ${checked.errors.join('\n  - ')}`);
      if (checked.manifest.id !== id) throw new PackError(`the folder is called "${id}" but the plugin id is "${checked.manifest.id}"`);
      sourceServerEntry(dir);
      plugins.push({ manifest: checked.manifest, source: 'bundled', dir, digest });
    } catch (err) {
      skipped.push({ dir, reason: (err as Error).message });
    }
  }
  plugins.sort((a, b) => (a.manifest.order ?? 1000) - (b.manifest.order ?? 1000) || a.manifest.id.localeCompare(b.manifest.id));
  return { plugins, skipped };
}
