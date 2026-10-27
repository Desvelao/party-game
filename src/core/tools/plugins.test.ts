import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PLUGIN_API_VERSION } from '../shared';
import { sha256 } from '../server/plugins/pack';
import { main, type Io } from './plugins';

let root: string;
let installed: string;
let bundled: string;
let out: string[];
let err: string[];
let answer = true;
const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), confirm: async () => answer };

/** An unpacked plugin in its own folder under `root`. */
function plugin(version = '1.0.0', folder = 'src-pack', code = 'export default { start() {} };'): string {
  const dir = join(root, folder);
  mkdirSync(dir, { recursive: true });
  const manifest = { kind: 'plugin', id: 'fixture-plugin', name: 'Fixture Plugin', version, apiVersion: PLUGIN_API_VERSION, author: 'a', license: 'MIT', description: 'd', files: { 'server.mjs': sha256(Buffer.from(code)) } };
  writeFileSync(join(dir, 'server.mjs'), code);
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest));
  return dir;
}
const run = (...argv: string[]) => main([...argv, '--dir', installed], io);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pgplugins-'));
  installed = join(root, 'installed');
  bundled = join(root, 'bundled');
  mkdirSync(bundled);
  process.env.BUNDLED_PLUGINS_DIR = bundled;
  out = [];
  err = [];
  answer = true;
});
afterEach(() => {
  delete process.env.BUNDLED_PLUGINS_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe('plugins CLI', () => {
  it('lists nothing at first', async () => {
    expect(await run('list')).toBe(0);
    expect(out.join('\n')).toBe('No plugins installed.');
  });

  it('install -> list -> info -> uninstall', async () => {
    expect(await run('install', plugin(), '--yes')).toBe(0);
    expect(out.join('\n')).toMatch(/Installed Fixture Plugin 1.0.0/);
    expect(out.join('\n')).toMatch(/Restart the server to use it\./);
    expect(readdirSync(join(installed, 'fixture-plugin')).sort()).toEqual(['plugin.json', 'server.mjs']);

    out.length = 0;
    await run('list');
    expect(out[1]).toMatch(/fixture-plugin\s+1\.0\.0\s+installed\s+active/);

    out.length = 0;
    await run('list', '--json');
    expect(JSON.parse(out.join('\n')).plugins[0]).toMatchObject({ id: 'fixture-plugin', version: '1.0.0', source: 'installed', status: 'active' });

    out.length = 0;
    expect(await run('info', 'fixture-plugin')).toBe(0);
    expect(out.join('\n')).toMatch(/requires: nothing\s+core: any/);
    expect(out.join('\n')).toMatch(/sha256:/);

    out.length = 0;
    expect(await run('uninstall', 'fixture-plugin')).toBe(0);
    expect(readdirSync(installed)).toEqual([]);
    expect(await run('uninstall', 'fixture-plugin')).toBe(1);
  });

  it('asks first, and does nothing when declined', async () => {
    answer = false;
    expect(await run('install', plugin())).toBe(1);
    expect(out.join('\n')).toMatch(/This plugin runs on the server/);
    expect(readdirSync(root)).not.toContain('installed');
  });

  it('upgrades, and refuses the same or an older version without --force', async () => {
    await run('install', plugin('1.0.0'), '--yes');
    out.length = 0;
    expect(await run('install', plugin('1.1.0', 'b'), '--yes')).toBe(0);
    expect(out.join('\n')).toMatch(/Upgraded .* \(was 1\.0\.0\)/);
    await expect(run('install', plugin('1.0.0', 'c'), '--yes')).rejects.toThrow(/use --force/);
    expect(await run('install', plugin('1.0.0', 'c'), '--yes', '--force')).toBe(0);
    expect(out.join('\n')).toMatch(/Downgraded/);
  });

  it('rejects a modified plugin and leaves nothing behind', async () => {
    const dir = plugin();
    writeFileSync(join(dir, 'server.mjs'), 'export default {}; //tampered');
    await expect(run('install', dir, '--yes')).rejects.toThrow(/sha256/);
    expect(() => readdirSync(installed)).toThrow();
  });

  it('shows bundled plugins in the list and --bundled acts on that directory', async () => {
    expect(await main(['install', plugin('0.5.0', 'a'), '--yes', '--bundled'], io)).toBe(0);
    expect(readdirSync(bundled)).toEqual(['fixture-plugin']);
    await run('install', plugin('1.0.0', 'b'), '--yes');
    out.length = 0;
    await run('list');
    expect(out.slice(1).map((l) => l.replace(/\s+/g, ' '))).toEqual(['fixture-plugin 0.5.0 bundled overridden Fixture Plugin', 'fixture-plugin 1.0.0 installed active Fixture Plugin']);
  });

  it('usage errors', async () => {
    await expect(run('install')).rejects.toThrow(/needs a pack/);
    await expect(run('uninstall')).rejects.toThrow(/needs a plugin id/);
    await expect(run('nope')).rejects.toThrow(/unknown command/);
    expect(await main([], io)).toBe(2);
    expect(out.join('\n')).toMatch(/usage: plugins <command>/);
  });
});
