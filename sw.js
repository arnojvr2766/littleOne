/* LittleOne service worker.
   Every release changes VERSION (scripts/release.mjs), which makes the browser
   install this worker again, re-download the app shell into a fresh cache and
   tell the open app that an update is ready. */
const VERSION = '2.2.1+2026-11-16T08:04:21Z';
const SHELL = 'shell-' + VERSION;
const MEDIA = 'media-v1';
const SHELL_FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'config.js', 'version.js', 'manifest.webmanifest',
  'assets/logo-mark.png', 'assets/logo-full.webp', 'assets/hero.webp', 'assets/favicon.png',
  'assets/icon-180.png', 'assets/icon-192.png', 'assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the HTTP cache so the new shell is really new.
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('shell-') && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'version') event.source?.postMessage({ version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only same-origin GETs. The data API, photos from storage and shop links go straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;

  if (req.mode === 'navigate') {
    // Page loads: try the network for a fresh page, fall back to the cached shell offline.
    event.respondWith(fetch(req).catch(() => caches.match('index.html', { cacheName: SHELL })));
    return;
  }
  if (url.pathname.includes('/assets/p/')) {
    // Product photos: serve from cache, refresh in the background.
    event.respondWith(caches.open(MEDIA).then(async (c) => {
      const hit = await c.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    }));
    return;
  }
  // App shell files: the cached copy for this version, else the network.
  event.respondWith(caches.match(req, { cacheName: SHELL, ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
