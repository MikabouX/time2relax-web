'use strict';

/* ---------- Historique en ligne (Supabase), sans bibliothèque et sans mot de passe ----------
   L'historique est rangé sous un nom d'utilisateur : toute personne qui tape le même nom retrouve
   (et peut modifier) le même historique. La table n'est pas accessible directement : seulement par
   trois fonctions SQL (t2r_list, t2r_save, t2r_delete, voir supabase/schema.sql) qui exigent le nom.
   Tant que config.js ne contient ni adresse ni clé, rien de tout cela n'est actif : la page
   fonctionne en local, dans le navigateur. */

const SB = {
  url: String((window.T2R_CONFIG && window.T2R_CONFIG.supabaseUrl) || '').replace(/\/+$/, ''),
  key: String((window.T2R_CONFIG && window.T2R_CONFIG.supabaseKey) || ''),
};
const syncEnabled = () => !!(SB.url && SB.key);

/** fetch + JSON ; lève une erreur avec .status, .code, ou .offline si le réseau est coupé. */
async function sbFetch(url, opts) {
  let r;
  try {
    r = await fetch(url, opts);
  } catch (_) {
    const err = new Error('offline');
    err.offline = true;
    throw err;
  }
  const text = await r.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = text; }
  }
  if (!r.ok) {
    const msg = data && typeof data === 'object' ? (data.message || data.msg || data.error_description) : null;
    const err = new Error(msg || `HTTP ${r.status}`);
    err.status = r.status;
    err.code = data && typeof data === 'object' ? (data.code || data.error_code || '') : '';
    throw err;
  }
  return data;
}

/** Appelle une fonction SQL du projet (POST /rest/v1/rpc/<nom>). */
const rpc = (fn, args, query) => sbFetch(`${SB.url}/rest/v1/rpc/${fn}${query || ''}`, {
  method: 'POST',
  headers: { apikey: SB.key, 'Content-Type': 'application/json' },
  body: JSON.stringify(args),
});

/** Nom d'utilisateur « propre » : espaces nettoyés, sans majuscules (Michaël = michaël). */
const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const validName = (s) => s.length >= 2 && s.length <= 40;

/** Ouvre la session pour ce nom (aucune vérification : le nom est créé au premier envoi). */
function signIn(name) {
  S.session = { username: name };
  store.set('t2r.session', S.session);
  // Ce qui est déjà dans ce navigateur est (ré)envoyé sous ce nom ; l'envoi ne crée jamais de doublon.
  S.deleted = [];
  S.entries.forEach((e) => { e.synced = false; });
  saveEntries();
}

/** Ferme la session : l'historique affiché ici est effacé, il reste enregistré sous le nom. */
function signOut() {
  S.session = null;
  store.remove('t2r.session');
  S.entries = [];
  S.deleted = [];
  S.sync.last = null;
  store.remove('t2r.lastSync');
  saveEntries();
}

const pendingCount = () => S.entries.filter((e) => !e.synced).length + S.deleted.length;

let syncTimer = null;
const scheduleSync = () => {
  if (!syncEnabled() || !S.session) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 700);
};

/** Envoie les suppressions et les nouvelles entrées, puis récupère l'état du serveur. */
async function syncNow() {
  if (!syncEnabled() || !S.session || S.sync.busy) return;
  const who = S.session.username;
  S.sync.busy = true;
  S.sync.error = '';
  onSyncChange();
  try {
    // 1. suppressions
    while (S.deleted.length) {
      const chunk = S.deleted.slice(0, 50);
      await rpc('t2r_delete', { p_username: who, p_ids: chunk });
      S.deleted = S.deleted.filter((id) => !chunk.includes(id));
      saveEntries();
    }
    // 2. nouvelles entrées et modifications (« upsert » côté serveur : renvoyer deux fois la même est sans danger)
    const pending = S.entries.filter((e) => !e.synced);
    for (let i = 0; i < pending.length; i += 200) {
      const part = pending.slice(i, i + 200);
      const rows = part.map((e) => ({ id: e.id, date: e.date, time: e.time, type: e.type, seconds: e.seconds }));
      await rpc('t2r_save', { p_username: who, p_rows: rows });
      // Une entrée modifiée pendant l'envoi reste « à envoyer » : on compare avec ce qui est parti.
      part.forEach((e, idx) => {
        const r = rows[idx];
        if (e.date === r.date && e.time === r.time && e.type === r.type && e.seconds === r.seconds) e.synced = true;
      });
      saveEntries();
    }
    // 3. état du serveur (par pages de 1000)
    const all = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await rpc('t2r_list', { p_username: who }, `?limit=1000&offset=${offset}`);
      all.push(...page);
      if (page.length < 1000) break;
    }
    // Déconnecté (ou autre nom) pendant la synchro : on ne touche plus à l'historique affiché.
    if (!S.session || S.session.username !== who) return;
    const deletedMeanwhile = new Set(S.deleted); // supprimées pendant la synchro, pas encore envoyées
    const stillLocal = S.entries.filter((e) => !e.synced); // ajoutées ou modifiées pendant la synchro
    const localIds = new Set(stillLocal.map((e) => e.id));
    const fromServer = all
      .filter((r) => !deletedMeanwhile.has(r.id) && !localIds.has(r.id))
      .map((r) => ({
        id: r.id, date: r.date, time: String(r.time).slice(0, 5), type: r.type === 'lunch' ? 'lunch' : 'break', seconds: r.seconds, synced: true,
      }));
    S.entries = fromServer.concat(stillLocal);
    sortEntries();
    saveEntries();
    S.sync.last = Date.now();
    store.set('t2r.lastSync', S.sync.last);
  } catch (e) {
    S.sync.error = e.offline ? 'offline' : (e.message || 'error');
  } finally {
    S.sync.busy = false;
    onSyncChange();
    // Quelque chose a changé pendant la synchro (sans erreur) : on repasse tout de suite après.
    if (!S.sync.error && pendingCount() > 0) scheduleSync();
  }
}
