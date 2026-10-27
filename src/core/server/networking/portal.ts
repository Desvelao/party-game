import type { IncomingMessage, ServerResponse } from 'node:http';
import { qrSvgMarkup } from '../../shared/qrSvg';

/** Where the join link points: `server.publicUrl`, else the Host the phone used (so `partygame.local` shows up, not an IP). */
export function baseUrl(publicUrl: string, host: string | undefined, tls: boolean): string | null {
  if (publicUrl) return publicUrl;
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return null;
  return `${tls ? 'https' : 'http'}://${host}`;
}

/** The paths phones and laptops probe to find out whether the Wi-Fi has internet; answering them differently opens the sign-in sheet. */
const PROBES = new Set(['/generate_204', '/gen_204', '/hotspot-detect.html', '/library/test/success.html', '/connecttest.txt', '/ncsi.txt', '/success.txt', '/canonical.html']);

const hostName = (host: string | undefined): string => (host ?? '').replace(/:\d+$/, '').toLowerCase();

/** Public `GET /qr/<ROOM>`: the join link of a room as an SVG QR code. Returns true when it answered. */
export function handleQr(pathname: string, publicUrl: string, req: IncomingMessage, res: ServerResponse, tls: boolean): boolean {
  const m = /^\/qr\/([A-Za-z0-9]{1,8})$/.exec(pathname);
  if (!m) return false;
  const base = baseUrl(publicUrl, req.headers.host, tls);
  const svg = base ? qrSvgMarkup(`${base}/room/${m[1]!.toUpperCase()}`) : null;
  if (!svg) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('bad request');
    return true;
  }
  res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=60' });
  res.end(svg);
  return true;
}

/**
 * Captive portal (party-box mode): a probe path, or any request whose Host is not the game's own name or an IP,
 * is redirected to the game so the phone opens it right after joining the Wi-Fi. Returns true when it answered.
 */
export function handlePortal(pathname: string, publicUrl: string, req: IncomingMessage, res: ServerResponse, tls: boolean): boolean {
  const host = hostName(req.headers.host);
  let own = '';
  if (publicUrl) {
    try { own = new URL(publicUrl).hostname.toLowerCase(); } catch { /* bad publicUrl: no own name */ }
  }
  const known = host === '' || host === own || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
  if (!PROBES.has(pathname) && known) return false;
  // unknown names must not redirect to themselves: fall back to the address the phone reached us on
  const local = (req.socket.localAddress ?? '').replace(/^::ffff:/, '');
  const base = publicUrl || (known ? baseUrl('', req.headers.host, tls) : local ? `${tls ? 'https' : 'http'}://${local.includes(':') ? `[${local}]` : local}:${req.socket.localPort}` : null) || '';
  res.writeHead(302, { Location: base + '/', 'Cache-Control': 'no-store' });
  res.end();
  return true;
}
