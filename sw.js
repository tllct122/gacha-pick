// Gacha Pick — works offline after the first visit.
const CACHE = 'gacha-pick-v5';
const FILES = ['./', 'index.html', 'machine3d.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // fresh when online, cached when offline (fonts included once loaded)
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && (e.request.url.startsWith(self.location.origin) || e.request.url.includes('fonts.g') || e.request.url.includes('cdn.jsdelivr.net'))) {
      const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./'))));
});
