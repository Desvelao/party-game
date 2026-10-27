import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../../shared';
import { Net } from './socket';

type CloseEv = { code: number; reason: string; wasClean: boolean };
const closeEv = (): CloseEv => ({ code: 1006, reason: '', wasClean: false });

class FakeWS {
  static OPEN = 1;
  static last: FakeWS;
  readyState = 0;
  onopen: () => void = () => {};
  onerror: () => void = () => {};
  onclose: (ev: CloseEv) => void = () => {};
  onmessage: () => void = () => {};
  constructor() {
    FakeWS.last = this;
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }
}

const stub = () => {
  vi.stubGlobal('WebSocket', FakeWS);
  vi.stubGlobal('location', { protocol: 'http:', host: 'x' });
  vi.stubGlobal('window', { setInterval: () => 1, clearInterval: () => {} });
};

afterEach(() => vi.unstubAllGlobals());

describe('Net close handling', () => {
  it('does not fire onClose when the first connection never opened', async () => {
    stub();
    const net = new Net();
    const onClose = vi.fn();
    net.onClose = onClose;
    const p = net.connect();
    FakeWS.last.onerror();
    FakeWS.last.onclose(closeEv());
    await expect(p).rejects.toThrow(t('conn.unreachable'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('fires onClose when an opened connection drops', async () => {
    stub();
    const net = new Net();
    const onClose = vi.fn();
    net.onClose = onClose;
    const p = net.connect();
    FakeWS.last.readyState = 1;
    FakeWS.last.onopen();
    await p;
    FakeWS.last.onclose(closeEv());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the previous socket when connect() is called again', async () => {
    stub();
    const net = new Net();
    const onClose = vi.fn();
    net.onClose = onClose;
    const p1 = net.connect();
    const first = FakeWS.last;
    first.readyState = 1;
    first.onopen();
    await p1;
    const p2 = net.connect();
    const second = FakeWS.last;
    expect(first.readyState).toBe(3);
    expect(onClose).not.toHaveBeenCalled();
    second.readyState = 1;
    second.onopen();
    await p2;
    expect(net.connected).toBe(true);
  });
});

describe('Net.checkAlive', () => {
  const open = async (net: Net) => {
    const p = net.connect();
    FakeWS.last.readyState = 1;
    FakeWS.last.onopen();
    await p;
    return FakeWS.last;
  };

  it('treats a socket that never answers the ping as dropped', async () => {
    vi.useFakeTimers();
    stub();
    const net = new Net();
    const onClose = vi.fn();
    net.onClose = onClose;
    await open(net);
    net.checkAlive(1000);
    vi.advanceTimersByTime(1000);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(net.connected).toBe(false);
    vi.useRealTimers();
  });

  it('keeps the connection when a PONG arrives in time', async () => {
    vi.useFakeTimers();
    stub();
    const net = new Net();
    const onClose = vi.fn();
    net.onClose = onClose;
    const ws = await open(net);
    net.checkAlive(1000);
    (ws.onmessage as unknown as (ev: { data: string }) => void)({ data: JSON.stringify({ t: 'PONG', ts: 0 }) });
    vi.advanceTimersByTime(1000);
    expect(onClose).not.toHaveBeenCalled();
    expect(net.connected).toBe(true);
    vi.useRealTimers();
  });
});

