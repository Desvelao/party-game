import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixturePack } from '../test-fixtures/pack';
import { createPack, writePackDir } from '../server/plugins/pack';
import { main, type Io } from './games';

let root: string;
let installed: string;
let bundled: string;
let out: string[];
let err: string[];
let answer = true;
const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), confirm: async () => answer };

const pack = (version = '1.0.0', name = 'fixture-game.pgpack') => {
  const file = join(root, name);
  writeFileSync(file, createPack(fixturePack({ version })));
  return file;
};
const run = (...argv: string[]) => main([...argv, '--dir', installed], io);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pggames-'));
  installed = join(root, 'installed');
  bundled = join(root, 'bundled');
  mkdirSync(bundled);
  process.env.BUNDLED_GAMES_DIR = bundled;
  out = [];
  err = [];
  answer = true;
});
afterEach(() => {
  delete process.env.BUNDLED_GAMES_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe('games CLI', () => {
  it('lists nothing at first', async () => {
    expect(await run('list')).toBe(0);
    expect(out.join('\n')).toBe('No games installed.');
  });

  it('install -> list -> info -> uninstall', async () => {
    expect(await run('install', pack(), '--yes')).toBe(0);
    expect(out.join('\n')).toMatch(/Installed Fixture Game 1.0.0/);
    expect(readdirSync(join(installed, 'fixture-game')).sort()).toEqual(['client.mjs', 'game.json', 'server.mjs']);

    out.length = 0;
    await run('list');
    expect(out[1]).toMatch(/fixture-game\s+1\.0\.0\s+installed\s+active/);

    out.length = 0;
    expect(await run('info', 'fixture-game')).toBe(0);
    expect(out.join('\n')).toMatch(/sha256:/);

    out.length = 0;
    expect(await run('uninstall', 'fixture-game')).toBe(0);
    expect(readdirSync(installed)).toEqual([]);
    expect(await run('uninstall', 'fixture-game')).toBe(1);
  });

  it('asks first, and does nothing when declined', async () => {
    answer = false;
    expect(await run('install', pack())).toBe(1);
    expect(out.join('\n')).toMatch(/same permissions as the server/);
    expect(readdirSync(root)).not.toContain('installed');
  });

  it('upgrades, and refuses the same or an older version without --force', async () => {
    await run('install', pack('1.0.0'), '--yes');
    out.length = 0;
    expect(await run('install', pack('1.1.0', 'b.pgpack'), '--yes')).toBe(0);
    expect(out.join('\n')).toMatch(/Upgraded .* \(was 1\.0\.0\)/);
    await expect(run('install', pack('1.0.0', 'c.pgpack'), '--yes')).rejects.toThrow(/use --force/);
    expect(await run('install', pack('1.0.0', 'c.pgpack'), '--yes', '--force')).toBe(0);
    expect(out.join('\n')).toMatch(/Downgraded/);
  });

  it('rejects a modified pack and leaves nothing behind', async () => {
    const files = fixturePack();
    files.set('server.mjs', Buffer.from('export default {}; //tampered'));
    const file = join(root, 'bad.pgpack');
    writeFileSync(file, createPack(files));
    await expect(run('install', file, '--yes')).rejects.toThrow(/sha256/);
    expect(() => readdirSync(installed)).toThrow();
  });

  it('installs from an unpacked directory and shows bundled games in the list', async () => {
    const dir = join(root, 'src-pack');
    writePackDir(fixturePack(), dir);
    expect(await run('install', dir, '--yes')).toBe(0);
    writePackDir(fixturePack({ version: '0.5.0' }), join(bundled, 'fixture-game'));
    out.length = 0;
    await run('list');
    expect(out.slice(1).map((l) => l.replace(/\s+/g, ' '))).toEqual(['fixture-game 0.5.0 bundled overridden Fixture Game', 'fixture-game 1.0.0 installed active Fixture Game']);
  });

  it('--bundled acts on the bundled directory', async () => {
    expect(await main(['install', pack(), '--yes', '--bundled'], io)).toBe(0);
    expect(readdirSync(bundled)).toEqual(['fixture-game']);
  });

  it('usage errors', async () => {
    await expect(run('install')).rejects.toThrow(/needs a pack/);
    await expect(run('nope')).rejects.toThrow(/unknown command/);
    expect(await main([], io)).toBe(2);
  });
});
