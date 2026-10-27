import { describe, expect, it, vi } from 'vitest';
import { ServerEvents } from './events';

describe('ServerEvents', () => {
  it('calls listeners with the payload and stops after unsubscribe', () => {
    const bus = new ServerEvents();
    const seen: string[] = [];
    const off = bus.on('profileChanged', (e) => seen.push(`${e.profileId}:${e.reason}`));
    bus.emit('profileChanged', () => ({ profileId: 'a', reason: 'edit' }));
    off();
    bus.emit('profileChanged', () => ({ profileId: 'b', reason: 'admin' }));
    expect(seen).toEqual(['a:edit']);
  });

  it('builds no payload when nobody listens', () => {
    const make = vi.fn(() => ({ profileId: 'a', reason: 'edit' as const }));
    new ServerEvents().emit('profileChanged', make);
    expect(make).not.toHaveBeenCalled();
  });

  it('keeps going when a listener throws', () => {
    const bus = new ServerEvents();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: number[] = [];
    bus.on('matchFinished', () => {
      throw new Error('boom');
    });
    bus.on('matchFinished', (m) => seen.push(m.durationSec));
    bus.emit('matchFinished', () => ({ ts: 1, room: 'ABCD', durationSec: 7, games: [] }));
    expect(seen).toEqual([7]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
