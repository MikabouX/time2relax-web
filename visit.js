// Compteur de visites anonyme : +1 par jour et par page sur le serveur. Ni cookie, ni identifiant, ni IP gardée.
// Ouvrir une fois une page avec ?moi=1 sur un appareil pour ne plus compter ses propres visites (?moi=0 pour annuler).
(function () {
  'use strict';
  try {
    var page = document.currentScript && document.currentScript.dataset.page;
    var moi = new URLSearchParams(location.search).get('moi');
    if (moi === '1') localStorage.setItem('t2r_nocount', '1');
    if (moi === '0') localStorage.removeItem('t2r_nocount');
    if (!page || localStorage.getItem('t2r_nocount')) return;
    var k = 'sb_publishable_9fKWGXevueh6hHJpGQvmhg_EFOd_-dR';
    fetch('https://gxftbzbvbveocwpdavtt.supabase.co/rest/v1/rpc/t2r_visit', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: k, Authorization: 'Bearer ' + k },
      body: JSON.stringify({ p_page: page }),
    }).catch(function () {});
  } catch (e) {}
})();
