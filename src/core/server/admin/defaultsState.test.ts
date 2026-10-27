import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { effectiveDefaults, normalizeSelection, optionsFor, setDefaultOverrides } from '../../shared';
import { DefaultsState } from './defaultsState';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'pg-defaults-'));
  dirs.push(d);
  return join(d, 'option-defaults.json');
};
const def = (game: string, variant: string, id: string) => optionsFor(game, variant).find((o) => o.id === id)?.default;

afterEach(() => {
  setDefaultOverrides({});
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('DefaultsState', () => {
  it('uses the built-in default without any layer', () => {
    new DefaultsState(null);
    expect(def('box-bonanza', 'jungle-bonanza', 'timeLimit')).toBe(90);
  });

  it('applies config file defaults; a variant beats its game', () => {
    new DefaultsState(null, { 'box-bonanza': { timeLimit: 120 }, 'jungle-bonanza': { timeLimit: 60 } });
    expect(def('box-bonanza', 'space-bonanza', 'timeLimit')).toBe(120);
    expect(def('box-bonanza', 'jungle-bonanza', 'timeLimit')).toBe(60);
  });

  it('admin wins over the config file and reset falls back to it', () => {
    const s = new DefaultsState(null, { 'jungle-bonanza': { timeLimit: 60 } });
    expect(s.patch('jungle-bonanza', { timeLimit: 150 })).toEqual({ ok: true });
    expect(def('box-bonanza', 'jungle-bonanza', 'timeLimit')).toBe(150);
    s.patch('jungle-bonanza', { timeLimit: null });
    expect(def('box-bonanza', 'jungle-bonanza', 'timeLimit')).toBe(60);
  });

  it('refuses unknown ids, options and out-of-range values', () => {
    const s = new DefaultsState(null);
    expect(s.patch('nope', { timeLimit: 60 }).ok).toBe(false);
    expect(s.patch('jungle-bonanza', { nope: 1 }).ok).toBe(false);
    expect(s.patch('jungle-bonanza', { timeLimit: 9999 }).ok).toBe(false);
    expect(def('box-bonanza', 'jungle-bonanza', 'timeLimit')).toBe(90);
  });

  it('persists admin overrides across restarts', async () => {
    const file = tmp();
    const a = new DefaultsState(file);
    a.patch('jungle-bonanza', { timeLimit: 120 });
    await a.flush();
    setDefaultOverrides({});
    const b = new DefaultsState(file);
    expect(b.layers().admin).toEqual({ 'jungle-bonanza': { timeLimit: 120 } });
    expect(def('box-bonanza', 'jungle-bonanza', 'timeLimit')).toBe(120);
  });

  it('strips selections against the effective default', () => {
    new DefaultsState(null, { 'jungle-bonanza': { timeLimit: 120 } });
    expect(normalizeSelection('box-bonanza', 'jungle-bonanza', { timeLimit: 120 })?.options).toEqual({});
    expect(normalizeSelection('box-bonanza', 'jungle-bonanza', { timeLimit: 90 })?.options).toEqual({ timeLimit: 90 });
    expect(effectiveDefaults('jungle-bonanza', true)).toEqual({ timeLimit: 120 });
  });
});
