import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_PACK_BYTES } from '../../shared';
import { fixturePack } from '../../test-fixtures/pack';
import { PackError, createPack, loadPack, readPack, sha256, verifyPack, writePackDir } from './pack';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'pgpack-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Hand-made tar entry so tests can build archives createPack refuses to. */
function rawTar(name: string, data: Buffer, type = '0'): Buffer {
  const head = Buffer.alloc(512);
  head.write(name, 0, 'ascii');
  head.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  head.fill(' ', 148, 156);
  head.write(type, 156, 'ascii');
  let sum = 0;
  for (const b of head) sum += b;
  head.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return gzipSync(Buffer.concat([head, data, pad, Buffer.alloc(1024)]));
}

describe('pack archive', () => {
  it('round-trips and is deterministic', () => {
    const files = fixturePack();
    const a = createPack(files);
    expect(createPack(files).equals(a)).toBe(true);
    const back = readPack(a);
    expect([...back.keys()].sort()).toEqual(['client.mjs', 'game.json', 'server.mjs']);
    for (const [name, data] of files) expect(back.get(name)?.equals(data)).toBe(true);
  });

  it('verifies a good pack and gives a stable digest', () => {
    const v = verifyPack(fixturePack());
    expect(v.manifest.id).toBe('fixture-game');
    expect(v.digest).toBe(verifyPack(fixturePack()).digest);
  });

  it('rejects path traversal and unlisted names', () => {
    expect(() => readPack(rawTar('../evil.mjs', Buffer.from('x')))).toThrow(PackError);
    expect(() => readPack(rawTar('/etc/passwd', Buffer.from('x')))).toThrow(PackError);
    expect(() => readPack(rawTar('sub/server.mjs', Buffer.from('x')))).toThrow(PackError);
    expect(() => readPack(rawTar('extra.js', Buffer.from('x')))).toThrow(/not allowed/);
  });

  it('rejects symlinks and hard links', () => {
    expect(() => readPack(rawTar('server.mjs', Buffer.alloc(0), '2'))).toThrow(/regular file/);
    expect(() => readPack(rawTar('server.mjs', Buffer.alloc(0), '1'))).toThrow(/regular file/);
  });

  it('rejects an oversized pack and garbage', () => {
    expect(() => readPack(rawTar('server.mjs', Buffer.alloc(MAX_PACK_BYTES + 1)))).toThrow(PackError);
    expect(() => readPack(Buffer.from('not gzip'))).toThrow(PackError);
  });

  it('detects a modified file', () => {
    const files = fixturePack();
    files.set('server.mjs', Buffer.from('export default {}; // tampered'));
    expect(() => verifyPack(files)).toThrow(/sha256/);
  });

  it('detects missing and unlisted files', () => {
    const missing = fixturePack();
    missing.delete('client.mjs');
    expect(() => verifyPack(missing)).toThrow(/missing/);
    const extra = fixturePack();
    extra.set('README.md', Buffer.from('hi'));
    expect(() => verifyPack(extra)).not.toThrow(); // README is optional and unhashed
    expect(() => verifyPack(new Map())).toThrow(/game.json is missing/);
  });

  it('reports every manifest problem', () => {
    const files = fixturePack({ id: 'Bad Id', version: 'x', apiVersion: 99 });
    const err = (() => {
      try {
        verifyPack(files);
      } catch (e) {
        return (e as Error).message;
      }
      return '';
    })();
    expect(err).toMatch(/id must be/);
    expect(err).toMatch(/version must look like/);
    expect(err).toMatch(/apiVersion is 99/);
  });

  it('loads a directory and refuses symlinked members', () => {
    const files = fixturePack();
    const dir = tmp();
    writePackDir(files, dir);
    expect(loadPack(dir).manifest.name).toBe('Fixture Game');
    const pack = join(tmp(), 'g.pgpack');
    writeFileSync(pack, createPack(files));
    expect(loadPack(pack).digest).toBe(loadPack(dir).digest);

    const bad = tmp();
    writePackDir(files, bad);
    rmSync(join(bad, 'server.mjs'));
    symlinkSync('/etc/hostname', join(bad, 'server.mjs'));
    expect(() => loadPack(bad)).toThrow(/regular file/);
  });

  it('sha256 helper matches node', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
