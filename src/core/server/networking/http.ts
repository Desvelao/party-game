import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

/** `appRoutes`: extra paths (a plugin's pages) that the client router resolves, answered with the app. */
export function createStaticHandler(rootDir: string, appRoutes: () => readonly string[] = () => []) {
  const root = path.resolve(rootDir);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      // client-side routes: the page itself decides what to show
      if (rel === '/profile' || ['/tv', '/console'].includes(rel.replace(/\/$/, '')) || /^\/room\/[^/]+$/.test(rel) || appRoutes().includes(rel.replace(/\/$/, ''))) rel = '/index.html';
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.normalize(path.join(root, rel));
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const data = await readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found (is the client built? run `npm run build`, or use the Vite dev server)');
    }
  };
}

/** `client.mjs` of an installed game pack. A URL carrying the pack's digest never changes, so it caches for good. */
export async function serveGameClient(res: ServerResponse, game: { dir: string; digest: string } | undefined, version: string | null): Promise<void> {
  try {
    if (!game) throw new Error('unknown game');
    const data = await readFile(path.join(game.dir, 'client.mjs'));
    const cache = version === game.digest ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME['.mjs'], 'Cache-Control': cache });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}
