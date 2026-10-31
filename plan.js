'use strict';

/* ---------- Breaks prévus : le temps qui reste avant le prochain (sans aucune alerte) ----------
   On note à quelle heure on aura ses breaks et son lunch. L'accueil affiche, en gris, le temps qui reste
   avant le prochain : un arc autour du cadran (il se remplit pendant les 2 dernières heures) et une ligne
   sous le cadran. Un break lancé jusqu'à 30 minutes avant l'heure prévue compte pour celui-ci.
   Les horaires se répètent les jours cochés ; ils sont enregistrés sous le nom d'utilisateur (sinon, sur cet appareil). */

const PLAN_WINDOW = 7200; // secondes : l'arc se remplit pendant les 2 dernières heures
const PLAN_DUE_MS = 10 * 60000; // « c'est l'heure » reste affiché 10 minutes
const PLAN_EARLY_MS = 30 * 60000; // un break lancé jusqu'à 30 min avant l'heure prévue compte pour celui-ci
const PLAN_LATE_MS = 3 * 3600000; // …ou jusqu'à 3 h après

const DEFAULT_PLAN_DAYS = [1, 2, 3, 4, 5]; // 1 = lundi … 7 = dimanche

const cleanDays = (list) => [...new Set(list.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);

function normalizePlan(p) {
  const out = { items: [], repeat: true, day: '', days: DEFAULT_PLAN_DAYS.slice() };
  if (!p || typeof p !== 'object') return out;
  if (Array.isArray(p.items)) {
    for (const it of p.items) {
      if (!it || typeof it.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(it.time)) continue;
      out.items.push({
        id: typeof it.id === 'string' && it.id ? it.id : uid(),
        time: it.time,
        type: it.type === 'lunch' ? 'lunch' : 'break',
      });
    }
  }
  out.repeat = p.repeat !== false;
  out.day = typeof p.day === 'string' ? p.day : '';
  if (Array.isArray(p.days)) out.days = cleanDays(p.days); // absent (anciennes versions) : lundi à vendredi
  out.items.sort((a, b) => a.time.localeCompare(b.time));
  return out;
}

S.plan = normalizePlan(store.get('t2r.plan', null));
const savePlan = () => { store.set('t2r.plan', S.plan); if (typeof settingsChanged === 'function') settingsChanged(); };

/** Après une modification : la liste est triée, et (sans répétition) elle vaut pour aujourd'hui. */
function touchPlan() {
  S.plan.items.sort((a, b) => a.time.localeCompare(b.time));
  S.plan.day = todayKey();
  savePlan();
}

/** Les breaks prévus valent-ils pour la journée de travail en cours ? */
function planApplies(now = new Date()) {
  if (!S.plan.items.length) return false;
  const key = todayKey(now);
  if (!S.plan.repeat) return S.plan.day === key;
  const d = parseDay(key);
  const wd = d ? d.getDay() : 1; // 0 = dimanche, 6 = samedi
  return S.plan.days.includes(wd === 0 ? 7 : wd);
}

/** Les heures prévues de cette journée de travail, en instants précis (en mode nuit, avant l'heure de bascule = lendemain). */
function planMoments(now = new Date()) {
  if (!planApplies(now)) return [];
  const base = parseDay(todayKey(now));
  if (!base) return [];
  return S.plan.items.map((it) => {
    const [hh, mm] = it.time.split(':').map(Number);
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0, 0);
    if (S.prefs.nightMode && hh < S.prefs.nightCutoff) d.setDate(d.getDate() + 1);
    return { id: it.id, type: it.type, time: it.time, ms: d.getTime() };
  }).sort((a, b) => a.ms - b.ms);
}

/** Départs de breaks de la journée (historique + chrono en cours). */
function planStarts(now = new Date()) {
  const key = todayKey(now);
  const out = [];
  for (const e of S.entries) {
    if (workDay(e) !== key) continue;
    const d = parseDay(e.date);
    const [hh, mm] = String(e.time).split(':').map(Number);
    if (!d || Number.isNaN(hh) || Number.isNaN(mm)) continue;
    out.push({ type: e.type, ms: new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).getTime() });
  }
  if (S.run) out.push({ type: S.run.type, ms: S.run.start });
  return out.sort((a, b) => a.ms - b.ms);
}

/** Fonction pure. items : [{ms, type}] ; starts : [{ms, type}] → { item, secs, due } ou null.
    due : l'heure est passée depuis moins de 10 minutes et rien n'a été lancé (secs = secondes écoulées). */
function pickPlanned(nowMs, items, starts) {
  // Chaque départ « consomme » l'horaire du même type le plus proche (de -30 min à +3 h).
  const taken = new Set();
  for (const s of [...starts].sort((x, y) => x.ms - y.ms)) {
    let best = -1;
    let bestGap = Infinity;
    items.forEach((it, i) => {
      if (taken.has(i) || it.type !== s.type) return;
      if (s.ms < it.ms - PLAN_EARLY_MS || s.ms > it.ms + PLAN_LATE_MS) return;
      const gap = Math.abs(s.ms - it.ms);
      if (gap < bestGap) { best = i; bestGap = gap; }
    });
    if (best >= 0) taken.add(best);
  }
  const open = items.filter((_, i) => !taken.has(i));
  const due = open.find((it) => it.ms <= nowMs && nowMs < it.ms + PLAN_DUE_MS);
  if (due) return { item: due, secs: Math.floor((nowMs - due.ms) / 1000), due: true };
  const next = open.find((it) => it.ms > nowMs);
  return next ? { item: next, secs: Math.ceil((next.ms - nowMs) / 1000), due: false } : null;
}

function formatCountdown(secs) {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${two(m)}:${two(s % 60)}`;
}

/** Ce que l'accueil affiche : { has, text, due, progress }. */
function planState(now = new Date()) {
  const moments = planMoments(now);
  if (!moments.length) return { has: false, text: '', due: false, progress: 0 };
  const pick = pickPlanned(now.getTime(), moments, planStarts(now));
  if (!pick) return { has: true, text: t('plan_none'), due: false, progress: 0 };
  const vars = { type: typeLabel(pick.item.type).toLowerCase(), time: pick.item.time, left: formatCountdown(pick.secs) };
  return pick.due
    ? { has: true, text: t('plan_due', vars), due: true, progress: 0 }
    : { has: true, text: t('plan_next', vars), due: false, progress: Math.min(1, pick.secs / PLAN_WINDOW) };
}

/** Met à jour l'arc gris et la ligne sous le cadran (sans reconstruire la page). */
function updatePlan() {
  const line = document.getElementById('planLine');
  const arc = document.getElementById('planArc');
  const track = document.getElementById('planTrack');
  if (!line || !arc) return;
  const st = planState();
  line.hidden = !st.has;
  if (track) track.style.opacity = st.has ? '1' : '0';
  arc.style.opacity = st.has && st.progress > 0 ? '1' : '0';
  arc.style.strokeDashoffset = String(PLAN_CIRC * (1 - st.progress));
  line.classList.toggle('due', st.due);
  const txt = document.getElementById('planText');
  if (txt && txt.textContent !== st.text) txt.textContent = st.text;
}

/** Heure arrondie au prochain quart d'heure (valeur de départ d'un nouveau break prévu). */
function nextQuarter(now = new Date()) {
  const d = new Date(now.getTime() + 60000);
  const q = Math.ceil(d.getMinutes() / 15) * 15;
  d.setMinutes(q, 0, 0);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

function addPlanned(type) {
  S.plan.items.push({ id: uid(), time: nextQuarter(), type });
  touchPlan();
  render();
}

function setPlannedTime(id, time) {
  const it = S.plan.items.find((x) => x.id === id);
  if (!it || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return;
  it.time = time;
  touchPlan();
  render();
}

function setPlannedType(id, type) {
  const it = S.plan.items.find((x) => x.id === id);
  if (!it) return;
  it.type = type;
  touchPlan();
  render();
}

function removePlanned(id) {
  S.plan.items = S.plan.items.filter((x) => x.id !== id);
  touchPlan();
  render();
}

/** Coche ou décoche un jour de la semaine (1 = lundi … 7 = dimanche). */
function setPlanDay(weekday, on) {
  const set = new Set(S.plan.days);
  if (on) set.add(weekday); else set.delete(weekday);
  S.plan.days = cleanDays([...set]);
  S.plan.day = todayKey();
  savePlan();
  render();
}

function setPlanRepeat(on) {
  S.plan.repeat = on;
  S.plan.day = todayKey();
  savePlan();
  render();
}
