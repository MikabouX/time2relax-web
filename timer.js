'use strict';

/* ---------- Chrono, minuteur et alertes ----------
   Le temps écoulé est toujours recalculé à partir de l'heure de départ : même si
   le navigateur ralentit un onglet en arrière-plan, le chrono reste exact. */

const plannedFor = (type) => (S.ui.useTimer ? (type === 'lunch' ? LUNCH_MINUTES : S.ui.pauseMinutes) * 60 : 0);

/** Tout ce qu'il faut pour dessiner l'anneau à l'instant présent. */
function ringState() {
  const run = S.run;
  const running = !!run;
  const planned = running ? run.planned : 0;
  const elapsed = running ? Math.max(0, Math.floor((Date.now() - run.start) / 1000)) : 0;
  const hasTimer = running && planned > 0;
  const remaining = planned - elapsed;
  const over = hasTimer && remaining < 0;
  const lastMinute = hasTimer && !over && planned > 60 && remaining <= 60;
  const type = running ? run.type : S.ui.type;
  let big;
  let cap;
  let progress;
  if (hasTimer) {
    big = over ? `+${formatDuration(-remaining)}` : formatDuration(remaining);
    cap = over ? t('cap_over') : (lastMinute ? t('cap_last_minute') : t('cap_remaining'));
    progress = over ? 1 : Math.min(Math.max(remaining / planned, 0), 1);
  } else if (running) {
    big = formatDuration(elapsed);
    cap = t('cap_running');
    progress = (elapsed % 60) / 60;
  } else {
    big = S.ui.useTimer ? formatDuration(plannedFor(type)) : '00:00';
    cap = S.ui.useTimer ? t('cap_timer_ready') : t('cap_ready');
    progress = S.ui.useTimer ? 1 : 0;
  }
  const color = over ? 'var(--error)' : (lastMinute ? 'var(--amber)' : (type === 'lunch' ? 'var(--tertiary)' : 'var(--primary)'));
  return { running, hasTimer, over, lastMinute, type, big, cap, progress, color, elapsed, remaining };
}

/* ---------- Sons et notifications ---------- */

let audioCtx = null;

function ensureAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (_) { /* pas de son */ }
}

function beep(count) {
  try {
    ensureAudio();
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < count; i += 1) {
      const start = t0 + i * 0.4;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.35);
    }
  } catch (_) { /* pas de son */ }
}

function requestNotifPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  } catch (_) { /* notifications indisponibles */ }
}

function notify(title, body, tag) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, tag: `t2r-${tag}`, icon: 'icon-192.png', requireInteraction: tag === 'end' });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (_) { /* notifications indisponibles */ }
}

/* ---------- Alertes : une minute avant, à la fin, puis rappel toutes les 30 s ---------- */

let alertState = { warned: false, ended: false, lastRepeat: 0 };

function resetAlerts(silentIfLate) {
  alertState = { warned: false, ended: false, lastRepeat: 0 };
  if (silentIfLate && S.run && S.run.planned > 0) {
    // Page rechargée en cours de route : on ne rejoue pas les alertes déjà passées.
    const remaining = S.run.planned - Math.floor((Date.now() - S.run.start) / 1000);
    if (remaining <= 60) alertState.warned = true;
    if (remaining <= 0) { alertState.ended = true; alertState.lastRepeat = Date.now(); }
  }
}

function handleAlerts() {
  const run = S.run;
  if (!run || !run.planned) return;
  const remaining = run.planned - Math.floor((Date.now() - run.start) / 1000);
  const type = typeLabel(run.type).toLowerCase();
  if (!alertState.warned && run.planned > 60 && remaining <= 60 && remaining > 0) {
    alertState.warned = true;
    notify(t('warn_title'), t('warn_body', { type }), 'warn');
    beep(1);
  }
  if (!alertState.ended && remaining <= 0) {
    alertState.ended = true;
    alertState.lastRepeat = Date.now();
    notify(t('end_title', { type }), t('end_body'), 'end');
    beep(3);
  } else if (alertState.ended && remaining < 0 && Date.now() - alertState.lastRepeat >= 30000) {
    alertState.lastRepeat = Date.now();
    beep(2);
  }
}

/* ---------- Horloge ---------- */

let tickWorker = null;
let tickInterval = null;

function tick() {
  handleAlerts();
  if (S.view === 'home') updateRing(false);
  updateTitle();
}

function startTicker() {
  stopTicker();
  try {
    // Un Worker n'est pas ralenti quand l'onglet est en arrière-plan.
    const blob = new Blob(['setInterval(function(){postMessage(0)},1000)'], { type: 'text/javascript' });
    tickWorker = new Worker(URL.createObjectURL(blob));
    tickWorker.onmessage = tick;
    tickWorker.onerror = () => {
      // Worker refusé par le navigateur : repli sur un minuteur classique.
      if (tickWorker) { tickWorker.terminate(); tickWorker = null; }
      if (!tickInterval && S.run) tickInterval = setInterval(tick, 1000);
    };
  } catch (_) {
    tickInterval = setInterval(tick, 1000);
  }
  tick();
}

function stopTicker() {
  if (tickWorker) { tickWorker.terminate(); tickWorker = null; }
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
}

function updateTitle() {
  let title = 'Time2Relax';
  if (S.run) {
    const st = ringState();
    title = `${st.over ? '⏰ ' : ''}${st.big} · Time2Relax`;
  }
  if (document.title !== title) document.title = title;
}

/* ---------- Démarrer / terminer ---------- */

function beginRun() {
  const type = S.ui.type;
  S.run = { id: uid(), start: Date.now(), type, planned: plannedFor(type), pushed: false };
  saveRun();
  resetAlerts(false);
  ensureAudio();
  if (S.run.planned > 0) requestNotifPermission();
  startTicker();
  render();
  runAnnounce(); // les autres appareils connectés au même nom suivent ce chrono
}

/** L'entrée d'historique d'un chrono : elle porte son identifiant (le terminer deux fois n'en crée qu'une). */
function entryFromRun(r) {
  // Plafonné à 24 h (limite du serveur) : un chrono oublié pendant des jours ne doit pas bloquer la synchro.
  const seconds = Math.min(86400, Math.max(0, Math.floor((Date.now() - r.start) / 1000)));
  const s = new Date(r.start);
  return {
    id: r.id || uid(),
    date: dayKey(s),
    time: `${two(s.getHours())}:${two(s.getMinutes())}`,
    type: r.type,
    seconds,
    synced: false,
  };
}

async function endRun() {
  const r = S.run;
  if (!r) return;
  if (S.prefs.confirmStop) {
    const elapsed = Math.max(0, Math.floor((Date.now() - r.start) / 1000));
    const ok = await confirmDialog({
      title: t('stop_confirm_title', { type: typeLabel(r.type).toLowerCase(), Type: typeLabel(r.type) }),
      body: t('stop_confirm_body', { dur: formatDuration(elapsed) }),
      ok: t('stop_confirm_ok'),
    });
    if (!ok || S.run !== r) return; // « Annuler » : le chrono continue (ou il a déjà été terminé entre-temps)
  }
  const entry = entryFromRun(r);
  addEntry(entry);
  S.run = null;
  saveRun();
  stopTicker();
  render();
  // Un arrêt par erreur se rattrape : « Reprendre » annule l'enregistrement et relance le chrono là où il en était.
  toast(t('saved_entry', { Type: typeLabel(r.type), dur: formatDuration(entry.seconds) }),
    { label: t('resume'), fn: () => resumeRun(entry.id, r) }, 15000);
  scheduleSync();
  if (runSharing()) { markStopped(r.id); runEnd(r.id); } // les autres appareils arrêtent aussi leur chrono
}

/** Annule le dernier arrêt : l'entrée est retirée et le chrono repart avec son heure de départ d'origine. */
function resumeRun(entryId, run) {
  if (S.run) { toast(t('resume_busy')); return; }
  forgetStopped(run.id);
  run.pushed = false; // ré-annoncé juste après (si un autre chrono a démarré entre-temps, celui du serveur gagne)
  removeEntries([entryId]);
  S.run = run;
  saveRun();
  resetAlerts(true);
  ensureAudio();
  startTicker();
  render();
  toast(t('resumed', { Type: typeLabel(run.type) }));
  scheduleSync();
  runAnnounce();
}
