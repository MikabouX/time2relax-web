'use strict';

/* ---------- Horaires reçus (partage d'un proche), comme dans l'appli ----------
   Les codes d'invitation (16 chiffres) et le nom choisi restent dans ce navigateur. L'horaire est lu sur le
   serveur seulement à l'ouverture de la page (au plus toutes les 5 minutes) ou sur « Actualiser » ; sans
   connexion, la dernière copie reçue s'affiche. Présentation : la même grille que le planning de l'appli. */

const FOLLOWS_KEY = 't2r.follows';
const FOLLOW_CACHE = 't2r.followCache.';
const FW = { sel: 0, monday: null, data: {}, busy: {}, err: {}, at: {} };
const FW_HOUR = 42; // hauteur d'une heure dans la grille (px)

function readFollowsWeb() {
  try {
    const j = JSON.parse(localStorage.getItem(FOLLOWS_KEY) || '[]');
    return Array.isArray(j) ? j.filter((x) => x && typeof x.code === 'string' && /^\d{16}$/.test(x.code)) : [];
  } catch (_) { return []; }
}
function saveFollowsWeb(list) {
  try { localStorage.setItem(FOLLOWS_KEY, JSON.stringify(list)); } catch (_) { /* navigateur sans stockage */ }
}
const codeText = (c) => String(c).replace(/(\d{4})(?=\d)/g, '$1 ');
const followLabel = (f) => f.name || codeText(f.code);

function cachedFollow(code) {
  try { return JSON.parse(localStorage.getItem(FOLLOW_CACHE + code) || 'null'); } catch (_) { return null; }
}

async function fetchFollowWeb(code) {
  FW.busy[code] = true;
  FW.err[code] = '';
  FW.at[code] = Date.now();
  if (S.view === 'follows') render();
  try {
    const r = await dogRpc('t2r_share_get', { p_code: code });
    if (r && typeof r === 'object') {
      FW.data[code] = r;
      try { localStorage.setItem(FOLLOW_CACHE + code, JSON.stringify(r)); } catch (_) { /* plein */ }
    } else {
      FW.data[code] = null;
      FW.err[code] = t('fw_gone');
      try { localStorage.removeItem(FOLLOW_CACHE + code); } catch (_) { /* rien */ }
    }
  } catch (_) {
    FW.data[code] = cachedFollow(code);
    FW.err[code] = FW.data[code] ? t('fw_offline_copy') : t('fw_offline');
  }
  FW.busy[code] = false;
  if (S.view === 'follows') render();
}

/** Ouverture de la page (ou retour sur l'onglet) : relit l'horaire affiché s'il date de plus de 5 minutes. */
function followsMaybeFetch() {
  const list = readFollowsWeb();
  if (!list.length) return;
  const f = list[Math.min(FW.sel, list.length - 1)];
  if (!(f.code in FW.data)) FW.data[f.code] = cachedFollow(f.code);
  if (!FW.busy[f.code] && Date.now() - (FW.at[f.code] || 0) > 300000) fetchFollowWeb(f.code);
}

function openFollows() {
  go('follows');
  followsMaybeFetch();
}

/* ---------- Horaire reçu → semaine affichable ---------- */

const hmToMin = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Jours de l'horaire reçu : { 'AAAA-MM-JJ': { off, label, place, blocks: [{from, to, type, label}] } }. */
function followDays(data) {
  const payload = data && data.payload;
  const weeks = payload && Array.isArray(payload.weeks) ? payload.weeks : [];
  const days = {};
  const total = {};
  for (const w of weeks) {
    if (!w || !Array.isArray(w.days)) continue;
    for (const d of w.days) {
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.d)) continue;
      if (d.k === 'off') {
        days[d.d] = {
          off: true,
          label: d.off === 'holiday' ? (d.h || t('fw_holiday')) : d.off === 'absent' ? t('fw_absent') : t('fw_rest'),
          blocks: [],
        };
        continue;
      }
      const blocks = [];
      let others = false;
      for (const it of Array.isArray(d.items) ? d.items : []) {
        const from = it ? hmToMin(it.t) : null;
        if (from === null) continue;
        const type = it.y === 'lunch' ? 'lunch' : it.y === 'other' ? 'other' : 'break';
        const label = type === 'other' ? String(it.l || '').trim().slice(0, 40) : '';
        if (type === 'other' && !label) continue;
        if (type === 'other') {
          others = true;
          total[label.toLowerCase()] = (total[label.toLowerCase()] || 0) + (Number(it.m) || 0);
        }
        const min = Math.max(0, Number(it.m) || 0);
        blocks.push({ from, to: Math.min(24 * 60, from + (min || 5)), type, label, min });
      }
      // Sans le détail des autres activités : la journée (début – fin) en fond, breaks et lunchs par-dessus.
      if (!others) {
        const s = hmToMin(d.s);
        let e = hmToMin(d.e);
        if (s !== null && e !== null) {
          if (e <= s) e = 24 * 60; // travail de nuit : jusqu'à minuit ce jour-là
          blocks.unshift({ from: s, to: e, type: 'other', label: t('fw_work'), min: e - s, base: true });
        }
      }
      days[d.d] = { off: false, place: d.k === 'site' || d.k === 'remote' ? d.k : null, blocks };
    }
  }
  let main = '';
  let max = -1;
  for (const [k, v] of Object.entries(total)) if (v > max) { main = k; max = v; }
  return { days, main };
}

const fwMonday = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/* ---------- Page ---------- */

function followsView() {
  const list = readFollowsWeb();
  if (FW.sel >= list.length) FW.sel = 0;
  const f = list[FW.sel];
  return h('div', { class: 'page' },
    h('header', { class: 'top' },
      iconBtn('arrow_back', t('back'), goBack),
      h('h1', { class: 'grow' }, t('fw_title')),
      f ? iconBtn('refresh', t('fw_refresh'), () => fetchFollowWeb(f.code)) : null,
      iconBtn('add', t('fw_add'), addFollowDialog, 'accent')),
    list.length === 0
      ? h('div', { class: 'empty' }, icon('people', 56), h('p', {}, t('fw_intro')),
        h('button', { type: 'button', class: 'btn tonal', on: { click: addFollowDialog } }, icon('add', 18), t('fw_add')))
      : [
        list.length > 1 ? h('div', { class: 'chips' }, list.map((x, i) => chip(followLabel(x), i === FW.sel, () => { FW.sel = i; render(); followsMaybeFetch(); }))) : null,
        followWeek(f),
        h('div', { class: 'row fw-foot' },
          h('button', { type: 'button', class: 'btn text small', on: { click: () => removeFollow(f) } }, icon('delete', 18), t('fw_remove', { name: followLabel(f) }))),
      ]);
}

function followWeek(f) {
  const data = FW.data[f.code];
  const busy = FW.busy[f.code];
  const err = FW.err[f.code];
  if (!FW.monday) FW.monday = fwMonday(new Date());
  const monday = FW.monday;
  const { days, main } = followDays(data);
  const keys = [0, 1, 2, 3, 4, 5, 6].map((i) => dayKey(addDays(monday, i)));
  const week = keys.map((k) => days[k] || null);
  let lo = 24 * 60;
  let hi = 0;
  week.forEach((d) => (d ? d.blocks : []).forEach((b) => { lo = Math.min(lo, b.from); hi = Math.max(hi, b.to); }));
  const h0 = hi > lo ? Math.floor(lo / 60) : 8;
  const h1 = hi > lo ? Math.min(24, Math.max(h0 + 1, Math.ceil(hi / 60))) : 18;
  const sunday = addDays(monday, 6);
  const today = dayKey(new Date());
  const empty = week.every((d) => !d || (!d.off && !d.blocks.length && !d.place));
  const anyPlace = week.some((d) => d && d.place);
  const updated = data && data.updated ? new Date(data.updated) : null;

  const status = err
    ? h('p', { class: 'small center fw-err' }, err)
    : updated && !Number.isNaN(updated.getTime())
      ? h('p', { class: 'small muted center' }, t('fw_updated', { date: dateLong(updated), time: `${two(updated.getHours())}:${two(updated.getMinutes())}` }))
      : null;

  const nav = h('div', { class: 'fw-nav' },
    iconBtn('chevron_left', t('fw_prev'), () => { FW.monday = addDays(monday, -7); render(); }),
    h('div', { class: 'grow center strong' }, monday.getMonth() === sunday.getMonth()
      ? `${monday.getDate()} – ${dateLong(sunday)}` : `${dateLong(monday)} – ${dateLong(sunday)}`),
    iconBtn('chevron_right', t('fw_next'), () => { FW.monday = addDays(monday, 7); render(); }));

  const head = h('div', { class: 'fw-head' }, h('div', {}),
    keys.map((k, i) => {
      const d = addDays(monday, i);
      const pl = week[i] && !week[i].off ? week[i].place : null;
      return h('div', { class: `fw-day${k === today ? ' now' : ''}` },
        h('div', { class: 'small muted' }, d.toLocaleDateString(LANG, { weekday: 'short' })),
        h('div', { class: 'strong' }, String(d.getDate())),
        anyPlace ? h('div', { class: `fw-place ${pl || ''}` }, pl ? icon(pl === 'remote' ? 'home' : 'directions_car', 15) : null) : null);
    }));

  let grid;
  if (busy && !data) grid = h('p', { class: 'center muted pad' }, t('fw_loading'));
  else if (empty) grid = h('p', { class: 'center muted pad' }, t('fw_empty_week'));
  else {
    const y = (m) => ((m - h0 * 60) / 60) * FW_HOUR;
    const height = (h1 - h0) * FW_HOUR;
    const axis = h('div', { class: 'fw-axis', style: `height:${height}px` });
    for (let hr = h0; hr < h1; hr += 1) axis.append(h('span', { style: `top:${(hr - h0) * FW_HOUR - 7}px` }, `${two(hr)}h`));
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const cols = keys.map((k, i) => {
      const d = week[i];
      const col = h('div', { class: 'fw-col', style: `height:${height}px;background-size:100% ${FW_HOUR}px` });
      if (d && d.off) col.append(h('div', { class: 'fw-off' }, h('span', {}, d.label)));
      else if (d) {
        // L'activité principale (ou la journée) d'abord, en fond ; le reste par-dessus.
        const isMain = (b) => b.base || (b.type === 'other' && b.label.toLowerCase() === main);
        [...d.blocks.filter(isMain), ...d.blocks.filter((b) => !isMain(b))].forEach((b) => {
          const top = y(b.from);
          const hgt = Math.max(6, y(b.to) - top - 1);
          const cls = b.type === 'break' ? 'brk' : b.type === 'lunch' ? 'lun' : isMain(b) ? 'main' : 'oth';
          const name = b.type === 'other' ? b.label : typeLabel(b.type);
          const start = `${two(Math.floor(b.from / 60))}:${two(b.from % 60)}`;
          const end = `${two(Math.floor(b.to / 60) % 24)}:${two(b.to % 60)}`;
          col.append(h('div', {
            class: `fw-blk ${cls}`, style: `top:${top + 0.5}px;height:${hgt}px`, title: `${name} · ${start} – ${end}`,
          }, hgt < 16 ? '' : hgt < 30 ? name : [h('span', {}, start), h('br', {}), name]));
        });
      }
      if (k === today && nowMin >= h0 * 60 && nowMin <= h1 * 60) col.append(h('div', { class: 'fw-now', style: `top:${y(nowMin) - 1}px` }));
      return col;
    });
    grid = h('div', { class: 'fw-grid' }, axis, cols);
  }

  const legend = h('div', { class: 'fw-legend small' },
    [['brk', typeLabel('break')], ['lun', typeLabel('lunch')], ['oth', t('fw_other')], main ? ['main', capitalize(main)] : null]
      .filter(Boolean).map(([c, l]) => h('span', {}, h('i', { class: `fw-sw ${c}` }), l)),
    week.some((d) => d && d.place === 'site') ? h('span', {}, icon('directions_car', 14), t('fw_site')) : null,
    week.some((d) => d && d.place === 'remote') ? h('span', {}, icon('home', 14), t('fw_remote')) : null);

  return h('section', { class: 'card pad fw-card' }, status, nav, head, grid, legend);
}

function addFollowDialog() {
  return openDialog((dlg, close) => {
    const code = h('input', { type: 'text', class: 'field', inputmode: 'numeric', autocomplete: 'off', placeholder: t('fw_code'), 'aria-label': t('fw_code') });
    const name = h('input', { type: 'text', class: 'field', autocomplete: 'off', maxlength: '40', placeholder: t('fw_name'), 'aria-label': t('fw_name') });
    const msg = h('p', { class: 'small fw-err', role: 'status' });
    const add = async () => {
      const c = String(code.value).replace(/\D/g, '');
      if (c.length !== 16) { msg.textContent = t('fw_need16'); return; }
      msg.textContent = '';
      let r;
      try { r = await dogRpc('t2r_share_get', { p_code: c }); } catch (_) { msg.textContent = t('fw_offline'); return; }
      if (!r || typeof r !== 'object') { msg.textContent = t('fw_unknown'); return; }
      const list = readFollowsWeb().filter((x) => x.code !== c);
      list.push({ code: c, name: String(name.value).trim().slice(0, 40) });
      saveFollowsWeb(list);
      FW.data[c] = r;
      FW.at[c] = Date.now();
      FW.err[c] = '';
      try { localStorage.setItem(FOLLOW_CACHE + c, JSON.stringify(r)); } catch (_) { /* plein */ }
      FW.sel = list.length - 1;
      close(null);
      render();
    };
    dlg.append(
      h('h2', {}, t('fw_add')),
      h('form', { class: 'dlg-fields', on: { submit: (e) => { e.preventDefault(); add(); } } }, code, name, msg),
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn text', on: { click: () => close(null) } }, t('cancel')),
        h('button', { type: 'button', class: 'btn filled', on: { click: add } }, t('fw_add_ok'))));
    setTimeout(() => code.focus(), 50);
  });
}

async function removeFollow(f) {
  const ok = await confirmDialog({ title: t('fw_remove', { name: followLabel(f) }), body: t('fw_remove_body'), ok: t('delete'), danger: true });
  if (!ok) return;
  saveFollowsWeb(readFollowsWeb().filter((x) => x.code !== f.code));
  try { localStorage.removeItem(FOLLOW_CACHE + f.code); } catch (_) { /* rien */ }
  delete FW.data[f.code];
  FW.sel = 0;
  render();
}
