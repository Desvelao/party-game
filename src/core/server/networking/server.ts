import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  MAX_MESSAGE_BYTES,
  PROFILE_KEY_RE,
  PROTOCOL_VERSION,
  parseClientMessage,
  sanitizeColor,
  sanitizeLang,
  sanitizeAvatar,
  sanitizeLooks,
  sanitizeName,
  sanitizeControls,
  sanitizeAccessPrefs,
  sanitizeAudioPrefs,
  sanitizeEmoteKeys,
  sanitizeTouchPrefs,
  sanitizePresets,
  rejectedJoinError,
  toInputState,
  type ClientMessage,
  APP_VERSION,
  type DefaultOverrides,
  type OperatorPlaylist,
  type ErrorCode,
  type PluginAdminCheck,
  type ServerMessage,
} from '../../shared';
import type { ServerConfig } from '../config';
import { GameLoop } from '../game/GameLoop';
import { ProfileLimitError, createProfileRepository, isMigratable, profileIdOf, type ProfileRepository } from '../profiles';
import { RoomStore } from '../rooms/roomStore';
import { RoomManager, type RoomSummary } from '../rooms/RoomManager';
import { Client } from './Client';
import { ConnectionCounter, apiLimiter as newApiLimiter, clientIp, isLoopback, messageKind, statsResetAllowed } from './limits';
import { createStaticHandler, serveGameClient } from './http';
import { tlsFiles } from './tls';
import { webManifest } from './manifest';
import { handlePortal, handleQr } from './portal';
import { ConsoleManager, handleConsoleHttp } from '../console';
import { consoleRoutes } from '../admin/console';
import { GameRegistry } from '../plugins/loader';
import { PluginRegistry } from '../plugins/features';
import { ServerEvents } from '../plugins/events';
import { metrics, resetMetrics } from './metrics';
import { NAV_CSS, NAV_SCRIPT, navHtml } from './nav';
import { sampleSystem } from './system';
import { AdminAuth } from '../admin/auth';
import { AuditLog } from '../admin/audit';
import { ReportLog, reportRoutes } from '../admin/reports';
import { createAdminApi } from '../admin/api';
import { BanList } from '../admin/bans';
import { moderationRoutes } from '../admin/moderation';
import { profileRoutes } from '../admin/profiles';
import { settingsRoutes } from '../admin/settings';
import { maintenanceRoutes } from '../admin/maintenance';
import { MaintenanceState } from '../admin/maintenanceState';
import { insightRoutes } from '../admin/insights';
import { ADMIN_PAGE } from '../admin/page';
import { MatchHistory } from '../admin/history';
import { MetricsSampler } from '../admin/timeseries';
import { RuntimeConfig } from '../admin/runtimeConfig';
import { CatalogState } from '../admin/catalogState';
import { DefaultsState } from '../admin/defaultsState';
import { PlaylistsState } from '../admin/playlistsState';

/** longest a shutdown waits for the profile store and the state files to flush before exiting anyway */
const SHUTDOWN_GRACE_MS = 3000;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function roomsPage(list: RoomSummary[], online: number): string {
  const rows = list
    .map((r) => {
      const code = escapeHtml(r.code);
      const status = r.status === 'open' ? `<a class="open" href="/room/${code}">open</a>` : r.locked ? 'locked' : 'playing';
      const lock = r.passwordProtected ? ' &#128274;' : '';
      return `<tr><td>${code}${lock}</td><td>${escapeHtml(r.game)}</td><td>${status}</td><td>${r.players}/${r.maxPlayers}</td></tr>`;
    })
    .join('');
  const body = list.length
    ? `<table><thead><tr><th>Room</th><th>Minigame</th><th>Status</th><th>Players</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p>No rooms right now.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><title>Rooms</title><style>
body{margin:0;padding:24px;background:#1b1033;color:#fff;font:16px system-ui,sans-serif}
h1{color:#ffd23f}table{border-collapse:collapse;width:100%;max-width:640px}
th,td{text-align:left;padding:8px 12px;border-bottom:2px solid #ffd23f55}th{color:#ffd23f}
a.open{color:#1b1033;background:#ffd23f;padding:2px 10px;border-radius:8px;text-decoration:none;font-weight:bold}
${NAV_CSS}${PRESENCE_CSS}</style></head><body>${navHtml('rooms')}${NAV_SCRIPT}<h1>Rooms</h1><span class="presence">${online} online</span>${body}</body></html>`;
}

const PRESENCE_CSS = `.presence{display:inline-flex;align-items:center;gap:8px;padding:4px 12px;margin:0 0 12px;border:3px solid #ffd23f;border-radius:999px;color:#ffd23f;font:800 .85rem ui-rounded,system-ui}.presence::before{content:'';width:9px;height:9px;border-radius:50%;background:#3ddc84}`;

const STATUS_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Server status</title><style>
body{margin:0;padding:24px;background:#1b1033;color:#fff;font:16px system-ui,sans-serif}
h1{color:#ffd23f}
${NAV_CSS}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;max-width:900px}
.tile{background:#2a1a4d;border:2px solid #ffd23f55;border-radius:12px;padding:12px}
.tile b{display:block;font-size:24px}.tile span{opacity:.7;font-size:13px}
#err{color:#ff6b6b}
${PRESENCE_CSS}</style></head><body>${navHtml('status')}${NAV_SCRIPT}<h1>Server status</h1><span class="presence" id="pres"></span><p id="err"></p><div id="root" class="grid">Loading&hellip;</div><script>
const root=document.getElementById('root'),err=document.getElementById('err');
const tile=(l,v)=>'<div class="tile"><span>'+l+'</span><b>'+v+'</b></div>';
const dur=s=>{const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return (d?d+'d ':'')+h+'h '+m+'m'};
async function tick(){
  try{
    const r=await fetch('/status?format=json',{cache:'no-store'});
    const d=await r.json();
    root.innerHTML=tile('Rooms',d.rooms+' / '+d.maxRooms)+tile('Clients',d.clients)+tile('Uptime',dur(d.uptimeSec))+tile('Version',d.version);
    err.textContent='';document.getElementById('pres').textContent=d.clients+' online';
  }catch(e){err.textContent='Cannot reach server'}
}
tick();setInterval(tick,5000);
</script></body></html>`;

/** A slow store must never stall joining: after this the player joins as a guest. */
const PROFILE_LOOKUP_MS = 800;
// presets (up to 20 variants + 20 playlists of 10 rounds) need room
const MAX_PROFILE_BODY = 16384;

export function startServer(config: ServerConfig, deps: { profiles?: ProfileRepository; gameDefaults?: DefaultOverrides; playlists?: OperatorPlaylist[]; games?: GameRegistry; plugins?: PluginRegistry } = {}) {
  // runtime settings change this object in place, so never the caller's copy
  const cfg: ServerConfig = { ...config };
  const profiles = deps.profiles ?? createProfileRepository(cfg);
  const stateFile = (name: string) => (cfg.profileStore === 'memory' ? null : join(cfg.dataDir, name));
  let perIp: ConnectionCounter | null = null;
  const runtime = new RuntimeConfig(cfg, stateFile('runtime-config.json'), () => {
    if (perIp) perIp.limit = cfg.maxConnectionsPerIp;
  });
  const catalog = new CatalogState(stateFile('catalog.json'));
  const maintenance = new MaintenanceState(stateFile('maintenance.json'));
  const defaults = new DefaultsState(stateFile('option-defaults.json'), deps.gameDefaults);
  const playlists = new PlaylistsState(stateFile('playlists.json'), deps.playlists);
  const history = cfg.adminInsights ? new MatchHistory(stateFile('match-history.jsonl')) : undefined;
  const reports = cfg.adminInsights ? new ReportLog(200, stateFile('reports.jsonl')) : undefined;
  const events = new ServerEvents();
  const rooms = new RoomManager(cfg, {
    matchFinished: (m) => {
      history?.record(m);
      events.emit('matchFinished', () => ({ ts: m.ts, room: m.room, durationSec: m.durationSec, games: m.games.map((g) => ({ id: g.id })) }));
    },
    reported: reports && ((r) => reports.record(r)),
    isPlayableEnabled: (id) => catalog.isPlayableEnabled(id),
    checkSelection: (sel) => catalog.check(sel),
    recordResult: (id, delta) => {
      profiles.recordResult(id, delta.match ? { ...delta, keepRecent: cfg.recentMatches } : delta).then(
        () => {
          events.emit('resultRecorded', () => ({ profileId: id, ...(delta.game ? { game: { ...delta.game } } : {}), ...(delta.match ? { match: { score: delta.match.score, won: delta.match.won, ...(delta.match.summary ? { place: delta.match.summary.place, players: delta.match.summary.players } : {}) } } : {}) }));
          events.emit('profileChanged', () => ({ profileId: id, reason: 'result' }));
        },
        (err) => {
          if (!(err instanceof ProfileLimitError)) console.error('[party-game] could not record result', err);
        },
      );
    },
  });
  // open lobbies survive a restart (host settings only, see RoomStore)
  const roomStore = new RoomStore(cfg.roomRestoreSeconds > 0 ? stateFile('rooms.json') : null, cfg.roomRestoreSeconds);
  const restored = rooms.restore(roomStore.load());
  if (restored > 0) console.log(`[party-game] restored ${restored} lobby room(s)`);
  let saveTimer: NodeJS.Timeout | null = null;
  let saving = true;
  const scheduleSave = () => {
    if (!saving || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      roomStore.save(rooms.snapshots());
    }, 2000);
    saveTimer.unref();
  };
  for (const ev of ['created', 'changed', 'closed'] as const) rooms.on(ev, scheduleSave);
  // per-IP budget for the profile API
  const apiLimiter = newApiLimiter();
  const apiAllowed = (ip: string): boolean => apiLimiter.allow(ip);

  const sendJson = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  /** Operator-only flags (shadow ban) never reach the player. */
  function publicProfile<T extends { shadowBanned?: boolean } | null>(rec: T): T {
    if (!rec || rec.shadowBanned === undefined) return rec;
    const { shadowBanned: _hidden, ...rest } = rec;
    return rest as T;
  }

  function handleProfileApi(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void {
    const ip = clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], cfg.trustProxy);
    if (!apiAllowed(ip)) return sendJson(res, 429, { error: 'rate limited' });
    const auth = req.headers.authorization;
    const key = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!PROFILE_KEY_RE.test(key)) return sendJson(res, 401, { error: 'missing or invalid profile key' });
    const id = profileIdOf(key);
    if (req.method === 'GET') {
      profiles.get(id).then(
        (rec) => sendJson(res, 200, { profile: publicProfile(rec) }),
        () => sendJson(res, 500, { error: 'storage error' }),
      );
      return;
    }
    if (req.method !== 'PUT') return sendJson(res, 405, { error: 'method not allowed' });
    let size = 0;
    const chunks: Buffer[] = [];
    let aborted = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_PROFILE_BODY) {
        aborted = true;
        sendJson(res, 413, { error: 'too large' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      let body: any;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return sendJson(res, 400, { error: 'invalid json' });
      }
      if (typeof body !== 'object' || body === null) return sendJson(res, 400, { error: 'invalid body' });
      const patch: Parameters<ProfileRepository['upsert']>[1] = {};
      if (body.name !== undefined) patch.name = sanitizeName(body.name);
      if (body.color !== undefined) patch.color = sanitizeColor(body.color);
      if (body.looks !== undefined) patch.looks = sanitizeLooks(body.looks);
      if (body.avatar !== undefined) patch.avatar = sanitizeAvatar(body.avatar) ?? '';
      const lang = sanitizeLang(body.lang);
      if (lang) patch.lang = lang;
      if (body.presets !== undefined) patch.presets = sanitizePresets(body.presets);
      if (body.controls !== undefined) patch.controls = sanitizeControls(body.controls);
      if (body.touch !== undefined) patch.touch = sanitizeTouchPrefs(body.touch);
      if (body.emoteKeys !== undefined) patch.emoteKeys = sanitizeEmoteKeys(body.emoteKeys);
      if (body.access !== undefined) patch.access = sanitizeAccessPrefs(body.access);
      if (body.audio !== undefined) patch.audio = sanitizeAudioPrefs(body.audio);
      profiles.upsert(id, patch).then(
        (rec) => {
          events.emit('profileChanged', () => ({ profileId: id, reason: 'edit' }));
          sendJson(res, 200, { profile: publicProfile(rec) });
        },
        (err) => sendJson(res, err instanceof ProfileLimitError ? 503 : 500, { error: 'cannot save profile' }),
      );
    });
  }

  const clients = new Map<string, Client>();

  // drain mode and announcements: a player hears about them on connecting and again when they change
  const sendMaintenance = (c: Client): void => {
    const info = maintenance.info();
    if (info.draining || info.banners.length > 0 || info.recent.length > 0) c.send(JSON.stringify({ t: 'MAINTENANCE_STATE', ...info } satisfies ServerMessage));
  };
  let lastMaintenance = JSON.stringify(maintenance.info());
  let leaving = false;
  const processMaintenance = (): void => {
    const { due } = maintenance.tick();
    for (const a of due) {
      const toast = JSON.stringify({ t: 'NOTICE', message: a.message } satisfies ServerMessage);
      for (const c of clients.values()) c.send(toast);
    }
    const info = maintenance.info();
    const json = JSON.stringify(info);
    if (json !== lastMaintenance) {
      lastMaintenance = json;
      const state = JSON.stringify({ t: 'MAINTENANCE_STATE', ...info } satisfies ServerMessage);
      for (const c of clients.values()) c.send(state);
    }
    if (!leaving && maintenance.exitsWhenEmpty && rooms.roomCount === 0) {
      leaving = true;
      console.log('[party-game] drained: no rooms left, shutting down');
      shutdown();
    }
  };
  maintenance.onChange(processMaintenance);
  const maintenanceTimer = setInterval(processMaintenance, 1000);
  maintenanceTimer.unref();
  const games = deps.games ?? new GameRegistry([]);
  const plugins = deps.plugins ?? new PluginRegistry([]);
  rooms.summarize = (room) => plugins.summarize(room);
  const serveStatic = createStaticHandler(cfg.staticDir, () => plugins.clientRoutes());
  // one AdminAuth for /api/admin and the plugins' admin routes: same failure counters and console tokens
  const adminAuth = new AdminAuth(cfg);
  const consoleMgr = cfg.consoleMode ? new ConsoleManager() : undefined;
  if (consoleMgr) adminAuth.setConsole((t) => consoleMgr.validToken(t));
  const pluginHttp = async (req: IncomingMessage, res: ServerResponse, url: URL, kind: 'api' | 'page' | 'root', id: string, path: string): Promise<void> => {
    let body: Record<string, unknown> | null = {};
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > 1024 * 1024) return void req.destroy(); // not a request this server wants to read
        if (size > 16 * 1024) body = null; // too large for the plugin: keep reading (and dropping) so the answer can still be sent
        else chunks.push(c as Buffer);
      }
      if (body) {
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          body = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
        } catch {
          body = null;
        }
      }
    }
    let admin: PluginAdminCheck | null = null;
    const check = (): PluginAdminCheck => (admin ??= adminAuth.check(req));
    const r = await plugins.http(id, {
      kind,
      method: req.method ?? 'GET',
      path,
      query: Object.fromEntries(url.searchParams),
      body,
      ip: adminAuth.ip(req),
      admin: check,
      requireAdmin: () => {
        const a = check();
        return a.ok ? null : { status: a.status, body: { error: a.error } };
      },
    });
    const text = typeof r.body === 'string';
    res.writeHead(r.status, {
      'Content-Type': r.type ?? (text ? 'text/plain; charset=utf-8' : 'application/json'),
      'Cache-Control': 'no-store',
      ...(kind === 'page' ? { 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : text ? (r.body as string) : JSON.stringify(r.body));
  };
  const loop = new GameLoop(cfg.tickRate, (dt) => rooms.update(dt));

  let lastCpu = process.cpuUsage();
  let lastCpuAt = Date.now();

  function stats(reset: boolean) {
    const now = Date.now();
    const cpu = process.cpuUsage(lastCpu);
    const cpuPct = ((cpu.user + cpu.system) / 1000 / Math.max(1, now - lastCpuAt)) * 100;
    const mem = process.memoryUsage();
    const out = {
      profile: cfg.profile,
      tickRate: cfg.tickRate,
      networkRate: cfg.networkRate,
      maxPlayersPerRoom: cfg.maxPlayersPerRoom,
      maxRooms: cfg.maxRooms,
      rooms: rooms.roomCount,
      clients: clients.size,
      loop: loop.stats(reset),
      net: { ...metrics },
      cpuPercent: Math.round(cpuPct * 10) / 10,
      rssMB: Math.round((mem.rss / 1048576) * 10) / 10,
      heapMB: Math.round((mem.heapUsed / 1048576) * 10) / 10,
      windowMs: now - lastCpuAt,
    };
    if (reset) {
      resetMetrics();
      lastCpu = process.cpuUsage();
      lastCpuAt = now;
    }
    return out;
  }

  const sampler = cfg.adminInsights
    ? new MetricsSampler({
        rooms: () => rooms.roomCount,
        clients: () => clients.size,
        loop: () => loop.stats(false),
      })
    : undefined;
  const audit = new AuditLog(500, stateFile('admin-audit.jsonl'));
  const bans = new BanList(stateFile('bans.json'));
  const adminApi = createAdminApi(
    { cfg, auth: adminAuth, console: consoleMgr, audit, reports, bans, rooms, profiles, events, runtime, catalog, maintenance, defaults, playlists, history, metrics: sampler, clients, plugins: () => plugins.plugins.map((p) => ({ id: p.manifest.id, name: p.manifest.name, version: p.manifest.version, http: plugins.hasHttp(p.manifest.id), client: 'client.mjs' in p.manifest.files })), stats: () => stats(false), status: () => ({ ...stats(false), draining: maintenance.isDraining, version: APP_VERSION, system: sampleSystem(), serverTime: Date.now() }) },
    [consoleRoutes, moderationRoutes, profileRoutes, settingsRoutes, maintenanceRoutes, insightRoutes, reportRoutes],
  );

  const tls = tlsFiles(cfg);
  const onRequest = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/stats') {
      let reset = false;
      if (url.searchParams.get('reset') === '1') {
        const auth = req.headers.authorization;
        const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
        const provided = bearer ?? url.searchParams.get('token') ?? undefined;
        const ip = clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], cfg.trustProxy);
        if (!statsResetAllowed(cfg.adminToken, provided, ip, !!req.headers['x-forwarded-for'])) {
          res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end('{"error":"forbidden"}');
          return;
        }
        reset = true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(stats(reset)));
      return;
    }
    if (url.pathname === '/status') {
      if (url.searchParams.get('format') === 'json') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        const st = stats(false);
        // minimal on purpose: the full picture is behind auth in the admin Health tab
        res.end(JSON.stringify({ ok: true, version: APP_VERSION, rooms: st.rooms, maxRooms: st.maxRooms, clients: st.clients, uptimeSec: Math.round(process.uptime()) }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(STATUS_PAGE);
      }
      return;
    }
    if (handleQr(url.pathname, cfg.publicUrl, req, res, !!tls)) return;
    if (consoleMgr && handleConsoleHttp(consoleMgr, cfg, req, res, url.pathname, () => !!(consoleMgr.roomCode && rooms.get(consoleMgr.roomCode)?.screenConnected))) return;
    if (cfg.captivePortal && handlePortal(url.pathname, cfg.publicUrl, req, res, !!tls)) return;
    // top-level paths a plugin asked for in its manifest (`rootRoutes`)
    const rootOwner = plugins.rootRouteOwner(url.pathname);
    if (rootOwner) return void pluginHttp(req, res, url, 'root', rootOwner, url.pathname);
    if (url.pathname === '/api/profile') return handleProfileApi(req, res);
    // installed game packs: the list (catalog + translations) and each pack's client code
    if (url.pathname === '/games/index.json') return sendJson(res, 200, games.index());
    // installed plugins: the list (translations, which have a user interface) and each plugin's client code
    if (url.pathname === '/plugins/index.json') return sendJson(res, 200, plugins.index());
    const pluginCode = /^\/plugins\/([a-z0-9-]+)\/client\.mjs$/.exec(url.pathname);
    if (pluginCode) return void serveGameClient(res, plugins.get(pluginCode[1]), url.searchParams.get('v'));
    // endpoints of installed plugins: the API under /api/<id>/, pages under /plugins/<id>/ (their client.mjs is served above)
    const pluginRoute = /^\/(api|plugins)\/([a-z0-9-]+)(\/.*)?$/.exec(url.pathname);
    if (pluginRoute && plugins.hasHttp(pluginRoute[2]!)) return void pluginHttp(req, res, url, pluginRoute[1] === 'api' ? 'api' : 'page', pluginRoute[2]!, pluginRoute[3] ?? '/');
    const clientCode = /^\/games\/([a-z0-9-]+)\/client\.mjs$/.exec(url.pathname);
    if (clientCode) return void serveGameClient(res, games.get(clientCode[1]), url.searchParams.get('v'));
    if (url.pathname === '/manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(webManifest(cfg.brandName)));
      return;
    }
    if (url.pathname === '/api/rooms') {
      const ip = clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], cfg.trustProxy);
      if (!apiAllowed(ip)) return sendJson(res, 429, { error: 'rate limited' });
      // only rooms the host chose to list, and only while people can still join
      const open = rooms.list().filter((r) => r.public && r.status === 'open').map((r) => ({ code: r.code, game: r.game, players: r.players, maxPlayers: r.maxPlayers, passwordProtected: r.passwordProtected }));
      return sendJson(res, 200, { rooms: open });
    }
    if (url.pathname === '/api/catalog') return sendJson(res, 200, { disabled: catalog.list(), defaults: defaults.effective(), playlists: playlists.effective(), maintenance: maintenance.info(), brand: { name: cfg.brandName, welcomeMessage: cfg.welcomeMessage, publicUrl: cfg.publicUrl } });
    if (url.pathname === '/admin') {
      // the shell holds no data; every call it makes is authenticated
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(ADMIN_PAGE);
      return;
    }
    if (url.pathname.startsWith('/api/admin/')) {
      void adminApi(req, res, url);
      return;
    }
    if (url.pathname === '/rooms') {
      const list = rooms.list();
      const json = url.searchParams.get('format') === 'json';
      res.writeHead(200, {
        'Content-Type': json ? 'application/json' : 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(json ? JSON.stringify(list) : roomsPage(list, clients.size));
      return;
    }
    void serveStatic(req, res);
  };
  // one request handler for both: with TLS the same port serves https and wss
  const http = tls ? createHttpsServer({ cert: tls.cert, key: tls.key }, onRequest) : createHttpServer(onRequest);

  const wss = new WebSocketServer({
    server: http,
    path: '/ws',
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false, // CPU matters more than bandwidth on a Pi
  });

  const capacity = () => cfg.maxRooms * (cfg.maxPlayersPerRoom + cfg.maxSpectatorsPerRoom);

  const ipCounter = new ConnectionCounter(cfg.maxConnectionsPerIp);
  perIp = ipCounter;
  const alive = new WeakSet<WebSocket>();

  // ws-level liveness: terminate sockets that did not answer the previous ping
  const pinger =
    cfg.pingIntervalMs > 0
      ? setInterval(() => {
          for (const ws of wss.clients) {
            if (!alive.has(ws)) {
              ws.terminate();
              continue;
            }
            alive.delete(ws);
            try {
              ws.ping();
            } catch {
              ws.terminate();
            }
          }
        }, cfg.pingIntervalMs)
      : null;
  pinger?.unref();

  wss.on('connection', (ws: WebSocket, req) => {
    // first, so early-return paths below are covered too: an unhandled 'error' would crash the process
    ws.on('error', () => ws.terminate());
    // tell the peer why before the close, so the client can word it instead of showing a bare disconnect
    const refuse = (code: ErrorCode, message: string, closeCode: number, reason: string): void => {
      ws.send(JSON.stringify({ t: 'ERROR', code, message } satisfies ServerMessage), () => {});
      ws.close(closeCode, reason);
    };
    if (clients.size >= capacity()) {
      refuse('SERVER_FULL', 'The server is full', 1013, 'server full');
      return;
    }
    const ip = clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], cfg.trustProxy);
    if (bans.isBanned('ip', ip)) {
      ws.send(JSON.stringify({ t: 'ERROR', code: 'BANNED', message: 'You have been banned from this server', ...bans.describe('ip', ip) } satisfies ServerMessage));
      ws.close(1008, 'banned');
      return;
    }
    if (!ipCounter.acquire(ip)) {
      refuse('TOO_MANY_CONNECTIONS', 'Too many connections from your network', 1013, 'too many connections');
      return;
    }
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    ws.on('message', () => alive.add(ws));
    let id: string;
    do id = randomBytes(3).toString('hex');
    while (clients.has(id));
    const client = new Client(id, ws);
    client.ip = ip;
    clients.set(id, client);
    sendMaintenance(client);

    // must JOIN_ROOM soon after connecting or the slot is reclaimed
    const joinTimer =
      cfg.joinTimeoutMs > 0
        ? setTimeout(() => {
            if (client.roomCode) return;
            sendError('JOIN_TIMEOUT', 'Took too long to join a room');
            ws.close(1008, 'join timeout');
            // a peer that never completes the close handshake must not linger
            setTimeout(() => ws.terminate(), 2000).unref();
          }, cfg.joinTimeoutMs)
        : null;
    joinTimer?.unref();

    const sendError = (code: ErrorCode, message: string) => {
      const msg: ServerMessage = { t: 'ERROR', code, message };
      client.send(JSON.stringify(msg));
    };

    // a throw from room/game code must not take the process down: log it, tell the sender
    const guarded = (fn: () => void): void => {
      try {
        fn();
      } catch (err) {
        console.error(`[party-game] message handler failed for ${id} room=${client.roomCode ?? '-'}`, err);
        sendError('BAD_STATE', 'Internal server error');
      }
    };

    const doJoin = (msg: Extract<ClientMessage, { t: 'JOIN_ROOM' }>): void => {
      // a wrong/expired token falls through to the normal join rules, after telling the player the old seat is gone
      if (msg.resume && msg.code) {
        const target = rooms.get(msg.code);
        if (target?.resume(client, msg.resume)) return;
        if (target) client.send(JSON.stringify({ t: 'NOTICE', message: 'Your seat was released', code: 'SEAT_EXPIRED' } satisfies ServerMessage));
      }
      if (msg.plugin && msg.code) {
        // an outside process seating a virtual player: the plugin decides whether the claim is good
        const target = rooms.get(msg.code);
        if (!target) return sendError('ROOM_NOT_FOUND', `No room ${msg.code}`);
        const seat = plugins.authorizeJoin(target, msg.plugin.id, { token: msg.plugin.token, data: msg.plugin.data });
        if (typeof seat === 'string') return sendError('BAD_STATE', seat);
        const r = target.joinVirtual(client, seat);
        if (!r.ok) sendError(r.code as ErrorCode, r.message);
        return;
      }
      if (msg.screen) {
        // the TV (the kiosk browser on this machine) opens the room it owns, or re-attaches to it after a reload
        if (!consoleMgr) return sendError('BAD_STATE', 'Console mode is off');
        if (!cfg.consoleScreenAny && !isLoopback(client.ip)) return sendError('BAD_STATE', 'Only the screen itself may open a console room');
        let screenRoom = consoleMgr.roomCode ? rooms.get(consoleMgr.roomCode) : undefined;
        if (!screenRoom) {
          if (maintenance.isDraining) return sendError('SERVER_DRAINING', 'The server is closing for maintenance - no new rooms right now');
          screenRoom = rooms.create() ?? undefined;
          if (!screenRoom) return sendError('SERVER_FULL', 'No free rooms on this server');
          consoleMgr.roomCode = screenRoom.code;
        }
        const r = screenRoom.joinScreen(client);
        if (!r.ok) sendError(r.code, r.message);
        return;
      }
      if (msg.spectate && msg.code) {
        const target = rooms.get(msg.code);
        if (!target) return sendError('ROOM_NOT_FOUND', `No room ${msg.code}`);
        // a phone paired with the TV's PIN walks past locks and passwords and becomes the host without a seat
        const controller = !!msg.console && !!consoleMgr?.validToken(msg.console);
        if (msg.console && !controller) return sendError('BAD_STATE', 'This phone is no longer paired with the screen');
        const r = target.joinSpectator(client, msg.password, controller);
        if (!r.ok) {
          sendError(r.code, r.message);
          if (r.code === 'KICKED') client.close(1000, 'kicked');
        } else if (controller) target.claimControl(client);
        return;
      }
      if (!msg.code && maintenance.isDraining) return sendError('SERVER_DRAINING', 'The server is closing for maintenance - no new rooms right now');
      if (!msg.code && msg.selection) {
        // a room is never created on a game the operator switched off (the host is told, not silently switched)
        const refused = catalog.check(msg.selection);
        if (refused) return sendError('GAME_DISABLED', refused);
      }
      const room = msg.code ? rooms.get(msg.code) : rooms.create(msg.selection, msg.password, msg.public === true);
      if (!room) {
        return msg.code
          ? sendError('ROOM_NOT_FOUND', `No room ${msg.code}`)
          : sendError('SERVER_FULL', 'No free rooms on this server');
      }
      if (msg.spectateIfBusy && room.phase !== 'lobby') {
        // typed a code mid-match: watch instead of a dead end (they can take a seat in the next lobby)
        const r = room.joinSpectator(client, msg.password);
        if (!r.ok) {
          sendError(r.code, r.message);
          if (r.code === 'KICKED') client.close(1000, 'kicked');
        }
        return;
      }
      const res = room.join(client, msg.password);
      if (!res.ok) {
        rooms.releaseIfEmpty(room);
        sendError(res.code, res.message);
        if (res.code === 'KICKED') client.close(1000, 'kicked'); // like a kick: the client expects the socket to go
      }
    };

    const onMessage = (data: Parameters<Parameters<WebSocket['on']>[1]>[0], isBinary: boolean): void => {
      if (isBinary) return;
      const raw = data.toString();
      metrics.msgsIn++;
      metrics.bytesIn += raw.length;

      // INPUT is budgeted separately, chosen by a peek at the frame so a throttled flood costs no JSON.parse
      // no ERROR is sent for rate limiting: no existing ErrorCode fits and replying
      // to a flood would be an amplification vector
      if (!client.governor.allow(messageKind(raw))) {
        metrics.rejected++;
        if (client.governor.strike()) {
          sendError('RATE_LIMITED', 'You are sending too many messages');
          client.close(1008, 'rate limit');
        }
        return;
      }
      const msg = parseClientMessage(raw);
      if (!msg) {
        metrics.rejected++;
        const rejectedJoin = rejectedJoinError(raw);
        if (rejectedJoin) sendError(rejectedJoin.code, rejectedJoin.message);
        if (client.governor.strike()) {
          sendError('RATE_LIMITED', 'You are sending too many invalid messages');
          client.close(1008, 'invalid messages');
        }
        return;
      }

      if (msg.t === 'PING') {
        client.send(JSON.stringify({ t: 'PONG', ts: msg.ts } satisfies ServerMessage));
        return;
      }

      if (msg.t === 'JOIN_ROOM') {
        if (client.roomCode || client.joining) return sendError('BAD_STATE', 'Already in a room');
        if (msg.v !== PROTOCOL_VERSION) return sendError('BAD_VERSION', 'Protocol version mismatch');
        client.name = msg.name;
        if (!msg.profileKey) return doJoin(msg);
        // signed-in player: fetch the saved look/colour first (guests fall through unchanged)
        const pid = profileIdOf(msg.profileKey);
        if (bans.isBanned('profile', pid)) {
          client.send(JSON.stringify({ t: 'ERROR', code: 'BANNED', message: 'You have been banned from this server', ...bans.describe('profile', pid) } satisfies ServerMessage));
          client.close(1008, 'banned');
          return;
        }
        client.joining = true;
        const timeout = new Promise<null>((r) => setTimeout(() => r(null), PROFILE_LOOKUP_MS).unref());
        Promise.race([profiles.get(pid), timeout])
          .catch(() => null)
          .then((rec) => {
            client.joining = false;
            client.profileId = pid;
            if (rec) {
              client.looks = rec.looks;
              client.avatar = rec.avatar;
              client.preferredColor = rec.color;
            }
            if (ws.readyState === ws.OPEN) guarded(() => doJoin(msg));
          });
        return;
      }

      const room = client.roomCode ? rooms.get(client.roomCode) : undefined;
      if (!room) return sendError('BAD_STATE', 'Join a room first');
      if (msg.t !== 'INPUT') {
        room.touch();
        room.noteActive(client.id);
      }
      if (msg.t === 'JOIN_AS_PLAYER') {
        const r = room.promote(client);
        if (!r.ok) sendError(r.code, r.message);
        return;
      }
      if (msg.t === 'LEAVE_SEAT') {
        const r = room.demote(client.id);
        if (!r.ok) sendError(r.code, r.message);
        return;
      }
      if (msg.t === 'EMOTE') return room.emote(client.id, msg.emote);
      if (msg.t === 'REPORT') return room.report(client.id, msg.id);
      // spectators only watch: drop every gameplay/lobby intent
      if (room.isSpectator(client.id) && !room.isController(client.id)) return msg.t === 'INPUT' ? undefined : sendError('BAD_STATE', 'Spectators cannot do that');
      switch (msg.t) {
        case 'KICK':
          room.kick(client.id, msg.id);
          break;
        case 'MAKE_HOST':
          room.makeHost(client.id, msg.id);
          break;
        case 'RESET_NAME':
          room.resetName(client.id, msg.id);
          break;
        case 'SET_ROLE':
          room.setRole(client.id, msg.id, msg.spectator);
          break;
        case 'ROOM_SETTINGS':
          room.setSettings(client.id, msg);
          break;
        case 'PLUGIN_ACTION':
          plugins.onAction(room, client.id, msg.plugin, msg.data);
          break;
        case 'SET_TEAM':
          room.setTeam(client.id, msg.team, msg.id);
          break;
        case 'SET_SELECTION':
          room.setSelection(client.id, msg.selection);
          break;
        case 'READY':
          room.setReady(client.id, msg.ready);
          break;
        case 'START_GAME':
          room.startMatch(client.id, msg.force === true);
          break;
        case 'NEXT_GAME':
          room.nextGame(client.id);
          break;
        case 'REMATCH':
          room.rematch(client.id);
          break;
        case 'BACK_TO_LOBBY':
          room.forceLobby(client.id);
          break;
        case 'VOTE_START':
          room.startVote(client.id, msg.kind);
          break;
        case 'VOTE':
          room.castVote(client.id, msg.yes);
          break;
        case 'INPUT':
          room.handleInput(client.id, toInputState(msg));
          break;
        case 'GAME_ACTION':
          room.handleAction(client.id, msg.data);
          break;
      }
    };
    ws.on('message', (data, isBinary) => guarded(() => onMessage(data, isBinary)));

    ws.on('close', (code, reason) => {
      if (joinTimer) clearTimeout(joinTimer);
      if (client.roomCode) {
        const phase = rooms.get(client.roomCode)?.phase ?? '-';
        console.log(`[party-game] close ${id} room=${client.roomCode} phase=${phase} code=${code} reason="${reason.toString()}"`);
      }
      ipCounter.release(ip);
      clients.delete(id);
      const room = client.roomCode ? rooms.get(client.roomCode) : undefined;
      if (room) {
        // client.id, not the connection id: a resumed client carries its seat's id.
        // 1000/1005: the client closed on purpose; 1001 (tab closed/reloaded) and 1006 (network
        // drop) keep a lobby seat for the reconnect grace period
        room.leave(client.id, client, code === 1000 || code === 1005);
        rooms.releaseIfEmpty(room);
      }
    });
  });

  void plugins.start({
    profile: cfg.profile,
    tickRate: cfg.tickRate,
    dataRoot: join(cfg.dataDir, 'plugins-data'),
    rooms: { list: () => rooms.all(), get: (code) => rooms.get(code), on: (event, fn) => rooms.on(event, fn) },
    stats: () => ({ rooms: rooms.roomCount, maxRooms: cfg.maxRooms, clients: clients.size, loop: loop.stats(false), net: { ...metrics } }),
    matches: { playedSinceStart: () => history?.playedSinceStart ?? 0, recent: (limit) => history?.list(limit) ?? [] },
    events,
    profiles: { list: async () => (isMigratable(profiles) ? (await profiles.entries()).map(([, r]) => r) : null) },
  });
  loop.start();
  sampler?.start();
  http.listen(cfg.port, cfg.host, () => {
    console.log(
      `[party-game] profile=${cfg.profile} tick=${cfg.tickRate}Hz net=${cfg.networkRate}Hz ` +
        `rooms<=${cfg.maxRooms} players/room<=${cfg.maxPlayersPerRoom}`,
    );
    console.log(`[party-game] listening on ${tls ? 'https' : 'http'}://${cfg.host}:${cfg.port} (ws path /ws, stats /stats)`);
  });

  const shutdown = () => {
    // save before the sockets close: the closes below may empty rooms, which must not erase the snapshot
    roomStore.save(rooms.snapshots());
    saving = false;
    if (saveTimer) clearTimeout(saveTimer);
    // tell everyone before the sockets go, so clients say "restarting" instead of a silent drop
    const notice = JSON.stringify({ t: 'NOTICE', message: 'The server is restarting', code: 'SERVER_RESTARTING' } satisfies ServerMessage);
    for (const c of clients.values()) {
      c.send(notice);
      c.close(1001, 'server restarting');
    }
    loop.stop();
    plugins.stop();
    sampler?.stop();
    if (pinger) clearInterval(pinger);
    clearInterval(maintenanceTimer);
    wss.close();
    // let the fire-and-forget state files reach the disk before exiting (a failed one is logged by its owner)
    const pending = [roomStore, bans, runtime, catalog, maintenance, defaults, playlists, audit, history, reports].map((s) => s?.flush());
    void Promise.allSettled([profiles.close(), ...pending]).then(() => http.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { http, wss, rooms, loop, profiles, audit, bans, runtime, catalog, maintenance, defaults, playlists, history, metrics: sampler, cfg };
}
