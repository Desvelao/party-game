/**
 * Manage installed plugins (the server reads them at startup, so restart it afterwards).
 *   plugins list [--json]
 *   plugins install <file.pgpack|dir> [--yes] [--force] [--bundled]
 *   plugins uninstall <id> [--bundled]
 *   plugins info <id|file.pgpack|dir>
 * Options: -c/--config <file> to find the plugin directories like the server does, --dir <path>
 * to name the install directory directly.
 *
 *   npm run plugins -- list            (built: node dist/plugins.js list)
 */
import { pathToFileURL } from 'node:url';
import { installedPluginsDir, scanPlugins, type InstalledPlugin } from '../server/plugins/features';
import { loadPluginPack, type VerifiedPluginPack } from '../server/plugins/pack';
import { consoleIo, runMain, runPackCli, usageOf, type Io, type PackKind } from './packCli';

export type { Io };

const kind: PackKind<InstalledPlugin, VerifiedPluginPack> = {
  noun: 'plugin',
  plural: 'plugins',
  restartTo: 'use it',
  bundledDir: (cfg) => cfg.bundledPluginsDir,
  installedDir: installedPluginsDir,
  scan: (dirs) => {
    const { plugins, skipped } = scanPlugins(dirs);
    return { items: plugins, skipped };
  },
  load: loadPluginPack,
  details: (pack) => {
    const m = pack.manifest;
    return [
      `  requires: ${Object.entries(m.requires ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing'}   core: ${m.engines?.core ?? 'any'}`,
      `  settings: ${(m.config ?? []).map((o) => o.id + (o.env ? ` (${o.env})` : '')).join(', ') || 'none'}`,
    ];
  },
};

export const USAGE = usageOf(kind);

export const main = (argv: string[], io: Io = consoleIo): Promise<number> => runPackCli(kind, argv, io);

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runMain(main, USAGE);
