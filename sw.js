// Permet d'ouvrir la page sans réseau. Toujours le réseau d'abord : une mise à jour
// publiée est visible tout de suite, la copie en mémoire ne sert qu'en secours.
const CACHE = 't2r-v7';
const CORE = [
  './', 'index.html', 'style.css', 'config.js', 'i18n.js', 'store.js', 'theme.js', 'sync.js',
  'timer.js', 'plan.js', 'ui.js', 'main.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('index.html'))),
  );
});
