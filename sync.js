'use strict';

/* ---------- Compte et synchronisation (Supabase), sans bibliothèque ----------
   Tant que config.js ne contient ni adresse ni clé, rien de tout cela n'est actif :
   la page fonctionne en local, dans le navigateur. */

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
    const msg = data && typeof data === 'object' ? (data.error_description || data.msg || data.message) : null;
    const err = new Error(msg || `HTTP ${r.status}`);
    err.status = r.status;
    err.code = data && typeof data === 'object' ? (data.error_code || data.code || '') : '';
    throw err;
  }
  return data;
}

const authRequest = (path, body) => sbFetch(`${SB.url}/auth/v1/${path}`, {
  method: 'POST',
  headers: { apikey: SB.key, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function setSession(d) {
  const previous = S.session || {};
  S.session = {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    email: (d.user && d.user.email) || previous.email || '',
    user_id: (d.user && d.user.id) || previous.user_id || '',
  };
  store.set('t2r.session', S.session);
}

function dropSession() {
  S.session = null;
  store.remove('t2r.session');
}

async function signIn(email, password) {
  setSession(await authRequest('token?grant_type=password', { email, password }));
}

/** Renvoie 'signed_in' ou 'confirm' (si l'adresse doit d'abord être confirmée par e-mail). */
async function signUp(email, password) {
  const d = await authRequest('signup', { email, password });
  if (d && d.access_token) {
    setSession(d);
    return 'signed_in';
  }
  return 'confirm';
}

let refreshing = null;

/** Jeton valide ; renouvelé automatiquement : c'est la « session » qui reste ouverte d'un jour à l'autre. */
async function getToken() {
  const s = S.session;
  if (!s) throw new Error('no_session');
  if (s.expires_at - Date.now() / 1000 > 60) return s.access_token;
  if (!refreshing) {
    refreshing = authRequest('token?grant_type=refresh_token', { refresh_token: s.refresh_token })
      .then((d) => { setSession(d); })
      .finally(() => { refreshing = null; });
  }
  try {
    await refreshing;
  } catch (e) {
    if (!e.offline) {
      dropSession();
      e.expired = true;
    }
    throw e;
  }
  return S.session.access_token;
}

async function rest(method, path, body, extraHeaders) {
  const token = await getToken();
  return sbFetch(`${SB.url}/rest/v1/${path}`, {
    method,
    headers: Object.assign({
      apikey: SB.key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }, extraHeaders || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signOut() {
  try {
    const token = S.session && S.session.access_token;
    if (token) {
      await sbFetch(`${SB.url}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: SB.key, Authorization: `Bearer ${token}` },
      });
    }
  } catch (_) { /* hors ligne : on se déconnecte quand même ici */ }
  dropSession();
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
  S.sync.busy = true;
  S.sync.error = '';
  onSyncChange();
  try {
    // 1. suppressions
    while (S.deleted.length) {
      const chunk = S.deleted.slice(0, 50);
      await rest('DELETE', `breaks?id=in.(${chunk.join(',')})`, undefined, { Prefer: 'return=minimal' });
      S.deleted = S.deleted.filter((id) => !chunk.includes(id));
      saveEntries();
    }
    // 2. nouvelles entrées (upsert : renvoyer deux fois la même est sans danger)
    const pending = S.entries.filter((e) => !e.synced);
    for (let i = 0; i < pending.length; i += 200) {
      const part = pending.slice(i, i + 200);
      const rows = part.map((e) => ({ id: e.id, date: e.date, time: e.time, type: e.type, seconds: e.seconds }));
      await rest('POST', 'breaks?on_conflict=id', rows, { Prefer: 'resolution=merge-duplicates,return=minimal' });
      part.forEach((e) => { e.synced = true; });
      saveEntries();
    }
    // 3. état du serveur (par pages de 1000)
    const all = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await rest('GET', `breaks?select=id,date,time,type,seconds&order=date.asc,time.asc&limit=1000&offset=${offset}`);
      all.push(...page);
      if (page.length < 1000) break;
    }
    const deletedMeanwhile = new Set(S.deleted); // supprimées pendant la synchro, pas encore envoyées
    const fromServer = all
      .filter((r) => !deletedMeanwhile.has(r.id))
      .map((r) => ({
        id: r.id, date: r.date, time: String(r.time).slice(0, 5), type: r.type === 'lunch' ? 'lunch' : 'break', seconds: r.seconds, synced: true,
      }));
    const stillLocal = S.entries.filter((e) => !e.synced); // ajoutées pendant la synchro
    S.entries = fromServer.concat(stillLocal);
    sortEntries();
    saveEntries();
    S.sync.last = Date.now();
    store.set('t2r.lastSync', S.sync.last);
  } catch (e) {
    if (e.offline) S.sync.error = 'offline';
    else if (e.expired) S.sync.error = 'expired';
    else S.sync.error = e.message || 'error';
  } finally {
    S.sync.busy = false;
    onSyncChange();
  }
}
