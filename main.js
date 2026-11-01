'use strict';

/* ---------- Démarrage ---------- */

(function boot() {
  LANG = S.prefs.lang || detectLang();
  applyTheme();

  // Données locales abîmées : on repart propre plutôt que de planter.
  if (!Array.isArray(S.entries)) S.entries = [];
  if (!Array.isArray(S.deleted)) S.deleted = [];
  S.entries = S.entries.filter((e) => e && typeof e.id === 'string' && typeof e.seconds === 'number');
  pruneOld(); // historique gardé une semaine
  if (S.run && (typeof S.run.start !== 'number' || (S.run.type !== 'break' && S.run.type !== 'lunch'))) {
    S.run = null;
    saveRun();
  }
  // Ancienne session (compte e-mail / mot de passe) : remplacée par le nom d'utilisateur.
  if (S.session && typeof S.session.username !== 'string') {
    S.session = null;
    store.remove('t2r.session');
  }

  if (!S.prefs.setupDone) S.view = 'settings';
  try { history.replaceState({ v: S.view, d: 0 }, ''); } catch (_) { /* file:// restreint */ }

  render();

  if (S.run) {
    resetAlerts(true);
    startTicker();
  }
  // Le compte à rebours du prochain break prévu avance aussi sans chrono en cours.
  setInterval(() => { if (S.view === 'home' && !S.run) updatePlan(); checkPlanReminders(); }, 1000);

  if (syncEnabled() && S.session) { syncNow(); startRunPolling(); }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    pruneOld();
    if (S.view === 'home') render(); // recompte la journée si la date a changé pendant la nuit
    if (syncEnabled() && S.session) { syncNow(); runPoll(); }
  });
  window.addEventListener('online', () => { if (syncEnabled() && S.session) { syncNow(); runPoll(); } });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* hors-ligne indisponible, sans gravité */ });
  }

  // Pour les tests automatiques.
  window.t2r = { tick, state: S, render, runPoll, planState, checkPlanReminders };
}());
