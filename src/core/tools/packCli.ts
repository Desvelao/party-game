/**
 * The pack manager behind `games` and `plugins`: list, install, uninstall and info of the packs in a directory.
 * Each tool describes its kind of pack (`PackKind`) and calls `runPackCli`; `runMain` is its entry point.
 */
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { loadConfig, type ServerConfig } from '../server/config';
import { ConfigError, loadConfigFile, resolveConfigPath } from '../server/configFile';
import { installPack, installedVersion, uninstallGame } from '../server/plugins/install';
import { PackError, type PackFiles } from '../server/plugins/pack';
import { UsageError, flagValue, parseArgs, type Parsed } from './args';

export interface Io {
  out(line: string): void;
  err(line: string): void;
  /** Ask a yes/no question; false when there is no one to ask. */
  confirm(question: string): Promise<boolean>;
}

export const consoleIo: Io = {
  out: (l) => console.log(l),
  err: (l) => console.error(l),
  async confirm(question) {
    if (!process.stdin.isTTY) return false;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
    } finally {
      rl.close();
    }
  },
};

export interface Dirs {
  bundled: string | null;
  installed: string | null;
}

interface InstalledPack {
  manifest: { id: string; name: string; version: string };
  dir: string;
  digest: string;
}

interface VerifiedPackLike {
  manifest: { id: string; name: string; version: string; description: string; author: string; license: string };
  files: PackFiles;
  digest: string;
}

/** What differs between the packs a tool manages. */
export interface PackKind<I extends InstalledPack, V extends VerifiedPackLike> {
  /** `game`, `plugin`: singular, as in "install a game" */
  noun: string;
  /** `games`, `plugins`: the command name */
  plural: string;
  /** what the tool says to do once installed: "play it", "use it" */
  restartTo: string;
  bundledDir(cfg: ServerConfig): string;
  installedDir(cfg: ServerConfig): string;
  scan(dirs: Dirs): { items: I[]; skipped: { dir: string; reason: string }[] };
  load(path: string): V;
  /** the lines of `info` after the author line and before the files line */
  details(pack: V): string[];
  /** fields of a pack in `list --json`, besides the common ones */
  listFields?(item: I): Record<string, unknown>;
}

export const usageOf = (k: { noun: string; plural: string }) => `usage: ${k.plural} <command> [options]

  list [--json]                                  installed ${k.plural} (bundled and installed)
  install <file.pgpack|dir> [--yes] [--force]    install or upgrade a ${k.noun}
  uninstall <id>                                 remove an installed ${k.noun}
  info <id|file.pgpack|dir>                      show what a ${k.noun} or pack contains

options:
  -c, --config <file>   configuration file (to find the ${k.plural} directories)
  --dir <path>          ${k.plural} directory to use instead of the configured one
  --bundled             act on the ${k.plural} baked into the build instead of the installed ones
  --yes                 do not ask for confirmation
  --force               replace a ${k.noun} with the same or an older version

Restart the server after changing ${k.plural}.`;

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

export async function runPackCli<I extends InstalledPack, V extends VerifiedPackLike>(k: PackKind<I, V>, argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv.map((a) => (a === '-c' ? '--config' : a)), ['config', 'dir']);
  const [cmd, target] = args.words;
  if (args.flags.has('help') || !cmd) {
    io.out(usageOf(k));
    return cmd ? 0 : 2;
  }
  const dirs = resolveDirs(k, args);
  const root = args.flags.has('bundled') ? dirs.bundled : dirs.installed;
  if (!root) throw new UsageError(`there is no ${k.plural} directory to use (bundled directory is not set)`);

  const describe = (pack: V): string[] => {
    const m = pack.manifest;
    return [
      `${m.name} ${m.version}  (${m.id})`,
      `  ${m.description}`,
      `  author:   ${m.author}   license: ${m.license}`,
      ...k.details(pack),
      `  files:    ${[...pack.files].map(([n, d]) => `${n} ${kb(d.length)}`).join(', ')}`,
      `  sha256:   ${pack.digest}`,
    ];
  };

  switch (cmd) {
    case 'list': {
      const list = rows(k, dirs);
      const skipped = [dirs.bundled, dirs.installed].flatMap((d) => (d ? k.scan({ bundled: d, installed: null }).skipped : []));
      if (args.flags.has('json')) {
        io.out(JSON.stringify({ [k.plural]: list.map((r) => ({ id: r.item.manifest.id, name: r.item.manifest.name, version: r.item.manifest.version, source: r.source, status: r.status, digest: r.item.digest, ...k.listFields?.(r.item) })), skipped }, null, 2));
        return 0;
      }
      if (list.length === 0) io.out(`No ${k.plural} installed.`);
      else {
        const w = Math.max(...list.map((r) => r.item.manifest.id.length), 2);
        io.out(`${'ID'.padEnd(w)}  ${'VERSION'.padEnd(8)}  ${'SOURCE'.padEnd(9)}  ${'STATUS'.padEnd(10)}  NAME`);
        for (const r of list) io.out(`${r.item.manifest.id.padEnd(w)}  ${r.item.manifest.version.padEnd(8)}  ${r.source.padEnd(9)}  ${r.status.padEnd(10)}  ${r.item.manifest.name}`);
      }
      for (const s of skipped) io.err(`warning: ${s.dir} is not usable: ${s.reason.split('\n')[0]}`);
      return 0;
    }
    case 'info': {
      if (!target) throw new UsageError(`info needs a ${k.noun} id or a pack file`);
      const found = rows(k, dirs).find((r) => r.item.manifest.id === target && r.status === 'active');
      for (const line of describe(k.load(found ? found.item.dir : resolve(target)))) io.out(line);
      return 0;
    }
    case 'install': {
      if (!target) throw new UsageError('install needs a pack file or directory');
      const pack = k.load(resolve(target));
      for (const line of describe(pack)) io.out(line);
      const prev = installedVersion(root, pack.manifest.id, k.load);
      if (!args.flags.has('yes')) {
        io.out('');
        io.out(`This ${k.noun} runs on the server with the same permissions as the server itself. Only install packs from authors you trust.`);
        const verb = prev ? `Replace ${pack.manifest.id} ${prev} with ${pack.manifest.version}` : `Install ${pack.manifest.name}`;
        if (!(await io.confirm(`${verb} in ${root}?`))) {
          io.err('Not installed (pass --yes to skip this question).');
          return 1;
        }
      }
      const r = installPack(pack, root, { force: args.flags.has('force') }, k.load);
      io.out(`${r.action === 'installed' ? 'Installed' : r.action[0]!.toUpperCase() + r.action.slice(1)} ${r.manifest.name} ${r.manifest.version}${r.previous ? ` (was ${r.previous})` : ''} in ${root}`);
      io.out(`Restart the server to ${k.restartTo}.`);
      return 0;
    }
    case 'uninstall': {
      if (!target) throw new UsageError(`uninstall needs a ${k.noun} id`);
      if (!uninstallGame(root, target, k.noun)) {
        io.err(`${target} is not installed in ${root}`);
        return 1;
      }
      io.out(`Removed ${target} from ${root}. Restart the server to apply.`);
      return 0;
    }
    default:
      throw new UsageError(`unknown command "${cmd}"`);
  }
}

function resolveDirs<I extends InstalledPack, V extends VerifiedPackLike>(k: PackKind<I, V>, args: Parsed): Dirs {
  const resolved = resolveConfigPath({ config: flagValue(args, 'config') });
  const cfg = loadConfig(resolved ? loadConfigFile(resolved.path) : {}, () => {});
  const dir = flagValue(args, 'dir');
  const bundled = k.bundledDir(cfg);
  return { bundled: bundled ? resolve(bundled) : null, installed: dir ? resolve(dir) : k.installedDir(cfg) };
}

function rows<I extends InstalledPack, V extends VerifiedPackLike>(k: PackKind<I, V>, dirs: Dirs): { item: I; source: string; status: string }[] {
  const active = new Map(k.scan(dirs).items.map((g) => [g.manifest.id, g]));
  const out: { item: I; source: string; status: string }[] = [];
  for (const [source, dir] of [['bundled', dirs.bundled], ['installed', dirs.installed]] as const) {
    if (!dir) continue;
    for (const item of k.scan({ bundled: source === 'bundled' ? dir : null, installed: source === 'installed' ? dir : null }).items) {
      out.push({ item, source, status: active.get(item.manifest.id)?.dir === item.dir ? 'active' : 'overridden' });
    }
  }
  return out.sort((a, b) => a.item.manifest.id.localeCompare(b.item.manifest.id) || a.source.localeCompare(b.source));
}

/** The command-line entry of a tool: runs `main` and turns usage, pack and config errors into exit codes. */
export function runMain(main: (argv: string[]) => Promise<number>, usage: string): void {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      if (err instanceof UsageError) {
        console.error(`${err.message}\n\n${usage}`);
        process.exit(2);
      }
      if (err instanceof PackError || err instanceof ConfigError) {
        console.error(`error: ${err.message}`);
        process.exit(err instanceof ConfigError ? err.exitCode : 1);
      }
      console.error(err);
      process.exit(1);
    },
  );
}
