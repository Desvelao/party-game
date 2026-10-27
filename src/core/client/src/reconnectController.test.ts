import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReconnectController, type ReconnectDeps } from './reconnectController';
import type { ResumeInfo } from './reconnect';

const info: ResumeInfo = { code: 'ABCD', token: 'tok', name: 'Ann' };

function setup(opts: { connected?: boolean; connect?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const net = {
    connected: opts.connected ?? false,
    connect: vi.fn(opts.connect ?? (async () => { net.connected = true; })),
    disconnect: vi.fn(() => calls.push('disconnect')),
    join: vi.fn(),
  };
  const deps = {
    net,
    now: () => Date.now(),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
    showOverlay: vi.fn(),
    onBeginInGame: vi.fn(),
    onJoinAttempt: vi.fn(),
    clearResume: vi.fn(),
    showJoinLink: vi.fn(),
    failToMenu: vi.fn(),
    leaveToMenu: vi.fn(),
    spectateInstead: vi.fn(),
    errorToMenu: vi.fn(),
  } satisfies ReconnectDeps;
  return { net, deps, ctl: createReconnectController(deps) };
}

describe('reconnect controller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('first attempt runs immediately and joins with the token', async () => {
    const { ctl, net, deps } = setup();
    ctl.begin(info, false);
    expect(ctl.active).toBe(true);
    expect(deps.onBeginInGame).toHaveBeenCalled();
    expect(deps.showOverlay).toHaveBeenCalledWith(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(net.connect).toHaveBeenCalled();
    expect(deps.onJoinAttempt).toHaveBeenCalledWith(info);
    expect(net.join).toHaveBeenCalledWith('Ann', 'ABCD', undefined, false, 'tok');
  });

  it('a spectator comes back as a spectator, without a token', async () => {
    const { ctl, net, deps } = setup();
    const watcher: ResumeInfo = { code: 'ABCD', token: '', name: 'TV', spectate: true };
    ctl.begin(watcher, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.onJoinAttempt).toHaveBeenCalledWith(watcher);
    expect(net.join).toHaveBeenCalledWith('TV', 'ABCD', undefined, true, '');
  });

  it('leave stops the attempt, drops the socket and returns to the menu', async () => {
    const { ctl, net, deps } = setup();
    ctl.begin(info, false);
    await vi.advanceTimersByTimeAsync(0);
    ctl.leave();
    expect(ctl.active).toBe(false);
    expect(net.disconnect).toHaveBeenCalled();
    expect(deps.showOverlay).toHaveBeenLastCalledWith(false);
    expect(deps.leaveToMenu).toHaveBeenCalledTimes(1);
    ctl.onClose(); // the close that follows must not start another attempt
    await vi.advanceTimersByTimeAsync(60_000);
    expect(net.join).toHaveBeenCalledTimes(1);
  });

  it('startup attempts skip the in-game hook', async () => {
    const { ctl, deps } = setup();
    ctl.begin(info, true);
    expect(deps.onBeginInGame).not.toHaveBeenCalled();
  });

  it('backs off 0.5s, 1s, 2s between attempts after a socket close', async () => {
    const { ctl, net } = setup({ connected: true });
    ctl.begin(info, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(net.join).toHaveBeenCalledTimes(1);
    ctl.onClose();
    await vi.advanceTimersByTimeAsync(499);
    expect(net.join).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(net.join).toHaveBeenCalledTimes(2);
    ctl.onClose();
    await vi.advanceTimersByTimeAsync(999);
    expect(net.join).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(net.join).toHaveBeenCalledTimes(3);
    ctl.onClose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(net.join).toHaveBeenCalledTimes(4);
  });

  it('success path: stop() clears the overlay and cancels pending timers', async () => {
    const { ctl, deps } = setup();
    ctl.begin(info, false);
    ctl.stop();
    expect(ctl.active).toBe(false);
    expect(deps.showOverlay).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deps.net.connect).not.toHaveBeenCalled();
  });

  it('bails out and disconnects when the user leaves mid-connect', async () => {
    let release!: () => void;
    const { ctl, net, deps } = setup({ connect: () => new Promise<void>((r) => (release = r)) });
    ctl.begin(info, false);
    await vi.advanceTimersByTimeAsync(0);
    ctl.stop();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(net.disconnect).toHaveBeenCalledTimes(1);
    expect(net.join).not.toHaveBeenCalled();
    expect(deps.onJoinAttempt).not.toHaveBeenCalled();
  });

  it('a failing connect schedules the next attempt, then fails after the max attempts', async () => {
    const { ctl, net, deps } = setup({ connect: async () => { throw new Error('down'); } });
    ctl.begin(info, false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(net.connect.mock.calls.length).toBeLessThanOrEqual(12);
    expect(net.connect.mock.calls.length).toBeGreaterThan(3);
    expect(deps.clearResume).toHaveBeenCalled();
    expect(deps.failToMenu).toHaveBeenCalledTimes(1);
    expect(deps.showJoinLink).not.toHaveBeenCalled();
    expect(ctl.active).toBe(false);
  });

  it('startup gives up after 3 attempts and shows the join link', async () => {
    const { ctl, net, deps } = setup({ connect: async () => { throw new Error('down'); } });
    ctl.begin(info, true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(net.connect).toHaveBeenCalledTimes(3);
    expect(deps.showJoinLink).toHaveBeenCalledWith('ABCD');
    expect(deps.failToMenu).not.toHaveBeenCalled();
  });

  describe('handleError', () => {
    it('returns false when no attempt is active', () => {
      const { ctl } = setup();
      expect(ctl.handleError('ROOM_FULL', 'x')).toBe(false);
    });
    it('ROOM_BUSY/ROOM_FULL falls back to spectating', () => {
      const { ctl, deps } = setup();
      ctl.begin(info, false);
      expect(ctl.handleError('ROOM_FULL', 'full')).toBe(true);
      expect(ctl.active).toBe(false);
      expect(deps.clearResume).toHaveBeenCalled();
      expect(deps.spectateInstead).toHaveBeenCalledWith(info, 'ROOM_FULL', 'full');
    });
    it('other codes go to the menu and leave stopping to resetToMenu', () => {
      const { ctl, deps } = setup();
      ctl.begin(info, false);
      expect(ctl.handleError('ROOM_NOT_FOUND', 'nope')).toBe(true);
      expect(deps.errorToMenu).toHaveBeenCalledWith(info, 'ROOM_NOT_FOUND', 'nope');
    });
    it('startup errors give up to the join link', () => {
      const { ctl, deps } = setup();
      ctl.begin(info, true);
      ctl.handleError('ROOM_FULL', 'full');
      expect(deps.showJoinLink).toHaveBeenCalledWith('ABCD');
      expect(deps.clearResume).toHaveBeenCalled();
    });
  });
});
