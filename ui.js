'use strict';

/* ---------- Petits utilitaires DOM (jamais d'innerHTML avec du texte saisi) ---------- */

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') e.className = v;
    else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => e.addEventListener(ev, fn));
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

// Icônes (Material Design) : chemins fixes écrits ici, jamais construits à partir de texte saisi.
const ICONS = {
  arrow_back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  more_vert: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  history: 'M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  coffee: 'M18.5 3H6c-1.1 0-2 .9-2 2v5.71c0 3.83 2.95 7.18 6.78 7.29 3.96.12 7.22-3.06 7.22-7v-1h.5c1.93 0 3.5-1.57 3.5-3.5S20.43 3 18.5 3zM16 5v3H6V5h10zm2.5 3H18V5h.5c.83 0 1.5.67 1.5 1.5S19.33 8 18.5 8zM4 19h16v2H4z',
  restaurant: 'M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z',
  play: 'M8 5v14l11-7z',
  stop: 'M6 6h12v12H6z',
  bag: 'M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-8 4c0 .55-.45 1-1 1s-1-.45-1-1V8h2v2zm2-6c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm4 6c0 .55-.45 1-1 1s-1-.45-1-1V8h2v2z',
  timer: 'M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z',
  schedule: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5l-1-1h-5l-1 1H5v2h14V4z',
  delete_sweep: 'M15 16h4v2h-4zm0-8h7v2h-7zm0 4h6v2h-6zM3 18c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2V8H3v10zM14 5h-3l-1-1H6L5 5H2v2h12z',
  delete_forever: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z',
  warning: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  expand_more: 'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z',
  radio: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z',
  check_circle: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
  event: 'M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z',
  phone_android: 'M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z',
  open_in_new: 'M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  cloud: 'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z',
};

function icon(name, size) {
  const px = size || 24;
  const span = h('span', { class: 'ico', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="currentColor"><path d="${ICONS[name] || ''}"/></svg>`;
  return span;
}

const $app = document.getElementById('app');

/** Adresse sûre pour un lien : uniquement http(s). */
const safeUrl = (u) => (/^https?:\/\//i.test(String(u)) ? u : 'about:blank');

/* ---------- Navigation (le bouton « précédent » du navigateur fonctionne) ---------- */

let navDepth = 0;

function go(view, push = true) {
  if (S.view === view) return;
  S.view = view;
  if (push) navDepth += 1;
  try {
    // Sans « push », on remplace l'entrée courante : le bouton précédent reste cohérent.
    if (push) history.pushState({ v: view, d: navDepth }, '');
    else history.replaceState({ v: view, d: navDepth }, '');
  } catch (_) { /* file:// restreint */ }
  window.scrollTo(0, 0);
  render();
}

function goBack() {
  if (navDepth > 0) history.back();
  else go('home', false);
}

window.addEventListener('popstate', (e) => {
  navDepth = (e.state && e.state.d) || 0;
  S.view = (e.state && e.state.v) || 'home';
  render();
});

/* ---------- Message en bas d'écran, boîtes de dialogue ---------- */

let toastTimer = null;

function hideToast() {
  const box = document.getElementById('toast');
  if (box) box.classList.remove('show');
}

function toast(message, action, ms) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.replaceChildren(h('span', {}, message));
  if (action) {
    box.append(h('button', { type: 'button', class: 'toast-action', on: { click: () => { hideToast(); action.fn(); } } }, action.label));
  }
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms || (action ? 8000 : 3500));
}

function openDialog(build) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dlg' });
    const close = (value) => { dlg.close(); dlg.remove(); resolve(value); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    build(dlg, close);
    document.body.append(dlg);
    dlg.showModal();
  });
}

function confirmDialog({ title, body, ok, danger }) {
  return openDialog((dlg, close) => {
    dlg.append(
      icon('warning', 28),
      h('h2', {}, title),
      h('p', { class: 'dlg-body' }, body),
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn text', on: { click: () => close(false) } }, t('cancel')),
        h('button', { type: 'button', class: `btn filled${danger ? ' danger' : ''}`, on: { click: () => close(true) } }, ok)),
    );
  }).then((v) => v === true);
}

/** Lien web tapé à la main (www.exemple.be, https://…) ; null s'il n'en est pas un. */
function shopUrlFrom(text) {
  let u = String(text || '').trim();
  if (!u || /^https?:\/\/$/i.test(u) || /\s/.test(u)) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const url = new URL(u);
    if (!url.hostname.includes('.')) return null;
  } catch (_) { return null; }
  return u;
}

const shopNameFrom = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; } };

function shopDialog(initial) {
  return openDialog((dlg, close) => {
    const url = h('input', { type: 'url', class: 'field', value: initial ? initial.url : '', placeholder: t('shop_link_hint'), 'aria-label': t('shop_link') });
    const name = h('input', { type: 'text', class: 'field', value: initial ? initial.name : '', placeholder: t('shop_name'), 'aria-label': t('shop_name') });
    const error = h('p', { class: 'small dlg-error', hidden: true, role: 'alert' });
    const submit = () => {
      const u = shopUrlFrom(url.value);
      if (!u) { error.textContent = t('shop_err'); error.hidden = false; return; }
      close({ name: name.value.trim() || shopNameFrom(u), url: u });
    };
    dlg.append(
      h('h2', {}, initial ? t('shop_edit_title') : t('shop_add_title')),
      h('div', { class: 'dlg-fields' },
        h('label', { class: 'small muted' }, t('shop_link')), url,
        h('label', { class: 'small muted' }, t('shop_name')), name),
      error,
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn text', on: { click: () => close(null) } }, t('cancel')),
        h('button', { type: 'button', class: 'btn filled', on: { click: submit } }, t('ok'))),
    );
    [name, url].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
  });
}

/** Choix d'un nombre de minutes : − / +, ou un choix rapide. zeroLabel : texte pour 0 (« à l'heure »). */
function minutesDialog({ title, value, min, max, presets = [], zeroLabel = null, note = null }) {
  return openDialog((dlg, close) => {
    let v = Math.min(Math.max(value, min), max);
    const label = (m) => (m === 0 && zeroLabel ? zeroLabel : t('minutes_n', { m }));
    const out = h('output', { class: 'min-value' });
    const minus = h('button', { type: 'button', class: 'icon-btn tonal', 'aria-label': '−1', on: { click: () => set(v - 1) } }, '−');
    const plus = h('button', { type: 'button', class: 'icon-btn tonal', 'aria-label': '+1', on: { click: () => set(v + 1) } }, '+');
    const chips = h('div', { class: 'chips center' });
    function set(n) {
      v = Math.min(Math.max(n, min), max);
      out.textContent = label(v);
      minus.disabled = v <= min;
      plus.disabled = v >= max;
      chips.replaceChildren(...presets.map((m) => chip(label(m), v === m, () => set(m))));
    }
    set(v);
    dlg.append(...[
      h('h2', {}, title),
      h('div', { class: 'min-row' }, minus, out, plus),
      presets.length ? chips : null,
      note ? h('p', { class: 'small muted' }, note) : null,
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn text', on: { click: () => close(null) } }, t('cancel')),
        h('button', { type: 'button', class: 'btn filled', on: { click: () => close(v) } }, t('ok'))),
    ].filter(Boolean));
  });
}

const pickBreakMinutes = () => minutesDialog({ title: t('dur_break_title'), value: S.ui.pauseMinutes, min: BREAK_MIN, max: BREAK_MAX, presets: [5, 10, 15, 20, 30] });
const pickLunchMinutes = () => minutesDialog({ title: t('dur_lunch_title'), value: S.ui.lunchMinutes, min: LUNCH_MIN, max: LUNCH_MAX, presets: [20, 30, 45, 60] });

async function editDuration(lunch) {
  const m = await (lunch ? pickLunchMinutes() : pickBreakMinutes());
  if (m === null || m === undefined) return;
  if (lunch) S.ui.lunchMinutes = m; else S.ui.pauseMinutes = m;
  saveUi();
  render();
}

function pickShopDialog() {
  return openDialog((dlg, close) => {
    dlg.append(
      h('h2', {}, t('pick_shop_title')),
      h('div', { class: 'pick-list' }, S.prefs.shops.map((s, i) => h('button', {
        type: 'button',
        class: 'pick-item',
        on: { click: () => close(i) },
      }, icon(i === S.prefs.shopIndex ? 'check_circle' : 'radio', 22), h('span', {}, s.name)))),
      h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn text', on: { click: () => close(null) } }, t('cancel'))),
    );
  });
}

/* ---------- Dessin de la page ---------- */

function render() {
  document.documentElement.lang = LANG;
  applyTheme(); // couleur et mode (aussi après une synchro ou une réinitialisation)
  let page;
  if (S.view === 'history') page = historyView();
  else if (S.view === 'welcome') page = welcomeView();
  else if (S.view === 'plan') page = planView();
  else page = homeView(); // les réglages sont en bas de l'accueil
  $app.replaceChildren(page);
  if (S.view === 'home' || S.view === 'settings') updateRing(true);
  if (S.view === 'settings') {
    const sec = document.getElementById('settings');
    if (sec) sec.scrollIntoView();
  }
  updateTitle();
}

/** Appelé par la synchro quand son état change. */
function onSyncChange() {
  render();
}

const iconBtn = (name, label, onClick, cls) => h('button', {
  type: 'button', class: `icon-btn ${cls || ''}`, title: label, 'aria-label': label, on: { click: onClick },
}, icon(name, 22));

const chip = (label, selected, onClick) => h('button', {
  type: 'button', class: `chip${selected ? ' on' : ''}`, 'aria-pressed': String(!!selected), on: { click: onClick },
}, label);

/* ---------- Accueil ---------- */

const RING = 220;
const STROKE = 13;
const PLAN_STROKE = 4; // fin arc gris autour du cadran : le temps avant le prochain break prévu
const PLAN_R = (RING - PLAN_STROKE) / 2;
const PLAN_CIRC = 2 * Math.PI * PLAN_R;
const RADIUS = PLAN_R - PLAN_STROKE / 2 - 1.5 - STROKE / 2;
const CIRC = 2 * Math.PI * RADIUS;

function homeView() {
  return h('div', { class: 'page' },
    h('header', { class: 'top' },
      h('div', { class: 'grow' },
        h('div', { class: 'muted small' }, greeting()),
        h('div', { class: 'date' }, capitalize(dateLong(new Date())))),
      iconBtn('history', t('history'), () => go('history')),
      iconBtn('event', t('plan_title'), () => go('plan')),
      iconBtn('settings', t('settings'), () => { const sec = document.getElementById('settings'); if (sec) sec.scrollIntoView({ behavior: 'smooth' }); })),
    todayCard(),
    typeSelector(),
    ringBlock(),
    h('div', { class: 'options' }, S.run ? runningInfo() : timerOptions()),
    startButton(),
    appStrip(),
    settingsSection());
}

/** Liens directs vers les applis mobiles. */
const storeLinks = () => h('div', { class: 'store-links' },
  h('a', { class: 'btn tonal', href: safeUrl(ANDROID_URL), rel: 'noopener noreferrer' }, icon('phone_android', 18), 'Android'),
  h('a', { class: 'btn tonal', href: safeUrl(IPHONE_URL), target: '_blank', rel: 'noopener noreferrer' }, icon('phone_android', 18), 'iPhone'));

/** Sous le chrono : « Pour plus de fonctionnalités, téléchargez l'application mobile ». */
function appStrip() {
  return h('div', { class: 'card pad app-strip' },
    h('p', { class: 'small' }, t('more_features')),
    storeLinks());
}

/* ---------- Première visite : courte page d'accueil ---------- */

function welcomeView() {
  const features = ['app_f1', 'app_f2', 'app_f3', 'app_f4', 'app_f5'];
  return h('div', { class: 'page welcome' },
    h('header', { class: 'top' }, h('h1', { class: 'grow' }, t('welcome_title'))),
    h('p', {}, t('welcome_web')),
    langCard(),
    h('div', { class: 'card pad' },
      h('div', { class: 'strong' }, t('app_features_title')),
      h('ul', { class: 'feature-list' }, features.map((k) => h('li', {}, t(k))))),
    h('div', { class: 'card pad' },
      h('div', { class: 'strong' }, t('download_title')),
      storeLinks()),
    h('p', { class: 'center' }, h('a', { href: safeUrl(SITE_URL), target: '_blank', rel: 'noopener noreferrer' }, t('learn_more'))),
    h('div', { class: 'center' },
      h('button', { type: 'button', class: 'btn text small-btn', on: { click: () => { S.prefs.setupDone = true; savePrefs(); go('home', false); } } }, t('continue_web'))));
}

function statBlock(iconName, label, agg) {
  return h('div', { class: 'stat' },
    h('span', { class: 'stat-ico' }, icon(iconName, 18)),
    h('div', { class: 'stat-txt' },
      h('div', { class: 'stat-label' }, agg.n === 0 ? label : `${label} · ${agg.n}`),
      h('div', { class: 'stat-val' }, agg.n === 0 ? '—' : humanDuration(agg.s))));
}

function todayCard() {
  const key = todayKey();
  const tot = dayTotals(S.entries.filter((e) => workDay(e) === key));
  return h('section', { class: 'today', id: 'todayCard' },
    statBlock('coffee', t('stat_breaks'), tot.b),
    h('div', { class: 'vsep' }),
    statBlock('restaurant', t('stat_lunch'), tot.l));
}

function typeSelector() {
  const running = !!S.run;
  const current = running ? S.run.type : S.ui.type;
  const seg = (value, label, ic) => h('button', {
    type: 'button',
    class: `seg${current === value ? ' on' : ''}`,
    disabled: running,
    on: { click: () => { S.ui.type = value; saveUi(); render(); } },
  }, icon(ic, 20), h('span', {}, label));
  return h('div', { class: `segs${running ? ' dim' : ''}` },
    seg('break', t('type_break'), 'coffee'),
    seg('lunch', t('type_lunch'), 'restaurant'));
}

function ringBlock() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${RING} ${RING}`);
  svg.setAttribute('class', 'ring-svg');
  const circle = (cls) => {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', RING / 2);
    c.setAttribute('cy', RING / 2);
    c.setAttribute('r', RADIUS);
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke-width', STROKE);
    c.setAttribute('class', cls);
    return c;
  };
  const arc = circle('ring-arc');
  arc.id = 'ringArc';
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('stroke-dasharray', CIRC);
  arc.setAttribute('transform', `rotate(-90 ${RING / 2} ${RING / 2})`);
  const planCircle = (cls, id) => {
    const c = document.createElementNS(ns, 'circle');
    c.id = id;
    c.setAttribute('cx', RING / 2);
    c.setAttribute('cy', RING / 2);
    c.setAttribute('r', PLAN_R);
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke-width', PLAN_STROKE);
    c.setAttribute('class', cls);
    return c;
  };
  const planTrack = planCircle('plan-track', 'planTrack');
  const planArc = planCircle('plan-arc', 'planArc');
  planArc.setAttribute('stroke-linecap', 'round');
  planArc.setAttribute('stroke-dasharray', PLAN_CIRC);
  planArc.setAttribute('transform', `rotate(-90 ${RING / 2} ${RING / 2})`);
  svg.append(planTrack, planArc, circle('ring-track'), arc);
  const type = S.run ? S.run.type : S.ui.type;
  return h('div', { class: 'ring-wrap' },
    h('div', { class: 'ring', role: 'timer', 'aria-live': 'off' },
      svg,
      h('div', { class: 'ring-in' },
        h('span', { id: 'ringIco', class: 'ring-ico' }, icon(type === 'lunch' ? 'restaurant' : 'coffee', 24)),
        h('div', { id: 'ringBig', class: 'ring-big' }),
        h('div', { id: 'ringCap', class: 'ring-cap' }))),
    h('div', { id: 'planLine', class: 'plan-line', hidden: true }, icon('schedule', 16), h('span', { id: 'planText' })));
}

/** Met à jour l'anneau et les chiffres, sans reconstruire la page. */
function updateRing(initial) {
  const arc = document.getElementById('ringArc');
  if (!arc) return;
  const st = ringState();
  arc.classList.toggle('animate', !initial && st.hasTimer);
  arc.style.strokeDashoffset = String(CIRC * (1 - st.progress));
  arc.style.stroke = st.color;
  arc.style.opacity = st.progress > 0 ? '1' : '0';
  const alert = st.over || st.lastMinute;
  const big = document.getElementById('ringBig');
  const cap = document.getElementById('ringCap');
  const ico = document.getElementById('ringIco');
  if (big.textContent !== st.big) big.textContent = st.big;
  if (cap.textContent !== st.cap) cap.textContent = st.cap;
  big.style.color = alert ? st.color : '';
  cap.style.color = alert ? st.color : '';
  ico.style.color = st.color;
  updatePlan();
}

function runningInfo() {
  const r = S.run;
  const hm = (ms) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
  const line = r.planned > 0
    ? t('run_timer', { start: hm(r.start), end: hm(r.start + r.planned * 1000) })
    : t('run_nolimit', { start: hm(r.start) });
  return h('div', { class: 'card info' }, icon('schedule', 20), h('span', {}, line, r.pushed ? h('span', { class: 'small muted' }, ` · ${t('run_shared')}`) : null));
}

function timerOptions() {
  const lunch = S.ui.type === 'lunch';
  const sub = S.ui.useTimer ? (lunch ? t('lunch_duration') : t('break_duration')) : t('stopwatch_only');
  const box = h('input', {
    type: 'checkbox',
    class: 'switch',
    role: 'switch',
    checked: S.ui.useTimer,
    'aria-label': t('timer_switch'),
    on: {
      change: (e) => {
        S.ui.useTimer = e.target.checked;
        saveUi();
        if (S.ui.useTimer) { requestNotifPermission(); ensureAudio(); }
        render();
      },
    },
  });
  // Une seule pastille : la durée choisie par l'utilisateur ; un clic permet de la changer.
  const chips = [h('button', {
    type: 'button',
    class: 'chip on dur-chip',
    title: t('dur_edit'),
    'aria-label': `${t('dur_edit')} : ${t('minutes_n', { m: lunch ? S.ui.lunchMinutes : S.ui.pauseMinutes })}`,
    on: { click: () => editDuration(lunch) },
  }, t('minutes_n', { m: lunch ? S.ui.lunchMinutes : S.ui.pauseMinutes }), ' ', icon('edit', 16))];
  return h('div', { class: 'card timer-opts' },
    h('label', { class: 'switch-row' },
      icon('timer', 24),
      h('span', { class: 'grow' },
        h('span', { class: 'strong block' }, t('timer_switch')),
        h('span', { class: 'small muted block' }, sub)),
      box),
    S.ui.useTimer ? h('div', { class: 'chips scroll' }, chips) : null,
    h('div', { class: 'timer-note small muted' }, icon('timer', 18), h('span', {}, t('timer_web_note'))));
}

function startButton() {
  const running = !!S.run;
  const name = typeLabel(running ? S.run.type : S.ui.type);
  const vars = { type: name.toLowerCase(), Type: name };
  return h('button', {
    type: 'button',
    class: `start${running ? ' stop' : ''}`,
    on: { click: running ? endRun : beginRun },
  }, icon(running ? 'stop' : 'play', 26), h('span', {}, t(running ? 'stop_btn' : 'start_btn', vars)));
}

/** Bouton « Commander » vers le site choisi (la petite flèche permet d'en changer). */
function orderTile() {
  const shop = S.prefs.shops[S.prefs.shopIndex];
  if (!shop) {
    // Aucun site encore : le bouton propose d'en ajouter un.
    return h('div', { class: 'tile-wrap' },
      h('button', { type: 'button', class: 'tile', on: { click: addShop } },
        icon('bag', 26),
        h('span', { class: 'tile-txt' },
          h('span', { class: 'tile-label' }, t('order')),
          h('span', { class: 'tile-cap' }, t('order_add')))));
  }
  return h('div', { class: 'tile-wrap' },
    h('a', { class: 'tile', href: safeUrl(shop.url), target: '_blank', rel: 'noopener noreferrer' },
      icon('bag', 26),
      h('span', { class: 'tile-txt' },
        h('span', { class: 'tile-label' }, t('order')),
        h('span', { class: 'tile-cap' }, shop.name))),
    S.prefs.shops.length > 1
      ? h('button', { type: 'button', class: 'tile-pick', title: t('pick_shop'), 'aria-label': t('pick_shop'), on: { click: choseShop } }, icon('expand_more', 18))
      : null);
}

async function choseShop() {
  const i = await pickShopDialog();
  if (i === null || i === undefined) return;
  S.prefs.shopIndex = i;
  savePrefs();
  render();
}

/* ---------- Historique ---------- */

function historyView() {
  const entries = S.entries.slice().reverse();
  const byDay = new Map();
  entries.forEach((e) => {
    const k = workDay(e);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  });

  const menu = h('div', { class: 'menu', id: 'histMenu', hidden: true },
    menuItem('download', t('menu_export'), doExport),
    menuItem('upload', t('menu_import'), pickImportFile),
    h('hr', {}),
    menuItem('delete_sweep', t('menu_clear_old'), () => clearHistory(true)),
    menuItem('delete_forever', t('menu_clear_all'), () => clearHistory(false)));

  const body = entries.length === 0
    ? h('div', { class: 'empty' }, icon('history', 56), h('p', {}, t('history_empty')),
      h('button', { type: 'button', class: 'btn tonal', on: { click: () => editEntry(null) } }, icon('add', 18), t('entry_add')))
    : [...byDay.entries()].map(([key, list]) => dayBlock(key, list)).concat(h('p', { class: 'small muted note center' }, t('keep_note')));

  return h('div', { class: 'page' },
    h('header', { class: 'top' },
      iconBtn('arrow_back', t('back'), goBack),
      h('h1', { class: 'grow' }, t('history')),
      iconBtn('add', t('entry_add'), () => editEntry(null), 'accent'),
      h('div', { class: 'menu-wrap' }, iconBtn('more_vert', t('more'), toggleMenu), menu)),
    body);
}

function menuItem(ic, label, fn) {
  return h('button', { type: 'button', class: 'menu-item', on: { click: () => { closeMenu(); fn(); } } }, icon(ic, 20), h('span', {}, label));
}

function closeMenu() {
  const m = document.getElementById('histMenu');
  if (m) m.hidden = true;
  document.removeEventListener('click', onDocClick, true);
}

function onDocClick(e) {
  const m = document.getElementById('histMenu');
  if (m && !m.contains(e.target) && !e.target.closest('.menu-wrap')) closeMenu();
}

function toggleMenu() {
  const m = document.getElementById('histMenu');
  if (!m) return;
  if (m.hidden) {
    m.hidden = false;
    document.addEventListener('click', onDocClick, true);
  } else {
    closeMenu();
  }
}

function dayBlock(key, list) {
  const tot = dayTotals(list);
  const totalChip = (ic, text, cls) => h('span', { class: `chip-total ${cls}` }, icon(ic, 14), text);
  return h('section', { class: 'day' },
    h('div', { class: 'day-head' },
      h('span', { class: 'grow day-name' }, dayLabel(key)),
      tot.b.n ? totalChip('coffee', humanDuration(tot.b.s), 'brk') : null,
      tot.l.n ? totalChip('restaurant', humanDuration(tot.l.s), 'lun') : null),
    list.map(entryRow));
}

function entryRow(e) {
  const lunch = e.type === 'lunch';
  return h('div', { class: 'entry' },
    h('span', { class: `avatar ${lunch ? 'lun' : 'brk'}` }, icon(lunch ? 'restaurant' : 'coffee', 20)),
    h('div', { class: 'grow' },
      h('div', { class: 'strong' }, typeLabel(e.type)),
      h('div', { class: 'small muted' }, t('at_time', { time: e.time }))),
    h('span', { class: 'dur' }, formatDuration(e.seconds)),
    iconBtn('edit', t('edit'), () => editEntry(e)),
    iconBtn('delete', t('delete'), () => deleteEntry(e)));
}

/** Boîte « ajouter / modifier une entrée » : renvoie {type, date, time, seconds}, ou null si on annule. */
function entryDialog(initial) {
  return openDialog((dlg, close) => {
    const now = new Date();
    const todayCal = dayKey(now);
    let type = initial ? initial.type : 'break';
    let touched = !!initial; // durée modifiée à la main : on ne la remplace plus quand on change de type
    const defaultMinutes = (v) => (v === 'lunch' ? S.ui.lunchMinutes : S.ui.pauseMinutes);

    const date = h('input', {
      type: 'date', class: 'field', required: true, min: oldestKeptDay(), max: todayCal, 'aria-label': t('entry_date'),
      value: initial ? initial.date : todayCal,
    });
    const time = h('input', {
      type: 'time', class: 'field', required: true, 'aria-label': t('entry_start'),
      value: initial ? initial.time : `${two(now.getHours())}:${two(now.getMinutes())}`,
    });
    const mins = h('input', {
      type: 'number', class: 'field num', min: '0', max: '1440', step: '1', inputmode: 'numeric', 'aria-label': t('entry_minutes'),
      value: String(initial ? Math.floor(initial.seconds / 60) : defaultMinutes(type)),
    });
    const secs = h('input', {
      type: 'number', class: 'field num', min: '0', max: '59', step: '1', inputmode: 'numeric', 'aria-label': t('entry_seconds'),
      value: String(initial ? initial.seconds % 60 : 0),
    });
    [mins, secs].forEach((el) => el.addEventListener('input', () => { touched = true; }));

    const hint = h('p', { class: 'small muted', hidden: true, 'aria-live': 'polite' });
    const error = h('p', { class: 'small dlg-error', hidden: true, role: 'alert' });
    const fail = (message) => { error.textContent = message; error.hidden = false; };

    const updateHint = () => {
      const d = parseDay(date.value);
      let text = '';
      if (S.prefs.nightMode && d && dayKey(d) === date.value && /^\d{2}:\d{2}$/.test(time.value)) {
        const key = workDay({ date: date.value, time: time.value });
        if (key !== date.value) text = t('entry_night_note', { day: dateLong(parseDay(key)) });
      }
      hint.textContent = text;
      hint.hidden = !text;
    };
    [date, time].forEach((el) => { el.addEventListener('input', updateHint); el.addEventListener('change', updateHint); });

    const segBtns = {};
    const pickType = (v) => {
      type = v;
      Object.entries(segBtns).forEach(([k, b]) => { b.classList.toggle('on', k === v); b.setAttribute('aria-pressed', String(k === v)); });
      if (!touched) { mins.value = String(defaultMinutes(v)); secs.value = '0'; }
    };
    const seg = (value, ic) => {
      segBtns[value] = h('button', {
        type: 'button', class: `seg${type === value ? ' on' : ''}`, 'aria-pressed': String(type === value), on: { click: () => pickType(value) },
      }, icon(ic, 20), h('span', {}, typeLabel(value)));
      return segBtns[value];
    };

    const submit = () => {
      error.hidden = true;
      const d = parseDay(date.value);
      if (!d || dayKey(d) !== date.value || date.value > todayCal || date.value < oldestKeptDay()) return fail(t('entry_err_date'));
      if (!/^\d{2}:\d{2}$/.test(time.value)) return fail(t('entry_err_time'));
      const m = mins.value === '' ? 0 : Number(mins.value);
      const s = secs.value === '' ? 0 : Number(secs.value);
      const total = m * 60 + s;
      if (!Number.isInteger(m) || !Number.isInteger(s) || m < 0 || s < 0 || s > 59 || total < 1 || total > 86400) return fail(t('entry_err_duration'));
      return close({ type, date: date.value, time: time.value, seconds: total });
    };

    dlg.append(
      h('h2', {}, initial ? t('entry_edit_title') : t('entry_add')),
      h('div', { class: 'dlg-fields' },
        h('div', { class: 'segs' }, seg('break', 'coffee'), seg('lunch', 'restaurant')),
        h('div', { class: 'fld-pair' },
          h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, t('entry_date')), date),
          h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, t('entry_start')), time)),
        h('div', { class: 'fld' },
          h('span', { class: 'fld-label' }, t('entry_duration')),
          h('div', { class: 'dur-row' }, mins, h('span', { class: 'unit' }, 'min'), secs, h('span', { class: 'unit' }, 's'))),
        hint,
        error),
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn text', on: { click: () => close(null) } }, t('cancel')),
        h('button', { type: 'button', class: 'btn filled', on: { click: submit } }, t('entry_save'))),
    );
    [date, time, mins, secs].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }));
    updateHint();
  });
}

/** Ajoute (entry = null) ou modifie une entrée de l'historique, pour les oublis. */
async function editEntry(entry) {
  const res = await entryDialog(entry);
  if (!res) return;
  const vars = { Type: typeLabel(res.type), dur: formatDuration(res.seconds) };
  if (entry) {
    // L'entrée a pu être remplacée par une synchro pendant que la boîte était ouverte : on la retrouve par son identifiant.
    if (!updateEntry(entry.id, res)) addEntry({ id: entry.id, ...res, synced: false });
    toast(t('entry_updated', vars));
  } else {
    addEntry({ id: uid(), ...res, synced: false });
    toast(t('entry_added', vars));
  }
  render();
  scheduleSync();
}

function undoAction(removed) {
  return {
    label: t('undo'),
    fn: () => { restoreEntries(removed); render(); scheduleSync(); },
  };
}

function deleteEntry(e) {
  const removed = removeEntries([e.id]);
  render();
  toast(t('deleted_entry', { Type: typeLabel(e.type) }), undoAction(removed));
  scheduleSync();
}

/** Vide l'historique : tout, ou tout sauf la journée en cours (qui tient compte du mode nuit). */
async function clearHistory(keepCurrentDay) {
  const key = todayKey();
  const doomed = S.entries.filter((e) => !keepCurrentDay || workDay(e) !== key);
  const kept = S.entries.length - doomed.length;
  if (doomed.length === 0) { toast(t('nothing_to_delete')); return; }
  const parts = [];
  if (keepCurrentDay) {
    parts.push(t('clear_old_counts', { n: doomed.length, kept }));
    if (S.prefs.nightMode) {
      parts.push(t('clear_night_note', { day: dateLong(parseDay(key)), at: `${two(S.prefs.nightCutoff)}:00` }));
    }
  } else {
    parts.push(t('clear_all_body', { n: doomed.length }));
  }
  if (syncEnabled() && S.session) parts.push(t('clear_account_note'));
  const ok = await confirmDialog({
    title: t(keepCurrentDay ? 'clear_old_title' : 'clear_all_title'),
    body: parts.join('\n\n'),
    ok: t('delete'),
    danger: true,
  });
  if (!ok) return;
  const removed = removeEntries(doomed.map((e) => e.id));
  render();
  toast(t('cleared', { n: removed.length }), undoAction(removed));
  scheduleSync();
}

function doExport() {
  const blob = new Blob([entriesToText()], { type: 'text/plain;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'mes-breaks-historique.txt' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(t('export_done'));
}

function pickImportFile() {
  const input = h('input', { type: 'file', accept: '.txt,text/plain', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    const list = parseText(await file.text());
    if (list.length === 0) { toast(t('import_none')); return; }
    const { added, skipped } = importEntries(list);
    render();
    toast(t('import_result', { added, skipped }));
    scheduleSync();
  });
  document.body.append(input);
  input.click();
}

/* ---------- Réglages (enregistrés automatiquement) ---------- */

const sectionTitle = (text) => h('h2', { class: 'sec-title' }, text);

/* ---------- Page « Breaks prévus » ---------- */

/** Une ligne du planning (lecture seule) : un clic l'ouvre dans la fenêtre d'édition. */
function planRow(it) {
  const lunch = it.type === 'lunch';
  const other = it.type === 'other';
  const name = planName(it.type, it.label);
  return h('button', {
    type: 'button',
    class: 'plan-item',
    'aria-label': `${name} ${it.time} — ${t('edit')}`,
    on: { click: () => editPlanned(it) },
  },
  h('span', { class: `plan-badge${lunch ? ' lun' : ''}${other ? ' oth' : ''}` }, icon(other ? 'event' : (lunch ? 'restaurant' : 'coffee'), 20)),
  h('span', { class: 'plan-item-txt' },
    h('span', { class: 'plan-time' }, it.time),
    h('span', { class: 'small muted block' }, name)),
  icon('edit', 18));
}

/** Fenêtre d'édition, séparée du planning : rien ne change avant « Enregistrer ». */
function planDialog(item, type) {
  return openDialog((dlg, close) => {
    let kind = item ? item.type : type;
    const time = h('input', { type: 'time', class: 'field time-big', required: true, value: item ? item.time : nextQuarter(), 'aria-label': t('plan_time_label') });
    const segs = h('div', { class: 'segs' });
    const error = h('p', { class: 'small dlg-error', hidden: true, role: 'alert' });
    const save = h('button', { type: 'button', class: 'btn filled' }, t('save'));
    // « Autre » : un nom libre (meeting, formation…).
    const name = h('input', { type: 'text', class: 'field', maxlength: String(PLAN_LABEL_MAX), value: item && item.label ? item.label : '', placeholder: t('other_hint'), 'aria-label': t('other_name') });
    const nameWrap = h('div', { class: 'dlg-fields' }, h('label', { class: 'small muted' }, t('other_name')), name);
    const clash = () => S.plan.items.some((x) => (!item || x.id !== item.id) && x.time === time.value);
    const refresh = () => {
      segs.replaceChildren(...[['break', 'coffee', typeLabel('break')], ['lunch', 'restaurant', typeLabel('lunch')], ['other', 'event', t('type_other')]].map(([v, ic, label]) => h('button', {
        type: 'button',
        class: `seg${kind === v ? ' on' : ''}`,
        'aria-pressed': String(kind === v),
        on: { click: () => { kind = v; refresh(); if (v === 'other') name.focus(); } },
      }, icon(ic, 18), h('span', {}, label))));
      nameWrap.hidden = kind !== 'other';
      const bad = clash();
      error.textContent = bad ? t('plan_clash') : '';
      error.hidden = !bad;
      save.disabled = bad || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time.value) || (kind === 'other' && !planLabel(name.value));
    };
    time.addEventListener('input', refresh);
    name.addEventListener('input', refresh);
    save.addEventListener('click', () => { if (!save.disabled) close({ action: 'save', type: kind, time: time.value, label: name.value }); });
    refresh();
    dlg.append(
      h('h2', {}, item ? t('plan_edit_title') : t('plan_new_title')),
      h('div', { class: 'dlg-fields' }, segs, time),
      nameWrap,
      error,
      h('div', { class: 'dlg-actions wrap' },
        item ? h('button', { type: 'button', class: 'btn text danger-text', on: { click: () => close({ action: 'delete' }) } }, icon('delete', 18), t('delete')) : null,
        h('button', { type: 'button', class: 'btn text', on: { click: () => close(null) } }, t('cancel')),
        save),
    );
  });
}

async function editPlanned(item, type = 'break') {
  const res = await planDialog(item, type);
  if (!res) return;
  if (res.action === 'delete' && item) removePlanned(item.id);
  else if (res.action === 'save' && item) savePlanned(item.id, res.type, res.time, res.label);
  else if (res.action === 'save') addPlanned(res.type, res.time, res.label);
}

/** « Me prévenir quand l'heure approche » + nombre de minutes. */
function planNotifyCard() {
  const box = h('input', {
    type: 'checkbox',
    checked: S.prefs.planNotify,
    'aria-label': t('plan_notify_title'),
    on: {
      change: (e) => {
        S.prefs.planNotify = e.target.checked;
        savePrefs();
        if (S.prefs.planNotify) { requestNotifPermission(); ensureAudio(); }
        render();
      },
    },
  });
  const lead = S.prefs.planNotifyLead;
  return h('div', { class: 'card' },
    h('label', { class: 'switch-row pad' },
      box,
      h('span', { class: 'grow' },
        h('span', { class: 'strong block' }, t('plan_notify_title')),
        h('span', { class: 'small muted block' }, t('plan_notify_note')))),
    h('button', {
      type: 'button',
      class: 'shop-main pad lead-row',
      disabled: !S.prefs.planNotify,
      on: {
        click: async () => {
          const m = await minutesDialog({ title: t('plan_notify_lead_title'), value: lead, min: 0, max: LEAD_MAX, presets: [0, 2, 5, 10, 15], zeroLabel: t('on_time') });
          if (m === null || m === undefined) return;
          S.prefs.planNotifyLead = m;
          savePrefs();
          render();
        },
      },
    },
    h('span', { class: 'grow' }, t('plan_notify_lead')),
    h('span', { class: 'strong' }, lead === 0 ? t('on_time') : t('minutes_n', { m: lead })), ' ', icon('edit', 16)),
    h('p', { class: 'small muted pad' }, t('plan_notify_web')));
}

/** Des horaires existent mais ne valent pas pour aujourd'hui : on explique pourquoi l'accueil n'affiche rien. */
function planHint() {
  if (!S.plan.items.length || planApplies()) return null;
  const wd = parseDay(todayKey()).getDay();
  const text = S.plan.repeat ? t('plan_hint_day', { day: DAYS[LANG][(wd + 6) % 7] }) : t('plan_hint_other');
  return h('p', { class: 'small plan-hint' }, icon('info', 16), ' ', text);
}

function planView() {
  const repeatBox = h('input', {
    type: 'checkbox',
    class: 'switch',
    role: 'switch',
    checked: S.plan.repeat,
    'aria-label': t('plan_repeat'),
    on: { change: (e) => setPlanRepeat(e.target.checked) },
  });
  return h('div', { class: 'page' },
    h('header', { class: 'top' },
      iconBtn('arrow_back', t('back'), goBack),
      h('h1', { class: 'grow' }, t('plan_title'))),
    h('p', { class: 'small muted note' }, t('plan_intro')),
    sectionTitle(t('plan_my', { n: S.plan.items.length })),
    h('div', { class: 'card plan-list' },
      S.plan.items.length
        ? S.plan.items.slice().sort((a, b) => a.time.localeCompare(b.time)).map(planRow)
        : h('p', { class: 'muted pad plan-empty' }, t('plan_empty'))),
    h('div', { class: 'plan-add' },
      h('button', { type: 'button', class: 'btn tonal', 'aria-label': t('plan_add_break_long'), on: { click: () => editPlanned(null, 'break') } }, icon('add', 18), t('plan_add_break')),
      h('button', { type: 'button', class: 'btn tonal', 'aria-label': t('plan_add_lunch_long'), on: { click: () => editPlanned(null, 'lunch') } }, icon('add', 18), t('plan_add_lunch')),
      h('button', { type: 'button', class: 'btn tonal', 'aria-label': t('plan_add_other_long'), on: { click: () => editPlanned(null, 'other') } }, icon('add', 18), t('type_other'))),
    h('div', { class: 'card' },
      h('label', { class: 'switch-row pad' },
        h('span', { class: 'grow' },
          h('span', { class: 'strong block' }, t('plan_repeat')),
          h('span', { class: 'small muted block' }, S.plan.repeat ? t('plan_repeat_on') : t('plan_repeat_off'))),
        repeatBox),
      S.plan.repeat
        ? h('div', { class: 'chips plan-days pad', role: 'group', 'aria-label': t('plan_days_label') },
          DAYS_SHORT[LANG].map((label, i) => chip(label, S.plan.days.includes(i + 1), () => setPlanDay(i + 1, !S.plan.days.includes(i + 1)))))
        : null),
    planHint(),
    planNotifyCard(),
    h('p', { class: 'small muted note' }, t(S.session ? 'plan_note_sync' : 'plan_note')));
}

/** Réglages, en bas de l'accueil (on y descend en faisant défiler, ou avec la roue dentée). */
function settingsSection() {
  return h('section', { id: 'settings', class: 'settings-sec' },
    h('h2', { class: 'sec-title big' }, t('settings')),
    h('p', { class: 'small muted note' }, t('settings_auto')),

    sectionTitle(t('sec_lang')),
    langCard(),

    sectionTitle(t('sec_colors')),
    themeCard(),

    sectionTitle(t('sec_durations')),
    durationsCard(),

    sectionTitle(t('sec_history')),
    confirmStopCard(),
    nightCard(),
    h('div', { class: 'card pad' },
      h('div', { class: 'strong' }, t('backup_title')),
      h('p', { class: 'small muted' }, t('backup_note')),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn tonal', on: { click: doExport } }, icon('download', 18), t('btn_export')),
        h('button', { type: 'button', class: 'btn tonal', on: { click: pickImportFile } }, icon('upload', 18), t('btn_import')))),

    sectionTitle(t('sec_apps')),
    appsCard(),

    sectionTitle(t('sec_danger')),
    h('button', { type: 'button', class: 'btn danger-outline wide', on: { click: resetAll } }, icon('delete_forever', 20), t('reset_btn')),
    h('p', { class: 'small muted note' }, t('reset_note')),

    h('p', { class: 'footer' }, `✦ ${t('footer')}`));
}

/** Lien vers le site explicatif (fonctions, téléchargement des applis Android et iPhone). */
function appsCard() {
  return h('div', { class: 'card pad' },
    h('p', { class: 'small muted' }, t('web_or_app_body')),
    h('a', { class: 'btn tonal', href: safeUrl(SITE_URL), target: '_blank', rel: 'noopener noreferrer' }, icon('open_in_new', 18), t('apps_btn')));
}

function durationsCard() {
  const row = (ic, label, m, lunch) => h('button', {
    type: 'button',
    class: 'shop-main pad dur-row-btn',
    on: { click: () => editDuration(lunch) },
  }, icon(ic, 22), h('span', { class: 'grow strong' }, label), h('span', { class: 'strong' }, t('minutes_n', { m })), ' ', icon('edit', 16));
  return h('div', { class: 'card' },
    row('coffee', t('dur_break'), S.ui.pauseMinutes, false),
    row('restaurant', t('dur_lunch'), S.ui.lunchMinutes, true),
    h('p', { class: 'small muted pad' }, t('dur_note')));
}

function themeCard() {
  const set = (key, v) => () => { S.prefs[key] = v; savePrefs(); applyTheme(); render(); };
  const cur = chakraKey(S.prefs.themeColor) || DEFAULT_CHAKRA;
  const sel = CHAKRAS.find((c) => c.key === cur);
  return h('div', { class: 'card pad' },
    // Les 7 chakras, de la racine (à gauche) à la couronne (à droite).
    h('div', { class: 'swatches chakras', role: 'group', 'aria-label': t('sec_colors') },
      CHAKRAS.map((c) => h('button', {
        type: 'button',
        class: `swatch${cur === c.key ? ' on' : ''}`,
        style: `background:${c.color}`,
        title: `${t(`chakra_${c.key}`)} · ${c.sanskrit}`,
        'aria-pressed': String(cur === c.key),
        'aria-label': `${t(`chakra_${c.key}`)} · ${c.sanskrit}`,
        on: { click: set('themeColor', c.key) },
      }, cur === c.key ? icon('check_circle', 20) : null))),
    h('p', { class: 'chakra-line' },
      h('span', { class: 'dot', style: `background:${sel.color}` }),
      h('strong', {}, `${t(`chakra_${sel.key}`)} · ${sel.sanskrit}`),
      ` — ${t(`chakra_${sel.key}_m`)}`),
    h('p', { class: 'small muted chakra-info' },
      `${t(`chakra_${sel.key}_p`)} · ${t('chakra_element')} : ${t(`chakra_${sel.key}_e`)} · ${t('chakra_sound')} : ${sel.sound}`),
    h('div', { class: 'segs theme-modes' },
      [['system', 'mode_auto'], ['light', 'mode_light'], ['dark', 'mode_dark']].map(([v, label]) => h('button', {
        type: 'button',
        class: `seg${S.prefs.themeMode === v ? ' on' : ''}`,
        'aria-pressed': String(S.prefs.themeMode === v),
        on: { click: set('themeMode', v) },
      }, t(label)))),
    h('p', { class: 'small muted' }, t('mode_note')));
}

function langCard() {
  const pick = (code) => () => {
    LANG = code;
    S.prefs.lang = code;
    savePrefs();
    render();
  };
  return h('div', { class: 'card pad' },
    h('div', { class: 'chips' },
      chip('Français', LANG === 'fr', pick('fr')),
      chip('Nederlands', LANG === 'nl', pick('nl')),
      chip('English', LANG === 'en', pick('en')),
      chip('Deutsch', LANG === 'de', pick('de'))),
    h('p', { class: 'small muted' }, t('lang_note')));
}

function shopsCard() {
  const shops = S.prefs.shops;
  const missing = SUGGESTIONS.filter((sg) => !shops.some((x) => x.name === sg.name));
  return h('div', { class: 'card' },
    shops.length ? null : h('p', { class: 'small muted pad' }, t('shops_empty')),
    shops.map((s, i) => h('div', { class: 'shop-row' },
      h('button', {
        type: 'button',
        class: 'shop-main',
        on: { click: () => { S.prefs.shopIndex = i; savePrefs(); render(); } },
      },
      icon(i === S.prefs.shopIndex ? 'check_circle' : 'radio', 22),
      h('span', { class: 'shop-txt' }, h('span', { class: 'strong block' }, s.name), h('span', { class: 'small muted block ellipsis' }, s.url))),
      iconBtn('edit', t('edit'), () => editShop(i)),
      iconBtn('delete', t('delete'), () => deleteShop(i)))),
    missing.length
      ? h('div', { class: 'pad' },
        h('div', { class: 'small muted' }, t('suggestions')),
        h('div', { class: 'chips' }, missing.map((sg) => h('button', {
          type: 'button',
          class: 'chip',
          on: { click: () => { S.prefs.shops.push({ name: sg.name, url: sg.url }); savePrefs(); render(); } },
        }, icon('add', 16), sg.name))))
      : null,
    h('div', { class: 'pad' }, h('button', { type: 'button', class: 'btn text', on: { click: addShop } }, icon('add', 18), shops.length ? t('add_site') : t('order_add'))));
}

async function addShop() {
  const shop = await shopDialog(null);
  if (!shop) return;
  S.prefs.shops.push(shop);
  S.prefs.shopIndex = S.prefs.shops.length - 1;
  savePrefs();
  render();
}

async function editShop(i) {
  const shop = await shopDialog(S.prefs.shops[i]);
  if (!shop) return;
  S.prefs.shops[i] = shop;
  savePrefs();
  render();
}

function deleteShop(i) {
  const shops = S.prefs.shops;
  shops.splice(i, 1);
  if (S.prefs.shopIndex >= shops.length) S.prefs.shopIndex = Math.max(0, shops.length - 1);
  else if (i < S.prefs.shopIndex) S.prefs.shopIndex -= 1;
  savePrefs();
  render();
}

function confirmStopCard() {
  const box = h('input', {
    type: 'checkbox',
    class: 'switch',
    role: 'switch',
    checked: S.prefs.confirmStop,
    'aria-label': t('confirm_stop_title'),
    on: { change: (e) => { S.prefs.confirmStop = e.target.checked; savePrefs(); } },
  });
  return h('div', { class: 'card' },
    h('label', { class: 'switch-row pad' },
      h('span', { class: 'grow' },
        h('span', { class: 'strong block' }, t('confirm_stop_title')),
        h('span', { class: 'small muted block' }, t('confirm_stop_note'))),
      box));
}

function nightCard() {
  const box = h('input', {
    type: 'checkbox',
    class: 'switch',
    role: 'switch',
    checked: S.prefs.nightMode,
    'aria-label': t('night_title'),
    on: { change: (e) => { S.prefs.nightMode = e.target.checked; savePrefs(); render(); } },
  });
  return h('div', { class: 'card' },
    h('label', { class: 'switch-row pad' },
      h('span', { class: 'grow' },
        h('span', { class: 'strong block' }, t('night_title')),
        h('span', { class: 'small muted block' }, t('night_note'))),
      box),
    S.prefs.nightMode
      ? h('div', { class: 'pad' },
        h('div', { class: 'small' }, t('night_changes_at')),
        h('div', { class: 'chips' }, [6, 8, 10, 12, 14, 16, 18].map((hh) => chip(`${two(hh)}:00`, S.prefs.nightCutoff === hh, () => {
          S.prefs.nightCutoff = hh;
          savePrefs();
          render();
        }))))
      : null);
}

async function resetAll() {
  const ok = await confirmDialog({ title: t('reset_title'), body: t('reset_body'), ok: t('reset_ok'), danger: true });
  if (!ok) return;
  // Connecté : les réglages rangés en ligne sont effacés d'abord ; si c'est impossible, on ne touche à rien.
  try {
    await clearOnlineSettings();
  } catch (_) {
    toast(t('reset_online_failed'));
    return;
  }
  stopTicker();
  stopRunPolling();
  resetRunState();
  resetSettingsState();
  const lang = S.prefs.lang;
  store.clearAll();
  S.prefs = loadPrefs();
  S.prefs.lang = lang;
  S.prefs.setupDone = false;
  savePrefs();
  S.plan = normalizePlan(null);
  S.entries = [];
  S.deleted = [];
  S.run = null;
  S.session = null;
  S.ui = { type: 'break', useTimer: false, pauseMinutes: 15 };
  S.sync = { busy: false, last: null, error: '' };
  S.view = 'welcome';
  render();
}

/* ---------- Compte : un simple nom d'utilisateur, sans mot de passe ---------- */

let lastName = ''; // le nom tapé, repris si la carte est redessinée

function syncStatusText() {
  const s = S.sync;
  let text;
  if (s.busy) text = t('sync_busy');
  else if (s.error === 'offline') text = t('sync_offline');
  else if (s.error) text = t('sync_error', { msg: s.error });
  else if (s.last) {
    const d = new Date(s.last);
    text = t('sync_last', { time: `${two(d.getHours())}:${two(d.getMinutes())}` });
  } else text = t('sync_never');
  const pending = pendingCount();
  return pending > 0 ? `${text} · ${t('sync_pending', { n: pending })}` : text;
}

function accountCard() {
  if (S.session) {
    return h('div', { class: 'card pad', id: 'acctCard' },
      h('div', { class: 'strong acct-line' }, icon('cloud', 20), t('signed_as', { name: S.session.username })),
      h('p', { class: 'small muted', id: 'syncStatus' }, syncStatusText()),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn tonal', disabled: S.sync.busy, on: { click: () => syncNow() } }, t('sync_now')),
        h('button', { type: 'button', class: 'btn text', on: { click: doSignOut } }, t('sign_out'))));
  }
  const name = h('input', {
    type: 'text', class: 'field', id: 'acctName', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off',
    spellcheck: 'false', maxlength: '40', placeholder: t('username'), 'aria-label': t('username'),
    value: lastName, on: { input: (e) => { lastName = e.target.value; } },
  });
  const msg = h('p', { class: 'small acct-msg', id: 'acctMsg', role: 'status' });
  const attempt = () => {
    const n = normName(name.value);
    if (!validName(n)) { msg.textContent = t('err_username'); return; }
    lastName = '';
    signIn(n);
    S.sync.error = '';
    syncNow(); // redessine la carte (connecté) dès le début de la synchro
  };
  return h('div', { class: 'card pad', id: 'acctCard' },
    h('form', { class: 'acct-form', on: { submit: (ev) => { ev.preventDefault(); attempt(); } } },
      h('p', { class: 'small muted' }, t('acct_intro')),
      name, msg,
      h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn filled' }, t('sign_in'))),
      h('p', { class: 'small muted' }, t('acct_note'))));
}

async function doSignOut() {
  await syncNow();
  const pending = pendingCount();
  const ok = await confirmDialog({
    title: t('signout_title'),
    body: [t('signout_body'), pending > 0 ? t('signout_pending', { n: pending }) : ''].filter(Boolean).join('\n\n'),
    ok: t('sign_out'),
    danger: pending > 0,
  });
  if (!ok) return;
  signOut();
  render();
}
