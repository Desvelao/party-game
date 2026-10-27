import path from 'node:path';
import { existsSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// Dev: browser -> vite (5173) -> proxy /ws, /stats, /rooms, /status, /admin, /api, /games, /plugins -> game server.
const target = process.env.SERVER_TARGET ?? 'http://localhost:8080';
// a self-signed certificate on the dev server (https target) is accepted by the proxy
const secure = false;
// Docker Desktop / WSL / network mounts don't deliver inotify events: poll instead.
const polling = process.env.WATCH_POLLING === '1' || process.env.WATCH_POLLING === 'true';

const allowedHosts = (process.env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);

// Dev source mode (the server runs with DEV_SOURCE=1): the client code of a game or plugin comes straight from
// src/games|plugins/<id>/client/index.ts, which Vite transpiles and reloads on change, instead of the built client.mjs.
const repo = path.resolve(__dirname, '../../..');
function packSources(): Plugin {
  return {
    name: 'pack-sources',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const m = /^\/(games|plugins)\/([a-z0-9][a-z0-9-]*)\/client\.mjs(\?.*)?$/.exec(req.url ?? '');
        if (m) {
          const entry = ['ts', 'js', 'mjs'].map((e) => path.join(repo, 'src', m[1]!, m[2]!, 'client', `index.${e}`)).find(existsSync);
          if (entry) req.url = `/@fs${entry}${m[3] ?? ''}`;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [packSources()],
  root: __dirname,
  build: { outDir: '../../../dist/client', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    // Vite refuses other Host names (partygame.local, the machine's name...): a phone on the LAN gets "Blocked request".
    // ALLOWED_HOSTS=a.local,b.lan limits it to those names; dev server only.
    allowedHosts: allowedHosts.length ? allowedHosts : true,
    // src/core/shared lives outside this root: allow the whole repo explicitly
    fs: { allow: [path.resolve(__dirname, '../../..')] },
    watch: polling ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      '/ws': { target, ws: true, changeOrigin: true, secure },
      '/stats': { target, changeOrigin: true, secure },
      '/rooms': { target, changeOrigin: true, secure },
      '/status': { target, changeOrigin: true, secure },
      '/admin': { target, changeOrigin: true, secure },
      '/api': { target, changeOrigin: true, secure },
      '/games': { target, changeOrigin: true, secure },
      '/plugins': { target, changeOrigin: true, secure },
      '/manifest.webmanifest': { target, changeOrigin: true, secure },
    },
  },
});
