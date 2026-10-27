/**
 * Manage installed game packs (the server reads them at startup, so restart it afterwards).
 *   games list [--json]
 *   games install <file.pgpack|dir> [--yes] [--force] [--bundled]
 *   games uninstall <id> [--bundled]
 *   games info <id|file.pgpack|dir>
 * Options: -c/--config <file> to find the games directories like the server does, --dir <path>
 * to name the install directory directly.
 *
 *   npm run games -- list            (built: node dist/games.js list)
 */
import { pathToFileURL } from 'node:url';
import { playablesOf } from '../shared';
import { installedGamesDir, scanGames, type InstalledGame } from '../server/plugins/loader';
import { loadPack, type VerifiedPack } from '../server/plugins/pack';
import { consoleIo, runMain, runPackCli, usageOf, type Io, type PackKind } from './packCli';

export type { Io };

const kind: PackKind<InstalledGame, VerifiedPack> = {
  noun: 'game',
  plural: 'games',
  restartTo: 'play it',
  bundledDir: (cfg) => cfg.bundledGamesDir,
  installedDir: installedGamesDir,
  scan: (dirs) => {
    const { games, skipped } = scanGames(dirs);
    return { items: games, skipped };
  },
  load: loadPack,
  details: (pack) => {
    const m = pack.manifest;
    return [
      `  playable: ${playablesOf(m.catalog).map((p) => p.id).join(', ')}`,
      ...(m.character ? [`  character: ${m.character} (a game or plugin that provides it must be installed)`] : []),
      ...(m.characters ? [`  provides: ${m.characters.map((c) => c.id).join(', ')} (character models)`] : []),
    ];
  },
  listFields: (g) => ({ character: g.manifest.character }),
};

export const USAGE = usageOf(kind);

export const main = (argv: string[], io: Io = consoleIo): Promise<number> => runPackCli(kind, argv, io);

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runMain(main, USAGE);
