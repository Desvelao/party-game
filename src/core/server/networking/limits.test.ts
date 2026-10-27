import { describe, expect, it } from 'vitest';
import {
  BUCKET_CAPACITY,
  ConnectionCounter,
  INPUT_BUCKET_CAPACITY,
  MAX_STRIKES,
  MessageGovernor,
  clientIp,
  messageKind,
  statsResetAllowed,
} from './limits';

describe('ConnectionCounter', () => {
  it('caps per ip and frees slots on release', () => {
    const c = new ConnectionCounter(2);
    expect(c.acquire('a')).toBe(true);
    expect(c.acquire('a')).toBe(true);
    expect(c.acquire('a')).toBe(false);
    expect(c.acquire('b')).toBe(true);
    c.release('a');
    expect(c.acquire('a')).toBe(true);
  });

  it('0 means unlimited', () => {
    const c = new ConnectionCounter(0);
    for (let i = 0; i < 1000; i++) expect(c.acquire('a')).toBe(true);
  });
});

describe('clientIp', () => {
  it('uses the peer unless the proxy is trusted', () => {
    expect(clientIp('1.1.1.1', '2.2.2.2, 3.3.3.3', false)).toBe('1.1.1.1');
    expect(clientIp('1.1.1.1', '2.2.2.2, 3.3.3.3', true)).toBe('3.3.3.3');
    expect(clientIp('1.1.1.1', ['9.9.9.9', '3.3.3.3'], true)).toBe('3.3.3.3');
    expect(clientIp('1.1.1.1', '2.2.2.2, ', true)).toBe('1.1.1.1');
    expect(clientIp('1.1.1.1', '', true)).toBe('1.1.1.1');
    expect(clientIp('1.1.1.1', undefined, true)).toBe('1.1.1.1');
  });
});

describe('clientIp spoofing', () => {
  it('ignores a client-supplied leading X-Forwarded-For entry', () => {
    expect(clientIp('10.0.0.1', '127.0.0.1, 203.0.113.7', true)).toBe('203.0.113.7');
  });
});

describe('messageKind', () => {
  it('charges INPUT frames to the input budget and everything else to the general one, without parsing', () => {
    expect(messageKind(JSON.stringify({ t: 'INPUT', seq: 1, mx: 0, my: 0, a1: false, a2: false }))).toBe('input');
    expect(messageKind('{"t":"PING","ts":1}')).toBe('other');
    expect(messageKind('not json')).toBe('other');
  });
});

describe('MessageGovernor', () => {
  it('lets a sustained 60Hz INPUT stream plus PING/READY through', () => {
    let t = 0;
    const g = new MessageGovernor(() => t);
    for (let i = 0; i < 60 * 30; i++) {
      t += 1000 / 60;
      expect(g.allow('input')).toBe(true);
      if (i % 30 === 0) expect(g.allow('other')).toBe(true);
    }
  });

  it('input floods do not consume the general budget', () => {
    const g = new MessageGovernor(() => 0);
    for (let i = 0; i < INPUT_BUCKET_CAPACITY; i++) g.allow('input');
    expect(g.allow('input')).toBe(false);
    expect(g.allow('other')).toBe(true);
  });

  it('a burst of garbage is cut off quickly', () => {
    const g = new MessageGovernor(() => 0);
    let sent = 0;
    let closed = false;
    while (!closed && sent < 10_000) {
      sent++;
      if (!g.allow('other')) closed = g.strike();
    }
    expect(closed).toBe(true);
    expect(sent).toBe(BUCKET_CAPACITY + MAX_STRIKES + 1);
  });

  it('strikes decay with good behaviour', () => {
    let t = 0;
    const g = new MessageGovernor(() => t);
    for (let i = 0; i < MAX_STRIKES; i++) expect(g.strike()).toBe(false);
    t += 60_000; // 30 strikes drain
    for (let i = 0; i < 30; i++) expect(g.strike()).toBe(false);
    expect(g.strike()).toBe(true);
  });
});

describe('statsResetAllowed', () => {
  it('without a token only loopback may reset', () => {
    expect(statsResetAllowed('', undefined, '127.0.0.1')).toBe(true);
    expect(statsResetAllowed('', undefined, '::1')).toBe(true);
    expect(statsResetAllowed('', undefined, '::ffff:127.0.0.1')).toBe(true);
    expect(statsResetAllowed('', 'x', '10.0.0.5')).toBe(false);
    expect(statsResetAllowed('', undefined, 'unknown')).toBe(false);
  });
  it('without a token a proxied request is not local, even from loopback', () => {
    expect(statsResetAllowed('', undefined, '127.0.0.1', true)).toBe(false);
    expect(statsResetAllowed('', undefined, '127.0.0.1', false)).toBe(true);
    expect(statsResetAllowed('s3cret', 's3cret', '127.0.0.1', true)).toBe(true);
  });
  it('with a token the exact token is required from anywhere', () => {
    expect(statsResetAllowed('s3cret', 's3cret', '10.0.0.5')).toBe(true);
    expect(statsResetAllowed('s3cret', 'wrong', '127.0.0.1')).toBe(false);
    expect(statsResetAllowed('s3cret', undefined, '127.0.0.1')).toBe(false);
    expect(statsResetAllowed('s3cret', '', '127.0.0.1')).toBe(false);
  });
});
