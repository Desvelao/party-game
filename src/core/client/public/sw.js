// Minimal service worker: it exists so the browser offers to install the app. It never caches the game
// (the server decides everything and the client must match its protocol version); the only thing it keeps is
// the "server not reachable" page, shown when opening the app while the server is down.
const CACHE = 'offline-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add('/offline.html')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  // only page loads are handled; the websocket, the API, the game packs, scripts and images go straight to the network
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});
