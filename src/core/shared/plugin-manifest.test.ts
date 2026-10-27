import { describe, expect, it } from 'vitest';
import { satisfies, validatePluginManifest } from './plugin-manifest';

const base = { kind: 'plugin', id: 'my-plugin', name: 'My', version: '1.0.0', apiVersion: 1, author: 'a', license: 'MIT', description: 'd', files: { 'server.mjs': 'a'.repeat(64) } };

describe('version ranges', () => {
  it('checks every comparator', () => {
    expect(satisfies('1.2.3', '>=1.0.0')).toBe(true);
    expect(satisfies('1.2.3', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('1.2.4', '=1.2.3')).toBe(false);
    expect(satisfies('1.2.3', '>1.2.3')).toBe(false);
    expect(satisfies('1.2.3', '<=1.2.3')).toBe(true);
  });
  it('rejects ranges it does not understand', () => {
    expect(satisfies('1.0.0', '^1.0.0')).toBe(false);
    expect(satisfies('1.0.0', '')).toBe(false);
    expect(satisfies('1.0', '>=1.0.0')).toBe(false);
  });
});

describe('plugin manifest', () => {
  it('accepts a minimal plugin and one with settings', () => {
    expect(validatePluginManifest(base).ok).toBe(true);
    const full = { ...base, requires: { bots: '>=1.0.0' }, engines: { core: '>=1.0.0' }, config: [{ id: 'level', label: 'L', description: 'd', type: 'choice', default: 'a', choices: [{ value: 'a', label: 'A' }], env: 'MY_LEVEL' }, { id: 'n', label: 'N', description: 'd', type: 'number', default: 2, min: 0, max: 5 }], locales: { es: { Hi: 'Hola' } }, files: { ...base.files, 'client.mjs': 'b'.repeat(64) } };
    expect(validatePluginManifest(full)).toMatchObject({ ok: true });
  });
  it('accepts translations in every language and rejects unknown ones', () => {
    expect(validatePluginManifest({ ...base, locales: { es: { Hi: 'Hola' }, fr: { Hi: 'Salut' }, de: { Hi: 'Hallo' }, pt: { Hi: 'Olá' }, it: { Hi: 'Ciao' } } }).ok).toBe(true);
    expect(validatePluginManifest({ ...base, locales: { xx: { Hi: 'Hi' } } }).ok).toBe(false);
    expect(validatePluginManifest({ ...base, locales: { fr: { Hi: 1 } } }).ok).toBe(false);
  });
  it('accepts root routes that are free, and rejects the ones the server uses', () => {
    expect(validatePluginManifest({ ...base, rootRoutes: ['/metrics', '/health-x'] }).ok).toBe(true);
    for (const bad of [['/api'], ['/stats'], ['metrics'], ['/a/b'], ['/Metrics'], 'metrics', Array.from({ length: 9 }, (_, i) => `/r${i}`)]) {
      expect(validatePluginManifest({ ...base, rootRoutes: bad }).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it('accepts client routes that are free, and rejects the ones the app uses', () => {
    expect(validatePluginManifest({ ...base, clientRoutes: ['/leaderboard'] }).ok).toBe(true);
    for (const bad of [['/profile'], ['/room'], ['/api'], ['leaderboard'], ['/a/b'], '/leaderboard', Array.from({ length: 5 }, (_, i) => `/r${i}`)]) {
      expect(validatePluginManifest({ ...base, clientRoutes: bad }).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it('reports every problem', () => {
    const r = validatePluginManifest({ ...base, kind: 'game', id: 'X', version: '1', apiVersion: 9, requires: { 'Bad Id': '^1' }, engines: { core: 'x' }, config: [{ id: '1x', type: 'nope' }], files: { 'game.json': 'a'.repeat(64) } });
    expect(r.ok).toBe(false);
    const text = !r.ok ? r.errors.join('\n') : '';
    for (const part of ['kind must be', 'id must be', 'version must', 'apiVersion', 'requires', 'engines.core', 'config[0]', 'files lists', 'server.mjs']) expect(text).toContain(part);
  });
  it('needs a server entry and rejects a default outside the choices', () => {
    expect(validatePluginManifest({ ...base, files: {} }).ok).toBe(false);
    expect(validatePluginManifest({ ...base, config: [{ id: 'c', label: 'C', description: 'd', type: 'choice', default: 'z', choices: [{ value: 'a', label: 'A' }] }] }).ok).toBe(false);
  });
  it('accepts the declared capabilities and API 1 or 2, and rejects the rest', () => {
    expect(validatePluginManifest({ ...base, apiVersion: 2, capabilities: ['virtualPlayers'] }).ok).toBe(true);
    for (const bad of [['bots'], 'virtualPlayers', ['virtualPlayers', 'virtualPlayers']]) expect(validatePluginManifest({ ...base, apiVersion: 2, capabilities: bad }).ok, JSON.stringify(bad)).toBe(false);
    expect(validatePluginManifest({ ...base, apiVersion: 3 }).ok).toBe(false);
  });
});

describe('plugin characters', () => {
  const model = { id: 'robot', name: 'Robot', slots: [{ id: 'head', label: 'Head', options: [{ label: 'Round' }, { label: 'Square', swatch: 0xff0000 }], default: 1 }] };
  it('accepts character models and reports bad ones', () => {
    expect(validatePluginManifest({ ...base, characters: [model] }).ok).toBe(true);
    const bad = validatePluginManifest({ ...base, characters: [{ ...model, slots: [{ ...model.slots[0], default: 5 }] }] });
    expect(bad.ok === false && bad.errors.join()).toMatch(/characters\[0\]\.slots\[0\]\.default/);
  });
});
