import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProgressStore } from './store';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'pgprog-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('ProgressStore', () => {
  it('saves and reloads', () => {
    const dir = tmp();
    const a = new ProgressStore(dir);
    a.ensure('p1').xp = 70;
    a.flush();
    expect(new ProgressStore(dir).get('p1')?.xp).toBe(70);
  });

  it('moves a corrupt file aside and starts empty', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'progression.json'), '{nope');
    const s = new ProgressStore(dir);
    expect(s.size).toBe(0);
    expect(existsSync(join(dir, 'progression.json'))).toBe(false);
    expect(readdirSync(dir).some((f) => f.startsWith('progression.json.corrupt-'))).toBe(true);
  });

  it('without a folder it only keeps memory', () => {
    const s = new ProgressStore(null);
    s.ensure('x');
    s.flush();
    expect(s.size).toBe(1);
    expect(s.delete('x')).toBe(true);
  });
});
