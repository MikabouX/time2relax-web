// Appli « Simulateur » (prix-mobile) : fonctionne aussi hors ligne.
// - Pages et fichiers : réseau d'abord, copie en mémoire sans connexion.
// - Données Supabase (appels « rpc », en POST) : réseau d'abord, la dernière réponse est gardée et resservie hors ligne.
// - Codes postaux : sans connexion, la recherche se fait dans cp.json (liste embarquée).
// - À l'ouverture de l'appli, les prix de tous les mois en ligne sont téléchargés d'avance.
const CACHE = 'prix-mobile-v2';
const DATA = 'prix-mobile-data';
const SB = 'https://gxftbzbvbveocwpdavtt.supabase.co';
const KEY = 'sb_publishable_9fKWGXevueh6hHJpGQvmhg_EFOd_-dR';
const CORE = ['/prix-mobile/', '/prix-mobile/prix/?embed=1', '/prix-mobile/concurrence/', '/prix-mobile/cp.json', '/prix-mobile/manifest.webmanifest',
  '/prix-mobile/icon-192.png', '/prix-mobile/icon-180.png', '/conso-estimation-r8m3/concurrence/cartes.json', '/conso-estimation-r8m3/icon.svg', '/conso-estimation-r8m3/icon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => c.add(new Request(u, { cache: 'no-cache' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE && x !== DATA).map((x) => caches.delete(x)))).then(() => self.clients.claim()).then(() => syncData()));
});

// Clé stable d'un appel rpc : nom de la fonction + paramètres triés
function rpcKey(fn, body) {
  let o = {}; try { o = JSON.parse(body || '{}') || {}; } catch (e) {}
  const k = Object.keys(o).sort().map((x) => x + '=' + JSON.stringify(o[x])).join('&');
  return SB + '/rpc-cache/' + fn + '?' + encodeURIComponent(k);
}
async function rpcFetch(fn, body) {
  const res = await fetch(SB + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: body });
  if (res.ok) { const c = await caches.open(DATA); await c.put(rpcKey(fn, body), res.clone()); }
  return res;
}
// Téléchargement d'avance des données (prix de tous les mois, formules, détails, tarif social)
let syncing = null;
function syncData() {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const r = await rpcFetch('conso_prix_get', JSON.stringify({ p_mois: null }));
      const d = await r.json();
      await Promise.all([rpcFetch('conso_formule_get', '{}'), rpcFetch('conso_detail_get', '{}'), rpcFetch('conso_tarif_social_get', '{}')].map((p) => p.catch(() => {})));
      for (const m of (d.mois_dispo || [])) { await rpcFetch('conso_prix_get', JSON.stringify({ p_mois: m })).catch(() => {}); }
      const t = new Date().toLocaleString('fr-BE', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      (await self.clients.matchAll()).forEach((c) => c.postMessage({ sync: t }));
    } catch (e) { /* hors ligne : on garde l'ancienne copie */ }
    syncing = null;
  })();
  return syncing;
}

// Recherche de codes postaux hors ligne (même logique que conso_cp_search / conso_cp_get)
let CP = null;
async function cpData() {
  if (CP) return CP;
  const r = (await caches.match('/prix-mobile/cp.json')) || (await fetch('/prix-mobile/cp.json'));
  CP = await r.json(); return CP;
}
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
async function cpOffline(fn, body) {
  const d = await cpData(); let o = {}; try { o = JSON.parse(body || '{}'); } catch (e) {}
  if (fn === 'conso_cp_get') {
    const c = +o.p_code, rows = d.g.filter((x) => x[0] === c);
    return { connu: rows.length > 0 || d.n.some((x) => x[0] === c), e: rows.filter((x) => x[1] === 'e').map((x) => x[2]).sort(), g: rows.filter((x) => x[1] === 'g').map((x) => x[2]).sort() };
  }
  const q = norm(o.p_q); if (q.length < 2 || q.length > 60) return [];
  const num = /^[0-9]+$/.test(q);
  const m = d.n.filter((x) => num ? String(x[0]).startsWith(q) : (norm(x[1]).includes(q) || norm(x[2]).startsWith(q))).map((x) => {
    const n = norm(x[1]);
    return { code: x[0], nom: x[1], commune: x[2] && x[2] !== x[1] ? x[2] : null, rk: num ? 0 : n === q ? 0 : n.startsWith(q) ? 1 : 2,
      ord: num ? String(x[0]).padStart(4, '0') + (x[2] ? '1' : '0') + x[1] : x[1] };
  });
  m.sort((a, b) => a.rk - b.rk || (a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : 0) || a.code - b.code);
  return m.slice(0, 12).map((x) => ({ code: x.code, nom: x.nom, commune: x.commune }));
}
const json = (o) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });

self.addEventListener('message', (e) => { if (e.data === 'sync') syncData(); });

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  // Données Supabase
  if (url.origin === SB && req.method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = url.pathname.split('/').pop();
    e.respondWith(req.clone().text().then((body) =>
      fetch(req).then(async (res) => {
        if (res.ok && !/saisir|proposer|avis|visit/.test(fn)) { const c = await caches.open(DATA); await c.put(rpcKey(fn, body), res.clone()); }
        return res;
      }).catch(async () => {
        const hit = await caches.match(rpcKey(fn, body), { cacheName: DATA });
        if (hit) return hit;
        if (fn === 'conso_cp_search' || fn === 'conso_cp_get') return json(await cpOffline(fn, body));
        return new Response(JSON.stringify({ message: 'hors ligne' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      })));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Pages et fichiers du site
  e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(req, c)); }
    return res;
  }).catch(() => caches.match(req, { cacheName: CACHE }).then((r) => r || caches.match(req, { cacheName: CACHE, ignoreSearch: true })
    .then((r2) => r2 || (req.mode === 'navigate' ? caches.match('/prix-mobile/', { cacheName: CACHE }) : undefined)))));
});
