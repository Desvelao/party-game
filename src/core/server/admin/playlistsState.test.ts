import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OperatorPlaylist } from '../../shared';
import { PlaylistsState } from './playlistsState';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'pg-playlists-'));
  dirs.push(d);
  return join(d, 'playlists.json');
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const round = { game: 'box-bonanza', variant: 'jungle-bonanza', options: {} };
const fromFile: OperatorPlaylist[] = [{ id: 'quick', name: 'Quick', rounds: [round] }];

describe('PlaylistsState', () => {
  it('offers the config file playlists', () => {
    expect(new PlaylistsState(null, fromFile).effective()).toEqual(fromFile);
  });

  it('admin replaces a file playlist, adds new ones, and restore brings the file one back', () => {
    const s = new PlaylistsState(null, fromFile);
    expect(s.put('quick', { name: 'Quick v2', rounds: [round, round] }).ok).toBe(true);
    expect(s.put('mine', { name: 'Mine', rounds: [round] }).ok).toBe(true);
    expect(s.effective().map((p) => [p.id, p.name, p.rounds.length])).toEqual([['quick', 'Quick v2', 2], ['mine', 'Mine', 1]]);
    expect(s.list().find((r) => r.playlist.id === 'quick')).toMatchObject({ source: 'admin', fileVersion: true });
    expect(s.restore('quick')).toBe(true);
    expect(s.effective()[0]).toEqual(fromFile[0]);
  });

  it('deleting hides a file playlist and removes an admin one', () => {
    const s = new PlaylistsState(null, fromFile);
    s.put('mine', { name: 'Mine', rounds: [round] });
    expect(s.remove('quick')).toBe(true);
    expect(s.remove('mine')).toBe(true);
    expect(s.remove('nope')).toBe(false);
    expect(s.effective()).toEqual([]);
    expect(s.list()[0]).toMatchObject({ hidden: true });
    s.restore('quick');
    expect(s.effective()).toEqual(fromFile);
  });

  it('refuses invalid playlists', () => {
    const s = new PlaylistsState(null);
    expect(s.put('a', { name: 'A', rounds: [] }).ok).toBe(false);
    expect(s.put('a', { name: '', rounds: [round] }).ok).toBe(false);
    expect(s.put('bad id!', { name: 'A', rounds: [round] }).ok).toBe(false);
    expect(s.put('a', { name: 'A', rounds: [{ game: 'nope' }] }).ok).toBe(false);
    expect(s.effective()).toEqual([]);
  });

  it('persists admin changes across restarts', async () => {
    const file = tmp();
    const a = new PlaylistsState(file, fromFile);
    a.put('mine', { name: 'Mine', rounds: [round] });
    a.remove('quick');
    await a.flush();
    const b = new PlaylistsState(file, fromFile);
    expect(b.effective().map((p) => p.id)).toEqual(['mine']);
  });
});
