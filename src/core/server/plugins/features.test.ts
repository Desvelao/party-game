import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PLUGIN_API_VERSION, type PluginManifest } from '../../shared';
import { ConfigError } from '../configFile';
import { enabledFilter, loadPlugins, resolvePluginConfig, scanPlugins } from './features';
import { ServerEvents } from './events';
import { sha256 } from './pack';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pgplug-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Write an unpacked plugin the way `gamepack build --unpacked` would. */
function make(dir: string, id: string, extra: Partial<PluginManifest> = {}, code = 'export default { start() {} };'): string {
  const d = join(dir, id);
  mkdirSync(d, { recursive: true });
  const manifest = { kind: 'plugin', id, name: id, version: '1.0.0', apiVersion: PLUGIN_API_VERSION, author: 'a', license: 'MIT', description: 'd', files: { 'server.mjs': sha256(Buffer.from(code)) }, ...extra };
  writeFileSync(join(d, 'server.mjs'), code);
  writeFileSync(join(d, 'plugin.json'), JSON.stringify(manifest));
  return d;
}

const quiet = (): ((m: string) => void) => () => {};

describe('enabledFilter', () => {
  it('reads all, none and lists', () => {
    expect(enabledFilter('all')('x')).toBe(true);
    expect(enabledFilter('')('x')).toBe(true);
    expect(enabledFilter('none')('x')).toBe(false);
    const some = enabledFilter('a, b');
    expect([some('a'), some('b'), some('c')]).toEqual([true, true, false]);
  });
});

describe('scanPlugins', () => {
  it('prefers the higher version and the installed copy on a tie, and reports broken ones', () => {
    const bundled = join(root, 'bundled');
    const installed = join(root, 'installed');
    make(bundled, 'aaa', { version: '1.0.0' });
    make(installed, 'aaa', { version: '1.1.0' });
    make(bundled, 'bbb');
    make(installed, 'bbb');
    mkdirSync(join(bundled, 'broken'));
    const r = scanPlugins({ bundled, installed });
    const by = Object.fromEntries(r.plugins.map((p) => [p.manifest.id, p]));
    expect(by.aaa.manifest.version).toBe('1.1.0');
    expect(by.bbb.source).toBe('installed');
    expect(r.skipped).toHaveLength(1);
  });
});

describe('resolvePluginConfig', () => {
  const manifest = { id: 'p', config: [{ id: 'on', label: 'x', description: 'x', type: 'boolean', default: false, env: 'P_ON' }, { id: 'n', label: 'x', description: 'x', type: 'number', default: 3, min: 1, max: 5, env: 'P_N' }, { id: 'lvl', label: 'x', description: 'x', type: 'choice', default: 'a', choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }] } as unknown as PluginManifest;
  it('takes the file, then the environment, then the default', () => {
    expect(resolvePluginConfig(manifest, {}, {})).toEqual({ on: false, n: 3, lvl: 'a' });
    expect(resolvePluginConfig(manifest, {}, { P_ON: '1', P_N: '4' })).toEqual({ on: true, n: 4, lvl: 'a' });
    expect(resolvePluginConfig(manifest, { on: false, n: 2, lvl: 'b' }, { P_ON: '1', P_N: '4' })).toEqual({ on: false, n: 2, lvl: 'b' });
  });
  it('ignores a bad environment value but stops on a bad file value or an unknown key', () => {
    expect(resolvePluginConfig(manifest, {}, { P_N: '99' }).n).toBe(3);
    expect(() => resolvePluginConfig(manifest, { n: 99 }, {})).toThrow(ConfigError);
    expect(() => resolvePluginConfig(manifest, { lvl: 'zz' }, {})).toThrow(ConfigError);
    expect(() => resolvePluginConfig(manifest, { nope: 1 }, {})).toThrow(/unknown setting/);
  });
});

describe('loadPlugins', () => {
  it('orders by requires, skips what cannot run, and honours the enabled list', async () => {
    const dir = join(root, 'p');
    make(dir, 'child', { requires: { base: '>=1.0.0' } });
    make(dir, 'base');
    make(dir, 'orphan', { requires: { missing: '>=1.0.0' } });
    make(dir, 'old', { engines: { core: '>=99.0.0' } });
    make(dir, 'cyc-a', { requires: { 'cyc-b': '>=1.0.0' } });
    make(dir, 'cyc-b', { requires: { 'cyc-a': '>=1.0.0' } });
    make(dir, 'broken', {}, 'export default 5;');
    const reg = await loadPlugins({ bundled: null, installed: dir }, {}, quiet());
    expect(reg.plugins.map((p) => p.manifest.id)).toEqual(['base', 'child']);
    const only = await loadPlugins({ bundled: null, installed: dir }, { enabled: 'base' }, quiet());
    expect(only.plugins.map((p) => p.manifest.id)).toEqual(['base']);
    expect((await loadPlugins({ bundled: null, installed: dir }, { enabled: 'none' }, quiet())).plugins).toEqual([]);
  });

  it('starts in order, gives a plugin its dependencies api, and drops one that fails to start', async () => {
    const dir = join(root, 'p');
    make(dir, 'base', {}, 'export default { api: { n: 41 }, start() { globalThis.__order = (globalThis.__order || []).concat("base"); } };');
    make(dir, 'child', { requires: { base: '>=1.0.0' } }, 'export default { start(host) { globalThis.__order = (globalThis.__order || []).concat("child" + (host.plugin("base").n + 1)); } };');
    make(dir, 'bad', {}, 'export default { start() { throw new Error("nope"); } };');
    const reg = await loadPlugins({ bundled: null, installed: dir }, {}, quiet());
    await reg.start({ profile: 'NORMAL', tickRate: 60, dataRoot: root, rooms: { list: () => [], get: () => undefined, on: () => () => {} }, stats: () => ({ rooms: 0, maxRooms: 0, clients: 0, loop: { ticks: 0, overruns: 0, avgStepMs: 0, maxStepMs: 0, avgLagMs: 0, maxLagMs: 0 }, net: { msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0, rejected: 0, droppedFrames: 0 } }), matches: { playedSinceStart: () => 0, recent: () => [] }, profiles: { list: async () => null }, events: new ServerEvents() }, quiet());
    expect((globalThis as { __order?: string[] }).__order).toEqual(['base', 'child42']);
    expect(reg.plugins.map((p) => p.manifest.id)).toEqual(['base', 'child']);
    expect(reg.index().plugins.map((p) => [p.id, p.client])).toEqual([['base', false], ['child', false]]);
    reg.stop();
    delete (globalThis as { __order?: string[] }).__order;
  });

  it('finds the plugin that owns a root route, only once it runs', async () => {
    const dir = join(root, 'p');
    make(dir, 'metrics-x', { rootRoutes: ['/metrics'] }, 'export default { start() {}, http() { return { status: 200, body: "ok" }; } };');
    make(dir, 'plain', {}, 'export default { start() {}, http() { return { status: 200, body: "no" }; } };');
    const reg = await loadPlugins({ bundled: null, installed: dir }, {}, quiet());
    expect(reg.rootRouteOwner('/metrics')).toBeUndefined(); // not started yet
    const rooms = { list: () => [], get: () => undefined, on: () => () => {} };
    const stats = () => ({ rooms: 0, maxRooms: 0, clients: 0, loop: { ticks: 0, overruns: 0, avgStepMs: 0, maxStepMs: 0, avgLagMs: 0, maxLagMs: 0 }, net: { msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0, rejected: 0, droppedFrames: 0 } });
    await reg.start({ profile: 'NORMAL', tickRate: 60, dataRoot: root, rooms, stats, matches: { playedSinceStart: () => 0, recent: () => [] }, profiles: { list: async () => null }, events: new ServerEvents() }, quiet());
    expect(reg.rootRouteOwner('/metrics')).toBe('metrics-x');
    expect(reg.rootRouteOwner('/other')).toBeUndefined();
    reg.stop();
  });

  it('hands virtual player rooms only to plugins that declare the capability, and adapts API 1 plugins', async () => {
    const dir = join(root, 'p');
    const code = (id: string, hook: string) => `export default { start(host) { globalThis.__virtual = Object.assign(globalThis.__virtual || {}, { ${id}: !!host.virtualRooms }); }, ${hook} };`;
    const grouped = 'virtualPlayers: { authorizeJoin() { return { plugin: "x" }; } }';
    make(dir, 'plain', {}, code('plain', grouped));
    make(dir, 'seater', { capabilities: ['virtualPlayers'] }, code('seater', grouped));
    make(dir, 'legacy', { apiVersion: 1 }, code('legacy', 'authorizeJoin() { return { plugin: "old" }; }'));
    const logs: string[] = [];
    const reg = await loadPlugins({ bundled: null, installed: dir }, {}, (m) => logs.push(m));
    const rooms = { list: () => [], get: () => undefined, on: () => () => {} };
    const stats = () => ({ rooms: 0, maxRooms: 0, clients: 0, loop: { ticks: 0, overruns: 0, avgStepMs: 0, maxStepMs: 0, avgLagMs: 0, maxLagMs: 0 }, net: { msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0, rejected: 0, droppedFrames: 0 } });
    await reg.start({ profile: 'NORMAL', tickRate: 60, dataRoot: root, rooms, stats, matches: { playedSinceStart: () => 0, recent: () => [] }, profiles: { list: async () => null }, events: new ServerEvents() }, (m) => logs.push(m));
    const seen = (globalThis as { __virtual?: Record<string, boolean> }).__virtual;
    delete (globalThis as { __virtual?: unknown }).__virtual;
    expect(seen).toEqual({ plain: false, seater: true, legacy: true });
    const room = {} as never;
    expect(reg.authorizeJoin(room, 'plain', { data: {} })).toBe('This plugin cannot be joined from outside');
    expect(reg.authorizeJoin(room, 'seater', { data: {} })).toEqual({ plugin: 'x' });
    expect(reg.authorizeJoin(room, 'legacy', { data: {} })).toEqual({ plugin: 'old' });
    expect(logs.some((m) => m.includes('legacy') && m.includes('plugin API 1'))).toBe(true);
    reg.stop();
  });

  it('lists the pages that plugins draw', async () => {
    const dir = join(root, 'p');
    make(dir, 'pages', { clientRoutes: ['/leaderboard'] });
    make(dir, 'plain');
    const reg = await loadPlugins({ bundled: null, installed: dir }, {}, quiet());
    expect(reg.clientRoutes()).toEqual(['/leaderboard']);
  });

  it('stops startup on an invalid value in the configuration file', async () => {
    const dir = join(root, 'p');
    make(dir, 'cfg', { config: [{ id: 'n', label: 'N', description: 'd', type: 'number', default: 1, min: 0, max: 2 }] });
    await expect(loadPlugins({ bundled: null, installed: dir }, { settings: { cfg: { n: 9 } } }, quiet())).rejects.toThrow(ConfigError);
  });
});
