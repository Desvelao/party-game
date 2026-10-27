/**
 * Build the games under src/games/ into packs and install them into the package, so a normal build
 * ships with its games while the core itself contains none.
 *
 *   GAMES=all|none|id,id  npm run build:games        (default: all)
 *
 * Output: <out>/games/<id>/ (what the server reads as its bundled games) and <out>/packs/<id>-<version>.pgpack.
 * `GAMES=none` leaves <out>/games empty: a core without games, to be filled with `games install`.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installPack } from '../server/plugins/install';
import { PackError, createPack, verifyPack } from '../server/plugins/pack';
import { UsageError, flagValue, parseArgs } from './args';
import { buildPack } from './gamepack/build';

/** Which game folders to build: `all`, `none` or a comma separated list of ids. */
export function selectGames(available: string[], spec: string): string[] {
  const s = spec.trim();
  if (s === '' || s === 'all') return available;
  if (s === 'none') return [];
  const wanted = s.split(',').map((x) => x.trim()).filter(Boolean);
  const unknown = wanted.filter((id) => !available.includes(id));
  if (unknown.length > 0) throw new UsageError(`unknown game(s): ${unknown.join(', ')} (available: ${available.join(', ') || 'none'})`);
  return available.filter((id) => wanted.includes(id));
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const args = parseArgs(argv, ['games', 'out', 'src']);
  const spec = flagValue(args, 'games') ?? env.GAMES ?? 'all';
  const src = resolve(flagValue(args, 'src') ?? 'src/games');
  const out = resolve(flagValue(args, 'out') ?? 'dist');
  const available = existsSync(src) ? readdirSync(src).filter((d) => existsSync(join(src, d, 'game.json'))).sort() : [];
  const chosen = selectGames(available, spec);

  // rebuilt from scratch so a game that was dropped from the list does not linger in the package
  rmSync(join(out, 'games'), { recursive: true, force: true });
  rmSync(join(out, 'packs'), { recursive: true, force: true });
  mkdirSync(join(out, 'games'), { recursive: true });
  mkdirSync(join(out, 'packs'), { recursive: true });
  for (const id of chosen) {
    const { files, manifest, warnings } = await buildPack(join(src, id));
    for (const w of warnings) console.warn(`warning: ${id}: ${w}`);
    writeFileSync(join(out, 'packs', `${manifest.id}-${manifest.version}.pgpack`), createPack(files));
    installPack(verifyPack(files), join(out, 'games'), { force: true });
    console.log(`game: ${manifest.name} ${manifest.version}`);
  }
  console.log(chosen.length === 0 ? `no games in ${join(out, 'games')} (GAMES=${spec})` : `${chosen.length} game(s) installed into ${join(out, 'games')}`);
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
