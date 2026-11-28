// Appli « Simulateur » (prix-mobile) : réseau d'abord, la copie en mémoire ne sert que sans connexion.
const CACHE = 'prix-mobile-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/prix-mobile/', '/prix-mobile/manifest.webmanifest', '/prix-mobile/icon-192.png'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put(req, c)); return res; })
    .catch(() => caches.match(req).then((r) => r || caches.match('/prix-mobile/'))));
});
