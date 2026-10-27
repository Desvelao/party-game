import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SELECTION } from '../../shared';
import type { RoomSnapshot } from './Room';
import { RoomStore } from './roomStore';

const snap = (code: string, over: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
  code,
  selection: DEFAULT_SELECTION,
  requestedMax: 8,
  locked: false,
  lateJoin: false,
  teams: false,
  public: true,
  savedAt: 0,
  ...over,
});
const tmp = () => join(mkdtempSync(join(tmpdir(), 'rooms-')), 'rooms.json');

describe('RoomStore', () => {
  it('round-trips lobbies through the file', async () => {
    const file = tmp();
    const store = new RoomStore(file, 900, () => 1000);
    store.save([snap('ABCD', { locked: true })]);
    await store.flush();
    const back = new RoomStore(file, 900, () => 2000).load();
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ code: 'ABCD', locked: true, public: true, savedAt: 1000 });
  });

  it('drops entries older than the TTL', async () => {
    const file = tmp();
    const store = new RoomStore(file, 10, () => 0);
    store.save([snap('ABCD')]);
    await store.flush();
    expect(new RoomStore(file, 10, () => 9_000).load()).toHaveLength(1);
    expect(new RoomStore(file, 10, () => 11_000).load()).toHaveLength(0);
  });

  it('ignores a corrupt or missing file and malformed entries', () => {
    const file = tmp();
    expect(new RoomStore(file, 900).load()).toEqual([]);
    writeFileSync(file, '{nope');
    expect(new RoomStore(file, 900).load()).toEqual([]);
    writeFileSync(file, JSON.stringify({ rooms: [{ code: 'x', savedAt: Date.now() }, null, { code: 'ABCD', savedAt: Date.now(), requestedMax: 4, selection: { game: 'nope-game', variant: 'x', options: {} } }] }));
    expect(new RoomStore(file, 900).load()).toEqual([]);
  });

  it('writes nothing without a file, and skips an unchanged snapshot', async () => {
    const none = new RoomStore(null, 900);
    none.save([snap('ABCD')]);
    expect(none.load()).toEqual([]);
    const file = tmp();
    let now = 1;
    const store = new RoomStore(file, 900, () => now);
    store.save([snap('ABCD')]);
    await store.flush();
    now = 5;
    store.save([snap('ABCD')]);
    await store.flush();
    expect(JSON.parse(readFileSync(file, 'utf8')).rooms[0].savedAt).toBe(1);
  });
});
