import type { Client } from '../networking/Client';
import type { AdminContext, AdminRoute } from './api';
import type { BanKind } from './bans';

export const MAX_NOTICE = 200;
const CODE_RE = /^[A-Z0-9]{3,8}$/;

export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Minutes from the body: a positive number up to a year, else 0 (= until lifted). */
function minutesOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 525_600) : 0;
}

/** Removes everyone matching a fresh ban from their rooms (or just drops the socket). */
function evict(ctx: AdminContext, match: (c: Client) => boolean, why: { reason?: string; minutes?: number } = {}): number {
  let n = 0;
  for (const c of ctx.clients.values()) {
    if (!match(c)) continue;
    n++;
    const room = c.roomCode ? ctx.rooms.get(c.roomCode) : undefined;
    if (room?.adminKick(c.id, 'BANNED', why)) {
      ctx.rooms.releaseIfEmpty(room);
      continue;
    }
    c.send(JSON.stringify({ t: 'ERROR', code: 'BANNED', message: 'You have been banned from this server', ...(why.reason ? { reason: why.reason } : {}), ...(why.minutes ? { minutes: why.minutes } : {}) }));
    c.close(1008, 'banned');
  }
  return n;
}

function banTarget(ctx: AdminContext, kind: BanKind, value: string, reason: string, minutes: number) {
  const entry = ctx.bans.add(kind, value, { reason, minutes });
  if (entry) ctx.audit.record({ action: 'ban', target: `${kind}:${value}`, ip: ctx.ip, detail: { reason, minutes } });
  return entry;
}

/** Live rooms, connected clients and the ban list. */
export const moderationRoutes: AdminRoute = async (ctx, method, path) => {
  if (method === 'GET' && path === '/rooms') {
    const now = Date.now();
    // operators also see how old and how idle each room is; `?idleOver=N` keeps the ones idle for N seconds or more
    const idleOver = Number(ctx.url.searchParams.get('idleOver'));
    const rooms = ctx.rooms.list().map((r) => {
      const room = ctx.rooms.get(r.code)!;
      return { ...r, idleSeconds: Math.floor(room.idleSeconds), ageSeconds: Math.floor((now - room.createdAt) / 1000) };
    });
    ctx.json(200, { rooms: idleOver > 0 ? rooms.filter((r) => r.idleSeconds >= idleOver) : rooms });
    return true;
  }
  if (method === 'GET' && path === '/clients') {
    ctx.json(200, {
      clients: [...ctx.clients.values()].map((c) => ({
        id: c.id,
        name: c.name,
        ip: c.ip,
        room: c.roomCode,
        profileId: c.profileId,
        banned: ctx.bans.isBanned('ip', c.ip) || ctx.bans.isBanned('profile', c.profileId),
      })),
    });
    return true;
  }
  if (method === 'POST' && path === '/broadcast') {
    const body = await ctx.body();
    if (!body) return true;
    const message = cleanText(body.message, MAX_NOTICE);
    if (!message) return ctx.json(400, { error: 'message required' }), true;
    const rooms = ctx.rooms.all();
    for (const r of rooms) r.adminNotice(message);
    ctx.audit.record({ action: 'broadcast', ip: ctx.ip, detail: { message, rooms: rooms.length } });
    ctx.json(200, { ok: true, rooms: rooms.length });
    return true;
  }

  const roomMatch = /^\/rooms\/([A-Za-z0-9]+)(?:\/([a-z]+))?$/.exec(path);
  if (roomMatch) {
    const code = roomMatch[1]!.toUpperCase();
    const action = roomMatch[2];
    if (!CODE_RE.test(code)) return ctx.json(400, { error: 'invalid room code' }), true;
    const room = ctx.rooms.get(code);
    if (!room) return ctx.json(404, { error: 'no such room' }), true;

    if (method === 'GET' && !action) {
      const summary = ctx.rooms.list().find((r) => r.code === code);
      ctx.json(200, { room: summary, members: room.adminMembers() });
      return true;
    }
    if (method !== 'POST' || !action) return false;
    const body = await ctx.body();
    if (!body) return true;

    switch (action) {
      case 'close':
        ctx.rooms.closeRoom(code);
        ctx.audit.record({ action: 'room.close', target: code, ip: ctx.ip });
        ctx.json(200, { ok: true });
        return true;
      case 'lock': {
        const locked = body.locked === undefined ? true : body.locked === true;
        room.adminSetLocked(locked);
        ctx.audit.record({ action: locked ? 'room.lock' : 'room.unlock', target: code, ip: ctx.ip });
        ctx.json(200, { ok: true, locked });
        return true;
      }
      case 'broadcast': {
        const message = cleanText(body.message, MAX_NOTICE);
        if (!message) return ctx.json(400, { error: 'message required' }), true;
        room.adminNotice(message);
        ctx.audit.record({ action: 'room.broadcast', target: code, ip: ctx.ip, detail: { message } });
        ctx.json(200, { ok: true });
        return true;
      }
      case 'host': {
        const id = str(body.id);
        if (!room.adminMakeHost(id)) return ctx.json(404, { error: 'no such connected player' }), true;
        ctx.audit.record({ action: 'room.host', target: `${code}/${id}`, ip: ctx.ip });
        ctx.json(200, { ok: true });
        return true;
      }
      case 'rename': {
        const id = str(body.id);
        if (!room.adminResetName(id)) return ctx.json(404, { error: 'no such player' }), true;
        ctx.audit.record({ action: 'room.rename', target: `${code}/${id}`, ip: ctx.ip });
        ctx.json(200, { ok: true });
        return true;
      }
      case 'kick': {
        const id = str(body.id);
        const member = room.adminMembers().find((m) => m.id === id);
        if (!member) return ctx.json(404, { error: 'no such player' }), true;
        const banProfile = body.ban === true;
        const banIp = body.banIp === true;
        const reason = cleanText(body.reason, 200);
        const minutes = minutesOf(body.minutes);
        const ip = member.ip;
        const profileId = member.profileId;
        // what was actually banned: the ban list can be full, and a member may have no profile or address
        const bannedKinds: BanKind[] = [];
        let banFailed = false;
        const tryBan = (kind: BanKind, value: string) => {
          if (banTarget(ctx, kind, value, reason, minutes)) bannedKinds.push(kind);
          else banFailed = true;
        };
        // a signed-in player is banned by profile (shared Wi-Fi stays unaffected) unless the IP is asked for
        if (profileId && banProfile) tryBan('profile', profileId);
        if (ip && (banIp || (banProfile && !profileId))) tryBan('ip', ip);
        const banned = bannedKinds.length > 0;
        // the operator's reason is shown even when the player is only removed, not banned
        const why = { ...(reason ? { reason } : {}), ...(banned && minutes ? { minutes } : {}) };
        room.adminKick(id, banned ? 'BANNED' : 'KICKED', why);
        ctx.rooms.releaseIfEmpty(room);
        ctx.audit.record({
          action: banned ? 'room.kick+ban' : 'room.kick',
          target: `${code}/${id}`,
          ip: ctx.ip,
          detail: { name: member.name, ...(banProfile || banIp ? { reason, minutes, banned: bannedKinds, banFailed } : {}) },
        });
        // other sockets of a freshly banned player/IP go too
        if (banned) {
          evict(ctx, (c) => (bannedKinds.includes('ip') && !!ip && c.ip === ip) || (bannedKinds.includes('profile') && !!profileId && c.profileId === profileId), why);
        }
        ctx.json(200, { ok: true, banned, ...(banFailed ? { banFailed: true } : {}) });
        return true;
      }
    }
    return false;
  }

  if (path === '/bans') {
    if (method === 'GET') {
      ctx.json(200, { bans: ctx.bans.list() });
      return true;
    }
    if (method === 'POST') {
      const body = await ctx.body();
      if (!body) return true;
      const ip = str(body.ip);
      const profileId = str(body.profileId);
      if ((ip ? 1 : 0) + (profileId ? 1 : 0) !== 1) return ctx.json(400, { error: 'give exactly one of ip, profileId' }), true;
      const kind: BanKind = ip ? 'ip' : 'profile';
      const value = ip || profileId;
      if (value.length > 128) return ctx.json(400, { error: 'value too long' }), true;
      if (kind === 'ip' && value === ctx.ip) return ctx.json(400, { error: 'refusing to ban the address you are using' }), true;
      const entry = banTarget(ctx, kind, value, cleanText(body.reason, 200), minutesOf(body.minutes));
      if (!entry) return ctx.json(409, { error: 'ban list is full' }), true;
      const evicted = evict(ctx, (c) => (kind === 'ip' ? c.ip === value : c.profileId === value));
      ctx.json(200, { ok: true, ban: entry, evicted });
      return true;
    }
    if (method === 'DELETE') {
      const ip = ctx.url.searchParams.get('ip');
      const profileId = ctx.url.searchParams.get('profileId');
      if ((ip ? 1 : 0) + (profileId ? 1 : 0) !== 1) return ctx.json(400, { error: 'give exactly one of ip, profileId' }), true;
      const kind: BanKind = ip ? 'ip' : 'profile';
      const value = (ip ?? profileId)!;
      const had = ctx.bans.remove(kind, value);
      if (had) ctx.audit.record({ action: 'unban', target: `${kind}:${value}`, ip: ctx.ip });
      ctx.json(had ? 200 : 404, had ? { ok: true } : { error: 'not banned' });
      return true;
    }
  }
  return false;
};
