'use strict';

/* ---------- Mes données de l'appli sur le site (1.9.2) ----------
   Avec le nom de l'appli, le site lit (à l'ouverture et au retour sur l'onglet, jamais en continu) et
   modifie la pointeuse, voit le planning importé et les congés, comme un autre téléphone. Chaque
   modification part tout de suite au serveur (relire → changer → renvoyer, pour ne rien écraser).
   Le serveur ne garde que 15 jours passés et 4 semaines à venir. */

const ME_KEY = 't2r.userdata';
const ME_PREFS_KEY = 't2r.phonePrefs';
const ME = { data: {}, prefs: {}, busy: false };
try { ME.data = JSON.parse(localStorage.getItem(ME_KEY) || '{}') || {}; } catch (_) { ME.data = {}; }
try { ME.prefs = JSON.parse(localStorage.getItem(ME_PREFS_KEY) || '{}') || {}; } catch (_) { ME.prefs = {}; }
const meSave = () => {
  try {
    localStorage.setItem(ME_KEY, JSON.stringify(ME.data));
    localStorage.setItem(ME_PREFS_KEY, JSON.stringify(ME.prefs));
  } catch (_) { /* plein */ }
};

const meD = (kind) => (ME.data[kind] && ME.data[kind].d && typeof ME.data[kind].d === 'object' ? ME.data[kind].d : null);
const meFrom = () => { const d = new Date(); return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 15)); };

/** Heure locale sans fuseau, comme l'appli (« 2026-11-20T08:05:00.000 »). */
function localIso(d) {
  return `${dayKey(d)}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.000`;
}
/** Lit une heure de l'appli (locale, 0 à 6 décimales). */
function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
}

/** Après la lecture du nom : données et réglages de l'appli. */
async function meFetch(n) {
  const r = await dogRpc('t2r_data_get', { p_username: n });
  ME.data = r && typeof r === 'object' ? r : {};
  meSave();
}
function meSetPrefs(p) {
  if (p && typeof p === 'object' && !Array.isArray(p)) { ME.prefs = p; meSave(); }
}

/** Relire → changer → renvoyer, pour ne pas écraser ce que le téléphone vient d'envoyer. */
async function meEdit(kind, change) {
  const n = dogName();
  if (!n) { askDogName(); return false; }
  ME.busy = true;
  render();
  try {
    const fresh = await dogRpc('t2r_data_get', { p_username: n });
    const row = fresh && fresh[kind];
    const d = row && row.d && typeof row.d === 'object' ? row.d : {};
    d.v = 1;
    d.from = meFrom();
    change(d);
    const at = await dogRpc('t2r_data_set', { p_username: n, p_kind: kind, p_data: d, p_device: 'web' });
    ME.data = fresh && typeof fresh === 'object' ? fresh : {};
    ME.data[kind] = { d, u: at, dev: 'web' };
    meSave();
    return true;
  } catch (_) {
    toast(t('me_error'));
    return false;
  } finally {
    ME.busy = false;
    render();
  }
}

/* ---------- Pointeuse ---------- */

const meShifts = () => {
  const d = meD('clock');
  return (d && Array.isArray(d.shifts) ? d.shifts : []).filter((s) => s && parseLocal(s.s))
    .sort((a, b) => parseLocal(a.s) - parseLocal(b.s));
};
const shiftWork = (s, now = new Date()) => {
  const a = parseLocal(s.s);
  const b = s.e ? parseLocal(s.e) : now;
  const pres = Math.max(0, Math.round((b - a) / 1000));
  return Math.max(0, pres - (s.pl ? 0 : (s.ls || 0)));
};
/** Journée en cours : la dernière, sans fin, commencée il y a moins de 14 h (comme l'appli). */
function meOpenShift() {
  const list = meShifts();
  const last = list[list.length - 1];
  return last && !last.e && Date.now() - parseLocal(last.s) < 14 * 3600000 ? last : null;
}

function remoteDaysOn(day) {
  const p = ME.prefs;
  const k = dayKey(day);
  let periods = [];
  try { periods = JSON.parse(p.clock_remote_periods || '[]'); } catch (_) { periods = []; }
  const per = (Array.isArray(periods) ? periods : []).find((x) => x && x.from <= k && k <= x.to);
  const days = per ? per.days : p.clock_remote_days;
  return (Array.isArray(days) ? days : []).map(Number);
}
const isoWeekday = (d) => ((d.getDay() + 6) % 7) + 1;

async function meClockIn() {
  const now = new Date();
  const remote = ME.prefs.clock_remote === true && remoteDaysOn(now).includes(isoWeekday(now));
  await meEdit('clock', (d) => {
    d.shifts = Array.isArray(d.shifts) ? d.shifts : [];
    const last = d.shifts[d.shifts.length - 1];
    if (last && !last.e) return; // déjà pointé (autre appareil)
    d.shifts.push({ s: localIso(now), b: 0, bs: 0, l: 0, ls: 0, ...(remote ? { r: true } : {}),
      ...(ME.prefs.clock_paid_lunch === true ? { pl: true } : {}) });
  });
}

async function meClockOut() {
  const ok = await confirmDialog({ title: t('me_end_q'), body: t('me_end_body'), ok: t('me_end') });
  if (!ok) return;
  const now = new Date();
  // Breaks et lunchs de la journée, d'après l'historique en ligne.
  let rows = [];
  try { rows = await dogRpc('t2r_list', { p_username: dogName() }) || []; } catch (_) { rows = []; }
  await meEdit('clock', (d) => {
    d.shifts = Array.isArray(d.shifts) ? d.shifts : [];
    const last = d.shifts[d.shifts.length - 1];
    if (!last || last.e) return;
    const start = parseLocal(last.s);
    let b = 0; let bs = 0; let l = 0; let ls = 0;
    for (const r of Array.isArray(rows) ? rows : []) {
      const at = parseLocal(`${r.date}T${String(r.time).slice(0, 5)}`);
      if (!at || at < new Date(start.getTime() - 60000) || at > now) continue;
      if (r.type === 'lunch') { l += 1; ls += r.seconds || 0; } else { b += 1; bs += r.seconds || 0; }
    }
    Object.assign(last, { e: localIso(now), b, bs, l, ls });
  });
}

function clockCard() {
  if (!dogName() || ME.prefs.clock_on !== true) return null;
  const open = meOpenShift();
  const today = dayKey(new Date());
  const doneToday = meShifts().filter((s) => s.e && dayKey(parseLocal(s.s)) === today);
  const worked = doneToday.reduce((a, s) => a + shiftWork(s), 0) + (open ? shiftWork(open) : 0);
  const line = open
    ? t('me_since', { time: hmText(parseLocal(open.s)), worked: humanDuration(worked) })
    : doneToday.length ? t('me_done', { worked: humanDuration(worked) }) : t('me_not_yet');
  return h('section', { class: 'card pad me-clock' },
    h('div', { class: 'row' },
      h('div', { class: 'grow' },
        h('div', { class: 'strong' }, icon('schedule', 18), ' ', t('me_clock')),
        h('div', { class: 'small muted' }, line)),
      h('button', {
        type: 'button', class: `btn ${open ? 'danger-outline' : 'filled'}`, disabled: ME.busy ? '' : null,
        on: { click: () => (open ? meClockOut() : meClockIn()) },
      }, open ? t('me_end') : t('me_start'))),
    h('button', { type: 'button', class: 'btn text small', on: { click: () => go('hours') } }, t('me_hours')));
}
const hmText = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;

/* ---------- Mes heures (15 derniers jours) ---------- */

function hoursView() {
  const list = meShifts().slice().reverse();
  const now = new Date();
  const monday = fwMonday(now);
  const week = list.filter((s) => parseLocal(s.s) >= monday).reduce((a, s) => a + shiftWork(s, now), 0);
  return h('div', { class: 'page' },
    h('header', { class: 'top' },
      iconBtn('arrow_back', t('back'), goBack),
      h('h1', { class: 'grow' }, t('me_hours')),
      iconBtn('add', t('me_add_day'), () => editShiftDialog(null), 'accent')),
    h('p', { class: 'small muted center' }, t('me_hours_note')),
    h('section', { class: 'card pad' }, h('div', { class: 'strong' }, t('me_week_total', { worked: humanDuration(week) }))),
    list.length === 0 ? h('p', { class: 'center muted pad' }, t('me_no_hours'))
      : h('section', { class: 'card' }, list.map((s) => {
        const a = parseLocal(s.s);
        const b = s.e ? parseLocal(s.e) : null;
        return h('div', { class: 'row me-row' },
          h('div', { class: 'grow' },
            h('div', { class: 'strong' }, capitalize(dateLong(a)), s.r ? h('span', { class: 'muted' }, ' · ', icon('home', 14)) : null),
            h('div', { class: 'small muted' }, `${hmText(a)} – ${b ? hmText(b) : t('me_running')} · ${humanDuration(shiftWork(s, now))}`)),
          iconBtn('edit', t('me_fix'), () => editShiftDialog(s)),
          iconBtn('delete', t('delete'), () => deleteShift(s)));
      })));
}

function editShiftDialog(shift) {
  return openDialog((dlg, close) => {
    const a = shift ? parseLocal(shift.s) : new Date();
    const b = shift && shift.e ? parseLocal(shift.e) : null;
    const date = h('input', { type: 'date', class: 'field', value: dayKey(a), 'aria-label': t('me_date') });
    const from = h('input', { type: 'time', class: 'field', value: hmText(a), 'aria-label': t('me_from') });
    const to = h('input', { type: 'time', class: 'field', value: b ? hmText(b) : '', 'aria-label': t('me_to') });
    const remote = h('input', { type: 'checkbox', ...(shift && shift.r ? { checked: '' } : {}) });
    const msg = h('p', { class: 'small fw-err' });
    const save = async () => {
      const s = parseLocal(`${date.value}T${from.value}`);
      let e = to.value ? parseLocal(`${date.value}T${to.value}`) : null;
      if (!s) { msg.textContent = t('me_bad_time'); return; }
      if (e && e <= s) e = new Date(e.getTime() + 86400000); // fin après minuit
      close(null);
      await meEdit('clock', (d) => {
        d.shifts = (Array.isArray(d.shifts) ? d.shifts : []).filter((x) => !shift || x.s !== shift.s);
        const base = shift ? { ...shift } : { b: 0, bs: 0, l: 0, ls: 0 };
        base.s = localIso(s);
        if (e) base.e = localIso(e); else delete base.e;
        if (remote.checked) base.r = true; else delete base.r;
        d.shifts.push(base);
        d.shifts.sort((x, y) => parseLocal(x.s) - parseLocal(y.s));
      });
    };
    dlg.append(
      h('h2', {}, shift ? t('me_fix') : t('me_add_day')),
      h('div', { class: 'dlg-fields' },
        h('label', { class: 'small muted' }, t('me_date')), date,
        h('label', { class: 'small muted' }, t('me_from')), from,
        h('label', { class: 'small muted' }, t('me_to')), to,
        h('label', { class: 'row' }, remote, ' ', t('fw_remote')), msg),
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn text', on: { click: () => close(null) } }, t('cancel')),
        h('button', { type: 'button', class: 'btn filled', on: { click: save } }, t('save'))));
  });
}

async function deleteShift(shift) {
  const ok = await confirmDialog({ title: t('me_del_q'), body: capitalize(dateLong(parseLocal(shift.s))), ok: t('delete'), danger: true });
  if (!ok) return;
  await meEdit('clock', (d) => { d.shifts = (Array.isArray(d.shifts) ? d.shifts : []).filter((x) => x.s !== shift.s); });
}

/* ---------- Congés (depuis le calendrier) ---------- */

function absenceDialog(key) {
  const d = meD('absences') || {};
  const cur = d.days && d.days[key];
  return openDialog((dlg, close) => {
    const label = h('input', { type: 'text', class: 'field', maxlength: '30', placeholder: t('me_abs_label'),
      value: (d.labels && d.labels[key]) || '' });
    const set = async (type) => {
      close(null);
      await meEdit('absences', (x) => {
        for (const f of ['days', 'parts', 'labels']) x[f] = x[f] && typeof x[f] === 'object' ? x[f] : {};
        if (type) {
          x.days[key] = type;
          if (label.value.trim()) x.labels[key] = label.value.trim().slice(0, 30); else delete x.labels[key];
        } else {
          delete x.days[key];
          delete x.labels[key];
          delete x.parts[key];
        }
      });
    };
    dlg.append(
      h('h2', {}, capitalize(dateLong(new Date(`${key}T12:00:00`)))),
      h('div', { class: 'dlg-fields' }, label),
      h('div', { class: 'dlg-actions wrap' },
        cur ? h('button', { type: 'button', class: 'btn text', on: { click: () => set(null) } }, t('me_abs_remove')) : null,
        h('button', { type: 'button', class: 'btn tonal', on: { click: () => set('absent') } }, t('me_abs_absent')),
        h('button', { type: 'button', class: 'btn filled', on: { click: () => set('leave') } }, t('me_abs_leave'))));
  });
}

/* ---------- Mon calendrier : même grille que les horaires reçus ---------- */

function myDays(monday) {
  const days = {};
  const total = {};
  const plan = meD('plan') || {};
  const abs = meD('absences') || {};
  const absDays = abs.days || {};
  const absLabels = abs.labels || {};
  const offPlan = new Set(Array.isArray(plan.off) ? plan.off : []);
  const items = Array.isArray(plan.items) ? plan.items : [];
  const shifts = meShifts();
  const workDays = (Array.isArray(ME.prefs.clock_plan_days) ? ME.prefs.clock_plan_days : [1, 2, 3, 4, 5]).map(Number);
  for (const it of items) {
    if (it.y === 'other' && it.l) total[String(it.l).toLowerCase()] = (total[String(it.l).toLowerCase()] || 0) + (it.m || 0);
  }
  let main = '';
  let max = -1;
  for (const [k, v] of Object.entries(total)) if (v > max) { main = k; max = v; }
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(monday, i);
    const k = dayKey(day);
    if (absDays[k] || offPlan.has(k)) {
      days[k] = { off: true, label: absLabels[k] || (absDays[k] === 'absent' ? t('fw_absent') : t('me_abs_leave')), blocks: [] };
      continue;
    }
    const blocks = [];
    for (const it of items) {
      const at = parseLocal(it.t);
      if (!at || dayKey(at) !== k) continue;
      const from = at.getHours() * 60 + at.getMinutes();
      const type = it.y === 'lunch' ? 'lunch' : it.y === 'other' ? 'other' : 'break';
      blocks.push({ from, to: Math.min(1440, from + (it.m || 5)), type, label: type === 'other' ? String(it.l || '') : '', min: it.m || 0 });
    }
    // Breaks prévus à la main (Réglages), s'il n'y a pas de planning importé ce jour-là.
    if (!blocks.length && S.plan && S.plan.items.length && (S.plan.repeat ? S.plan.days.includes(isoWeekday(day)) : S.plan.day === k)) {
      for (const it of S.plan.items) {
        const [hh, mm] = it.time.split(':').map(Number);
        const len = it.type === 'lunch' ? S.ui.lunchMinutes : it.type === 'break' ? S.ui.pauseMinutes : 30;
        blocks.push({ from: hh * 60 + mm, to: hh * 60 + mm + len, type: it.type, label: it.type === 'other' ? it.label || '' : '', min: len });
      }
    }
    const dayShifts = shifts.filter((s) => dayKey(parseLocal(s.s)) === k);
    if (!blocks.some((b) => b.type === 'other') && dayShifts.length) {
      for (const s of dayShifts) {
        const a = parseLocal(s.s);
        const b = s.e ? parseLocal(s.e) : new Date();
        const from = a.getHours() * 60 + a.getMinutes();
        const to = dayKey(b) === k ? b.getHours() * 60 + b.getMinutes() : 1440;
        blocks.unshift({ from, to: Math.max(from + 5, to), type: 'other', label: t('me_clocked'), min: to - from, base: true });
      }
    }
    let place = null;
    if (dayShifts.length) place = dayShifts[0].r ? 'remote' : 'site';
    else if (ME.prefs.clock_remote === true && (blocks.length || workDays.includes(isoWeekday(day)))) {
      place = remoteDaysOn(day).includes(isoWeekday(day)) ? 'remote' : 'site';
    }
    days[k] = { off: false, place, blocks };
  }
  return { days, main };
}

/* ---------- Connexion du PC par le téléphone (QR) ----------
   Le site affiche « time2relax-pair:CODE.SECRET ». Le téléphone (Réglages > Mon compte > Connecter un PC)
   dépose le nom et la clé chiffrée avec SECRET ; le secret ne passe jamais par le serveur. Le site relit
   toutes les 3 secondes, seulement tant que la fenêtre est ouverte, 5 minutes au plus. */
const PAIR_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function pairRandom(n) {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => PAIR_ALPHA[x % PAIR_ALPHA.length]).join('');
}
function pairDecode(blob, secret) {
  let key = '';
  for (let i = 0; i < blob.length && i < secret.length; i += 1) {
    const a = PAIR_ALPHA.indexOf(blob[i]);
    const b = PAIR_ALPHA.indexOf(secret[i]);
    if (a < 0 || b < 0) return '';
    key += PAIR_ALPHA[(a - b + PAIR_ALPHA.length) % PAIR_ALPHA.length];
  }
  return key;
}
function pairDialog() {
  const code = pairRandom(20);
  const secret = pairRandom(20);
  const started = Date.now();
  let timer = null;
  return openDialog((dlg, close) => {
    const box = h('div', { class: 'pair-qr' });
    box.innerHTML = qrSvg(`time2relax-pair:${code}.${secret}`, 240); // dessin généré ici, aucun texte saisi
    const msg = h('p', { class: 'small muted center', role: 'status' }, t('pair_wait'));
    const stop = () => { clearTimeout(timer); close(null); };
    const poll = async () => {
      if (!dlg.isConnected) return;
      if (Date.now() - started > 300000) { msg.textContent = t('pair_expired'); return; }
      try {
        const r = await dogRpc('t2r_pair_take', { p_code: code });
        if (r && r.n && dlg.isConnected) {
          dogSetKey(r.n, pairDecode(String(r.b || ''), secret));
          stop();
          toast(t('pair_ok', { name: r.n }));
          dogFetch(r.n);
          return;
        }
      } catch (_) { /* hors ligne : on réessaie */ }
      timer = setTimeout(poll, 3000);
    };
    dlg.append(
      h('h2', {}, t('pair_title')),
      h('p', {}, t('pair_note')),
      box, msg,
      h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn text', on: { click: stop } }, t('cancel'))));
    timer = setTimeout(poll, 3000);
  });
}

/* ---------- Réglages changés sur le site : envoyés au serveur (sans relecture automatique) ---------- */
let mePushTimer = null;
function meSettingsChanged() {
  if (!dogName()) return;
  clearTimeout(mePushTimer);
  mePushTimer = setTimeout(mePushSettings, 1500);
}
async function mePushSettings() {
  const n = dogName();
  if (!n) return;
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(DOG_SEEN_KEY) || '{}') || {}; } catch (_) { seen = {}; }
  const patch = {};
  for (const k of DOG_SET_KEYS) {
    const v = readSetting(k);
    if (v !== undefined && !sameValue(v, seen[k])) patch[k] = v;
  }
  if (!Object.keys(patch).length) return;
  try {
    await dogRpc('t2r_settings_set', { p_username: n, p_patch: patch });
    Object.assign(seen, patch);
    localStorage.setItem(DOG_SEEN_KEY, JSON.stringify(seen));
  } catch (_) { toast(t('me_error')); }
}

/** Même calcul que le téléphone (pour les tests) : chaque caractère décalé du caractère du secret. */
function pairEncodeForTest(key, secret) {
  return Array.from(key, (c, i) => PAIR_ALPHA[(PAIR_ALPHA.indexOf(c) + PAIR_ALPHA.indexOf(secret[i])) % PAIR_ALPHA.length]).join('');
}
