'use strict';

/* ---------- « Va chercher mon chrono ! » : le cocker va lire le chrono du téléphone ----------
   Seulement quand on appuie : une lecture (chrono en cours + pauses du jour) sous le nom d'utilisateur de
   l'application. Rien n'est écrit sur le serveur, rien n'est relu en arrière-plan. */

const DOG_NAME_KEY = 't2r.dogName';
const DOG = { busy: false, result: null, error: '' };

/* Chrono du téléphone affiché dans le cadran (lecture seule) : type, heure de départ, durée prévue.
   Il avance tout seul ici ; le site relit le téléphone seulement à la fin prévue, puis toutes les 2 minutes
   tant qu'il dépasse (au plus 15 fois), et quand on revient sur la page. */
let PHONE = null;
let phoneTimer = null;
let phoneRechecks = 0;

function phoneFollow(run) {
  clearTimeout(phoneTimer);
  PHONE = run;
  if (!run) return;
  const left = run.planned > 0 ? run.start + run.planned * 1000 - Date.now() : -1;
  const wait = left > 0 ? left + 5000 : 120000;
  if (left <= 0 && phoneRechecks >= 15) return;
  phoneTimer = setTimeout(() => {
    if (left <= 0) phoneRechecks += 1;
    if (dogName()) dogFetch(dogName(), true);
  }, wait);
}

function phoneStop() {
  clearTimeout(phoneTimer);
  PHONE = null;
  phoneRechecks = 0;
  DOG.result = null;
  render();
}

/** Cocker dessiné (original) : poil doré, longues oreilles ondulées. */
const COCKER_SVG = `<svg viewBox="0 0 200 170" width="120" height="102" aria-hidden="true">
  <ellipse cx="104" cy="160" rx="62" ry="7" fill="rgba(0,0,0,.12)"/>
  <path class="dog-tail" d="M 150 112 q 26 -14 22 -40 q -2 -6 -7 -2 q -2 22 -22 30 z" fill="#B97A35"/>
  <ellipse cx="118" cy="118" rx="46" ry="34" fill="#D39A52"/>
  <rect x="86" y="128" width="16" height="30" rx="8" fill="#C98A45"/>
  <rect x="130" y="128" width="16" height="30" rx="8" fill="#C98A45"/>
  <ellipse cx="94" cy="158" rx="12" ry="6" fill="#E6B877"/><ellipse cx="138" cy="158" rx="12" ry="6" fill="#E6B877"/>
  <ellipse cx="78" cy="122" rx="22" ry="20" fill="#E6B877"/>
  <ellipse cx="72" cy="70" rx="40" ry="38" fill="#D39A52"/>
  <ellipse cx="50" cy="88" rx="22" ry="17" fill="#E6B877"/>
  <path class="dog-ear" d="M 40 54 q -26 10 -24 48 q 2 22 16 30 q 10 4 14 -6 q 6 -16 4 -34 q -2 -26 -10 -38 z" fill="#9C5F27"/>
  <path class="dog-ear" d="M 104 52 q 22 10 22 46 q 0 22 -12 30 q -10 4 -14 -6 q -4 -16 -2 -34 q 0 -26 6 -36 z" fill="#9C5F27"/>
  <path d="M 26 92 q 4 6 0 12 M 30 104 q 4 6 0 12 M 116 92 q -4 6 0 12 M 112 104 q -4 6 0 12" stroke="#7E4A1C" stroke-width="3" fill="none" stroke-linecap="round"/>
  <ellipse cx="60" cy="66" rx="6" ry="7" fill="#2A1A10"/><circle cx="62" cy="64" r="2" fill="#fff"/>
  <ellipse cx="88" cy="66" rx="6" ry="7" fill="#2A1A10"/><circle cx="90" cy="64" r="2" fill="#fff"/>
  <ellipse cx="44" cy="82" rx="8" ry="6" fill="#2A1A10"/>
  <path d="M 44 88 q 2 8 10 8" stroke="#2A1A10" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <path class="dog-tongue" d="M 48 94 q 4 12 12 6 q 2 -4 -2 -8 z" fill="#E9707A"/>
  <path d="M 64 44 q 8 -8 18 -2" stroke="#B97A35" stroke-width="4" fill="none" stroke-linecap="round"/>
</svg>`;

function dogName() {
  try { return localStorage.getItem(DOG_NAME_KEY) || ''; } catch (_) { return ''; }
}

async function dogRpc(fn, args) {
  const C = window.T2R_FETCH || {};
  const r = await fetch(`${C.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: C.key, Authorization: `Bearer ${C.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const txt = await r.text(); // t2r_save ne renvoie rien
  return txt ? JSON.parse(txt) : null;
}

async function dogFetch(name, quiet) {
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 40) {
    DOG.error = t('dog_bad_name');
    render();
    return;
  }
  try { localStorage.setItem(DOG_NAME_KEY, n); } catch (_) { /* navigateur sans stockage */ }
  if (!quiet) phoneRechecks = 0;
  DOG.busy = !quiet;
  DOG.error = '';
  if (!quiet) DOG.result = null;
  render();
  const started = Date.now();
  try {
    await dogPush(n); // les pauses faites ici partent d'abord sous le nom
    const [runs, rows, prefs] = await Promise.all([dogRpc('t2r_run_get', { p_username: n }), dogRpc('t2r_list', { p_username: n }),
      quiet ? Promise.resolve(null) : dogRpc('t2r_settings_get', { p_username: n }).catch(() => null)]);
    // La couleur choisie dans l'appli arrive aussi sur le site.
    if (prefs && typeof prefs === 'object') setPhoneColor(prefs.theme_color);
    const today = dayKey(new Date());
    const day = (Array.isArray(rows) ? rows : []).filter((r) => r.date === today);
    const sum = (k) => day.filter((r) => (k === 'lunch') === (r.type === 'lunch')).reduce((a, r) => a + (r.seconds || 0), 0);
    const run = Array.isArray(runs) && runs[0] ? runs[0] : null;
    DOG.result = {
      at: Date.now(),
      run: run ? { kind: run.kind === 'lunch' ? 'lunch' : 'break', elapsed: Math.round((run.elapsed_ms || 0) / 1000), planned: run.planned_s || 0 } : null,
      breaks: sum('break'), nBreaks: day.filter((r) => r.type !== 'lunch').length,
      lunch: sum('lunch'), nLunch: day.filter((r) => r.type === 'lunch').length,
    };
    dogReconcile(Array.isArray(rows) ? rows : []);
    const r = DOG.result.run;
    phoneFollow(r ? { id: run.run_id, type: r.kind, start: Date.now() - r.elapsed * 1000, planned: r.planned } : null);
  } catch (_) {
    DOG.error = t('dog_error');
  }
  // Le chien prend au moins le temps d'aller et revenir.
  const wait = quiet ? 0 : 1300 - (Date.now() - started);
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));
  DOG.busy = false;
  render();
}

function dogCard() {
  const res = DOG.result;
  let out = null;
  if (DOG.error) out = h('p', { class: 'dog-msg err' }, DOG.error);
  else if (res) {
    const lines = [];
    if (res.run) {
      const extra = Math.round((Date.now() - res.at) / 1000);
      const el = res.run.elapsed + extra;
      lines.push(h('p', { class: 'dog-msg strong' }, t('dog_running', { type: typeLabel(res.run.kind), elapsed: humanDuration(el) })));
      if (res.run.planned > 0 && el > res.run.planned) {
        lines.push(h('p', { class: 'dog-msg warn' }, t('dog_over', { over: humanDuration(el - res.run.planned) })));
      }
      if (PHONE) lines.push(h('button', { type: 'button', class: 'btn text small', on: { click: phoneStop } }, t('dog_unfollow')));
    } else {
      lines.push(h('p', { class: 'dog-msg strong' }, t('dog_none')));
    }
    lines.push(h('p', { class: 'dog-msg' }, t('dog_today', {
      breaks: res.nBreaks ? humanDuration(res.breaks) : '—',
      lunch: res.nLunch ? humanDuration(res.lunch) : '—',
    })));
    out = h('div', {}, lines);
  }
  const dog = h('div', { class: `dog small${DOG.busy ? ' running' : ''}` });
  dog.innerHTML = COCKER_SVG; // dessin fixe, aucun texte saisi
  const name = dogName();
  return h('section', { class: 'card pad dog-card' },
    h('div', { class: 'dog-line' }, dog,
      h('button', {
        type: 'button', class: 'btn tonal grow', disabled: DOG.busy ? '' : null,
        on: { click: () => (name ? dogFetch(name) : askDogName()) },
      }, DOG.busy ? t('dog_busy') : t('dog_btn'))),
    name ? h('button', { type: 'button', class: 'btn text small dog-change', on: { click: askDogName } },
      t('dog_change', { name })) : null,
    out);
}

/** Le nom d'utilisateur de l'appli, demandé dans une fenêtre à part (puis retenu dans ce navigateur). */
function askDogName() {
  return openDialog((dlg, close) => {
    const input = h('input', {
      type: 'text', class: 'field', value: dogName(), autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
      maxlength: '40', placeholder: t('dog_name_ph'), 'aria-label': t('dog_name_ph'),
    });
    const go = () => { const v = input.value; close(null); dogFetch(v); };
    dlg.append(
      h('h2', {}, t('dog_ask_title')),
      h('form', { class: 'dlg-fields', on: { submit: (e) => { e.preventDefault(); go(); } } }, input),
      h('p', { class: 'small muted' }, t('dog_note')),
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn text', on: { click: () => close(null) } }, t('cancel')),
        h('button', { type: 'button', class: 'btn filled', on: { click: go } }, t('dog_btn'))));
    setTimeout(() => input.focus(), 50);
  });
}

/* ---------- Couleur de l'appli ---------- */
const PHONE_COLOR_KEY = 't2r.phoneColor';
function setPhoneColor(v) {
  const k = colorKey(v);
  try {
    if (k) localStorage.setItem(PHONE_COLOR_KEY, k); else localStorage.removeItem(PHONE_COLOR_KEY);
  } catch (_) { /* navigateur sans stockage */ }
  applyTheme();
}

/* ---------- Arrêter le chrono du téléphone depuis le site ----------
   Comme l'appli : la pause est enregistrée sous le nom (même identifiant que le chrono, donc jamais en double),
   puis le chrono partagé est arrêté. Le téléphone s'aligne quand l'appli se rouvre. */
async function phoneStopRemote() {
  const ph = PHONE;
  const who = dogName();
  if (!ph || !ph.id || !who) return;
  const elapsed = Math.max(0, Math.round((Date.now() - ph.start) / 1000));
  const over = ph.planned > 0 && elapsed > ph.planned;
  const Type = typeLabel(ph.type);
  // Dépassement : on peut aussi l'enregistrer « fini à l'heure » (durée prévue), comme dans l'appli.
  const choice = await openDialog((dlg, close) => {
    dlg.append(
      h('h2', {}, t('phone_stop_title', { Type, type: Type.toLowerCase() })),
      h('p', {}, t('phone_stop_body', { elapsed: humanDuration(elapsed) })),
      h('div', { class: 'dlg-actions wrap' },
        h('button', { type: 'button', class: 'btn text', on: { click: () => close(null) } }, t('cancel')),
        over ? h('button', { type: 'button', class: 'btn tonal', on: { click: () => close('on_time') } },
          t('phone_stop_on_time', { planned: humanDuration(ph.planned) })) : null,
        h('button', { type: 'button', class: 'btn filled danger', on: { click: () => close('now') } }, t('phone_stop_ok'))));
  });
  if (!choice) return;
  const secs = choice === 'on_time' ? ph.planned : elapsed;
  const d = new Date(ph.start);
  const row = { id: ph.id, date: dayKey(d), time: `${two(d.getHours())}:${two(d.getMinutes())}`, type: ph.type === 'lunch' ? 'lunch' : 'break', seconds: Math.min(secs, 86400) };
  try {
    await dogRpc('t2r_save', { p_username: who, p_rows: [row] });
    await dogRpc('t2r_run_stop', { p_username: who, p_id: ph.id });
  } catch (_) {
    toast(t('phone_stop_failed'));
    return;
  }
  phoneStop();
  // La pause rejoint tout de suite l'historique et les totaux du jour (ici et dans la carte du chien).
  mergeProfile([row]);
  render();
  dogFetch(who, true);
  toast(t('phone_stopped', { Type, type: Type.toLowerCase(), dur: humanDuration(secs) }));
}

/* ---------- Historique synchronisé avec l'appli quand le chien va chercher ----------
   1. les suppressions et les pauses faites ici (des 7 derniers jours) partent sous le nom ;
   2. la liste du serveur fait foi pour ces 7 jours : ajouts, modifications et suppressions faits dans
      l'appli arrivent ici. Les pauses plus anciennes (que le serveur ne garde plus) restent ici. */
const dogCutoff = () => { const d = new Date(); d.setDate(d.getDate() - 7); return dayKey(d); };

async function dogPush(who) {
  if (S.deleted.length) {
    const ids = S.deleted.slice(0, 500);
    await dogRpc('t2r_delete', { p_username: who, p_ids: ids });
    S.deleted = S.deleted.filter((id) => !ids.includes(id));
    saveEntries();
  }
  const cut = dogCutoff();
  const pending = S.entries.filter((e) => !e.synced && e.date >= cut).slice(0, 500);
  if (!pending.length) return;
  const rows = pending.map((e) => ({ id: e.id, date: e.date, time: e.time, type: e.type === 'lunch' ? 'lunch' : 'break', seconds: Math.min(e.seconds, 86400) }));
  await dogRpc('t2r_save', { p_username: who, p_rows: rows });
  // Modifiée pendant l'envoi : reste « à envoyer ».
  pending.forEach((e, i) => { const r = rows[i]; if (e.date === r.date && e.time === r.time && e.seconds === r.seconds) e.synced = true; });
  saveEntries();
}

function dogReconcile(rows) {
  const cut = dogCutoff();
  const gone = new Set(S.deleted);
  const local = new Set(S.entries.filter((e) => !e.synced).map((e) => e.id));
  const server = [];
  for (const r of rows) {
    const time = String((r && r.time) || '').slice(0, 5);
    if (!r || !r.id || gone.has(r.id) || local.has(r.id) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !/^\d{2}:\d{2}$/.test(time)) continue;
    server.push({ id: r.id, date: r.date, time, type: r.type === 'lunch' ? 'lunch' : 'break',
      seconds: Math.max(0, Math.min(86400, parseInt(r.seconds, 10) || 0)), synced: true });
  }
  const ids = new Set(server.map((e) => e.id));
  // Gardées ici : pas encore envoyées, ou trop anciennes pour le serveur (et pas dans sa liste).
  const keep = S.entries.filter((e) => !ids.has(e.id) && (!e.synced || e.date < cut));
  S.entries = keep.concat(server);
  sortEntries();
  saveEntries();
}

/* ---------- Historique du profil ----------
   Les pauses rangées en ligne sous le nom (les 7 derniers jours) rejoignent l'historique du site, avec leur
   identifiant : jamais en double, une pause supprimée ici ne revient pas, une pause modifiée ici est gardée. */
function mergeProfile(rows) {
  const gone = new Set(S.deleted);
  let changed = false;
  for (const r of rows) {
    if (!r || !r.id || gone.has(r.id) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !/^\d{2}:\d{2}$/.test(r.time)) continue;
    const type = r.type === 'lunch' ? 'lunch' : 'break';
    const seconds = Math.max(0, Math.min(86400, parseInt(r.seconds, 10) || 0));
    const e = S.entries.find((x) => x.id === r.id);
    if (!e) {
      S.entries.push({ id: r.id, date: r.date, time: r.time, type, seconds, synced: true });
      changed = true;
    } else if (e.synced && (e.date !== r.date || e.time !== r.time || e.type !== type || e.seconds !== seconds)) {
      Object.assign(e, { date: r.date, time: r.time, type, seconds });
      changed = true;
    }
  }
  if (changed) { sortEntries(); saveEntries(); }
}
