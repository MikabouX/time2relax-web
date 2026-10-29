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
const rpc = (fn, args, query, signal) => sbFetch(`${SB.url}/rest/v1/rpc/${fn}${query || ''}`, {
  method: 'POST',
  headers: { apikey: SB.key, 'Content-Type': 'application/json' },
  body: JSON.stringify(args),
  signal,
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
  startRunPolling(); // suit (et annonce) le chrono en cours
}

/** Ferme la session : l'historique affiché ici est effacé, il reste enregistré sous le nom. */
function signOut() {
  stopRunPolling();
  if (S.run && S.run.pushed) { S.run.pushed = false; saveRun(); } // le chrono ici reste local
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
    // Le serveur refuse plus de 24 h (anciennes entrées d'un chrono oublié) : on ramène à 24 h.
    pending.forEach((e) => { if (e.seconds > 86400) e.seconds = 86400; });
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

/* ---------- Chrono partagé : un seul chrono en cours par nom, suivi depuis tous les appareils ----------
   Le serveur garde le chrono en cours (identifiant, type, durée prévue, temps déjà écoulé, calculé avec
   SON horloge : les appareils n'ont pas besoin d'avoir la même heure). Chaque appareil connecté le
   relit toutes les quelques secondes. Si les fonctions « t2r_run_* » n'existent pas encore dans le
   projet (SQL pas encore collé), tout continue de marcher comme avant, en local. */

const RUN_TIMEOUT = 8000;
const runApi = { ok: true, retryAt: 0 };
let runBusy = false;
let stopped = store.get('t2r.stopped', []); // chronos terminés ici dont le serveur n'est peut-être pas au courant
if (!Array.isArray(stopped)) stopped = [];

const runSharing = () => syncEnabled() && !!S.session && (runApi.ok || Date.now() >= runApi.retryAt);

/** Appelle une fonction « t2r_run_* » : renvoie la réponse, ou undefined (hors ligne, lent, pas encore installé).
    Les appels partent l'un après l'autre, dans l'ordre (un « arrêt » ne doit pas doubler un « démarrage » qui le suit). */
let runQueue = Promise.resolve();
function runCall(fn, args) {
  const job = runQueue.then(() => runCallNow(fn, args));
  runQueue = job.catch(() => {});
  return job;
}

async function runCallNow(fn, args) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), RUN_TIMEOUT);
  try {
    const data = await rpc(fn, { p_username: S.session.username, ...args }, '', ctl.signal);
    runApi.ok = true;
    return data;
  } catch (e) {
    if (e.status === 404 || e.code === 'PGRST202') { runApi.ok = false; runApi.retryAt = Date.now() + 300000; }
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

const runOf = (data) => (Array.isArray(data) && data[0] && typeof data[0].run_id === 'string' ? data[0] : null);

async function runGet() {
  const d = await runCall('t2r_run_get', {});
  return d === undefined ? undefined : runOf(d);
}

/** Annonce un chrono au serveur ; renvoie le chrono en vigueur (le nôtre, ou un autre déjà en cours). */
async function runPush(run) {
  const d = await runCall('t2r_run_start', {
    p_id: run.id, p_type: run.type, p_planned: run.planned, p_elapsed_ms: Math.max(0, Date.now() - run.start),
  });
  return d === undefined ? undefined : runOf(d);
}

function markStopped(id) {
  stopped = stopped.filter((x) => x !== id).concat(id).slice(-20);
  store.set('t2r.stopped', stopped);
}

/** Dit au serveur que ce chrono est terminé (réessayé au tour suivant tant qu'il n'a pas répondu). */
async function runEnd(id) {
  const d = await runCall('t2r_run_stop', { p_id: id });
  if (d !== undefined) {
    stopped = stopped.filter((x) => x !== id);
    store.set('t2r.stopped', stopped);
  }
}

/** Remise à zéro complète (réglages → tout effacer). */
function resetRunState() {
  stopped = [];
  runApi.ok = true;
  runApi.retryAt = 0;
}

function forgetStopped(id) {
  if (!stopped.includes(id)) return;
  stopped = stopped.filter((x) => x !== id);
  store.set('t2r.stopped', stopped);
}

/** Un chrono démarré ailleurs : on le suit ici, avec le même temps écoulé. */
function adoptRun(row, message) {
  S.run = {
    id: row.run_id,
    start: Date.now() - Math.max(0, row.elapsed_ms),
    type: row.kind === 'lunch' ? 'lunch' : 'break',
    planned: row.planned_s,
    pushed: true,
  };
  saveRun();
  resetAlerts(true);
  startTicker();
  render();
  toast(message || t('run_followed', { Type: typeLabel(S.run.type) }));
}

/** Le chrono d'ici a été terminé depuis un autre appareil (qui a enregistré l'entrée : elle arrive par la synchro). */
function endRunElsewhere() {
  S.run = null;
  saveRun();
  stopTicker();
  render();
  toast(t('run_ended_elsewhere'));
  scheduleSync();
}

/** Deux chronos démarrés presque en même temps : celui du serveur gagne. Le nôtre est gardé s'il compte. */
function resolveConflict(row) {
  const mine = S.run;
  const keep = !!mine && (Date.now() - mine.start) / 1000 >= 60;
  if (keep) addEntry(entryFromRun(mine));
  adoptRun(row, keep ? t('run_conflict_saved') : undefined);
  if (keep) scheduleSync();
}

/** Le chrono d'ici n'est pas encore connu du serveur : on l'annonce. */
async function runAnnounce() {
  const run = S.run;
  if (!run || !runSharing()) return;
  const row = await runPush(run);
  if (row === undefined || !S.run || S.run.id !== run.id) return;
  if (row && row.run_id === run.id) {
    run.pushed = true;
    saveRun();
    if (S.view === 'home') render();
  } else if (row) {
    resolveConflict(row);
  }
}

/** Compare le chrono d'ici et celui du serveur. */
async function runPoll() {
  if (runBusy || !runSharing()) return;
  runBusy = true;
  try {
    const mine = S.run ? S.run.id : null;
    const row = await runGet();
    if (row === undefined) return;
    if ((S.run ? S.run.id : null) !== mine) return; // le chrono d'ici a changé pendant l'appel : au prochain tour
    if (row) {
      if (stopped.includes(row.run_id)) { await runEnd(row.run_id); return; } // terminé ici, le serveur ne le sait pas encore
      if (!S.run) adoptRun(row);
      else if (S.run.id === row.run_id) {
        if (!S.run.pushed) { S.run.pushed = true; saveRun(); if (S.view === 'home') render(); }
      } else if (S.run.pushed) { endRunElsewhere(); adoptRun(row); } // le nôtre a été terminé ailleurs, un autre a démarré
      else resolveConflict(row);
    } else if (S.run) {
      if (S.run.pushed) endRunElsewhere();
      else await runAnnounce(); // démarré hors ligne : on l'annonce maintenant
    }
  } finally {
    runBusy = false;
  }
}

let pollWorker = null;
let pollInterval = null;

function stopRunPolling() {
  if (pollWorker) { pollWorker.terminate(); pollWorker = null; }
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

/** Relit le chrono du serveur toutes les 5 secondes (config.js : pollMs, 0 pour désactiver). */
function startRunPolling() {
  stopRunPolling();
  const ms = Number(window.T2R_CONFIG && window.T2R_CONFIG.pollMs);
  const every = Number.isFinite(ms) ? ms : 5000;
  if (!syncEnabled() || !S.session || every <= 0) return;
  try {
    // Un Worker n'est pas ralenti quand l'onglet est en arrière-plan.
    const blob = new Blob([`setInterval(function(){postMessage(0)},${every})`], { type: 'text/javascript' });
    pollWorker = new Worker(URL.createObjectURL(blob));
    pollWorker.onmessage = runPoll;
    pollWorker.onerror = () => {
      if (pollWorker) { pollWorker.terminate(); pollWorker = null; }
      if (!pollInterval) pollInterval = setInterval(runPoll, every);
    };
  } catch (_) {
    pollInterval = setInterval(runPoll, every);
  }
  runPoll();
}
