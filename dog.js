'use strict';

/* ---------- « Va chercher mon chrono ! » : le cocker va lire le chrono du téléphone ----------
   Seulement quand on appuie : une lecture (chrono en cours + pauses du jour) sous le nom d'utilisateur de
   l'application. Rien n'est écrit sur le serveur, rien n'est relu en arrière-plan. */

const DOG_NAME_KEY = 't2r.dogName';
const DOG = { busy: false, result: null, error: '' };

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
  return r.json();
}

async function dogFetch(name) {
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 40) {
    DOG.error = t('dog_bad_name');
    render();
    return;
  }
  try { localStorage.setItem(DOG_NAME_KEY, n); } catch (_) { /* navigateur sans stockage */ }
  DOG.busy = true;
  DOG.error = '';
  DOG.result = null;
  render();
  const started = Date.now();
  try {
    const [runs, rows] = await Promise.all([dogRpc('t2r_run_get', { p_username: n }), dogRpc('t2r_list', { p_username: n })]);
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
  } catch (_) {
    DOG.error = t('dog_error');
  }
  // Le chien prend au moins le temps d'aller et revenir.
  const wait = 1300 - (Date.now() - started);
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
      if (res.run.planned > 0) {
        lines.push(h('p', { class: 'dog-msg' }, t('dog_planned', { planned: humanDuration(res.run.planned) })));
        if (el > res.run.planned) {
          lines.push(h('p', { class: 'dog-msg warn' }, t('dog_over', { over: humanDuration(el - res.run.planned) })));
        }
      }
    } else {
      lines.push(h('p', { class: 'dog-msg strong' }, t('dog_none')));
    }
    lines.push(h('p', { class: 'dog-msg' }, t('dog_today', {
      breaks: res.nBreaks ? humanDuration(res.breaks) : '—',
      lunch: res.nLunch ? humanDuration(res.lunch) : '—',
    })));
    out = h('div', {}, lines);
  }
  const input = h('input', {
    type: 'text', class: 'dog-input', value: dogName(), autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
    placeholder: t('dog_name_ph'), 'aria-label': t('dog_name_ph'),
  });
  const dog = h('div', { class: `dog${DOG.busy ? ' running' : ''}` });
  dog.innerHTML = COCKER_SVG; // dessin fixe, aucun texte saisi
  return h('section', { class: 'card pad dog-card' },
    h('div', { class: 'dog-head' }, dog,
      h('div', { class: 'grow' },
        h('h2', { class: 'sec-title' }, t('dog_title')),
        h('p', { class: 'small muted' }, t('dog_intro')))),
    h('div', { class: 'dog-row' }, input,
      h('button', {
        type: 'button', class: 'btn primary', disabled: DOG.busy ? '' : null,
        on: { click: () => dogFetch(input.value) },
      }, DOG.busy ? t('dog_busy') : t('dog_btn'))),
    out,
    h('p', { class: 'small muted dog-note' }, t('dog_note')));
}
