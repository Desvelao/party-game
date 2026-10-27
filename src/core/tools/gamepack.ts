/**
 * Dev tool for game authors: scaffold, build and check a game pack.
 *   npm run gamepack -- init <id> [--kind game|plugin] [--name "My Game"] [--out games]
 *   npm run gamepack -- build <dir> [--out dist/packs] [--unpacked] [--no-minify]
 *   npm run gamepack -- validate <dir|file.pgpack>
 * Needs esbuild (a dev dependency), so it is not part of the production image.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ID_RE } from '../shared';
import { PackError, createPack, loadPack, loadPluginPack, verifyPack, verifyPluginPack, writePackDir } from '../server/plugins/pack';
import { UsageError, flagValue, parseArgs } from './args';
import { buildPack, buildPlugin } from './gamepack/build';
import { smokeTest } from './gamepack/smoke';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TEMPLATE = join(REPO, 'templates/game');
const PLUGIN_TEMPLATE = join(REPO, 'templates/plugin');

export const USAGE = `usage:
  gamepack init <id> [--kind game|plugin] [--name "My Game"] [--out src/games]
                                                          create src/games/<id> (or src/plugins/<id>) from the template
  gamepack build <dir> [--out dist/packs] [--unpacked]    bundle a game or plugin directory into <id>-<version>.pgpack
  gamepack validate <dir|file.pgpack>                     verify the pack; a game is played with bots, a plugin is loaded`;

const titleCase = (id: string) => id.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');

/** Copy templates/game into `<out>/<id>`, filling in the placeholders. Returns the new directory. */
export function initGame(id: string, name: string, outRoot: string, kind: 'game' | 'plugin' = 'game'): string {
  if (!ID_RE.test(id) || id.length < 2 || id.length > 32) throw new UsageError('the id must be lowercase letters, digits and dashes (2-32 characters), like "orb-grab"');
  const dest = resolve(outRoot, id);
  if (existsSync(dest)) throw new UsageError(`${dest} already exists`);
  const src = relative(dest, join(REPO, 'src/core')).split('\\').join('/');
  const walk = (dir: string, rel = ''): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const from = join(dir, entry.name);
      const to = join(dest, rel, entry.name.replace(/\.tpl$/, ''));
      if (entry.isDirectory()) walk(from, join(rel, entry.name));
      else {
        mkdirSync(dirname(to), { recursive: true });
        writeFileSync(to, readFileSync(from, 'utf8').replaceAll('__ID__', id).replaceAll('__NAME__', name).replaceAll('__SRC__', src).replaceAll('__ENV__', id.toUpperCase().replaceAll('-', '_')));
      }
    }
  };
  walk(kind === 'plugin' ? PLUGIN_TEMPLATE : TEMPLATE);
  return dest;
}

function isPluginPack(path: string): boolean {
  try {
    loadPluginPack(path);
    return true;
  } catch {
    return false;
  }
}

/** A plugin is checked structurally and loaded: its server entry must export `start`. */
async function validatePlugin(path: string): Promise<number> {
  const isSource = existsSync(join(path, 'server', 'index.ts')) || existsSync(join(path, 'server', 'index.js'));
  const pack = isSource ? await buildPlugin(path).then(({ files }) => verifyPluginPack(files)) : loadPluginPack(path);
  const dir = mkdtempSync(join(tmpdir(), 'pgplugin-'));
  try {
    writePackDir(pack.files, dir);
    const mod = (await import(pathToFileURL(join(dir, 'server.mjs')).href)) as { default?: { start?: unknown } };
    if (!mod.default || typeof mod.default.start !== 'function') {
      console.error('error: server.mjs must export default { start }');
      return 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`${pack.manifest.id} ${pack.manifest.version}: ok (plugin, ${pack.files.has('client.mjs') ? 'with' : 'without'} interface)`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ['name', 'out', 'kind']);
  const [cmd, target] = args.words;
  if (args.flags.has('help') || !cmd) {
    console.log(USAGE);
    return cmd ? 0 : 2;
  }
  switch (cmd) {
    case 'init': {
      if (!target) throw new UsageError('init needs a game id');
      const kind = flagValue(args, 'kind') ?? 'game';
      if (kind !== 'game' && kind !== 'plugin') throw new UsageError('--kind must be game or plugin');
      const dir = initGame(target, flagValue(args, 'name') ?? titleCase(target), flagValue(args, 'out') ?? (kind === 'plugin' ? 'src/plugins' : 'src/games'), kind);
      console.log(`created ${relative(process.cwd(), dir)}\nnext: npm run gamepack -- build ${relative(process.cwd(), dir)}`);
      return 0;
    }
    case 'build': {
      if (!target) throw new UsageError('build needs a game directory');
      const { files, manifest, warnings } = existsSync(join(resolve(target), 'plugin.json'))
        ? await buildPlugin(resolve(target), { minify: !args.flags.has('no-minify') })
        : await buildPack(resolve(target), { minify: !args.flags.has('no-minify') });
      const out = resolve(flagValue(args, 'out') ?? 'dist/packs');
      mkdirSync(out, { recursive: true });
      const file = join(out, `${manifest.id}-${manifest.version}.pgpack`);
      writeFileSync(file, createPack(files));
      if (args.flags.has('unpacked')) writePackDir(files, join(out, manifest.id));
      for (const w of warnings) console.warn(`warning: ${w}`);
      console.log(`built ${manifest.name} ${manifest.version} -> ${relative(process.cwd(), file)} (${[...files].reduce((n, [, d]) => n + d.length, 0)} bytes unpacked)`);
      return 0;
    }
    case 'validate': {
      if (!target) throw new UsageError('validate needs a pack file or directory');
      const path = resolve(target);
      if (existsSync(join(path, 'plugin.json')) || /\.pgpack$/.test(path) && isPluginPack(path)) return validatePlugin(path);
      // a source directory has game.json without `files`: build it first, in memory
      const isSource = existsSync(join(path, 'server', 'index.ts')) || existsSync(join(path, 'server', 'index.js'));
      const pack = isSource ? await buildPack(path).then(({ files }) => verifyPack(files)) : loadPack(path);
      const r = await smokeTest(pack);
      for (const line of r.runs) console.log(`  ${line}`);
      for (const w of r.warnings) console.warn(`warning: ${w}`);
      if (r.errors.length > 0) {
        for (const e of r.errors) console.error(`error: ${e}`);
        console.error(`${pack.manifest.id} ${pack.manifest.version}: ${r.errors.length} problem(s)`);
        return 1;
      }
      console.log(`${pack.manifest.id} ${pack.manifest.version}: ok`);
      return 0;
    }
    default:
      throw new UsageError(`unknown command "${cmd}"`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      if (err instanceof UsageError) {
        console.error(`${err.message}\n\n${USAGE}`);
        process.exit(2);
      }
      if (err instanceof PackError) {
        console.error(`error: ${err.message}`);
        process.exit(1);
      }
      console.error(err);
      process.exit(1);
    },
  );
}
