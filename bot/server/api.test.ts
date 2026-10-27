import { describe, expect, it } from 'vitest';
import '../games';
import { AiRouter } from '../router/router';
import { AuditLog } from './audit';
import { DEFAULTS } from './config';
import { AuthGuard, createApi } from './http';
import { BotManager } from './manager';
import { RuntimeConfig } from './runtimeConfig';

function services(token = '') {
  const cfg = structuredClone(DEFAULTS);
  cfg.server.adminToken = token;
  const router = new AiRouter(cfg.ai);
  const bots = new BotManager({ start: () => ({ stop() {}, usage: () => ({ cpu: 0, heapMB: 0, externalMB: 0 }) }) }, cfg);
  let reschedules = 0;
  const runtime = new RuntimeConfig(cfg, null, () => router.catalog(), () => reschedules++);
  const audit = new AuditLog(null);
  const s = {
    cfg, router, bots, runtime, audit, startedAt: Date.now(),
    metrics: { latest: () => null, list: () => [], intervalMs: 3000 },
    watcher: {
      serverUp: true, lastError: '', lastPoll: 0, views: [],
      addBot: async (code: string, level?: string) => (code.toUpperCase() === 'GONE' ? { ok: false, error: 'no such room (it may have closed)' } : code.toUpperCase() === 'FULL' ? { ok: false, error: 'the room is full' } : { ok: true, bot: `Bot ${level ?? 'default'}` }),
      removeBots: (code: string) => (code.toUpperCase() === 'ABCD' ? 2 : 0),
    },
  };
  return { s, reschedules: () => reschedules };
}

async function withApi<T>(token: string, fn: (call: (method: string, path: string, body?: unknown, auth?: string) => Promise<{ status: number; json: any }>, s: ReturnType<typeof services>) => Promise<T>): Promise<T> {
  const sv = services(token);
  const api = createApi(sv.s as never);
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  const port = (api.address() as { port: number }).port;
  const call = async (method: string, path: string, body?: unknown, auth?: string) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    return await fn(call, sv);
  } finally {
    api.close();
  }
}

describe('admin API', () => {
  it('reads, patches and resets the live config, and audits the changes', async () => {
    await withApi('', async (call, sv) => {
      const snap = await call('GET', '/api/config');
      expect(snap.status).toBe(200);
      expect(snap.json.values['join.maxBots']).toBe(8);
      expect(snap.json.restartOnly['server.adminToken']).toBe('(unset)');

      const ok = await call('PATCH', '/api/config', { 'join.maxBots': 2, 'join.pollSeconds': 10 });
      expect(ok.status).toBe(200);
      expect(sv.s.cfg.join.maxBots).toBe(2);
      expect(sv.reschedules()).toBeGreaterThan(0);

      const bad = await call('PATCH', '/api/config', { 'join.maxBots': 3, 'server.port': 1 });
      expect(bad.status).toBe(400);
      expect(bad.json.errors['server.port']).toBe('needs a restart');
      expect(sv.s.cfg.join.maxBots).toBe(2);

      expect((await call('DELETE', '/api/config')).status).toBe(200);
      expect(sv.s.cfg.join.maxBots).toBe(8);

      const audit = await call('GET', '/api/audit');
      expect(audit.json.entries.map((e: { action: string }) => e.action)).toEqual(['config.reset', 'config.set']);
    });
  });

  it('pausing and stopping a bot are audited', async () => {
    await withApi('', async (call) => {
      await call('POST', '/api/pause?paused=1');
      await call('POST', '/api/pause?paused=0');
      const audit = await call('GET', '/api/audit');
      expect(audit.json.entries.map((e: { action: string }) => e.action)).toEqual(['bots.resume', 'bots.pause']);
    });
  });

  it('every api route needs the admin token when one is set', async () => {
    await withApi('s3cret', async (call) => {
      const none = await call('GET', '/api/config');
      expect([none.status, none.json.error]).toEqual([401, 'admin token required']);
      const wrong = await call('GET', '/api/config', undefined, 'wrong');
      expect([wrong.status, wrong.json.error]).toEqual([401, 'bad token']);
      expect((await call('GET', '/api/config', undefined, 's3cret')).status).toBe(200);
      expect((await call('PATCH', '/api/config', { 'join.maxBots': 1 })).status).toBe(401);
      expect((await call('GET', '/api/whoami', undefined, 's3cret')).json.tokenConfigured).toBe(true);
      expect((await call('GET', '/healthz')).status).toBe(200);
    });
  });

  it('blocks an address after 10 wrong tokens', async () => {
    await withApi('s3cret', async (call) => {
      for (let i = 0; i < 10; i++) expect((await call('GET', '/api/config', undefined, 'nope')).status).toBe(401);
      expect((await call('GET', '/api/config', undefined, 'nope')).status).toBe(429);
      expect((await call('GET', '/api/config', undefined, 's3cret')).status).toBe(429);
    });
  });
});

describe('rooms: add and remove bots', () => {
  it('adds a bot with an optional level and audits it, passing the reason back when refused', async () => {
    await withApi('', async (call) => {
      const ok = await call('POST', '/api/rooms/abcd/bot', { level: 'hard' });
      expect([ok.status, ok.json]).toEqual([200, { ok: true, bot: 'Bot hard' }]);
      expect((await call('POST', '/api/rooms/ABCD/bot')).json.bot).toBe('Bot default');
      const full = await call('POST', '/api/rooms/FULL/bot');
      expect([full.status, full.json.error]).toEqual([409, 'the room is full']);
      expect((await call('POST', '/api/rooms/GONE/bot')).status).toBe(404);
      const audit = (await call('GET', '/api/audit')).json.entries.map((e: { action: string; target?: string }) => `${e.action} ${e.target}`);
      expect(audit).toEqual(['bot.add ' + 'Bot default @ ABCD', 'bot.add Bot hard @ ABCD']);
    });
  });

  it('removes the bots of a room', async () => {
    await withApi('', async (call) => {
      expect((await call('POST', '/api/rooms/ABCD/bots/remove')).json).toEqual({ ok: true, removed: 2 });
      expect((await call('POST', '/api/rooms/WXYZ/bots/remove')).status).toBe(404);
    });
  });

  it('needs the admin token', async () => {
    await withApi('s3cret', async (call) => {
      expect((await call('POST', '/api/rooms/ABCD/bot')).status).toBe(401);
      expect((await call('POST', '/api/rooms/ABCD/bot', undefined, 's3cret')).status).toBe(200);
    });
  });
});

describe('AuthGuard', () => {
  const req = (auth?: string) => ({ headers: auth ? { authorization: `Bearer ${auth}` } : {}, socket: { remoteAddress: '10.0.0.9' } }) as never;

  it('counts only wrong tokens, not missing ones, and resets after a minute', () => {
    const g = new AuthGuard(() => 'tok');
    for (let i = 0; i < 20; i++) expect(g.check(req(), 1000).ok).toBe(false);
    expect(g.check(req('tok'), 1000).ok).toBe(true);
    for (let i = 0; i < 10; i++) g.check(req('bad'), 1000);
    expect(g.check(req('tok'), 2000)).toEqual({ ok: false, status: 429, error: 'too many failed attempts' });
    expect(g.check(req('tok'), 1000 + 61_000).ok).toBe(true);
  });
});

describe('dashboard page', () => {
  it('keeps the login form on a 401 instead of replacing it with the error text', async () => {
    const { DASHBOARD_PAGE } = await import('./page');
    // api() shows the login form and throws; render() must recognise that exact error and leave the form alone
    expect(DASHBOARD_PAGE).toContain("showLogin(d.error);throw new Error('unauthorized')");
    expect(DASHBOARD_PAGE).toContain("if(e.message!=='unauthorized')");
  });
});
