/* Life — service worker. Build 20260916-213631 */
const BUILD = '20260916-213631';
const CACHE = 'empire-' + BUILD;
const SHELL = ['./', './index.html', './quotes.js?v=' + BUILD, './city.js?v=' + BUILD, './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png', './icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => /\.html$|\/$/.test(u) ? new Request(u, { cache: 'reload' }) : u))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// App shell: network first (so updates land on the next open), cache fallback (so it opens offline).
// Everything else (GitHub, Anthropic, fonts): straight to the network.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;
  const put = r => { if (r && r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; };
  // versioned assets (?v=build) never change: cache first
  if (url.searchParams.has('v')) { e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(put))); return; }
  // the page: network first with a short timeout, then cache, so bad signal never means a blank screen
  const net = new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), 4000); fetch(e.request, { cache: 'no-cache' }).then(r => { clearTimeout(t); res(put(r)); }, err => { clearTimeout(t); rej(err); }); });
  e.respondWith(net.catch(() => caches.match(e.request).then(m => m || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});

// Web Push from the reminders workflow
self.addEventListener('push', e => {
  let d = { title: 'Life', body: 'Reminder', tag: 'reminder' };
  try { d = Object.assign(d, e.data ? e.data.json() : {}); } catch (err) { if (e.data) d.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, tag: d.tag, icon: './icon-192.png', badge: './icon-192.png', renotify: true, data: { url: './' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => { const c = list.find(x => 'focus' in x); if (c) return c.focus(); return self.clients.openWindow('./'); }));
});
