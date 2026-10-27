import type { AdminRoute } from './api';

/** Console mode: the TV's pairing PIN and the phones paired with it. */
export const consoleRoutes: AdminRoute = (ctx, method, path) => {
  if (!path.startsWith('/console')) return false;
  const mgr = ctx.console;
  if (!mgr) return ctx.json(404, { error: 'console mode is off (set CONSOLE_MODE=1)' }), true;
  const snapshot = () => ({ enabled: true, pin: mgr.pin, paired: mgr.paired, roomCode: mgr.roomCode });

  if (path === '/console' && method === 'GET') {
    ctx.json(200, snapshot());
    return true;
  }
  if (path === '/console/pin' && method === 'POST') {
    mgr.newPin();
    ctx.audit.record({ action: 'console.pin', ip: ctx.ip });
    ctx.json(200, snapshot());
    return true;
  }
  if (path === '/console/unpair' && method === 'POST') {
    const n = mgr.unpairAll();
    mgr.newPin();
    ctx.audit.record({ action: 'console.unpair', ip: ctx.ip, detail: { phones: n } });
    ctx.json(200, snapshot());
    return true;
  }
  return false;
};
