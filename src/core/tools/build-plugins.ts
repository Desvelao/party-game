/**
 * Build the plugins under src/plugins/ into packs and install them into the package, so a normal build ships
 * with its plugins while the core itself contains none.
 *
 *   PLUGINS=all|none|id,id  npm run build:plugins        (default: all)
 *
 * Output: <out>/plugins/<id>/ (what the server reads as its bundled plugins) and <out>/plugin-packs/<id>-<version>.pgpack.
 * Which of the bundled plugins the server actually loads is the `plugins.enabled` / PLUGINS setting.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installPack } from '../server/plugins/install';
import { PackError, createPack, loadPluginPack, verifyPluginPack } from '../server/plugins/pack';
import { UsageError, flagValue, parseArgs } from './args';
import { buildPlugin } from './gamepack/build';

/** Which plugin folders to build: `all`, `none` or a comma separated list of ids. */
export function selectPlugins(available: string[], spec: string): string[] {
  const s = spec.trim();
  if (s === '' || s === 'all') return available;
  if (s === 'none') return [];
  const wanted = s.split(',').map((x) => x.trim()).filter(Boolean);
  const unknown = wanted.filter((id) => !available.includes(id));
  if (unknown.length > 0) throw new UsageError(`unknown plugin(s): ${unknown.join(', ')} (available: ${available.join(', ') || 'none'})`);
  return available.filter((id) => wanted.includes(id));
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const args = parseArgs(argv, ['plugins', 'out', 'src']);
  // BUILD_PLUGINS (not PLUGINS) so it never clashes with the runtime setting that picks which plugins load
  const spec = flagValue(args, 'plugins') ?? env.BUILD_PLUGINS ?? 'all';
  const src = resolve(flagValue(args, 'src') ?? 'src/plugins');
  const out = resolve(flagValue(args, 'out') ?? 'dist');
  const available = existsSync(src) ? readdirSync(src).filter((d) => existsSync(join(src, d, 'plugin.json'))).sort() : [];
  const chosen = selectPlugins(available, spec);

  rmSync(join(out, 'plugins'), { recursive: true, force: true });
  rmSync(join(out, 'plugin-packs'), { recursive: true, force: true });
  mkdirSync(join(out, 'plugins'), { recursive: true });
  mkdirSync(join(out, 'plugin-packs'), { recursive: true });
  for (const id of chosen) {
    const { files, manifest, warnings } = await buildPlugin(join(src, id));
    for (const w of warnings) console.warn(`warning: ${id}: ${w}`);
    writeFileSync(join(out, 'plugin-packs', `${manifest.id}-${manifest.version}.pgpack`), createPack(files));
    installPack(verifyPluginPack(files), join(out, 'plugins'), { force: true }, loadPluginPack);
    console.log(`plugin: ${manifest.name} ${manifest.version}`);
  }
  console.log(chosen.length === 0 ? `no plugins in ${join(out, 'plugins')} (BUILD_PLUGINS=${spec})` : `${chosen.length} plugin(s) installed into ${join(out, 'plugins')}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof UsageError || err instanceof PackError ? `error: ${err.message}` : err);
      process.exit(err instanceof UsageError ? 2 : 1);
    },
  );
}
