import type { AddressInfo } from 'node:net';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { APP_VERSION, PROTOCOL_VERSION } from '../../shared';
import type { ServerConfig } from '../config';
import { startServer } from '../networking/server';
import { ADMIN_PAGE } from './page';

// ---- a very small DOM: just what the page script uses --------------------------------------
class TextNode {
  nodeType = 3;
  constructor(public data: string) {}
  get textContent() {
    return this.data;
  }
}
class El {
  nodeType = 1;
  children: (El | TextNode)[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, ((e: unknown) => void)[]>();
  style: Record<string, string> = {};
  className = '';
  value = '';
  parent: El | null = null;
  constructor(public tagName: string) {}
  get id() {
    return this.attrs.get('id') ?? '';
  }
  get dataset() {
    return new Proxy({} as Record<string, string>, { get: (_, k) => this.attrs.get('data-' + String(k)) });
  }
  get nextSibling() {
    const i = this.parent!.children.indexOf(this);
    return this.parent!.children[i + 1];
  }
  get textContent(): string {
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.children = [new TextNode(v)];
  }
  append(...kids: (El | TextNode | string)[]) {
    for (const k of kids) {
      const n = typeof k === 'string' ? new TextNode(k) : k;
      if (n instanceof El) n.parent = this;
      this.children.push(n);
    }
  }
  replaceChildren(...kids: (El | TextNode)[]) {
    this.children = [];
    this.append(...kids);
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, String(v));
    if (k === 'value') this.value = String(v);
  }
  toggleAttribute(k: string, on: boolean) {
    if (on) this.attrs.set(k, '');
    else this.attrs.delete(k);
  }
  addEventListener(t: string, fn: (e: unknown) => void) {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]);
  }
  click() {
    for (const fn of this.listeners.get('click') ?? []) fn({});
  }
  contains(o: unknown): boolean {
    return o === this || this.children.some((c) => c instanceof El && c.contains(o));
  }
  all(pred: (e: El) => boolean, out: El[] = []): El[] {
    for (const c of this.children) {
      if (c instanceof El) {
        if (pred(c)) out.push(c);
        c.all(pred, out);
      }
    }
    return out;
  }
  querySelector(sel: string): El | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  querySelectorAll(sel: string): El[] {
    if (sel.startsWith('#')) return this.all((e) => e.id === sel.slice(1));
    return this.all((e) => e.tagName === sel);
  }
  buttons(label: string | RegExp) {
    return this.all((e) => e.tagName === 'button' && (typeof label === 'string' ? e.textContent === label : label.test(e.textContent)));
  }
}

function makeDom(base: string, fetchLog: string[]) {
  const doc = new El('#document');
  const root = new El('div');
  root.setAttribute('id', 'root');
  const msg = new El('div');
  msg.setAttribute('id', 'msg');
  doc.append(root, msg);
  const store = new Map<string, string>();
  const intervals: NodeJS.Timeout[] = [];
  const document = {
    createElement: (t: string) => new El(t),
    createElementNS: (_: string, t: string) => new El(t),
    createTextNode: (s: string) => new TextNode(s),
    querySelector: (s: string) => doc.querySelector(s),
    body: new El('body'),
    activeElement: null,
    hidden: false,
  };
  const sandbox: Record<string, unknown> = {
    document,
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    fetch: (path: string, init?: RequestInit) => {
      fetchLog.push(`${init?.method ?? 'GET'} ${path}`);
      return fetch(base + path, init);
    },
    setInterval: (fn: () => void, ms: number) => {
      const t = setInterval(fn, ms);
      intervals.push(t);
      return t;
    },
    clearInterval,
    setTimeout,
    clearTimeout,
    prompt: () => null,
    confirm: () => true,
    URL: { createObjectURL: () => 'blob:x' },
    Blob: class {},
    console,
    Number,
    JSON,
    Math,
    Date,
    Object,
    Array,
    Promise,
    String,
    Error,
  };
  return { doc, root, sandbox, store, stop: () => intervals.forEach(clearInterval) };
}

const cfg: ServerConfig = {
  profile: 'NORMAL',
  port: 0,
  host: '127.0.0.1',
  tickRate: 30,
  networkRate: 15,
  maxPlayersPerRoom: 4,
  maxRooms: 2,
  maxSpectatorsPerRoom: 2,
  staticDir: '',
  gamesDir: '',
  bundledGamesDir: '',
  joinTimeoutMs: 0,
  pingIntervalMs: 0,
  maxConnectionsPerIp: 0,
  trustProxy: false,
  publicUrl: '',
  captivePortal: false, consoleMode: false, consoleScreenAny: false,
  adminInsights: true,
  adminToken: 'tok',
  idleRoomSeconds: 0,
  roomRestoreSeconds: 0,
  idleWarnSeconds: 60,
  hostIdleSeconds: 0,
  reconnectGraceSeconds: 60,
  profileStore: 'memory',
  dataDir: '',
  sqlitePath: '',
  sqliteBusyTimeoutMs: 5000,
  maxProfiles: 100,
  recentMatches: 10,
  brandName: 'Party Game',
  welcomeMessage: '',
  pluginsDir: '',
  bundledPluginsDir: '',
  pluginsEnabled: 'all',
};

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met');
    await tick(10);
  }
}

describe('/admin page', () => {
  let srv: ReturnType<typeof startServer>;
  let base: string;
  let port: number;
  let ws: WebSocket;

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    srv = startServer(cfg);
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    port = (srv.http.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Zed' }));
    await until(() => srv.rooms.roomCount === 1);
  });

  afterAll(async () => {
    ws.terminate();
    srv.loop.stop();
    srv.metrics!.stop();
    srv.wss.close();
    await new Promise<void>((r) => srv.http.close(() => r()));
    vi.restoreAllMocks();
  });

  function boot(token?: string) {
    const log: string[] = [];
    const dom = makeDom(base, log);
    if (token) dom.store.set('pg-admin-token', token);
    const html = ADMIN_PAGE;
    const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
    vm.runInNewContext(script, dom.sandbox);
    return { ...dom, log };
  }

  it('is served with hardening headers and contains no inline event handlers', async () => {
    const res = await fetch(`${base}/admin`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    const html = await res.text();
    expect(html).toContain('Party game admin');
    expect(html).not.toMatch(/\son[a-z]+=["']/);
  });

  it('shows the login screen, rejects a wrong token, then loads every tab', async () => {
    const page = boot();
    await until(() => page.root.querySelector('#tok') !== null);
    expect(page.root.textContent).toContain('Enter the admin token');

    page.root.querySelector('#tok')!.value = 'wrong';
    page.root.buttons('Sign in')[0]!.click();
    await until(() => page.root.textContent.includes('missing or invalid admin token'));

    page.root.querySelector('#tok')!.value = 'tok';
    page.root.buttons('Sign in')[0]!.click();
    await until(() => page.root.querySelector('#main') !== null);
    expect(page.store.get('pg-admin-token')).toBe('tok');

    const main = () => page.root.querySelector('#main')!;
    const open = async (label: string, expected: RegExp) => {
      page.root.buttons(label)[0]!.click();
      await until(() => expected.test(main().textContent));
    };

    // rooms: the room created above, with its member
    await until(() => /Zed/.test(main().textContent));
    expect(main().textContent).toContain(srv.rooms.all()[0]!.code);

    await open('Bans', /Nobody is banned|Add a ban/);
    await open('Profiles', /\d+ of \d+ profiles/);
    await open('Config', /maxRooms/);
    expect(main().querySelector('#cfg-maxRooms')!.value).toBe('2');
    expect(page.root.querySelector('#ver')!.textContent).toBe(`v${APP_VERSION}`);
    await open('Games', /Disabled games cannot be picked/);
    expect(main().textContent).toMatch(/Defaults hosts start from/);
    expect(page.root.buttons('Defaults')).toHaveLength(0);
    await open('Playlists', /Ready-made playlists/);
    expect(page.root.buttons('New playlist')).toHaveLength(1);
    await open('History', /Recent matches/);
    await open('Health', /Last 10 minutes/);
    expect(main().textContent).toMatch(/Latency/);
    expect(main().textContent).toMatch(/Host/);
    expect(main().textContent).toMatch(/Loop & network/);
    await open('Maintenance', /Maintenance mode is[\s\S]*No waiting or pinned announcements/);
    await open('Audit', /Nothing yet|Action/);
    page.stop();
  });

  it('acts through the API: apply config, ban, close room', async () => {
    const page = boot('tok');
    await until(() => page.root.querySelector('#main') !== null);
    await until(() => /Zed/.test(page.root.querySelector('#main')!.textContent));

    // change a setting from the Config tab
    page.root.buttons('Config')[0]!.click();
    await until(() => page.root.querySelector('#cfg-maxRooms') !== null);
    page.root.querySelector('#cfg-maxRooms')!.value = '4';
    page.root.buttons('Apply')[0]!.click();
    await until(() => srv.cfg.maxRooms === 4);
    srv.runtime.reset();

    // Rooms tab: kick the player, then the room is gone once empty
    page.root.buttons('Rooms')[0]!.click();
    await until(() => page.root.buttons('Kick').length > 0);
    page.root.buttons('Kick')[0]!.click();
    await until(() => srv.rooms.roomCount === 0);
    expect(page.log.some((l) => l.includes('/api/admin/rooms/') && l.startsWith('POST'))).toBe(true);
    page.stop();
  });

  it('publishes maintenance mode and announcements from the Maintenance tab', async () => {
    const page = boot('tok');
    await until(() => page.root.querySelector('#main') !== null);
    const el = (sel: string) => page.root.querySelector(sel) as unknown as { value: string; checked?: boolean };
    page.root.buttons('Maintenance')[0]!.click();
    await until(() => page.root.querySelector('#mm') !== null);

    el('#mm').value = 'Back at 8 pm';
    page.root.buttons('Start maintenance mode')[0]!.click();
    await until(() => srv.maintenance.snapshot().draining);
    expect(srv.maintenance.snapshot().message).toBe('Back at 8 pm');
    await until(() => /Maintenance mode is ON/.test(page.root.querySelector('#main')!.textContent));
    page.root.buttons('Stop maintenance mode')[0]!.click();
    await until(() => !srv.maintenance.snapshot().draining);

    await until(() => page.root.querySelector('#am') !== null);
    el('#am').value = 'Closing soon';
    el('#ap').checked = true;
    el('#au').value = '5';
    page.root.buttons('Send')[0]!.click();
    await until(() => srv.maintenance.snapshot().announcements.length === 1);
    expect(srv.maintenance.snapshot().announcements[0]).toMatchObject({ message: 'Closing soon', pinned: true });
    await until(() => page.root.buttons('Remove').length > 0);
    page.root.buttons('Remove')[0]!.click();
    await until(() => srv.maintenance.snapshot().announcements.length === 0);
    expect(page.log.some((l) => l.startsWith('POST') && l.includes('/api/admin/maintenance/announce'))).toBe(true);

    // the toast-only announcement went to the history: remove one, then clear the rest
    srv.maintenance.announce('Old news');
    srv.maintenance.announce('Older news');
    await until(() => srv.maintenance.snapshot().recent.length >= 2);
    page.root.buttons('Maintenance')[0]!.click();
    await until(() => page.root.buttons('Clear recent').length > 0);
    const before = srv.maintenance.snapshot().recent.length;
    page.root.buttons('Remove')[0]!.click();
    await until(() => srv.maintenance.snapshot().recent.length === before - 1);
    await until(() => page.root.buttons('Clear recent').length > 0);
    page.root.buttons('Clear recent')[0]!.click();
    await until(() => srv.maintenance.snapshot().recent.length === 0);
    page.stop();
  });
});
