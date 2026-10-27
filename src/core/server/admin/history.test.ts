import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MatchRecord } from '../rooms/Room';
import { MatchHistory } from './history';

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const rec = (i: number): MatchRecord => ({
  ts: i,
  room: 'ABCD',
  durationSec: 60,
  games: [{ id: 'g', name: 'G' }],
  ranking: [{ name: `p${i}`, score: i, signedIn: false }],
});

describe('MatchHistory', () => {
  it('compacts the file while running once it exceeds twice the window', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pg-hist-'));
    const file = join(dir, 'match-history.jsonl');
    const h = new MatchHistory(file, 3);
    for (let i = 1; i <= 7; i++) h.record(rec(i));
    await h.flush();
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(lines.map((l) => JSON.parse(l).ts).slice(-3)).toEqual([5, 6, 7]);
    expect(new MatchHistory(file, 3).list().map((m) => m.ts)).toEqual([7, 6, 5]);
  });

  it('keeps the newest matches first and bounded', () => {
    const h = new MatchHistory(null, 3);
    for (let i = 1; i <= 5; i++) h.record(rec(i));
    expect(h.list().map((m) => m.ts)).toEqual([5, 4, 3]);
    expect(h.size).toBe(3);
    expect(h.playedSinceStart).toBe(5);
  });

  it('reloads from its file, skips damaged lines and compacts', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pg-hist-'));
    const file = join(dir, 'match-history.jsonl');
    writeFileSync(file, [rec(1), rec(2), rec(3), rec(4)].map((r) => JSON.stringify(r)).join('\n') + '\n{broken\n');
    const h = new MatchHistory(file, 3);
    expect(h.list().map((m) => m.ts)).toEqual([4, 3, 2]);
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(3);
    h.record(rec(5));
    await h.flush();
    expect(new MatchHistory(file, 3).list().map((m) => m.ts)).toEqual([5, 4, 3]);
  });
});
