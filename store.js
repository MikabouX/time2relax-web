'use strict';

/* ---------- Stockage local (localStorage, avec repli en mémoire) ---------- */

const memStore = {};
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) {
      return key in memStore ? memStore[key] : fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      memStore[key] = value;
    }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (_) { /* stockage indisponible */ }
    delete memStore[key];
  },
  clearAll() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('t2r.')).forEach((k) => localStorage.removeItem(k));
    } catch (_) { /* stockage indisponible */ }
    Object.keys(memStore).forEach((k) => delete memStore[k]);
  },
};

const DEFAULT_SHOP_URL = 'https://www.smile-sandwicherie.be/';
const SUGGESTIONS = [
  { name: 'Takeaway.com', url: 'https://www.takeaway.com/be/' },
  { name: 'Uber Eats', url: 'https://www.ubereats.com/be' },
  { name: 'Deliveroo', url: 'https://deliveroo.be/' },
];
const PAUSE_CHOICES = [5, 10, 15, 20, 30];
const LUNCH_MINUTES = 30;

function defaultPrefs() {
  return {
    lang: null,
    shops: [{ name: 'Smile Sandwicherie', url: DEFAULT_SHOP_URL }],
    shopIndex: 0,
    nightMode: false,
    nightCutoff: 12,
    setupDone: false,
  };
}

function loadPrefs() {
  const p = Object.assign(defaultPrefs(), store.get('t2r.prefs', {}));
  if (!Array.isArray(p.shops) || p.shops.length === 0) p.shops = defaultPrefs().shops;
  p.shopIndex = Math.min(Math.max(parseInt(p.shopIndex, 10) || 0, 0), p.shops.length - 1);
  ['homeAddr', 'workAddr', 'navApp'].forEach((k) => { delete p[k]; }); // anciens réglages d'itinéraire
  p.nightCutoff = parseInt(p.nightCutoff, 10);
  if (Number.isNaN(p.nightCutoff)) p.nightCutoff = 12;
  return p;
}

const S = {
  view: 'home',
  prefs: loadPrefs(),
  entries: store.get('t2r.entries', []),
  deleted: store.get('t2r.deleted', []),
  run: store.get('t2r.run', null),
  ui: Object.assign({ type: 'break', useTimer: false, pauseMinutes: 15 }, store.get('t2r.ui', {})),
  session: store.get('t2r.session', null),
  sync: { busy: false, last: store.get('t2r.lastSync', null), error: '' },
};

const savePrefs = () => store.set('t2r.prefs', S.prefs);
const saveEntries = () => { store.set('t2r.entries', S.entries); store.set('t2r.deleted', S.deleted); };
const saveRun = () => (S.run ? store.set('t2r.run', S.run) : store.remove('t2r.run'));
const saveUi = () => store.set('t2r.ui', S.ui);

/* ---------- Formats d'affichage ---------- */

const two = (n) => String(n).padStart(2, '0');

function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${two(h)}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

/** Durée lisible : « 42 s », « 12 min », « 1 h 05 ». */
function humanDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} ${t('unit_h')} ${two(m)}`;
  if (m > 0) return `${m} min`;
  return `${seconds} s`;
}

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function dayKey(d) {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

function parseDay(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function dateLong(d) {
  return `${DAYS[LANG][(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[LANG][d.getMonth()]}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return t('greet_morning');
  if (h >= 12 && h < 18) return t('greet_afternoon');
  return t('greet_evening');
}

const typeLabel = (type) => (type === 'lunch' ? t('type_lunch') : t('type_break'));

/* ---------- La « journée de travail » (mode nuit) ---------- */

/** Clé de la journée en cours : minuit, ou en mode nuit l'heure de bascule choisie. */
function todayKey(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (S.prefs.nightMode && now.getHours() < S.prefs.nightCutoff) d.setDate(d.getDate() - 1);
  return dayKey(d);
}

/** Journée de travail d'une entrée : en mode nuit, un break avant l'heure de bascule compte pour la veille. */
function workDay(e) {
  if (!S.prefs.nightMode) return e.date;
  const d = parseDay(e.date);
  const hour = parseInt(e.time, 10);
  if (!d || Number.isNaN(hour)) return e.date;
  if (hour < S.prefs.nightCutoff) d.setDate(d.getDate() - 1);
  return dayKey(d);
}

function dayLabel(key) {
  const today = todayKey();
  if (key === today) return t('today');
  const tDate = parseDay(today);
  if (tDate) {
    tDate.setDate(tDate.getDate() - 1);
    if (key === dayKey(tDate)) return t('yesterday');
  }
  const d = parseDay(key);
  return d ? capitalize(dateLong(d)) : key;
}

function dayTotals(list) {
  const sum = (a) => a.reduce((acc, e) => acc + e.seconds, 0);
  const b = list.filter((e) => e.type !== 'lunch');
  const l = list.filter((e) => e.type === 'lunch');
  return { b: { n: b.length, s: sum(b) }, l: { n: l.length, s: sum(l) } };
}

/* ---------- Entrées de l'historique ---------- */

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

function sortEntries() {
  S.entries.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

function addEntry(e) {
  S.entries.push(e);
  sortEntries();
  saveEntries();
}

/** Modifie une entrée (même identifiant) ; elle sera renvoyée au serveur à la prochaine synchro. */
function updateEntry(id, fields) {
  const e = S.entries.find((x) => x.id === id);
  if (!e) return null;
  e.date = fields.date;
  e.time = fields.time;
  e.type = fields.type;
  e.seconds = fields.seconds;
  e.synced = false;
  sortEntries();
  saveEntries();
  return e;
}

/** Retire les entrées d'identifiants donnés et renvoie celles qui ont été retirées (pour annuler). */
function removeEntries(ids) {
  const set = new Set(ids);
  const removed = S.entries.filter((e) => set.has(e.id));
  S.entries = S.entries.filter((e) => !set.has(e.id));
  removed.forEach((e) => { if (e.synced) S.deleted.push(e.id); });
  saveEntries();
  return removed;
}

/** Remet des entrées retirées (annulation). */
function restoreEntries(list) {
  list.forEach((e) => {
    const i = S.deleted.indexOf(e.id);
    if (i >= 0) {
      S.deleted.splice(i, 1); // la suppression n'était pas encore envoyée : on l'annule
      e.synced = true;
    } else {
      e.synced = false; // déjà supprimée côté serveur (ou jamais envoyée) : à renvoyer
    }
    S.entries.push(e);
  });
  sortEntries();
  saveEntries();
}

/* ---------- Fichier texte : date;heure;type;durée_en_secondes ---------- */

function entriesToText() {
  const lines = S.entries.map((e) => `${e.date};${e.time};${e.type};${e.seconds}`);
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function parseText(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const p = line.trim().split(';');
    if (p.length < 4) continue;
    const seconds = parseInt(p[3], 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p[0]) || !/^\d{1,2}:\d{2}$/.test(p[1])) continue;
    if (Number.isNaN(seconds) || seconds < 0) continue;
    out.push({ date: p[0], time: p[1].padStart(5, '0'), type: p[2] === 'lunch' ? 'lunch' : 'break', seconds });
  }
  return out;
}

function importEntries(list) {
  const key = (e) => `${e.date}|${e.time}|${e.type}|${e.seconds}`;
  const have = new Set(S.entries.map(key));
  let added = 0;
  let skipped = 0;
  for (const e of list) {
    if (have.has(key(e))) { skipped += 1; continue; }
    have.add(key(e));
    S.entries.push({ id: uid(), date: e.date, time: e.time, type: e.type, seconds: e.seconds, synced: false });
    added += 1;
  }
  sortEntries();
  saveEntries();
  return { added, skipped };
}
