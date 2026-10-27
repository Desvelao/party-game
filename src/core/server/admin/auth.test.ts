import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { AdminAuth } from './auth';

const req = (remote: string, headers: Record<string, string> = {}) =>
  ({ socket: { remoteAddress: remote }, headers }) as unknown as IncomingMessage;
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('AdminAuth', () => {
  it('accepts the admin token and rejects others', () => {
    const a = new AdminAuth({ adminToken: 's3cret', trustProxy: false });
    expect(a.check(req('9.9.9.9', bearer('s3cret'))).ok).toBe(true);
    expect(a.check(req('9.9.9.9', bearer('nope')))).toMatchObject({ ok: false, status: 401 });
    expect(a.check(req('127.0.0.1'))).toMatchObject({ ok: false, status: 401 });
  });

  it('is loopback-only without any token, and not through a proxy header', () => {
    const a = new AdminAuth({ adminToken: '', trustProxy: false });
    expect(a.check(req('127.0.0.1')).ok).toBe(true);
    expect(a.check(req('::1')).ok).toBe(true);
    expect(a.check(req('10.0.0.5'))).toMatchObject({ ok: false, status: 403 });
    expect(a.check(req('127.0.0.1', { 'x-forwarded-for': '10.0.0.5' }))).toMatchObject({ ok: false, status: 403 });
  });

  it('throttles repeated failures per ip, then recovers', () => {
    let t = 0;
    const a = new AdminAuth({ adminToken: 'x', trustProxy: false }, () => t);
    for (let i = 0; i < 10; i++) expect(a.check(req('1.1.1.1', bearer('bad')))).toMatchObject({ status: 401 });
    expect(a.check(req('1.1.1.1', bearer('bad')))).toMatchObject({ ok: false, status: 429 });
    expect(a.check(req('2.2.2.2', bearer('bad')))).toMatchObject({ status: 401 });
    t = 61_000;
    expect(a.check(req('1.1.1.1', bearer('bad')))).toMatchObject({ status: 401 });
  });

  it('lets the real token in from a locked-out address, and keeps counters when flooded', () => {
    const a = new AdminAuth({ adminToken: 'x', trustProxy: false }, () => 0);
    for (let i = 0; i < 10; i++) a.check(req('1.1.1.1', bearer('bad')));
    expect(a.check(req('1.1.1.1', bearer('bad')))).toMatchObject({ status: 429 });
    expect(a.check(req('1.1.1.1', bearer('x'))).ok).toBe(true);
    // many other sources do not wipe the locked address's counter
    for (let i = 0; i < 1500; i++) a.check(req(`2001:db8::${i.toString(16)}`, bearer('bad')));
    expect(a.check(req('1.1.1.1', bearer('bad')))).toMatchObject({ status: 429 });
  });
});
