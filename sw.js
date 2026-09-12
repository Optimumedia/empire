/* Martin's Empire — service worker. Build 20260912-072559 */
const BUILD = '20260912-072559';
const CACHE = 'empire-' + BUILD;
const SHELL = ['./', './index.html', './quotes.js', './city.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// App shell: network first (so updates land on the next open), cache fallback (so it opens offline).
// Everything else (GitHub, Anthropic, fonts): straight to the network.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(m => m || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
