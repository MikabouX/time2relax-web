'use strict';

/* ---------- Démarrage ---------- */

(function boot() {
  LANG = S.prefs.lang || detectLang();

  // Données locales abîmées : on repart propre plutôt que de planter.
  if (!Array.isArray(S.entries)) S.entries = [];
  if (!Array.isArray(S.deleted)) S.deleted = [];
  S.entries = S.entries.filter((e) => e && typeof e.id === 'string' && typeof e.seconds === 'number');
  if (S.run && (typeof S.run.start !== 'number' || (S.run.type !== 'break' && S.run.type !== 'lunch'))) {
    S.run = null;
    saveRun();
  }
  if (S.session && !S.session.refresh_token) S.session = null;

  // Retour du lien « mot de passe oublié » : les jetons arrivent dans l'adresse (après le #), on les retire aussitôt.
  if (syncEnabled()) {
    const back = readAuthHash();
    if (back) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* file:// restreint */ }
      if (back.recovery) S.recovery = back.recovery;
      else acctNotice = t('err_recovery_expired');
      S.view = 'settings';
    }
  }

  if (!S.prefs.setupDone) S.view = 'settings';
  try { history.replaceState({ v: S.view, d: 0 }, ''); } catch (_) { /* file:// restreint */ }

  render();

  if (S.run) {
    resetAlerts(true);
    startTicker();
  }

  if (syncEnabled() && S.session) syncNow();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (S.view === 'home') render(); // recompte la journée si la date a changé pendant la nuit
    if (syncEnabled() && S.session) syncNow();
  });
  window.addEventListener('online', () => { if (syncEnabled() && S.session) syncNow(); });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* hors-ligne indisponible, sans gravité */ });
  }

  // Pour les tests automatiques.
  window.t2r = { tick, state: S, render };
}());
