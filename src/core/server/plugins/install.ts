/**
 * Installing and removing game packs on disk (used by the `games` CLI). The server only reads the
 * games directory at startup, so these functions never touch a running server.
 */
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions, type GameManifest } from '../../shared';
import { PackError, loadPack, writePackDir, type PackFiles } from './pack';

export type InstallAction = 'installed' | 'upgraded' | 'reinstalled' | 'downgraded';

/** What installing needs of a verified pack: games and plugins both qualify. */
export interface InstallablePack {
  manifest: { id: string; version: string };
  files: PackFiles;
  digest: string;
}

export interface InstallResult {
  manifest: GameManifest;
  digest: string;
  action: InstallAction;
  /** version that was replaced */
  previous?: string;
}

/** The installed version of `id` under `root`, if any and readable. */
export function installedVersion(root: string, id: string, read: (dir: string) => { manifest: { version: string } } = loadPack): string | null {
  try {
    return read(join(root, id)).manifest.version;
  } catch {
    return null;
  }
}

/**
 * Put a verified pack into `<root>/<id>`. A higher version is an upgrade; the same or a lower one needs
 * `force`. The directory is replaced atomically (written aside, then renamed), so a failure never
 * leaves a half-installed game.
 */
export function installPack(pack: InstallablePack, root: string, opts: { force?: boolean } = {}, read: (dir: string) => { manifest: { version: string } } = loadPack): InstallResult {
  const { manifest } = pack;
  const dest = join(root, manifest.id);
  const prev = existsSync(dest) ? installedVersion(root, manifest.id, read) : null;
  let action: InstallAction = 'installed';
  if (existsSync(dest)) {
    if (prev === null) action = 'reinstalled'; // present but unreadable: replace it
    else {
      const cmp = compareVersions(manifest.version, prev);
      if (cmp <= 0 && !opts.force) {
        throw new PackError(`${manifest.id} ${prev} is already installed${cmp === 0 ? ' (same version)' : ` (newer than ${manifest.version})`}; use --force to replace it`);
      }
      action = cmp > 0 ? 'upgraded' : cmp === 0 ? 'reinstalled' : 'downgraded';
    }
  }
  mkdirSync(root, { recursive: true });
  // dot-prefixed so a server starting meanwhile never sees a half-written pack
  const stage = mkdtempSync(join(root, `.install-${manifest.id}-`));
  try {
    writePackDir(pack.files, stage);
    if (existsSync(dest)) {
      const old = mkdtempSync(join(root, `.old-${manifest.id}-`));
      renameSync(dest, join(old, 'game'));
      try {
        renameSync(stage, dest);
      } catch (err) {
        renameSync(join(old, 'game'), dest);
        throw err;
      }
      rmSync(old, { recursive: true, force: true });
    } else renameSync(stage, dest);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return { manifest: manifest as GameManifest, digest: pack.digest, action, previous: prev ?? undefined };
}

/** Remove `<root>/<id>`. Returns false when it was not installed. */
export function uninstallGame(root: string, id: string, what = 'game'): boolean {
  if (!/^[a-z0-9-]{2,32}$/.test(id)) throw new PackError(`"${id}" is not a ${what} id`);
  const dir = join(root, id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
