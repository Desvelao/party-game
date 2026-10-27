import { describe, expect, it } from 'vitest';
import type { PluginHost, PluginHttpRequest } from '../../../core/shared';
import plugin from './index';

const KEY = 'a'.repeat(32);

const req = (over: Partial<PluginHttpRequest> = {}): PluginHttpRequest => ({
  kind: 'api',
  method: 'GET',
  path: '/',
  query: {},
  body: {},
  ip: '10.0.0.1',
  admin: () => ({ ok: false, status: 401, error: 'no' }),
  requireAdmin: () => ({ status: 401, body: { error: 'no' } }),
  ...over,
});

describe('transfer plugin', () => {
  it('issues a code for a valid key and redeems it once', async () => {
    plugin.start({} as PluginHost);
    const issued = (await plugin.http!(req({ method: 'POST', body: { key: KEY } })))!;
    expect(issued.status).toBe(200);
    const { code, expiresIn } = issued.body as { code: string; expiresIn: number };
    expect(code).toHaveLength(8);
    expect(expiresIn).toBe(300);
    const got = (await plugin.http!(req({ query: { code: code.toLowerCase() } })))!;
    expect(got).toEqual({ status: 200, body: { key: KEY } });
    expect((await plugin.http!(req({ query: { code } })))!.status).toBe(404);
  });

  it('rejects a missing or bad key, other methods and unknown codes', async () => {
    plugin.start({} as PluginHost);
    expect((await plugin.http!(req({ method: 'POST', body: {} })))!.status).toBe(401);
    expect((await plugin.http!(req({ method: 'POST', body: { key: 'nope' } })))!.status).toBe(401);
    expect((await plugin.http!(req({ method: 'POST', body: null })))!.status).toBe(401);
    expect((await plugin.http!(req({ method: 'DELETE' })))!.status).toBe(405);
    expect((await plugin.http!(req({ query: { code: 'ZZZZ2222' } })))!.status).toBe(404);
    expect(await plugin.http!(req({ path: '/x' }))).toBeUndefined();
    expect(await plugin.http!(req({ kind: 'page' }))).toBeUndefined();
  });

  it('limits calls per address', async () => {
    plugin.start({} as PluginHost);
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await plugin.http!(req({ ip: '10.9.9.9' })))!.status;
    expect(last).toBe(429);
    expect((await plugin.http!(req({ ip: '10.9.9.8' })))!.status).toBe(404);
  });
});
