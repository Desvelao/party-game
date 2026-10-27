/**
 * The games under `src/games/` read straight from their source, without building them. Used by the tools
 * and tests that run from the repository (the balance tool, the config example generator, the test setup).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playablesOf, registerGames, registerTranslations, type GameManifest, type ServerGamePlugin } from '../../shared';
import { registerAi, registerMinigame } from '../minigames';

export const SOURCE_GAMES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../games');

/** Source manifests in picker order (`files` is not filled in: the games are not built). */
export function sourceManifests(root = SOURCE_GAMES_DIR): GameManifest[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((d) => existsSync(join(root, d, 'game.json')))
    .map((d) => JSON.parse(readFileSync(join(root, d, 'game.json'), 'utf8')) as GameManifest)
    .sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.id.localeCompare(b.id));
}

/** Register the catalogs and translations of the source games (no code is loaded). */
export function registerSourceCatalogs(root?: string): GameManifest[] {
  const list = sourceManifests(root);
  for (const m of list) {
    registerGames([m.catalog]);
    registerTranslations(m.locales);
  }
  return list;
}

/** Register the source games completely: catalog, translations and server code (run from source with tsx or vitest). */
export async function registerSourceGames(root = SOURCE_GAMES_DIR): Promise<GameManifest[]> {
  const list = sourceManifests(root);
  for (const manifest of list) {
    const plugin = ((await import(join(root, manifest.id, 'server', 'index.ts'))) as { default: ServerGamePlugin }).default;
    registerGames([manifest.catalog]);
    registerTranslations(manifest.locales);
    if (plugin.ai) registerAi(plugin.ai);
    for (const p of playablesOf(manifest.catalog)) {
      registerMinigame(p.id, (options) => plugin.createMinigame(p.id, options), { seeded: (options, rng) => plugin.createMinigame(p.id, options, rng), bot: plugin.bot?.bind(plugin) });
    }
  }
  return list;
}
