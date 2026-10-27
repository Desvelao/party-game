/**
 * Build a game pack from its source directory:
 *   <dir>/game.json        manifest without `files` (apiVersion is filled in)
 *   <dir>/server/index.ts  default export: ServerGamePlugin
 *   <dir>/client/index.ts  default export: ClientGamePlugin
 *   <dir>/README.md        optional
 * Both entries are bundled to a single ESM file, so the pack needs nothing at runtime.
 */
import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_API_VERSION, PLUGIN_API_VERSION, validateManifest, validatePluginManifest, type GameManifest, type PluginManifest } from '../../shared';
import { PackError, sha256, type PackFiles } from '../../server/plugins/pack';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Core modules with runtime state or server/client internals: a pack bundling its own copy would silently diverge. */
const FORBIDDEN = [
  /^src\/core\/server\//,
  /^src\/core\/client\//,
  /^src\/core\/shared\/(index|catalog|character|i18n|guides|manifest|plugin-api|plugins|plugin-manifest|protocol|playlists|locales\/.*)\.ts$/,
  /^node_modules\/phaser\//,
];

const SOFT_LIMIT = 150 * 1024;

export interface BuildResult {
  files: PackFiles;
  manifest: GameManifest;
  warnings: string[];
}

function entryOf(dir: string, side: 'server' | 'client'): string {
  for (const ext of ['ts', 'js', 'mjs']) {
    const p = join(dir, side, `index.${ext}`);
    if (existsSync(p)) return p;
  }
  throw new PackError(`${side}/index.ts is missing in ${dir}`);
}

async function bundle(entry: string, side: 'server' | 'client', minify: boolean): Promise<Buffer> {
  let result;
  try {
    result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'esm',
      platform: side === 'server' ? 'node' : 'browser',
      target: side === 'server' ? 'node18' : 'es2020',
      minify,
      metafile: true,
      logLevel: 'silent',
      legalComments: 'none',
    });
  } catch (err) {
    const msgs = (err as { errors?: { text: string; location?: { file: string; line: number } | null }[] }).errors;
    const text = msgs ? msgs.map((m) => `${m.location ? `${relative(REPO, m.location.file)}:${m.location.line}: ` : ''}${m.text}`).join('\n  ') : String(err);
    throw new PackError(`${side} bundle failed:\n  ${text}`);
  }
  const bad = Object.keys(result.metafile.inputs)
    .map((p) => relative(REPO, resolve(REPO, p)).split('\\').join('/'))
    .filter((p) => FORBIDDEN.some((re) => re.test(p)));
  if (bad.length > 0) {
    throw new PackError(`the ${side} code imports core modules at runtime (${bad.join(', ')}). Use \`import type\` for types and copy small helpers into the game.`);
  }
  return Buffer.from(result.outputFiles[0]!.contents);
}

export async function buildPack(dir: string, opts: { minify?: boolean } = {}): Promise<BuildResult> {
  const srcPath = join(dir, 'game.json');
  if (!existsSync(srcPath)) throw new PackError(`${srcPath} is missing`);
  let source: Record<string, unknown>;
  try {
    source = JSON.parse(readFileSync(srcPath, 'utf8'));
  } catch (err) {
    throw new PackError(`game.json is not valid JSON (${(err as Error).message})`);
  }
  const minify = opts.minify ?? true;
  const files: PackFiles = new Map();
  files.set('server.mjs', await bundle(entryOf(dir, 'server'), 'server', minify));
  files.set('client.mjs', await bundle(entryOf(dir, 'client'), 'client', minify));
  const readme = join(dir, 'README.md');
  if (existsSync(readme)) files.set('README.md', readFileSync(readme));

  const raw = {
    ...source,
    apiVersion: source.apiVersion ?? PACK_API_VERSION,
    files: { 'server.mjs': sha256(files.get('server.mjs')!), 'client.mjs': sha256(files.get('client.mjs')!) },
  };
  const checked = validateManifest(raw);
  if (!checked.ok) throw new PackError(`game.json is invalid:\n  - ${checked.errors.join('\n  - ')}`);
  files.set('game.json', Buffer.from(JSON.stringify(checked.manifest, null, 2) + '\n'));

  const warnings: string[] = [];
  for (const name of ['server.mjs', 'client.mjs']) {
    const size = files.get(name)!.length;
    if (size > SOFT_LIMIT) warnings.push(`${name} is ${Math.round(size / 1024)} KB; keep packs small for low-power devices and slow phones`);
  }
  return { files, manifest: checked.manifest, warnings };
}

export interface PluginBuildResult {
  files: PackFiles;
  manifest: PluginManifest;
  warnings: string[];
}

/**
 * Build a plugin from its source directory:
 *   <dir>/plugin.json      manifest without `files` (kind and apiVersion are filled in)
 *   <dir>/server/index.ts  default export: ServerPlugin
 *   <dir>/client/index.ts  optional, default export: ClientPlugin (the plugin's user interface)
 *   <dir>/README.md        optional
 */
export async function buildPlugin(dir: string, opts: { minify?: boolean } = {}): Promise<PluginBuildResult> {
  const srcPath = join(dir, 'plugin.json');
  if (!existsSync(srcPath)) throw new PackError(`${srcPath} is missing`);
  let source: Record<string, unknown>;
  try {
    source = JSON.parse(readFileSync(srcPath, 'utf8'));
  } catch (err) {
    throw new PackError(`plugin.json is not valid JSON (${(err as Error).message})`);
  }
  const minify = opts.minify ?? true;
  const files: PackFiles = new Map();
  files.set('server.mjs', await bundle(entryOf(dir, 'server'), 'server', minify));
  const hasClient = ['ts', 'js', 'mjs'].some((ext) => existsSync(join(dir, 'client', `index.${ext}`)));
  if (hasClient) files.set('client.mjs', await bundle(entryOf(dir, 'client'), 'client', minify));
  const readme = join(dir, 'README.md');
  if (existsSync(readme)) files.set('README.md', readFileSync(readme));
  const hashes: Record<string, string> = {};
  for (const name of ['server.mjs', 'client.mjs']) if (files.has(name)) hashes[name] = sha256(files.get(name)!);
  const checked = validatePluginManifest({ ...source, kind: 'plugin', apiVersion: source.apiVersion ?? PLUGIN_API_VERSION, files: hashes });
  if (!checked.ok) throw new PackError(`plugin.json is invalid:\n  - ${checked.errors.join('\n  - ')}`);
  files.set('plugin.json', Buffer.from(JSON.stringify(checked.manifest, null, 2) + '\n'));
  const warnings: string[] = [];
  for (const [name, data] of files) if ((name === 'server.mjs' || name === 'client.mjs') && data.length > SOFT_LIMIT) warnings.push(`${name} is ${Math.round(data.length / 1024)} KB; keep plugins small for low-power devices`);
  return { files, manifest: checked.manifest, warnings };
}
