/**
 * Reading, verifying and writing game packs (`.pgpack` = gzip'd tar with a flat set of files, see
 * shared/plugin-api.ts). Node only. Packs are untrusted input: names are limited to a fixed
 * allow-list, only regular files are accepted and the unpacked size is capped, so nothing can
 * escape the target directory or exhaust memory. A small tar reader/writer keeps the server free
 * of archive dependencies.
 */
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { MAX_PACK_BYTES, PACK_FILES, parseManifest, parsePluginManifest, type GameManifest, type PluginManifest } from '../../shared';

export class PackError extends Error {}

export type PackFiles = Map<string, Buffer>;

const BLOCK = 512;
const ALLOWED = new Set<string>(PACK_FILES);

export const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

function octal(n: number, len: number): Buffer {
  return Buffer.from(n.toString(8).padStart(len - 1, '0') + '\0', 'ascii');
}

/** Deterministic (sorted, mtime 0) gzip'd tar of `files`. */
export function createPack(files: PackFiles): Buffer {
  const parts: Buffer[] = [];
  for (const name of [...files.keys()].sort()) {
    const data = files.get(name) as Buffer;
    const head = Buffer.alloc(BLOCK);
    head.write(name, 0, 'ascii');
    octal(0o644, 8).copy(head, 100);
    octal(0, 8).copy(head, 108); // uid
    octal(0, 8).copy(head, 116); // gid
    octal(data.length, 12).copy(head, 124);
    octal(0, 12).copy(head, 136); // mtime
    head.fill(' ', 148, 156); // checksum placeholder
    head.write('0', 156, 'ascii'); // regular file
    head.write('ustar\0', 257, 'ascii');
    head.write('00', 263, 'ascii');
    let sum = 0;
    for (const b of head) sum += b;
    head.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    parts.push(head, data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

const field = (b: Buffer, from: number, len: number): string => {
  const raw = b.subarray(from, from + len);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? len : end).toString('ascii');
};

/** Unpack a `.pgpack` into memory. Throws PackError on anything that is not a plain, small, flat pack. */
export function readPack(archive: Buffer): PackFiles {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, { maxOutputLength: MAX_PACK_BYTES + 64 * BLOCK });
  } catch (err) {
    throw new PackError(`not a valid pack (${(err as Error).message})`);
  }
  const files: PackFiles = new Map();
  let total = 0;
  let pos = 0;
  while (pos + BLOCK <= tar.length) {
    const head = tar.subarray(pos, pos + BLOCK);
    if (head.every((b) => b === 0)) break;
    const name = field(head, 0, 100);
    const type = String.fromCharCode(head[156] || 48);
    const size = parseInt(field(head, 124, 12).trim(), 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : head[i];
    if (sum !== parseInt(field(head, 148, 8).trim(), 8)) throw new PackError('corrupt pack (bad header checksum)');
    if (type !== '0') throw new PackError(`"${name}" is not a regular file (only plain files are allowed)`);
    if (!ALLOWED.has(name)) throw new PackError(`"${name}" is not allowed in a pack (allowed: ${PACK_FILES.join(', ')})`);
    if (files.has(name)) throw new PackError(`"${name}" appears twice`);
    if (!Number.isInteger(size) || size < 0) throw new PackError('corrupt pack (bad size)');
    total += size;
    if (total > MAX_PACK_BYTES) throw new PackError(`pack is larger than ${MAX_PACK_BYTES} bytes unpacked`);
    pos += BLOCK;
    if (pos + size > tar.length) throw new PackError('corrupt pack (truncated)');
    files.set(name, Buffer.from(tar.subarray(pos, pos + size)));
    pos += Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

/** Read a pack directory (only the allowed file names, no symlinks). */
export function readPackDir(dir: string): PackFiles {
  const files: PackFiles = new Map();
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (!ALLOWED.has(name)) continue;
    const path = join(dir, name);
    const st = lstatSync(path);
    if (!st.isFile()) throw new PackError(`"${name}" must be a regular file`);
    total += st.size;
    if (total > MAX_PACK_BYTES) throw new PackError(`pack is larger than ${MAX_PACK_BYTES} bytes`);
    files.set(name, readFileSync(path));
  }
  return files;
}

export function writePackDir(files: PackFiles, dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of files) {
    if (!ALLOWED.has(name)) throw new PackError(`"${name}" is not allowed in a pack`);
    writeFileSync(join(dir, name), data);
  }
}

export interface VerifiedPack {
  manifest: GameManifest;
  files: PackFiles;
  /** sha256 over game.json and the listed files: identifies this exact pack. */
  digest: string;
}

/** Parse `game.json`, and check the shipped files against its hashes. Throws PackError listing every problem. */
export function verifyPack(files: PackFiles): VerifiedPack {
  const raw = files.get('game.json');
  if (!raw) throw new PackError('game.json is missing');
  const parsed = parseManifest(raw.toString('utf8'));
  if (!parsed.ok) throw new PackError(`game.json is invalid:\n  - ${parsed.errors.join('\n  - ')}`);
  const { manifest } = parsed;
  const problems: string[] = [];
  for (const [name, hash] of Object.entries(manifest.files)) {
    const data = files.get(name);
    if (!data) problems.push(`${name} is listed but missing`);
    else if (sha256(data) !== hash) problems.push(`${name} does not match its sha256 (the pack was modified)`);
  }
  for (const name of files.keys()) if (name !== 'game.json' && name !== 'README.md' && !(name in manifest.files)) problems.push(`${name} is not listed in game.json`);
  if (problems.length > 0) throw new PackError(`pack failed verification:\n  - ${problems.join('\n  - ')}`);
  const h = createHash('sha256').update(raw);
  for (const name of Object.keys(manifest.files).sort()) h.update(name).update(manifest.files[name]);
  return { manifest, files, digest: h.digest('hex') };
}

export interface VerifiedPluginPack {
  manifest: PluginManifest;
  files: PackFiles;
  /** sha256 over plugin.json and the listed files: identifies this exact plugin and doubles as the client cache buster. */
  digest: string;
}

/** Which kind of pack these files are, from the manifest they carry. */
export function packKindOf(files: PackFiles): 'game' | 'plugin' | null {
  const game = files.has('game.json');
  const plugin = files.has('plugin.json');
  return game && !plugin ? 'game' : plugin && !game ? 'plugin' : null;
}

/** Parse `plugin.json`, and check the shipped files against its hashes. Throws PackError listing every problem. */
export function verifyPluginPack(files: PackFiles): VerifiedPluginPack {
  const raw = files.get('plugin.json');
  if (!raw) throw new PackError('plugin.json is missing');
  const parsed = parsePluginManifest(raw.toString('utf8'));
  if (!parsed.ok) throw new PackError(`plugin.json is invalid:\n  - ${parsed.errors.join('\n  - ')}`);
  const { manifest } = parsed;
  const problems: string[] = [];
  for (const [name, hash] of Object.entries(manifest.files)) {
    const data = files.get(name);
    if (!data) problems.push(`${name} is listed but missing`);
    else if (sha256(data) !== hash) problems.push(`${name} does not match its sha256 (the plugin was modified)`);
  }
  for (const name of files.keys()) if (name !== 'plugin.json' && name !== 'README.md' && !(name in manifest.files)) problems.push(`${name} is not listed in plugin.json`);
  if (problems.length > 0) throw new PackError(`plugin failed verification:\n  - ${problems.join('\n  - ')}`);
  const h = createHash('sha256').update(raw);
  for (const name of Object.keys(manifest.files).sort()) h.update(name).update(manifest.files[name]);
  return { manifest, files, digest: h.digest('hex') };
}

/** Load a plugin `.pgpack` file or an unpacked plugin directory, verified. */
export function loadPluginPack(path: string): VerifiedPluginPack {
  const st = lstatSync(path);
  if (st.isDirectory()) return verifyPluginPack(readPackDir(path));
  if (!st.isFile()) throw new PackError(`${path} is neither a file nor a directory`);
  if (st.size > MAX_PACK_BYTES) throw new PackError('pack file is too large');
  return verifyPluginPack(readPack(readFileSync(path)));
}

/** Load a `.pgpack` file or an unpacked pack directory, verified. */
export function loadPack(path: string): VerifiedPack {
  const st = lstatSync(path);
  if (st.isDirectory()) return verifyPack(readPackDir(path));
  if (!st.isFile()) throw new PackError(`${path} is neither a file nor a directory`);
  if (st.size > MAX_PACK_BYTES) throw new PackError('pack file is too large');
  return verifyPack(readPack(readFileSync(path)));
}
