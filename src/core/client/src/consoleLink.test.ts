import { describe, expect, it } from 'vitest';
import { consoleStatus, pairConsole, screenInfo } from './consoleLink';

const reply = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('consoleLink', () => {
  it('maps pairing answers', async () => {
    expect(await pairConsole('123456', reply(200, { token: 'abc' }))).toEqual({ ok: true, token: 'abc' });
    expect(await pairConsole('1', reply(401))).toEqual({ ok: false, reason: 'wrong' });
    expect(await pairConsole('1', reply(429))).toEqual({ ok: false, reason: 'many' });
    expect(await pairConsole('1', reply(409))).toEqual({ ok: false, reason: 'notv' });
    expect(await pairConsole('1', reply(404))).toEqual({ ok: false, reason: 'off' });
    expect(await pairConsole('1', (async () => { throw new Error('x'); }) as unknown as typeof fetch)).toEqual({ ok: false, reason: 'net' });
  });
  it('maps the status of a stored token', async () => {
    expect(await consoleStatus('t', reply(200, { roomCode: 'ABCD' }))).toEqual({ state: 'ok', roomCode: 'ABCD' });
    expect(await consoleStatus('t', reply(401))).toEqual({ state: 'unpaired' });
    expect(await consoleStatus('t', reply(404))).toEqual({ state: 'off' });
  });
  it('reads the screen info only when allowed', async () => {
    expect(await screenInfo(reply(200, { pin: '000000', code: 'ABCD' }))).toEqual({ pin: '000000', code: 'ABCD' });
    expect(await screenInfo(reply(403))).toBeNull();
  });
});
