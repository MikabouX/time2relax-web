// Tests de bout en bout dans Chromium : node tests/e2e.js
// Lance un petit serveur local, joue des scénarios réels (chrono, alertes, historique,
// mode nuit, import/export, néerlandais) et simule un serveur Supabase.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8765;
const BASE = `http://localhost:${PORT}/`;

let failed = 0;
let passed = 0;
function check(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok   ${msg}`); } else { failed += 1; console.log(`  FAIL ${msg}`); }
}
const eq = (a, b, msg) => check(a === b, `${msg}${a === b ? '' : `  (obtenu: ${JSON.stringify(a)}, attendu: ${JSON.stringify(b)})`}`);

// Fausse horloge pilotable + notifications et sons espionnés.
const initScript = (startIso) => `
(() => {
  const Real = Date;
  const saved = sessionStorage.getItem('__off');
  let offset = saved !== null ? Number(saved) : (new Real('${startIso}').getTime() - Real.now());
  sessionStorage.setItem('__off', String(offset));
  class Fake extends Real {
    constructor(...a) { if (a.length === 0) super(Real.now() + offset); else super(...a); }
    static now() { return Real.now() + offset; }
  }
  window.Date = Fake;
  window.__advance = (ms) => { offset += ms; sessionStorage.setItem('__off', String(offset)); };
  window.__setNow = (iso) => { offset = new Real(iso).getTime() - Real.now(); sessionStorage.setItem('__off', String(offset)); };
  window.__notes = [];
  window.__beeps = 0;
  const N = function (title, opts) { window.__notes.push({ title, body: opts && opts.body }); };
  N.permission = 'granted';
  N.requestPermission = () => Promise.resolve('granted');
  window.Notification = N;
  window.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() {}
    createOscillator() { window.__beeps += 1; return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  };
})();`;

async function newPage(browser, { startIso = '2026-10-29T10:00:00+01:00', lang = 'fr-BE', setup } = {}) {
  const context = await browser.newContext({ timezoneId: 'Europe/Brussels', locale: lang, viewport: { width: 420, height: 900 }, acceptDownloads: true });
  await context.addInitScript(initScript(startIso));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(BASE);
  if (setup) {
    await page.evaluate(setup);
    await page.reload();
  }
  return { page, context, errors };
}

const text = (page, sel) => page.locator(sel).first().innerText();
const tick = (page) => page.evaluate(() => window.t2r.tick());
const advance = async (page, ms) => { await page.evaluate((m) => window.__advance(m), ms); await tick(page); };

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  try {
    /* ------------------------------------------------------------ A. premier lancement + chrono */
    console.log('A. Premier lancement, chrono sans minuteur');
    {
      const { page, context, errors } = await newPage(browser);
      check(await page.locator('.banner').isVisible(), 'écran de bienvenue au premier lancement');
      await page.getByRole('button', { name: 'Continuer' }).click();
      eq(await text(page, '#ringBig'), '00:00', 'chrono à zéro');
      eq(await text(page, '#ringCap'), 'Prêt à démarrer', 'légende « prêt »');
      check((await text(page, '.date')).toLowerCase().includes('jeudi 29 octobre'), 'date du jour en français');
      eq(await text(page, '.stat-val'), '—', 'compteur du jour vide');
      // sous le minuteur : l'alerte écran éteint demande l'appli mobile (pas de minuteur « OS » sur le web)
      check((await text(page, '.timer-note')).includes('installe l\'appli sur ton téléphone'), 'sous le minuteur : message sur l\'appli mobile');
      eq(await page.locator('.timer-note a[href="https://bardiaux.wordpress.com/"][target="_blank"]').count(), 1, 'le message renvoie vers le site des applis');
      eq((await text(page, '.timer-note a')).trim(), 'Télécharger', 'lien « Télécharger »');

      await page.locator('.start').click();
      eq(await page.locator('.timer-note').count(), 0, 'pendant un chrono, le message disparaît avec les options');
      await advance(page, 312000);
      eq(await text(page, '#ringBig'), '05:12', 'chrono après 5 min 12 s');
      check((await page.title()).startsWith('05:12'), "le titre de l'onglet affiche le chrono");
      await page.locator('.start').click();
      check((await text(page, '#toast')).includes('Break enregistré : 05:12'), 'message « Break enregistré : 05:12 »');
      eq(await text(page, '.stat-label'), 'Breaks · 1', 'compteur de breaks = 1');
      eq(await text(page, '.stat-val'), '5 min', 'total du jour = 5 min');
      const entry = await page.evaluate(() => window.t2r.state.entries[0]);
      check(entry.date === '2026-10-29' && entry.time === '10:00' && entry.seconds === 312 && entry.type === 'break', "entrée enregistrée avec la date, l'heure de début et la durée");

      // Lunch avec minuteur de 30 minutes
      await page.locator('.seg').nth(1).click();
      await page.locator('.switch-row').first().click();
      eq(await text(page, '#ringBig'), '30:00', 'lunch : minuteur de 30 minutes');
      await page.locator('.start').click();
      await advance(page, 29 * 60 * 1000 + 30000);
      eq(await text(page, '#ringCap'), "Plus qu'une minute !", 'légende « plus qu\'une minute » (lunch)');
      await advance(page, 40000);
      check((await text(page, '#ringBig')).startsWith('+00:'), 'dépassement affiché avec « + »');
      const notes = await page.evaluate(() => window.__notes);
      eq(notes.length, 2, 'deux notifications (1 minute avant, puis fin)');
      check(notes[0].title === "Plus qu'une minute" && notes[1].title === 'Fin du lunch', 'titres des notifications en français');
      check((await page.evaluate(() => window.__beeps)) >= 4, 'bips émis');
      await page.locator('.start').click();
      eq(await text(page, '.segs .seg.on'), 'Lunch', 'le type reste sélectionné');

      // Minuteur break de 10 minutes puis rechargement en plein chrono
      await page.locator('.seg').nth(0).click();
      // la durée du break se choisit librement (pastille → boîte de minutes)
      await page.locator('.dur-chip').click();
      await page.locator('.dlg').getByRole('button', { name: '10 min' }).click();
      await page.locator('.dlg').getByRole('button', { name: 'OK' }).click();
      eq(await page.evaluate(() => window.t2r.state.ui.pauseMinutes), 10, 'durée du break choisie : 10 min');
      await page.locator('.start').click();
      await advance(page, 120000);
      await page.reload();
      check(await page.locator('.start.stop').isVisible(), 'chrono repris après rechargement');
      eq(await text(page, '#ringBig'), '08:00', 'temps restant exact après rechargement');
      const notesAfter = await page.evaluate(() => window.__notes.length);
      eq(notesAfter, 0, 'pas de fausse alerte au rechargement');
      await page.locator('.start').click();
      check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
      await context.close();
    }

    /* ------------------------------------------------------------ B. historique, mode nuit, vidage */
    console.log('B. Historique, suppression, mode nuit');
    const seed = () => {
      const mk = (date, time, type, seconds, i) => ({ id: `id-${i}`, date, time, type, seconds, synced: false });
      localStorage.setItem('t2r.entries', JSON.stringify([
        mk('2026-10-27', '23:40', 'break', 600, 1), mk('2026-10-28', '14:10', 'lunch', 1800, 2),
        mk('2026-10-28', '23:50', 'break', 900, 3), mk('2026-10-29', '02:15', 'break', 300, 4),
        mk('2026-10-29', '03:30', 'lunch', 1500, 5), mk('2026-10-29', '13:05', 'break', 420, 6),
      ]));
      localStorage.setItem('t2r.prefs', JSON.stringify({ setupDone: true, nightMode: true, nightCutoff: 12 }));
    };
    {
      // 08:00 en mode nuit : la journée en cours a commencé hier à 12:00
      const { page, context, errors } = await newPage(browser, { startIso: '2026-10-29T08:00:00+01:00', setup: seed });
      eq(await text(page, '.stat-label'), 'Breaks · 2', 'accueil, mode nuit 08:00 : 2 breaks dans la journée en cours');
      await page.getByRole('button', { name: 'Historique' }).click();
      const heads = await page.locator('.day-name').allInnerTexts();
      check(heads.length === 3 && heads[1] === "Aujourd'hui" && heads[2] === 'Hier', `jours regroupés selon le mode nuit (${heads.join(', ')})`);
      eq(await page.locator('.entry').count(), 6, "6 entrées dans l'historique");

      // suppression d'une entrée + annulation
      await page.locator('.entry').first().getByRole('button', { name: 'Supprimer' }).click();
      eq(await page.locator('.entry').count(), 5, 'une entrée supprimée');
      await page.locator('.toast-action').click();
      eq(await page.locator('.entry').count(), 6, "annulation : l'entrée revient");

      // vider sauf la journée en cours
      await page.getByRole('button', { name: "Plus d'options" }).click();
      await page.getByRole('button', { name: 'Vider sauf la journée en cours' }).click();
      const body = await text(page, '.dlg-body');
      check(body.includes('Entrées supprimées : 2') && body.includes('Conservées (journée en cours) : 4'), `confirmation avec décompte (${body.replace(/\n+/g, ' / ')})`);
      check(body.includes('Mode nuit : la journée en cours a commencé le mercredi 28 octobre à 12:00.'), 'confirmation : rappel du mode nuit');
      await page.getByRole('button', { name: 'Supprimer', exact: true }).last().click();
      eq(await page.locator('.entry').count(), 4, 'il reste 4 entrées (service de nuit conservé)');
      const left = await page.evaluate(() => window.t2r.state.entries.map((e) => `${e.date} ${e.time}`));
      check(left.join() === '2026-10-28 14:10,2026-10-28 23:50,2026-10-29 02:15,2026-10-29 03:30', `bonnes entrées conservées (${left.join(' ; ')})`);
      await page.locator('.toast-action').click();
      eq(await page.locator('.entry').count(), 6, 'annulation du vidage : tout revient');

      // à 15:00, la journée en cours ne contient plus que la dernière entrée
      await page.evaluate(() => window.__setNow('2026-10-29T15:00:00+01:00'));
      await page.getByRole('button', { name: "Plus d'options" }).click();
      await page.getByRole('button', { name: 'Vider sauf la journée en cours' }).click();
      const body2 = await text(page, '.dlg-body');
      check(body2.includes('Entrées supprimées : 5') && body2.includes('Conservées (journée en cours) : 1'), '15:00 : 5 supprimées, 1 conservée');
      await page.locator('.dlg').getByRole('button', { name: 'Annuler', exact: true }).click();
      eq(await page.locator('.entry').count(), 6, 'refus de la confirmation : rien ne bouge');

      // tout vider
      await page.getByRole('button', { name: "Plus d'options" }).click();
      await page.getByRole('button', { name: "Vider tout l'historique" }).click();
      await page.getByRole('button', { name: 'Supprimer', exact: true }).last().click();
      eq(await page.locator('.entry').count(), 0, 'historique entièrement vidé');
      check(await page.locator('.empty').isVisible(), 'message « aucun break enregistré »');
      await page.getByRole('button', { name: "Plus d'options" }).click();
      await page.getByRole('button', { name: "Vider tout l'historique" }).click();
      check((await text(page, '#toast')).includes('Rien à supprimer'), 'vidage sur historique vide : « rien à supprimer »');
      check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
      await context.close();
    }

    /* ------------------------------------------------------------ C. export / import / néerlandais */
    console.log('C. Export, import, néerlandais');
    {
      const { page, context, errors } = await newPage(browser, { startIso: '2026-10-29T10:00:00+01:00', setup: seed });
      await page.getByRole('button', { name: 'Historique' }).click();
      await page.getByRole('button', { name: "Plus d'options" }).click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter le fichier' }).click()]);
      const content = require('fs').readFileSync(await download.path(), 'utf8');
      eq(content, '2026-10-27;23:40;break;600\n2026-10-28;14:10;lunch;1800\n2026-10-28;23:50;break;900\n2026-10-29;02:15;break;300\n2026-10-29;03:30;lunch;1500\n2026-10-29;13:05;break;420\n', 'fichier exporté au même format que le téléphone');
      eq(download.suggestedFilename(), 'mes-breaks-historique.txt', 'nom du fichier exporté');

      // import d'un fichier du téléphone : 1 ligne nouvelle, 1 déjà présente, 1 ancienne « pause », 1 ligne invalide
      await page.getByRole('button', { name: "Plus d'options" }).click();
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Importer un fichier' }).click()]);
      await chooser.setFiles({ name: 'tel.txt', mimeType: 'text/plain', buffer: Buffer.from('2026-10-29;13:05;break;420\n2026-10-30;09:15;lunch;1700\n2026-10-31;09:00;pause;120\nn importe quoi\n') });
      await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Importées'));
      check((await text(page, '#toast')).includes('Importées : 2 · déjà présentes : 1'), 'import : 2 ajoutées, 1 déjà présente');
      eq(await page.locator('.entry').count(), 8, '8 entrées après import');
      const types = await page.evaluate(() => window.t2r.state.entries.filter((e) => e.date === '2026-10-31').map((e) => e.type));
      eq(types.join(), 'break', "ancien type « pause » lu comme break");

      // néerlandais
      await page.getByRole('button', { name: 'Retour' }).click();
      await page.getByRole('button', { name: 'Réglages' }).click();
      // lien vers le site explicatif (téléchargement des applis)
      const siteLink = page.locator('a[href="https://bardiaux.wordpress.com/"]');
      eq(await siteLink.count(), 1, 'réglages : un seul lien vers le site explicatif');
      eq(await siteLink.getAttribute('target'), '_blank', 'le lien du site s\'ouvre dans un nouvel onglet');
      check(((await siteLink.getAttribute('rel')) || '').includes('noopener'), 'le lien du site est en noopener');
      eq((await siteLink.innerText()).trim(), 'Ouvrir le site Time2Relax', 'texte du lien du site en français');
      check((await text(page, '#app')).includes('télécharger les applis'), 'phrase d\'introduction : téléchargement des applis');
      await page.getByRole('button', { name: 'Nederlands' }).click();
      eq(await text(page, 'h1'), 'Instellingen', 'titre des réglages en néerlandais');
      eq((await page.locator('a[href="https://bardiaux.wordpress.com/"]').innerText()).trim(), 'Time2Relax-website openen', 'texte du lien du site en néerlandais');
      await page.getByRole('button', { name: 'Terug' }).click();
      check((await text(page, '.date')).toLowerCase().includes('donderdag 29 oktober'), 'date en néerlandais');
      eq(await text(page, '.start'), 'Break starten', 'bouton de démarrage en néerlandais');
      check((await text(page, '.tile-wrap')).includes('Bestellen'), 'bouton « Bestellen »');
      await page.locator('.start').click();
      await advance(page, 65000);
      await page.locator('.start').click();
      check((await text(page, '#toast')).includes('Break opgeslagen: 01:05'), 'message en néerlandais');
      await page.reload();
      check((await text(page, '.date')).toLowerCase().includes('donderdag'), 'langue mémorisée après rechargement');
      await context.close();
      check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
    }

    /* ------------------------------------------------------------ D. langue du navigateur */
    console.log('D. Langue du navigateur par défaut');
    {
      const { page, context } = await newPage(browser, { lang: 'nl-BE' });
      check((await text(page, '.banner')).startsWith('Kies je taal'), 'navigateur en néerlandais : page directement en néerlandais');
      await context.close();
    }

    /* ------------------------------------------------------------ E. commande et réglages */
    console.log('E. Commande de repas, réglages (plus d\'itinéraires)');
    {
      const { page, context, errors } = await newPage(browser, {
        // anciens réglages d'itinéraire encore présents dans le navigateur : ils doivent être ignorés
        setup: () => localStorage.setItem('t2r.prefs', JSON.stringify({ setupDone: true, homeAddr: 'ancienne adresse', navApp: 'gmaps' })),
      });
      const hrefsOf = () => page.locator('.tile-wrap a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      let hrefs = await hrefsOf();
      eq(hrefs.length, 0, 'plus de sandwicherie par défaut : aucun lien');
      check((await text(page, '.tile-wrap')).includes('Ajouter un site'), 'bouton « Commander » : « Ajouter un site »');
      // ajout depuis le bouton : adresse tapée sans https ni nom
      await page.locator('.tile-wrap .tile').click();
      await page.locator('.dlg input[type=url]').fill('pas une adresse');
      await page.locator('.dlg').getByRole('button', { name: 'OK' }).click();
      check(await page.locator('.dlg .dlg-error').isVisible(), 'adresse invalide : message dans la boîte');
      await page.locator('.dlg input[type=url]').fill('www.ma-sandwicherie.be');
      await page.locator('.dlg').getByRole('button', { name: 'OK' }).click();
      hrefs = await hrefsOf();
      eq(hrefs.length, 1, "un seul raccourci : « Commander »");
      eq(hrefs[0], 'https://www.ma-sandwicherie.be', 'bouton « Commander » vers le site ajouté (https ajouté)');
      eq(await page.evaluate(() => window.t2r.state.prefs.shops[0].name), 'ma-sandwicherie.be', 'nom déduit de l\'adresse');
      eq(await page.locator('a[href*="waze"], a[href*="google.com/maps"]').count(), 0, 'aucun lien Waze / Google Maps');
      const prefs0 = await page.evaluate(() => window.t2r.state.prefs);
      check(!('homeAddr' in prefs0) && !('workAddr' in prefs0) && !('navApp' in prefs0), "anciens réglages d'itinéraire ignorés");
      await page.getByRole('button', { name: 'Réglages' }).click();
      eq(await page.locator('input[placeholder*="dresse"]').count(), 0, "plus de champs d'adresse dans les réglages");
      eq(await page.getByRole('button', { name: /Waze|Google Maps/ }).count(), 0, "plus de choix d'application d'itinéraire");
      await page.getByRole('button', { name: 'Takeaway.com' }).click();
      await page.getByRole('button', { name: 'Takeaway.com' }).first().click();
      await page.getByRole('button', { name: 'Terug' }).or(page.getByRole('button', { name: 'Retour' })).click();
      hrefs = await hrefsOf();
      check(hrefs[0] === 'https://www.takeaway.com/be/', 'commande vers Takeaway après sélection');
      await page.getByRole('button', { name: 'Choisir un autre site' }).click();
      await page.locator('.pick-item').first().click();
      hrefs = await hrefsOf();
      check(hrefs[0] === 'https://www.ma-sandwicherie.be', 'sélecteur rapide de site de commande');
      await page.getByRole('button', { name: 'Choisir un autre site' }).click();
      await page.locator('.pick-item').nth(1).click();
      // les réglages survivent au rechargement
      await page.reload();
      hrefs = await hrefsOf();
      check(hrefs.length === 1 && hrefs[0] === 'https://www.takeaway.com/be/', 'réglages conservés après rechargement');
      // réinitialisation
      await page.getByRole('button', { name: 'Réglages' }).click();
      await page.getByRole('button', { name: 'Réinitialiser cette page' }).click();
      await page.getByRole('button', { name: 'Tout effacer' }).click();
      check(await page.locator('.banner').isVisible(), 'après réinitialisation : retour à l\'écran de bienvenue');
      check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
      await context.close();
    }

    /* ------------------------------------------------------------ G. ajouter / modifier une entrée */
    console.log("G. Ajouter ou modifier une entrée depuis l'historique");
    {
      const seedPlain = () => {
        const mk = (date, time, type, seconds, i) => ({ id: `id-${i}`, date, time, type, seconds, synced: false });
        localStorage.setItem('t2r.entries', JSON.stringify([mk('2026-10-28', '14:10', 'lunch', 1800, 1), mk('2026-10-29', '08:00', 'break', 600, 2)]));
        localStorage.setItem('t2r.prefs', JSON.stringify({ setupDone: true }));
      };
      const { page, context, errors } = await newPage(browser, { startIso: '2026-10-29T10:00:00+01:00', setup: seedPlain });
      const dlg = page.locator('.dlg');
      const vals = () => dlg.evaluate((d) => ({
        date: d.querySelector('input[type=date]').value,
        time: d.querySelector('input[type=time]').value,
        mins: d.querySelectorAll('input[type=number]')[0].value,
        secs: d.querySelectorAll('input[type=number]')[1].value,
        type: d.querySelector('.seg.on').innerText.trim(),
      }));
      const fill = async ({ date, time, mins, secs }) => {
        if (date !== undefined) await dlg.locator('input[type=date]').fill(date);
        if (time !== undefined) await dlg.locator('input[type=time]').fill(time);
        if (mins !== undefined) await dlg.locator('input[type=number]').nth(0).fill(mins);
        if (secs !== undefined) await dlg.locator('input[type=number]').nth(1).fill(secs);
      };
      const save = () => dlg.getByRole('button', { name: 'Enregistrer' }).click();
      const count = () => page.locator('.entry').count();

      await page.getByRole('button', { name: 'Historique' }).click();
      eq(await count(), 2, "2 entrées au départ");

      // --- ajout
      await page.getByRole('button', { name: 'Ajouter une entrée' }).click();
      eq(await text(page, '.dlg h2'), 'Ajouter une entrée', "titre de la boîte d'ajout");
      eq(JSON.stringify(await vals()), JSON.stringify({ date: '2026-10-29', time: '10:00', mins: '15', secs: '0', type: 'Break' }), 'valeurs par défaut : maintenant, 15 minutes, break');
      await dlg.locator('.seg').nth(1).click();
      eq((await vals()).mins, '30', 'lunch : durée par défaut 30 minutes');
      await dlg.locator('.seg').nth(0).click();
      eq((await vals()).mins, '15', 'retour à break : durée par défaut 15 minutes');

      // --- vérifications de saisie : la boîte reste ouverte avec un message
      await fill({ mins: '0', secs: '0' });
      await save();
      check((await text(page, '.dlg-error')).includes('durée valide'), 'durée nulle refusée');
      await fill({ mins: '5', date: '2026-10-30' });
      await save();
      check((await text(page, '.dlg-error')).includes('pas dans le futur'), 'date future refusée');
      await fill({ date: '2026-10-29', time: '' });
      await save();
      check((await text(page, '.dlg-error')).includes('heure de début'), 'heure vide refusée');
      await fill({ time: '09:15', secs: '75' });
      await save();
      check((await text(page, '.dlg-error')).includes('durée valide'), 'secondes hors limites refusées');
      check(await dlg.isVisible() && (await count()) === 2, 'la boîte reste ouverte et rien n\'est ajouté tant que la saisie est invalide');

      // --- ajout valide
      await fill({ mins: '12', secs: '30' });
      await save();
      await dlg.waitFor({ state: 'detached' });
      eq(await count(), 3, 'entrée ajoutée');
      check((await text(page, '#toast')).includes('Break ajouté : 12:30'), 'message « Break ajouté : 12:30 »');
      const added = await page.evaluate(() => window.t2r.state.entries.find((e) => e.time === '09:15'));
      check(added && added.date === '2026-10-29' && added.type === 'break' && added.seconds === 750 && added.synced === false && /^[\w-]{8,}$/.test(added.id), "entrée créée avec date, heure, type, durée (à synchroniser)");
      check((await page.locator('.entry').first().innerText()).includes('à 09:15'), "l'entrée est rangée à sa place (la plus récente en haut)");
      await page.getByRole('button', { name: 'Retour' }).click();
      eq(await text(page, '.stat-label'), 'Breaks · 2', 'accueil : compteur de breaks mis à jour');
      eq(await text(page, '.stat-val'), '22 min', "accueil : total du jour mis à jour (10 min + 12 min 30 s)");
      await page.getByRole('button', { name: 'Historique' }).click();

      // --- modification (même identifiant), le type change mais pas la durée saisie
      await page.locator('.entry').first().getByRole('button', { name: 'Modifier' }).click();
      eq(await text(page, '.dlg h2'), "Modifier l'entrée", 'titre de la boîte de modification');
      eq(JSON.stringify(await vals()), JSON.stringify({ date: '2026-10-29', time: '09:15', mins: '12', secs: '30', type: 'Break' }), "la boîte reprend les valeurs de l'entrée");
      await dlg.locator('.seg').nth(1).click();
      eq((await vals()).mins, '12', 'changer de type en modification ne touche pas à la durée');
      await fill({ mins: '20', secs: '0' });
      await dlg.locator('input[type=number]').nth(1).press('Enter'); // validation au clavier
      await dlg.waitFor({ state: 'detached' });
      check((await text(page, '#toast')).includes('Lunch modifié : 20:00'), 'message « Lunch modifié : 20:00 »');
      eq(await count(), 3, 'pas de doublon après modification');
      const edited = await page.evaluate((id) => window.t2r.state.entries.filter((e) => e.id === id), added.id);
      check(edited.length === 1 && edited[0].type === 'lunch' && edited[0].seconds === 1200 && edited[0].synced === false, 'même entrée mise à jour, à resynchroniser');

      // --- changement de date : l'entrée change de jour
      await page.locator('.entry').first().getByRole('button', { name: 'Modifier' }).click();
      await fill({ date: '2026-10-27', time: '23:00' });
      await save();
      await dlg.waitFor({ state: 'detached' });
      const heads = await page.locator('.day-name').allInnerTexts();
      eq(heads.join(' | '), "Aujourd'hui | Hier | Mardi 27 octobre", "l'entrée est passée au bon jour");

      // --- annuler ne change rien
      await page.locator('.entry').last().getByRole('button', { name: 'Modifier' }).click();
      await fill({ mins: '99' });
      await dlg.getByRole('button', { name: 'Annuler' }).click();
      await dlg.waitFor({ state: 'detached' });
      eq(await page.evaluate((id) => window.t2r.state.entries.find((e) => e.id === id).seconds, added.id), 1200, 'annuler : rien ne change');

      // --- persistance
      await page.reload();
      await page.getByRole('button', { name: 'Historique' }).click();
      eq(await count(), 3, 'les modifications survivent au rechargement');

      // --- mode nuit : la boîte prévient dans quelle journée tombe l'entrée
      await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('t2r.prefs')); p.nightMode = true; p.nightCutoff = 12; localStorage.setItem('t2r.prefs', JSON.stringify(p)); });
      await page.reload();
      await page.getByRole('button', { name: 'Historique' }).click();
      await page.getByRole('button', { name: 'Ajouter une entrée' }).click();
      await fill({ date: '2026-10-29', time: '02:00', mins: '7', secs: '0' });
      const hint = dlg.locator('[aria-live=polite]');
      check(await hint.isVisible() && (await hint.innerText()).includes('mercredi 28 octobre'), 'mode nuit : « cette entrée comptera pour la journée du mercredi 28 octobre »');
      await fill({ time: '13:00' });
      check(!(await hint.isVisible()), "mode nuit : pas d'avertissement quand la journée est la même");
      await fill({ time: '02:00' });
      await save();
      await dlg.waitFor({ state: 'detached' });
      const todaySection = page.locator('.day').filter({ hasText: "Aujourd'hui" });
      check((await todaySection.innerText()).includes('à 02:00'), "mode nuit : l'entrée de 02:00 est rangée dans la journée en cours");
      check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
      await context.close();
    }

    // Historique vide + néerlandais
    {
      const { page, context, errors } = await newPage(browser, { lang: 'nl-BE', setup: () => localStorage.setItem('t2r.prefs', JSON.stringify({ setupDone: true })) });
      await page.getByRole('button', { name: 'Geschiedenis' }).click();
      await page.locator('.empty .btn').click();
      eq(await text(page, '.dlg h2'), 'Item toevoegen', 'néerlandais : titre de la boîte');
      await page.locator('.dlg').getByRole('button', { name: 'Opslaan' }).click();
      await page.locator('.dlg').waitFor({ state: 'detached' });
      check((await text(page, '#toast')).includes('Break toegevoegd: 15:00'), "néerlandais : ajout depuis l'historique vide");
      eq(await page.locator('.entry').count(), 1, 'une entrée créée depuis un historique vide');
      check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
      await context.close();
    }

    /* ------------------------------------------------------------ F. compte + synchronisation (serveur simulé) */
    console.log("F. Nom d'utilisateur et synchronisation (Supabase simulé)");
    await syncTests(browser);

    console.log('H. Synchronisation des ajouts et modifications');
    await editSyncTests(browser);

    console.log('I. Arrêt par erreur : Reprendre et confirmation');
    await stopTests(browser);

    console.log('J. Chrono partagé entre appareils');
    await sharedRunTests(browser);

    console.log('K. Breaks prévus : décompte grisé, sans alerte');
    await planTests(browser);

    console.log('L. Réglages rangés sous le nom d\'utilisateur');
    await settingsSyncTests(browser);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\n${passed} vérifications réussies, ${failed} échec(s).`);
  process.exit(failed ? 1 : 0);
}

/* ---------- K. Breaks prévus ---------- */

const planSetup = (items, extra = {}, prefs = {}) => `() => {
  localStorage.setItem('t2r.prefs', JSON.stringify(Object.assign({ setupDone: true }, ${JSON.stringify(prefs)})));
  localStorage.setItem('t2r.plan', JSON.stringify(Object.assign({ items: ${JSON.stringify(items)}, repeat: true, day: '' }, ${JSON.stringify(extra)})));
}`;
const PLAN3 = [
  { id: 'a', time: '10:15', type: 'break' },
  { id: 'b', time: '12:30', type: 'lunch' },
  { id: 'c', time: '15:00', type: 'break' },
];
const planLine = async (page) => ({
  hidden: await page.locator('#planLine').evaluate((e) => e.hidden),
  text: await page.locator('#planText').innerText(),
  due: await page.locator('#planLine').evaluate((e) => e.classList.contains('due')),
  arc: await page.locator('#planArc').evaluate((e) => ({ op: e.style.opacity, off: Number(e.style.strokeDashoffset) })),
});

async function planTests(browser) {
  // --- logique pure
  {
    const { page, context } = await newPage(browser);
    const r = await page.evaluate(() => {
      const base = new Date('2026-10-29T10:00:00+01:00').getTime();
      const min = (m) => base + m * 60000;
      const items = [{ ms: min(15), type: 'break' }, { ms: min(150), type: 'lunch' }, { ms: min(300), type: 'break' }];
      const pick = (now, starts = []) => { const p = pickPlanned(min(now), items, starts); return p && { t: p.item.type, ms: p.item.ms - base, secs: p.secs, due: p.due }; };
      return {
        upcoming: pick(0),
        dueNow: pick(15),
        dueLater: pick(24),
        dueGone: pick(26),
        early: pick(0, [{ ms: min(-5), type: 'break' }]),
        tooEarly: pick(-20, [{ ms: min(-20), type: 'break' }]),
        wrongType: pick(0, [{ ms: min(10), type: 'lunch' }]),
        late: pick(40, [{ ms: min(35), type: 'break' }]),
        twoStarts: pick(100, [{ ms: min(10), type: 'break' }, { ms: min(12), type: 'break' }]),
        nearest: (() => {
          const two = [{ ms: min(15), type: 'break' }, { ms: min(60), type: 'break' }];
          const a = pickPlanned(min(55), two, [{ ms: min(50), type: 'break' }]);
          const b = pickPlanned(min(25), two, [{ ms: min(20), type: 'break' }]);
          return { a, b: b && b.item.ms - base };
        })(),
        none: pick(400),
        allDone: pick(10, [{ ms: min(10), type: 'break' }, { ms: min(120), type: 'lunch' }, { ms: min(290), type: 'break' }]),
        fmt: [formatCountdown(0), formatCountdown(59), formatCountdown(61), formatCountdown(3600), formatCountdown(6130), formatCountdown(-4)],
        nextQ: [nextQuarter(new Date('2026-10-29T10:00:00+01:00')), nextQuarter(new Date('2026-10-29T10:14:30+01:00')), nextQuarter(new Date('2026-10-29T23:50:00+01:00'))],
      };
    });
    check(r.upcoming && r.upcoming.t === 'break' && r.upcoming.ms === 15 * 60000 && r.upcoming.secs === 900 && !r.upcoming.due, 'le prochain break prévu et le temps restant (15 min)');
    check(r.dueNow && r.dueNow.due && r.dueNow.secs === 0, "à l'heure pile : « c'est l'heure »");
    check(r.dueLater && r.dueLater.due && r.dueLater.secs === 540, "« c'est l'heure » reste affiché 10 minutes");
    check(r.dueGone && r.dueGone.t === 'lunch' && !r.dueGone.due, "après 10 minutes sans rien lancer : on passe au suivant");
    check(r.early && r.early.t === 'lunch', 'un break lancé 5 min avant compte pour le break prévu');
    check(r.tooEarly && r.tooEarly.t === 'break' && r.tooEarly.ms === 15 * 60000, 'lancé plus de 30 min avant : ne compte pas');
    check(r.wrongType && r.wrongType.t === 'break', "un lunch ne remplace pas un break prévu");
    check(r.late && r.late.t === 'lunch', 'lancé en retard (35 min après) : compte pour le break prévu');
    check(r.twoStarts && r.twoStarts.t === 'lunch' && r.twoStarts.secs === 3000, 'deux départs : un seul break prévu consommé');
    check(r.nearest.a === null && r.nearest.b === 60 * 60000, "un break compte pour l'horaire le plus proche (10:50 → 11:00, 10:20 → 10:15)");
    check(r.none === null, 'plus rien de prévu : null');
    check(r.allDone === null, 'tout a été pris : null');
    eq(r.fmt.join(' | '), '00:00 | 00:59 | 01:01 | 1:00:00 | 1:42:10 | 00:00', 'format du décompte');
    eq(r.nextQ.join(' '), '10:15 10:15 00:00', 'heure de départ proposée : prochain quart d\'heure');
    await context.close();
  }

  // --- l'icône, la page, les ajouts, modifications et suppressions
  {
    const { page, context, errors } = await newPage(browser, { setup: () => localStorage.setItem('t2r.prefs', JSON.stringify({ setupDone: true })) });
    check(await page.locator('#planLine').evaluate((e) => e.hidden), 'sans horaire : aucune ligne grise');
    eq(await page.locator('#planTrack').evaluate((e) => e.style.opacity), '0', 'sans horaire : aucun cercle gris');
    const labels = await page.locator('.icon-btn').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    eq(labels.slice(0, 3).join(' | '), 'Historique | Breaks prévus | Réglages', "icône calendrier entre l'historique et les réglages");
    await page.getByRole('button', { name: 'Breaks prévus' }).click();
    eq(await text(page, 'h1'), 'Breaks prévus', 'la page des breaks prévus');
    check(await page.locator('.plan-empty').isVisible(), 'liste vide : message');
    const dlg = page.locator('.dlg');
    const addAt = async (label, time) => {
      await page.getByRole('button', { name: label }).click();
      await dlg.locator('input[type=time]').fill(time);
      await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    };
    await page.getByRole('button', { name: 'Ajouter un break' }).click();
    eq(await dlg.locator('input[type=time]').inputValue(), '10:15', "heure de départ = prochain quart d'heure");
    eq(await page.locator('.plan-item').count(), 0, "rien n'est ajouté tant que la fenêtre est ouverte");
    await dlg.getByRole('button', { name: 'Annuler' }).click();
    eq(await page.locator('.plan-item').count(), 0, 'annuler : rien ajouté');
    await addAt('Ajouter un break', '09:45');
    await addAt('Ajouter un lunch', '12:30');
    await addAt('Ajouter un break', '15:00');
    eq(await page.locator('.plan-item').count(), 3, 'trois horaires ajoutés');
    eq(await text(page, '.sec-title'), 'Mon planning (3)', 'titre « Mon planning » avec le nombre');
    const list = () => page.evaluate(() => window.t2r.state.plan.items.map((i) => `${i.time} ${i.type}`).join(', '));
    eq(await list(), '09:45 break, 12:30 lunch, 15:00 break', 'liste triée par heure, type choisi à l\'ajout');
    // même heure qu'un autre : bloqué
    await page.getByRole('button', { name: 'Ajouter un break' }).click();
    await dlg.locator('input[type=time]').fill('12:30');
    check(await dlg.getByRole('button', { name: 'Enregistrer' }).isDisabled(), 'heure déjà prise : « Enregistrer » bloqué');
    await dlg.getByRole('button', { name: 'Annuler' }).click();
    // modifier : type et heure ensemble, dans la fenêtre
    await page.locator('.plan-item').nth(0).click();
    await dlg.getByRole('button', { name: 'Lunch' }).click();
    eq(await list(), '09:45 break, 12:30 lunch, 15:00 break', 'pendant l\'édition, le planning ne change pas');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    eq(await list(), '09:45 lunch, 12:30 lunch, 15:00 break', 'changer le type (break → lunch)');
    await page.locator('.plan-item').nth(0).click();
    await dlg.getByRole('button', { name: 'Supprimer' }).click();
    eq(await list(), '12:30 lunch, 15:00 break', 'supprimer un horaire');
    await page.reload();
    eq(await list(), '12:30 lunch, 15:00 break', 'les horaires sont gardés après rechargement');
    check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
    await context.close();
  }

  // --- « Me prévenir quand l'heure approche » : une notification N minutes avant, une seule fois
  {
    const { page, context, errors } = await newPage(browser, { setup: eval(planSetup(PLAN3, {}, { planNotify: true, planNotifyLead: 5 })) });
    const notes = () => page.evaluate(() => window.__notes.map((n) => `${n.title} | ${n.body}`));
    await page.evaluate(() => window.t2r.checkPlanReminders());
    eq((await notes()).length, 0, 'à 10:00 (break à 10:15, rappel 5 min avant) : rien encore');
    await advance(page, 10 * 60000 + 1000);
    await page.evaluate(() => window.t2r.checkPlanReminders());
    eq((await notes()).join(' / '), 'Break dans 5 min | Prévu à 10:15.', 'à 10:10 : « Break dans 5 min »');
    await page.evaluate(() => window.t2r.checkPlanReminders());
    eq((await notes()).length, 1, 'pas de seconde notification pour le même break');
    await page.reload();
    await page.evaluate(() => window.t2r.checkPlanReminders());
    eq((await notes()).length, 0, 'après rechargement non plus');
    // la case et les minutes dans la page
    await page.getByRole('button', { name: 'Breaks prévus' }).click();
    check(await page.getByRole('checkbox', { name: "Me prévenir quand l'heure approche" }).isChecked(), 'case « Me prévenir quand l\'heure approche » cochée');
    await page.locator('.lead-row').click();
    await page.locator('.dlg').getByRole('button', { name: '10 min' }).click();
    await page.locator('.dlg').getByRole('button', { name: 'OK' }).click();
    eq(await page.evaluate(() => window.t2r.state.prefs.planNotifyLead), 10, 'nombre de minutes choisi : 10');
    await page.getByRole('checkbox', { name: "Me prévenir quand l'heure approche" }).uncheck();
    eq(await page.evaluate(() => window.t2r.state.prefs.planNotify), false, 'case décochée : plus de rappel');
    check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
    await context.close();
  }

  // --- anglais et allemand
  {
    const en = await newPage(browser, { lang: 'en-GB', setup: eval(planSetup(PLAN3)) });
    eq(await en.page.evaluate(() => LANG), 'en', 'navigateur en anglais : page en anglais');
    eq((await planLine(en.page)).text, 'Next break · 10:15 · in 15:00', 'ligne grise en anglais');
    eq(await text(en.page, '.start'), 'Start break', 'bouton « Start break »');
    await en.context.close();
    const de = await newPage(browser, { lang: 'de-DE', setup: eval(planSetup(PLAN3)) });
    eq(await de.page.evaluate(() => LANG), 'de', 'navigateur en allemand : page en allemand');
    eq((await planLine(de.page)).text, 'Nächste: Pause · 10:15 · in 15:00', 'ligne grise en allemand');
    eq(await text(de.page, '.start'), 'Pause starten', 'bouton « Pause starten »');
    await de.context.close();
    const es = await newPage(browser, { lang: 'es-ES', setup: () => localStorage.setItem('t2r.prefs', JSON.stringify({ setupDone: true })) });
    eq(await es.page.evaluate(() => LANG), 'en', 'langue non proposée (espagnol) : anglais');
    await es.page.getByRole('button', { name: 'Settings' }).click();
    await es.page.getByRole('button', { name: 'Deutsch' }).click();
    eq(await text(es.page, 'h1'), 'Einstellungen', 'choix « Deutsch » dans les réglages');
    // durées dans les réglages
    await es.page.locator('.dur-row-btn').nth(1).click();
    await es.page.locator('.dlg').getByRole('button', { name: '45 Min.' }).click();
    await es.page.locator('.dlg').getByRole('button', { name: 'OK' }).click();
    eq(await es.page.evaluate(() => window.t2r.state.ui.lunchMinutes), 45, 'durée du lunch choisie dans les réglages : 45 min');
    await es.context.close();
  }

  // --- couleurs et mode clair / sombre
  {
    const { page, context, errors } = await newPage(browser, { setup: () => localStorage.setItem('t2r.prefs', JSON.stringify({ setupDone: true })) });
    const prim = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
    eq(await prim(), '#0F766E', "couleur d'origine par défaut");
    await page.getByRole('button', { name: 'Réglages' }).click();
    await page.getByRole('button', { name: 'Couleur 7' }).click();
    eq(await page.evaluate(() => window.t2r.state.prefs.themeColor), 'purple', 'pastille violette choisie');
    check((await prim()).startsWith('hsl(262'), 'la couleur principale devient violette');
    await page.getByRole('button', { name: 'Sombre' }).click();
    eq(await page.evaluate(() => document.documentElement.style.colorScheme), 'dark', 'mode sombre forcé');
    await page.reload();
    check((await prim()).startsWith('hsl(262') && (await page.evaluate(() => document.documentElement.style.colorScheme)) === 'dark', 'couleur et mode gardés après rechargement');
    check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
    await context.close();
  }

  // --- affichage sur l'accueil : décompte, « c'est l'heure », suivant, plus rien — et jamais d'alerte
  {
    const { page, context, errors } = await newPage(browser, { setup: eval(planSetup(PLAN3)) });
    let p = await planLine(page);
    check(!p.hidden, 'une ligne grise sous le cadran');
    eq(p.text, 'Prochain break · 10:15 · dans 15:00', 'prochain break et temps restant');
    const circ = await page.evaluate(() => PLAN_CIRC);
    check(!p.due && p.arc.op === '1' && Math.abs(p.arc.off / circ - 0.875) < 0.01, "l'arc gris est rempli à 12,5 % (15 min sur 2 h)");
    await advance(page, 5 * 60000 + 1000);
    p = await planLine(page);
    eq(p.text, 'Prochain break · 10:15 · dans 09:59', 'le décompte avance (sans relancer le chrono)');
    eq(await text(page, '#ringBig'), '00:00', 'le chrono du cadran reste à zéro');
    await advance(page, 10 * 60000);
    p = await planLine(page);
    eq(p.text, "C'est l'heure du break (10:15)", "à l'heure : « c'est l'heure du break »");
    check(p.due, 'mise en évidence (classe due)');
    await advance(page, 11 * 60000);
    p = await planLine(page);
    eq(p.text, 'Prochain lunch · 12:30 · dans 2:03:59', 'sans rien lancer : on passe au lunch');
    await page.evaluate(() => window.__setNow('2026-10-29T16:00:00+01:00'));
    await tick(page);
    p = await planLine(page);
    eq(p.text, "Plus de break prévu aujourd'hui", 'plus rien de prévu aujourd\'hui');
    check(p.arc.op === '0', 'plus d\'arc gris');
    eq((await page.evaluate(() => window.__notes)).length, 0, 'aucune notification, aucune alerte');
    eq(await page.evaluate(() => window.__beeps), 0, 'aucun bip');
    check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
    await context.close();
  }

  // --- un break lancé un peu en avance compte, y compris pendant qu'il tourne
  {
    const { page, context } = await newPage(browser, { setup: eval(planSetup(PLAN3)), startIso: '2026-10-29T10:05:00+01:00' });
    await page.locator('.start').click();
    let p = await planLine(page);
    eq(p.text, 'Prochain lunch · 12:30 · dans 2:25:00', 'break en cours (lancé 10 min avant) : le suivant est le lunch');
    await advance(page, 4 * 60000);
    await page.locator('.start').click();
    p = await planLine(page);
    eq(p.text, 'Prochain lunch · 12:30 · dans 2:21:00', 'après le break : toujours le lunch');
    await page.locator('.seg').nth(1).click();
    await page.locator('.start').click();
    p = await planLine(page);
    eq(p.text, 'Prochain lunch · 12:30 · dans 2:21:00', 'un lunch lancé 2 h avant l\'heure prévue ne compte pas');
    await page.locator('.start').click();
    await page.evaluate(() => window.__setNow('2026-10-29T12:10:00+01:00'));
    await tick(page);
    await page.locator('.start').click();
    p = await planLine(page);
    eq(p.text, 'Prochain break · 15:00 · dans 2:50:00', 'un lunch lancé 20 min avant l\'heure prévue compte');
    await context.close();
  }

  // --- jours de la semaine, répétition, mode nuit, néerlandais, réinitialisation
  {
    const sat = await newPage(browser, { setup: eval(planSetup(PLAN3)), startIso: '2026-10-31T10:00:00+01:00' });
    check(await sat.page.locator('#planLine').evaluate((e) => e.hidden), 'samedi : rien (répétition du lundi au vendredi)');
    await sat.context.close();

    // Jours au choix : un samedi, la page explique pourquoi rien ne s'affiche, et cocher « Sam » règle tout
    {
      const d = await newPage(browser, { setup: eval(planSetup(PLAN3)), startIso: '2026-10-31T10:00:00+01:00' });
      await d.page.getByRole('button', { name: 'Breaks prévus' }).click();
      eq(await d.page.locator('.plan-days .chip').allInnerTexts().then((a) => a.join(' ')), 'Lun Mar Mer Jeu Ven Sam Dim', 'sept jours à cocher');
      eq(await d.page.locator('.plan-days .chip.on').allInnerTexts().then((a) => a.join(' ')), 'Lun Mar Mer Jeu Ven', 'par défaut : du lundi au vendredi');
      check((await text(d.page, '.plan-hint')).includes("Rien n'est affiché aujourd'hui (samedi)"), "samedi, jour non coché : une phrase explique pourquoi rien ne s'affiche");
      await d.page.locator('.plan-days .chip', { hasText: 'Sam' }).click();
      check(await d.page.locator('.plan-hint').count() === 0, 'samedi coché : la phrase disparaît');
      eq(await d.page.evaluate(() => window.t2r.state.plan.days.join(',')), '1,2,3,4,5,6', 'jours enregistrés (lundi à samedi)');
      await d.page.getByRole('button', { name: 'Retour' }).click();
      check(!(await d.page.locator('#planLine').evaluate((e) => e.hidden)), 'samedi coché : le décompte gris apparaît');
      await d.page.reload();
      check(!(await d.page.locator('#planLine').evaluate((e) => e.hidden)), 'et reste après rechargement');
      await d.page.getByRole('button', { name: 'Breaks prévus' }).click();
      await d.page.locator('.plan-days .chip', { hasText: 'Sam' }).click();
      await d.page.locator('.plan-days .chip', { hasText: 'Dim' }).click();
      await d.page.locator('.plan-days .chip', { hasText: 'Jeu' }).click();
      eq(await d.page.evaluate(() => window.t2r.state.plan.days.join(',')), '1,2,3,5,7', 'décocher le samedi et le jeudi, cocher le dimanche');
      await d.context.close();
      const old = await newPage(browser, { setup: eval(planSetup(PLAN3)), startIso: '2026-10-30T10:00:00+01:00' });
      eq(await old.page.evaluate(() => window.t2r.state.plan.days.join(',')), '1,2,3,4,5', 'anciens horaires (sans jours) : lundi à vendredi');
      check(!(await old.page.locator('#planLine').evaluate((e) => e.hidden)), 'et un vendredi, ça s\'affiche');
      await old.context.close();
      const nlp = await newPage(browser, { setup: eval(planSetup(PLAN3)), lang: 'nl-BE', startIso: '2026-10-31T10:00:00+01:00' });
      await nlp.page.getByRole('button', { name: 'Geplande breaks' }).click();
      eq(await nlp.page.locator('.plan-days .chip').allInnerTexts().then((a) => a.join(' ')), 'Ma Di Wo Do Vr Za Zo', 'néerlandais : jours');
      check((await text(nlp.page, '.plan-hint')).includes('Vandaag (zaterdag) wordt niets getoond'), 'néerlandais : explication du week-end');
      await nlp.context.close();
    }

    const noRep = await newPage(browser, { setup: eval(planSetup(PLAN3, { repeat: false, day: '2026-10-31' })), startIso: '2026-10-31T10:00:00+01:00' });
    check(!(await noRep.page.locator('#planLine').evaluate((e) => e.hidden)), 'sans répétition : vaut pour le jour où on les a saisis');
    await noRep.context.close();
    const noRep2 = await newPage(browser, { setup: eval(planSetup(PLAN3, { repeat: false, day: '2026-10-28' })), startIso: '2026-10-29T10:00:00+01:00' });
    check(await noRep2.page.locator('#planLine').evaluate((e) => e.hidden), 'sans répétition : plus rien le lendemain');
    await noRep2.context.close();

    const night = await newPage(browser, {
      setup: eval(planSetup([{ id: 'n', time: '01:30', type: 'break' }, { id: 'm', time: '23:00', type: 'lunch' }], {}, { nightMode: true, nightCutoff: 6 })),
      startIso: '2026-10-29T22:00:00+01:00',
    });
    let p = await planLine(night.page);
    eq(p.text, 'Prochain lunch · 23:00 · dans 1:00:00', 'mode nuit : le lunch de 23 h');
    await night.page.evaluate(() => window.__setNow('2026-10-30T00:30:00+01:00'));
    await tick(night.page);
    p = await planLine(night.page);
    eq(p.text, 'Prochain break · 01:30 · dans 1:00:00', 'mode nuit : 01:30 est la nuit suivante, pas hier');
    await night.page.evaluate(() => window.__setNow('2026-10-30T03:00:00+01:00'));
    await tick(night.page);
    p = await planLine(night.page);
    eq(p.text, "Plus de break prévu aujourd'hui", 'mode nuit : tout est passé à 3 h du matin');
    await night.context.close();

    const nl = await newPage(browser, { setup: eval(planSetup(PLAN3)), lang: 'nl-BE' });
    p = await planLine(nl.page);
    eq(p.text, 'Volgende break · 10:15 · over 15:00', 'néerlandais : décompte');
    await advance(nl.page, 15 * 60000);
    p = await planLine(nl.page);
    eq((await planLine(nl.page)).text, 'Tijd voor je break (10:15)', 'néerlandais : « tijd voor je break »');
    await nl.context.close();

    const rs = await newPage(browser, { setup: eval(planSetup(PLAN3)) });
    await rs.page.getByRole('button', { name: 'Réglages' }).click();
    await rs.page.getByRole('button', { name: 'Réinitialiser cette page' }).click();
    await rs.page.getByRole('button', { name: 'Tout effacer' }).click();
    eq(await rs.page.evaluate(() => window.t2r.state.plan.items.length), 0, 'réinitialiser la page efface aussi les horaires prévus');
    eq(await rs.page.evaluate(() => localStorage.getItem('t2r.plan')), null, 'et la copie enregistrée');
    await rs.context.close();
  }
}

/* ---------- Faux Supabase en mémoire : les trois fonctions SQL, par nom d'utilisateur ---------- */
function makeMockSupabase() {
  const db = { rows: [], log: [], delayPost: 0, runs: {}, skew: 0, noRun: false, settings: {}, noSettings: false, settingsSets: 0, failClear: false, clears: 0 };
  db.now = () => Date.now() + db.skew; // horloge du « serveur » (avançable)
  db.advance = (ms) => { db.skew += ms; };
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'apikey, authorization, content-type, prefer, x-client-info',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  };
  db.of = (name) => db.rows.filter((r) => r.username === name);
  db.handler = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    db.log.push(`${req.method()} ${url.pathname}${url.search}`);
    if (!req.headers().apikey) return json(401, { message: 'No API key found in request' });
    const m = /^\/rest\/v1\/rpc\/(t2r_list|t2r_save|t2r_delete|t2r_run_get|t2r_run_start|t2r_run_stop|t2r_settings_get|t2r_settings_set|t2r_settings_clear)$/.exec(url.pathname);
    if (!m || req.method() !== 'POST') return json(404, { message: 'not found' });
    if (m[1].startsWith('t2r_run_') && db.noRun) return json(404, { code: 'PGRST202', message: 'Could not find the function public.' + m[1] });
    if (m[1].startsWith('t2r_settings_') && db.noSettings) return json(404, { code: 'PGRST202', message: 'Could not find the function public.' + m[1] });
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    const who = String(body.p_username || '').trim().toLowerCase();
    if (who.length < 2 || who.length > 40) return json(400, { code: 'P0001', message: "nom d'utilisateur invalide" });

    if (m[1].startsWith('t2r_run_')) {
      const day = 86400000;
      const current = () => {
        const r = db.runs[who];
        if (!r) return [];
        const el = db.now() - r.startedAt;
        return el >= day ? [] : [{ run_id: r.id, elapsed_ms: el, kind: r.type, planned_s: r.planned }];
      };
      if (m[1] === 't2r_run_get') return json(200, current());
      if (m[1] === 't2r_run_start') {
        if (!['break', 'lunch'].includes(body.p_type) || !(body.p_planned >= 0 && body.p_planned <= 86400)) return json(400, { code: 'P0001', message: 'chrono invalide' });
        if (db.runs[who] && db.now() - db.runs[who].startedAt >= day) delete db.runs[who];
        if (!db.runs[who]) {
          const el = Math.min(Math.max(Number(body.p_elapsed_ms) || 0, 0), day - 1000);
          db.runs[who] = { id: body.p_id, startedAt: db.now() - el, type: body.p_type, planned: body.p_planned };
        }
        return json(200, current());
      }
      const had = !!db.runs[who] && db.runs[who].id === body.p_id;
      if (had) delete db.runs[who];
      return json(200, had);
    }

    if (m[1].startsWith('t2r_settings_')) {
      // Même liste blanche que la fonction SQL : les adresses ne sont jamais gardées.
      const allowed = ['lang', 'theme_color', 'theme_mode', 'confirm_stop', 'night_mode', 'night_cutoff', 'use_timer', 'pause_minutes', 'lunch_minutes', 'plan_notify', 'plan_notify_lead', 'os_lead', 'nav_app', 'shops', 'shop_index', 'plan'];
      if (m[1] === 't2r_settings_get') return json(200, db.settings[who]);
      if (m[1] === 't2r_settings_clear') {
        if (db.failClear) return json(500, { message: 'serveur en panne' });
        db.clears += 1;
        const existed = !!db.settings[who];
        delete db.settings[who];
        return json(200, existed);
      }
      if (!body.p_patch || typeof body.p_patch !== 'object') return json(400, { code: 'P0001', message: 'réglages invalides' });
      db.settingsSets += 1;
      db.settings[who] = db.settings[who] || {};
      for (const [k, v] of Object.entries(body.p_patch)) if (allowed.includes(k)) db.settings[who][k] = v;
      return json(200, db.settings[who]);
    }

    if (m[1] === 't2r_list') {
      const mine = db.of(who).sort((a, b) => (a.date + a.time + a.id).localeCompare(b.date + b.time + b.id));
      const limit = Number(url.searchParams.get('limit') || 1000);
      const offset = Number(url.searchParams.get('offset') || 0);
      return json(200, mine.slice(offset, offset + limit).map(({ id, date, time, type, seconds }) => ({ id, date, time, type, seconds })));
    }
    if (m[1] === 't2r_save') {
      if (db.delayPost) await new Promise((r) => setTimeout(r, db.delayPost)); // serveur lent (test de modification pendant l'envoi)
      for (const r of body.p_rows) {
        if (!/^\d{2}:\d{2}$/.test(r.time) || !['break', 'lunch'].includes(r.type) || !(r.seconds >= 0 && r.seconds <= 86400)) return json(400, { code: '23514', message: 'check constraint' });
        const i = db.rows.findIndex((x) => x.id === r.id);
        if (i < 0) db.rows.push({ ...r, username: who });
        else if (db.rows[i].username === who) db.rows[i] = { ...r, username: who }; // l'entrée d'un autre nom n'est jamais touchée
      }
      return route.fulfill({ status: 204, headers: cors });
    }
    db.rows = db.rows.filter((r) => !(r.username === who && body.p_ids.includes(r.id)));
    return route.fulfill({ status: 204, headers: cors });
  };
  return db;
}

async function settingsSyncTests(browser) {
  const db = makeMockSupabase();
  const open = (iso, opts) => openWithMock(browser, db, iso, opts);
  const idle = (page) => page.waitForFunction(() => !window.t2r.state.sync.busy && window.t2r.state.sync.last, null, { timeout: 10000 });
  const A = await open('2026-10-29T10:00:00+01:00');
  await A.page.getByRole('button', { name: 'Continuer' }).click();
  // Réglages choisis avant la connexion : langue, mode nuit, boutique, jours des breaks prévus
  await A.page.evaluate(() => {
    const s = window.t2r.state;
    s.prefs.lang = 'nl'; s.prefs.nightMode = true; s.prefs.nightCutoff = 6;
    s.prefs.shops = [{ name: 'Chez Moi', url: 'https://moi.be/' }]; s.prefs.shopIndex = 0;
    s.plan.items = [{ id: 'p1', time: '10:15', type: 'break' }]; s.plan.days = [6, 7];
    s.ui.useTimer = true; s.ui.pauseMinutes = 10;
    savePrefs(); savePlan(); saveUi();
  });
  await A.page.getByRole('button', { name: /Instellingen|Réglages/ }).click();
  await signInAs(A.page, 'réglages-1');
  await A.page.getByRole('button', { name: /Aanmelden|Se connecter/ }).click().catch(() => {});
  await idle(A.page);
  const s1 = db.settings['réglages-1'];
  check(!!s1, 'les réglages sont envoyés sous le nom');
  eq(s1 && s1.lang, 'nl', 'langue envoyée');
  eq(s1 && s1.night_mode, true, 'mode nuit envoyé');
  eq(s1 && s1.shops && s1.shops[0].name, 'Chez Moi', 'sandwicherie envoyée');
  eq(s1 && s1.plan && s1.plan.days.join(','), '6,7', 'jours des breaks prévus envoyés');
  eq(s1 && s1.pause_minutes, 10, 'durée du minuteur envoyée');
  check(!JSON.stringify(db.settings).match(/home_addr|work_addr/), 'aucune adresse sur le serveur');

  // Appareil B (neuf) : même nom → retrouve les réglages
  const B = await open('2026-10-30T09:00:00+01:00');
  await B.page.getByRole('button', { name: 'Continuer' }).click();
  await B.page.getByRole('button', { name: 'Réglages' }).click();
  await signInAs(B.page, 'RÉGLAGES-1');
  await B.page.waitForFunction(() => window.t2r.state.prefs.lang === 'nl', null, { timeout: 10000 });
  const bs = await B.page.evaluate(() => { const s = window.t2r.state; return { night: s.prefs.nightMode, cut: s.prefs.nightCutoff, shop: s.prefs.shops[0].name, days: s.plan.days.join(','), items: s.plan.items.length, timer: s.ui.useTimer, pm: s.ui.pauseMinutes }; });
  check(bs.night && bs.cut === 6 && bs.shop === 'Chez Moi' && bs.days === '6,7' && bs.items === 1 && bs.timer && bs.pm === 10, 'le second appareil retrouve tous les réglages');
  eq(await B.page.evaluate(() => document.querySelector('h1').innerText), 'Instellingen', 'et la langue change tout de suite');

  // Un réglage changé sur B arrive sur A
  await B.page.evaluate(() => { window.t2r.state.prefs.confirmStop = true; savePrefs(); });
  await waitFor(() => db.settings['réglages-1'].confirm_stop === true);
  check(true, 'réglage changé sur B : envoyé tout seul');
  await A.page.evaluate(() => window.t2r.runPoll());
  await A.page.evaluate(() => syncNow());
  await A.page.waitForFunction(() => window.t2r.state.prefs.confirmStop === true, null, { timeout: 10000 });
  check(true, 'et récupéré sur A à la synchro suivante');

  // Hors connexion : le réglage attend, puis part au retour du réseau
  B.setOffline(true);
  await B.page.evaluate(() => { window.t2r.state.prefs.nightCutoff = 8; savePrefs(); });
  await B.page.waitForTimeout(1200);
  eq(db.settings['réglages-1'].night_cutoff, 6, 'hors connexion : rien ne part');
  B.setOffline(false);
  await B.page.evaluate(() => syncNow());
  await waitFor(() => db.settings['réglages-1'].night_cutoff === 8);
  check(true, 'au retour du réseau : le réglage part');
  eq(await B.page.evaluate(() => window.t2r.state.prefs.nightCutoff), 8, 'et reste tel quel ici');

  // Valeurs du serveur abîmées : ignorées, jamais d'erreur
  db.settings['réglages-1'].lang = 'es';
  db.settings['réglages-1'].shops = [{ name: 'X', url: 'javascript:alert(1)' }];
  db.settings['réglages-1'].pause_minutes = 75;
  db.settings['réglages-1'].lunch_minutes = 2;
  await A.page.evaluate(() => syncNow());
  await A.page.waitForFunction(() => !window.t2r.state.sync.busy);
  const ok = await A.page.evaluate(() => { const s = window.t2r.state; return s.prefs.lang === 'nl' && s.prefs.shops[0].name === 'Chez Moi' && s.ui.pauseMinutes === 10; });
  check(ok, 'valeurs invalides du serveur ignorées');
  check(A.errors.length === 0, `aucune erreur console (${A.errors.join(' | ')})`);

  // Fonctions SQL pas encore installées : l'historique marche, aucun message d'erreur
  const db2 = makeMockSupabase();
  db2.noSettings = true;
  const C = await openWithMock(browser, db2, '2026-10-29T10:00:00+01:00');
  await C.page.getByRole('button', { name: 'Continuer' }).click();
  await C.page.getByRole('button', { name: 'Réglages' }).click();
  await signInAs(C.page, 'sans-sql');
  await idle(C.page);
  eq(await C.page.evaluate(() => window.t2r.state.sync.error), '', 'fonctions de réglages absentes : aucune erreur affichée');
  C.setOffline(false);

  // « Réinitialiser » efface aussi les réglages en ligne (pas l'historique) ; sans réseau ou serveur en panne : rien n'est touché
  await B.page.evaluate(() => go('settings'));
  const rowsBefore = db.rows.length;
  db.failClear = true;
  await B.page.getByRole('button', { name: 'Deze pagina resetten' }).click();
  await B.page.getByRole('button', { name: 'Alles wissen' }).click();
  await B.page.waitForFunction(() => document.getElementById('toast').textContent.includes('De online instellingen konden niet worden gewist'));
  check(true, 'serveur en panne : message, la réinitialisation est annulée');
  check(!!db.settings['réglages-1'], 'et les réglages en ligne sont toujours là');
  eq(await B.page.evaluate(() => (window.t2r.state.session || {}).username), 'réglages-1', 'et la session est conservée');
  eq(await B.page.evaluate(() => window.t2r.state.prefs.nightCutoff), 8, 'et les réglages locaux aussi');
  db.failClear = false;
  await B.page.getByRole('button', { name: 'Deze pagina resetten' }).click();
  await B.page.getByRole('button', { name: 'Alles wissen' }).click();
  await waitFor(() => !db.settings['réglages-1']);
  check(true, 'réinitialiser : les réglages en ligne sont effacés');
  eq(db.clears, 1, 'une seule demande d\'effacement');
  await B.page.waitForFunction(() => window.t2r.state.session === null);
  eq(await B.page.evaluate(() => window.t2r.state.session), null, 'réinitialiser : déconnecté');
  eq(db.rows.length, rowsBefore, "l'historique en ligne n'est pas touché");
  eq(await B.page.evaluate(() => window.t2r.state.prefs.nightCutoff), 12, 'les réglages locaux sont remis à zéro');
  // Un autre appareil qui se connecte sous ce nom ne retrouve plus de réglages
  const D2 = await open('2026-10-29T10:00:00+01:00');
  await D2.page.getByRole('button', { name: 'Continuer' }).click();
  await D2.page.getByRole('button', { name: 'Réglages' }).click();
  await signInAs(D2.page, 'réglages-1');
  await idle(D2.page);
  eq(await D2.page.evaluate(() => window.t2r.state.prefs.shops.length), 0, 'sous ce nom, plus aucun réglage à retrouver (aucun site)');
  await D2.context.close();
  // Fonction d'effacement absente du serveur (404) : la réinitialisation se fait quand même
  await C.page.evaluate(() => go('settings'));
  await C.page.getByRole('button', { name: 'Réinitialiser cette page' }).click();
  await C.page.getByRole('button', { name: 'Tout effacer' }).click();
  await C.page.waitForFunction(() => window.t2r.state.session === null);
  check(true, 'serveur sans la fonction d\'effacement : la réinitialisation aboutit');

  // Déconnexion : plus rien en attente
  await B.page.evaluate(() => signOut());
  eq(await B.page.evaluate(() => localStorage.getItem('t2r.setUser')), null, 'déconnexion : le nom des réglages est oublié');
  for (const x of [A, B, C]) await x.context.close();
}

const cfgFor = (pollMs) => `window.T2R_CONFIG = { supabaseUrl: 'https://mock.supabase.test', supabaseKey: 'sb_publishable_test', pollMs: ${pollMs} };`;

// pollMs: 0 = pas de relecture automatique du chrono (les tests la déclenchent à la main, sans hasard)
async function openWithMock(browser, db, startIso, { pollMs = 0 } = {}) {
  const context = await browser.newContext({ timezoneId: 'Europe/Brussels', locale: 'fr-BE', viewport: { width: 420, height: 900 } });
  await context.addInitScript(initScript(startIso));
  await context.route('**/config.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: cfgFor(pollMs) }));
  const dev = { off: false };
  await context.route('https://mock.supabase.test/**', (r) => (dev.off ? r.abort('internetdisconnected') : db.handler(r)));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto(BASE);
  return { page, context, errors, setOffline: (v) => { dev.off = v; } };
}

/** Réglages → nom d'utilisateur → « Se connecter ». */
async function signInAs(page, name) {
  await page.locator('#acctName').fill(name);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

const allSynced = (page) => page.waitForFunction(() => {
  const s = window.t2r.state;
  return !s.sync.busy && s.sync.last !== null && s.entries.every((e) => e.synced) && s.deleted.length === 0;
}, null, { timeout: 10000 });

async function syncTests(browser) {
  const db = makeMockSupabase();
  const open = (iso) => openWithMock(browser, db, iso);

  // Poste 1 : un break fait hors connexion, puis choix du nom d'utilisateur
  const a = await open('2026-10-29T10:00:00+01:00');
  await a.page.getByRole('button', { name: 'Continuer' }).click();
  await a.page.locator('.start').click();
  await advance(a.page, 61000);
  await a.page.locator('.start').click();
  await a.page.getByRole('button', { name: 'Réglages' }).click();
  check(await a.page.locator('#acctCard').isVisible(), "carte « Nom d'utilisateur » visible quand la synchro est configurée");
  eq(await a.page.locator('input[type=password], input[type=email]').count(), 0, 'ni mot de passe ni e-mail à saisir');

  await signInAs(a.page, 'a');
  check((await text(a.page, '#acctMsg')).includes('2 à 40'), 'nom trop court refusé');
  await signInAs(a.page, '  Michaël-1234  ');
  await a.page.waitForSelector('#syncStatus');
  await allSynced(a.page);
  check((await text(a.page, '#acctCard')).includes('Connecté : michaël-1234'), 'connecté : le nom est nettoyé (espaces, majuscules)');
  eq(db.of('michaël-1234').length, 1, "l'entrée faite avant la connexion est envoyée sous ce nom");
  check(db.log.some((l) => l.includes('/rpc/t2r_save')), 'envoi par la fonction « t2r_save » (pas de doublon possible)');
  check((await text(a.page, '#syncStatus')).startsWith('Dernière synchro'), 'état de synchro affiché');

  // Nouveau break : envoyé tout seul
  await a.page.getByRole('button', { name: 'Retour' }).click();
  await a.page.locator('.start').click();
  await advance(a.page, 125000);
  await a.page.locator('.start').click();
  await allSynced(a.page);
  eq(db.of('michaël-1234').length, 2, 'deuxième entrée synchronisée automatiquement');

  // La session reste ouverte après un rechargement
  await a.page.reload();
  eq(await a.page.evaluate(() => window.t2r.state.session && window.t2r.state.session.username), 'michaël-1234', 'session conservée après rechargement');

  // Poste 2 (autre navigateur) : même nom, écrit avec des majuscules
  const b = await open('2026-10-30T09:00:00+01:00');
  await b.page.getByRole('button', { name: 'Continuer' }).click();
  await b.page.getByRole('button', { name: 'Réglages' }).click();
  await signInAs(b.page, 'MICHAËL-1234');
  await b.page.waitForFunction(() => window.t2r.state.entries.length === 2, null, { timeout: 8000 });
  check(true, 'le second poste retrouve les 2 entrées avec le même nom (majuscules sans importance)');

  // Poste 3 : un autre nom ne voit rien de tout cela
  const c = await open('2026-10-30T09:00:00+01:00');
  await c.page.getByRole('button', { name: 'Continuer' }).click();
  await c.page.locator('.start').click();
  await advance(c.page, 90000);
  await c.page.locator('.start').click();
  await c.page.getByRole('button', { name: 'Réglages' }).click();
  await signInAs(c.page, 'collègue-42');
  await allSynced(c.page);
  eq(db.of('collègue-42').length, 1, 'autre nom : son historique est séparé');
  eq(db.of('michaël-1234').length, 2, "l'historique du premier nom n'a pas bougé");
  eq(await c.page.evaluate(() => window.t2r.state.entries.length), 1, "autre nom : ne voit pas les entrées de l'autre");
  // une entrée d'un autre nom ne peut pas être écrasée, même avec son identifiant
  const victim = db.of('michaël-1234')[0];
  await c.page.evaluate(async ([id]) => {
    await fetch('https://mock.supabase.test/rest/v1/rpc/t2r_save', {
      method: 'POST',
      headers: { apikey: 'sb_publishable_test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_username: 'collègue-42', p_rows: [{ id, date: '2000-01-01', time: '00:00', type: 'break', seconds: 1 }] }),
    });
  }, [victim.id]);
  check(db.of('michaël-1234').some((r) => r.id === victim.id && r.seconds !== 1), "l'entrée d'un autre nom n'est pas écrasée");

  // Suppression sur le poste 2, vue sur le poste 1 après rechargement
  await b.page.getByRole('button', { name: 'Retour' }).click();
  await b.page.getByRole('button', { name: 'Historique' }).click();
  await b.page.locator('.entry').first().getByRole('button', { name: 'Supprimer' }).click();
  await allSynced(b.page);
  eq(db.of('michaël-1234').length, 1, 'suppression répercutée sur le serveur');
  await a.page.reload();
  await a.page.waitForFunction(() => window.t2r.state.entries.length === 1 && !window.t2r.state.sync.busy, null, { timeout: 8000 });
  check(true, 'le poste 1 voit la suppression après rechargement');

  // Déconnexion : l'historique local est effacé mais reste enregistré sous le nom
  await a.page.getByRole('button', { name: 'Réglages' }).click();
  await a.page.getByRole('button', { name: 'Se déconnecter' }).click();
  await a.page.locator('.dlg').getByRole('button', { name: 'Se déconnecter' }).click();
  await a.page.waitForSelector('#acctName');
  eq(await a.page.evaluate(() => window.t2r.state.entries.length), 0, 'déconnexion : historique local effacé');
  eq(await a.page.evaluate(() => window.t2r.state.session), null, 'déconnexion : session fermée');
  await signInAs(a.page, 'michaël-1234');
  await a.page.waitForFunction(() => window.t2r.state.entries.length === 1, null, { timeout: 8000 });
  check(true, "reconnexion avec le même nom : l'historique revient");

  // Ancienne session (compte e-mail) : abandonnée, l'historique du navigateur est renvoyé sous le nouveau nom
  const d = await open('2026-10-29T10:00:00+01:00');
  await d.page.evaluate(() => {
    localStorage.setItem('t2r.prefs', JSON.stringify({ setupDone: true }));
    localStorage.setItem('t2r.session', JSON.stringify({ access_token: 'x', refresh_token: 'y', email: 'ancien@example.com', user_id: 'u' }));
    const mk = (time, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, date: '2026-10-28', time, type: 'break', seconds: 600, synced: true });
    // la 4e est un ancien chrono oublié pendant des jours : plus de 24 h, refusé tel quel par le serveur
    localStorage.setItem('t2r.entries', JSON.stringify([mk('09:00', 1), mk('11:00', 2), mk('15:00', 3), { ...mk('17:00', 4), seconds: 200000 }]));
  });
  await d.page.reload();
  eq(await d.page.evaluate(() => window.t2r.state.session), null, "ancienne session (e-mail) abandonnée");
  await d.page.getByRole('button', { name: 'Réglages' }).click();
  await signInAs(d.page, 'migration-1');
  await allSynced(d.page);
  eq(db.of('migration-1').length, 4, "l'historique déjà présent dans le navigateur est envoyé sous le nouveau nom");
  eq(Math.max(...db.of('migration-1').map((r) => r.seconds)), 86400, 'une durée de plus de 24 h est ramenée à 24 h (limite du serveur) au lieu de bloquer la synchro');

  // Serveur injoignable
  const e = await open('2026-10-30T09:00:00+01:00');
  await e.page.getByRole('button', { name: 'Continuer' }).click();
  await e.context.route('https://mock.supabase.test/**', (r) => r.abort());
  await e.page.getByRole('button', { name: 'Réglages' }).click();
  await signInAs(e.page, 'hors-ligne-1');
  await e.page.waitForFunction(() => document.getElementById('syncStatus') && document.getElementById('syncStatus').textContent.includes('Hors ligne'), null, { timeout: 8000 });
  check(true, 'hors ligne : message clair, la page reste utilisable');

  for (const x of [a, b, c, d, e]) {
    check(x.errors.length === 0, `aucune erreur console (${x.errors.join(' | ')})`);
    await x.context.close();
  }
}

/** Ajout et modification d'entrées en ligne : une seule ligne côté serveur, même pendant un envoi lent. */
async function editSyncTests(browser) {
  const db = makeMockSupabase();
  const { page, context, errors } = await openWithMock(browser, db, '2026-10-29T10:00:00+01:00');
  const waitFor = async (fn, ms = 10000) => {
    const t0 = Date.now();
    while (!fn()) {
      if (Date.now() - t0 > ms) throw new Error('délai dépassé');
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const posts = () => db.log.filter((l) => l.includes('/rpc/t2r_save')).length;
  const settled = (n, seconds) => page.waitForFunction(([count, secs]) => {
    const s = window.t2r.state;
    return !s.sync.busy && s.entries.length === count && s.entries.every((e) => e.synced) && (secs === null || s.entries[0].seconds === secs);
  }, [n, seconds], { timeout: 12000 });
  const dlg = page.locator('.dlg');
  const editFirst = async (mins) => {
    await page.locator('.entry').first().getByRole('button', { name: 'Modifier' }).click();
    await dlg.locator('input[type=number]').nth(0).fill(String(mins));
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    await dlg.waitFor({ state: 'detached' });
  };

  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Réglages' }).click();
  await signInAs(page, 'modif-test');
  await page.waitForSelector('#syncStatus');
  await page.waitForFunction(() => !window.t2r.state.sync.busy && window.t2r.state.sync.last);
  await page.getByRole('button', { name: 'Retour' }).click();
  await page.getByRole('button', { name: 'Historique' }).click();

  // ajout depuis l'historique
  await page.getByRole('button', { name: 'Ajouter une entrée' }).first().click();
  await dlg.locator('input[type=date]').fill('2026-10-29');
  await dlg.locator('input[type=time]').fill('09:15');
  await dlg.locator('input[type=number]').nth(0).fill('10');
  await dlg.getByRole('button', { name: 'Enregistrer' }).click();
  await dlg.waitFor({ state: 'detached' });
  await settled(1, 600);
  const row = db.of('modif-test')[0];
  check(db.rows.length === 1 && row.seconds === 600 && row.time === '09:15' && row.date === '2026-10-29', 'entrée ajoutée à la main : envoyée au serveur');

  // modification : la ligne du serveur est mise à jour, sans doublon
  await editFirst(20);
  await settled(1, 1200);
  check(db.rows.length === 1 && db.rows[0].seconds === 1200, 'entrée modifiée : la ligne du serveur est mise à jour (pas de doublon)');

  // modification pendant un envoi lent : la seconde modification ne doit pas être perdue
  db.delayPost = 1500;
  const before = posts();
  await editFirst(30);
  await waitFor(() => posts() > before); // l'envoi de « 30 min » est parti, le serveur n'a pas encore répondu
  await editFirst(45);
  db.delayPost = 0;
  await settled(1, 2700);
  const ids = await page.evaluate(() => window.t2r.state.entries.map((e) => e.id));
  check(new Set(ids).size === ids.length && ids.length === 1, 'pas de doublon local après une modification pendant la synchro');
  check(db.rows.length === 1 && db.rows[0].seconds === 2700, 'modification faite pendant un envoi : renvoyée juste après (serveur à 45 min)');

  // déconnexion pendant un envoi lent : l'historique ne « revient » pas après la déconnexion
  db.delayPost = 1200;
  const before2 = posts();
  await editFirst(50);
  await waitFor(() => posts() > before2);
  await page.getByRole('button', { name: 'Retour' }).click();
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.locator('.dlg').getByRole('button', { name: 'Se déconnecter' }).click();
  await page.waitForSelector('#acctName');
  await page.waitForTimeout(2000); // le temps que l'envoi lent se termine
  db.delayPost = 0;
  eq(await page.evaluate(() => window.t2r.state.entries.length), 0, "déconnecté pendant une synchro : l'historique n'est pas ré-affiché");
  eq(await page.evaluate(() => window.t2r.state.session), null, 'toujours déconnecté');

  check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

/** Un arrêt par erreur se rattrape (« Reprendre »), et la confirmation est facultative. */
async function stopTests(browser) {
  const db = makeMockSupabase();
  const { page, context, errors } = await openWithMock(browser, db, '2026-10-29T10:00:00+01:00');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Réglages' }).click();
  await signInAs(page, 'reprise-test');
  await page.waitForFunction(() => !window.t2r.state.sync.busy && window.t2r.state.sync.last);
  await page.getByRole('button', { name: 'Retour' }).click();
  const entries = () => page.evaluate(() => window.t2r.state.entries);
  const settled = () => page.waitForFunction(() => {
    const s = window.t2r.state;
    return !s.sync.busy && s.entries.every((e) => e.synced) && s.deleted.length === 0;
  }, null, { timeout: 10000 });

  // Un break de 3 minutes arrêté « par erreur »
  await page.locator('.start').click();
  const runId = await page.evaluate(() => window.t2r.state.run.id);
  check(/^[0-9a-f-]{36}$/.test(runId), 'le chrono a un identifiant');
  await advance(page, 180000);
  await page.locator('.start').click();
  check((await text(page, '#toast')).includes('Break enregistré : 03:00'), 'message « Break enregistré : 03:00 »');
  check(await page.locator('#toast .toast-action', { hasText: "C'est une erreur : reprendre" }).isVisible(), "bouton « C'est une erreur : reprendre » proposé dans le message");
  let list = await entries();
  check(list.length === 1 && list[0].id === runId && list[0].seconds === 180, "l'entrée porte l'identifiant du chrono");
  await settled();
  eq(db.of('reprise-test').length, 1, "l'entrée est déjà en ligne");

  // 30 secondes plus tard : Reprendre
  await advance(page, 30000);
  await page.locator('#toast .toast-action').click();
  check(await page.locator('.start.stop').isVisible(), 'le chrono tourne de nouveau');
  eq(await text(page, '#ringBig'), '03:30', "il reprend avec son heure de départ d'origine (les 30 s d'arrêt comptent)");
  eq((await entries()).length, 0, "l'entrée enregistrée par erreur est retirée");
  await settled();
  eq(db.of('reprise-test').length, 0, "…et retirée aussi en ligne");
  eq(await page.evaluate(() => window.t2r.state.run.id), runId, 'même chrono (même identifiant)');

  // Vrai arrêt : une seule entrée, avec le temps total
  await advance(page, 90000);
  await page.locator('.start').click();
  list = await entries();
  // (l'horloge de la page continue d'avancer en vrai pendant le test : quelques secondes de marge)
  check(list.length === 1 && list[0].seconds >= 300 && list[0].seconds < 330 && list[0].id === runId, 'arrêt définitif : une seule entrée d\'environ 05:00, avec le temps total');
  await settled();
  check(db.of('reprise-test').length === 1 && db.of('reprise-test')[0].seconds === list[0].seconds, 'une seule ligne en ligne, même durée');

  // Option « Confirmer avant de terminer »
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.locator('.switch-row', { hasText: 'Confirmer avant de terminer' }).click();
  eq(await page.evaluate(() => window.t2r.state.prefs.confirmStop), true, 'option de confirmation activée');
  await page.getByRole('button', { name: 'Retour' }).click();
  await page.locator('.start').click();
  await advance(page, 60000);
  await page.locator('.start').click();
  const dlg = page.locator('.dlg');
  check((await dlg.innerText()).includes('Terminer le break ?') && (await dlg.innerText()).includes('01:00 écoulées'), 'fenêtre de confirmation avec le temps écoulé');
  await dlg.getByRole('button', { name: 'Annuler' }).click();
  await dlg.waitFor({ state: 'detached' });
  check(await page.locator('.start.stop').isVisible(), '« Annuler » : le chrono continue');
  eq((await entries()).length, 1, 'rien enregistré');
  await page.locator('.start').click();
  await dlg.getByRole('button', { name: 'Terminer' }).click();
  await dlg.waitFor({ state: 'detached' });
  eq((await entries()).length, 2, '« Terminer » : le break est enregistré');
  check((await text(page, '#toast')).includes('Break enregistré'), 'message de confirmation après la fin');

  check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

/* ---------- J. Chrono partagé ---------- */
async function joinAs(browser, db, name, opts) {
  const dev = await openWithMock(browser, db, '2026-10-29T10:00:00+01:00', opts);
  await dev.page.getByRole('button', { name: 'Continuer' }).click();
  await dev.page.getByRole('button', { name: 'Réglages' }).click();
  await signInAs(dev.page, name);
  await dev.page.waitForFunction(() => !window.t2r.state.sync.busy && window.t2r.state.sync.last);
  await dev.page.getByRole('button', { name: 'Retour' }).click();
  return dev;
}
const poll = (page) => page.evaluate(() => window.t2r.runPoll());
const runOn = (page) => page.evaluate(() => window.t2r.state.run && { id: window.t2r.state.run.id, pushed: !!window.t2r.state.run.pushed, type: window.t2r.state.run.type });
const entriesOn = (page) => page.evaluate(() => window.t2r.state.entries.map((e) => ({ id: e.id, seconds: e.seconds })));
const settledOn = (page) => page.waitForFunction(() => {
  const s = window.t2r.state;
  return !s.sync.busy && s.entries.every((e) => e.synced) && s.deleted.length === 0;
}, null, { timeout: 10000 });
const waitRunPushed = (page) => page.waitForFunction(() => window.t2r.state.run && window.t2r.state.run.pushed, null, { timeout: 10000 });
const waitFor = (fn, ms = 10000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const loop = () => { if (fn()) resolve(); else if (Date.now() - t0 > ms) reject(new Error('délai dépassé')); else setTimeout(loop, 50); };
  loop();
});
const runCalls = (db) => db.log.filter((l) => l.includes('/rpc/t2r_run_')).length;

async function sharedRunTests(browser) {
  const db = makeMockSupabase();
  const a = await joinAs(browser, db, 'duo-test', {});
  const b = await joinAs(browser, db, '  DUO-test ', {});
  const other = await joinAs(browser, db, 'quelquun-d-autre', {});

  // 1. Démarrage sur A : le serveur le connaît, B le suit avec le même temps écoulé
  await a.page.locator('.start').click();
  await waitRunPushed(a.page);
  const idA = (await runOn(a.page)).id;
  eq(db.runs['duo-test'] && db.runs['duo-test'].id, idA, 'chrono annoncé au serveur avec son identifiant');
  check((await a.page.locator('.card.info').innerText()).includes('partagé avec tes autres appareils'), 'indication « partagé » sur le chrono');
  db.advance(120000);
  await advance(a.page, 120000);
  await poll(b.page);
  let rb = await runOn(b.page);
  check(rb && rb.id === idA && rb.pushed && rb.type === 'break', 'B suit le chrono démarré sur A (même identifiant)');
  const shown = await text(b.page, '#ringBig');
  check(shown === '02:00' || shown === '02:01' || shown === '02:02', `B affiche le même temps écoulé (${shown})`);
  check((await text(b.page, '#toast')).includes('démarré sur un autre appareil'), 'B prévient que le chrono vient d’un autre appareil');
  await poll(other.page);
  eq(await runOn(other.page), null, 'un autre nom ne voit pas ce chrono');

  // 2. Arrêt sur A : l'entrée est unique, B arrête aussi son chrono et reçoit l'entrée par la synchro
  await a.page.locator('.start').click();
  await waitFor(() => !db.runs['duo-test']);
  check(!db.runs['duo-test'], 'arrêt sur A : le chrono disparaît du serveur');
  await poll(b.page);
  eq(await runOn(b.page), null, 'B arrête son chrono');
  check((await text(b.page, '#toast')).includes('terminé sur un autre appareil'), 'B prévient que le chrono est terminé ailleurs');
  await settledOn(a.page);
  await b.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await b.page.waitForFunction(() => window.t2r.state.entries.length === 1, null, { timeout: 10000 });
  let eb = await entriesOn(b.page);
  check(eb.length === 1 && eb[0].id === idA && eb[0].seconds >= 120, 'B reçoit une seule entrée (celle de A), pas de doublon');
  eq(db.of('duo-test').length, 1, 'une seule ligne en ligne');

  // 3. Démarrage sur B, arrêt depuis A : toujours une seule entrée
  await b.page.locator('.start').click();
  await waitRunPushed(b.page);
  const idB = (await runOn(b.page)).id;
  await poll(a.page);
  check((await runOn(a.page) || {}).id === idB, 'A suit le chrono démarré sur B');
  await advance(a.page, 45000);
  await a.page.locator('.start').click();
  await waitFor(() => !db.runs['duo-test']);
  await poll(b.page);
  eq(await runOn(b.page), null, 'B arrête son chrono');
  await settledOn(a.page);
  await b.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await b.page.waitForFunction(() => window.t2r.state.entries.length === 2, null, { timeout: 10000 });
  eq(db.of('duo-test').length, 2, 'deux breaks en tout, chacun une seule fois');
  check((await entriesOn(a.page)).length === 2 && (await entriesOn(b.page)).length === 2, 'les deux appareils ont les mêmes deux entrées');

  // 4. Démarrage hors connexion : annoncé dès que le réseau revient, puis suivi par B
  await a.setOffline(true);
  await a.page.locator('.start').click();
  const idOff = (await runOn(a.page)).id;
  eq((await runOn(a.page)).pushed, false, 'hors connexion : le chrono tourne mais n’est pas encore annoncé');
  await advance(a.page, 90000);
  await a.setOffline(false);
  await poll(a.page);
  await waitRunPushed(a.page);
  check(db.runs['duo-test'] && db.runs['duo-test'].id === idOff && db.now() - db.runs['duo-test'].startedAt >= 90000, 'annoncé au retour du réseau, avec le temps déjà écoulé');
  await poll(b.page);
  rb = await runOn(b.page);
  check(rb && rb.id === idOff, 'B suit le chrono démarré hors connexion');
  // B arrête puis A : un seul enregistrement (même identifiant)
  await b.page.locator('.start').click();
  await waitFor(() => !db.runs['duo-test']);
  await poll(a.page);
  eq(await runOn(a.page), null, 'A arrête son chrono');
  await settledOn(b.page);
  await a.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await a.page.waitForFunction(() => window.t2r.state.entries.length === 3, null, { timeout: 10000 });
  eq(db.of('duo-test').length, 3, 'trois breaks en tout');

  // 5. Deux chronos lancés presque ensemble : celui du serveur gagne, le nôtre est gardé s'il compte
  await a.setOffline(true);
  await a.page.locator('.start').click();
  const idLoser = (await runOn(a.page)).id;
  await advance(a.page, 90000);
  db.runs['duo-test'] = { id: '11111111-2222-4333-8444-555555555555', startedAt: db.now() - 5000, type: 'break', planned: 0 };
  await a.setOffline(false);
  await poll(a.page);
  let ra = await runOn(a.page);
  check(ra && ra.id === '11111111-2222-4333-8444-555555555555' && ra.pushed, 'A suit le chrono du serveur');
  check((await entriesOn(a.page)).some((e) => e.id === idLoser && e.seconds >= 90), 'le chrono d’A (plus d’une minute) est enregistré, pas perdu');
  check((await text(a.page, '#toast')).includes('Un autre chrono était déjà en cours'), 'A est prévenu');
  await a.page.locator('.start').click();
  await waitFor(() => !db.runs['duo-test']);
  await settledOn(a.page);
  await b.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await poll(b.page);

  // 5 bis. Moins d'une minute : le chrono local est abandonné sans bruit
  await a.setOffline(true);
  await a.page.locator('.start').click();
  const before = (await entriesOn(a.page)).length;
  await advance(a.page, 20000);
  db.runs['duo-test'] = { id: '22222222-2222-4333-8444-555555555555', startedAt: db.now() - 1000, type: 'break', planned: 0 };
  await a.setOffline(false);
  await poll(a.page);
  eq((await runOn(a.page) || {}).id, '22222222-2222-4333-8444-555555555555', 'A suit le chrono du serveur');
  eq((await entriesOn(a.page)).length, before, 'chrono local de 20 s : abandonné, aucune entrée parasite');
  await a.page.locator('.start').click();
  await waitFor(() => !db.runs['duo-test']);
  await settledOn(a.page);

  // 6. « Reprendre » ré-annonce le chrono, avec son heure de départ d'origine
  await b.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await poll(b.page);
  await a.page.locator('.start').click();
  await waitRunPushed(a.page);
  const idR = (await runOn(a.page)).id;
  await advance(a.page, 180000);
  await a.page.locator('.start').click();
  await waitFor(() => !db.runs['duo-test']);
  await advance(a.page, 30000);
  await a.page.locator('#toast .toast-action', { hasText: "C'est une erreur : reprendre" }).click();
  await waitFor(() => db.runs['duo-test']);
  const elapsedSrv = db.now() - db.runs['duo-test'].startedAt;
  check(db.runs['duo-test'].id === idR && elapsedSrv >= 210000 && elapsedSrv < 240000, `« Reprendre » : le serveur retrouve le chrono (${Math.round(elapsedSrv / 1000)} s écoulées)`);
  await poll(b.page);
  check(((await runOn(b.page)) || {}).id === idR, 'B suit le chrono repris');
  await a.page.locator('.start').click();
  await waitFor(() => !db.runs['duo-test']);
  await poll(b.page);
  await settledOn(a.page);

  // 6 bis. « Reprendre » alors qu'un autre chrono a démarré entre-temps : celui du serveur gagne, rien n'est perdu
  await a.page.locator('.start').click();
  await waitRunPushed(a.page);
  await advance(a.page, 70000);
  await a.page.locator('.start').click();
  await waitFor(() => !db.runs['duo-test']);
  const nEntries = (await entriesOn(a.page)).length;
  await poll(b.page); // B n'a rien
  await b.page.locator('.start').click();
  await waitRunPushed(b.page);
  const idBusy = (await runOn(b.page)).id;
  await a.page.locator('#toast .toast-action', { hasText: "C'est une erreur : reprendre" }).click();
  await a.page.waitForFunction(() => document.getElementById('toast').innerText.includes('Un autre chrono était déjà en cours'), null, { timeout: 5000 });
  check(true, 'reprise alors qu’un autre chrono tourne : A en est prévenu');
  eq((await runOn(a.page) || {}).id, idBusy, 'A suit le chrono de B');
  eq((await entriesOn(a.page)).length, nEntries, 'l’entrée du chrono repris est conservée (une seule fois)');
  await b.page.locator('.start').click();
  await waitFor(() => !db.runs['duo-test']);
  await poll(a.page);
  eq(await runOn(a.page), null, 'A arrête son chrono');
  await settledOn(a.page);
  await settledOn(b.page);

  // 7. Arrêt hors connexion : le serveur est prévenu plus tard, le chrono n'est pas ré-adopté
  await a.page.locator('.start').click();
  await waitRunPushed(a.page);
  await a.setOffline(true);
  await advance(a.page, 65000);
  await a.page.locator('.start').click();
  eq(await runOn(a.page), null, 'arrêt hors connexion : le chrono s’arrête ici');
  check(!!db.runs['duo-test'], 'le serveur ne sait pas encore que le chrono est terminé');
  await a.setOffline(false);
  await poll(a.page);
  await waitFor(() => !db.runs['duo-test']);
  eq(await runOn(a.page), null, 'le chrono terminé ici n’est pas ré-adopté');
  check(await a.page.evaluate(() => JSON.parse(localStorage.getItem('t2r.stopped') || '[]').length === 0), 'liste « arrêtés ici » vidée une fois le serveur prévenu');
  await settledOn(a.page);
  await b.page.evaluate(() => window.dispatchEvent(new Event('online')));

  // 8. SQL pas encore collé : tout marche en local, sans erreur
  db.noRun = true;
  const c1 = runCalls(db);
  await a.page.locator('.start').click();
  await advance(a.page, 61000);
  await a.page.locator('.start').click();
  const nBefore = await entriesOn(a.page);
  check(nBefore.some((e) => e.seconds >= 61), 'sans les fonctions SQL du chrono : le chrono fonctionne et enregistre en local');
  await poll(a.page);
  await poll(a.page);
  check(runCalls(db) - c1 <= 3, `pas de martèlement du serveur quand les fonctions manquent (${runCalls(db) - c1} appels)`);
  await settledOn(a.page);
  db.noRun = false;
  await advance(a.page, 301000); // 5 minutes plus tard, on réessaie
  await a.page.locator('.start').click();
  await waitRunPushed(a.page);
  check(!!db.runs['duo-test'], 'les fonctions installées : le partage reprend tout seul');
  await a.page.locator('.start').click();
  await waitFor(() => !db.runs['duo-test']);
  await settledOn(a.page);

  // 9. Se déconnecter : le chrono en cours reste ici, il n'est plus relu
  await a.page.locator('.start').click();
  await waitRunPushed(a.page);
  await a.page.getByRole('button', { name: 'Réglages' }).click();
  await a.page.getByRole('button', { name: 'Se déconnecter' }).click();
  await a.page.locator('.dlg').getByRole('button', { name: 'Se déconnecter' }).click();
  await a.page.waitForFunction(() => !window.t2r.state.session, null, { timeout: 5000 });
  const rOut = await runOn(a.page);
  check(rOut && rOut.pushed === false, 'déconnecté : le chrono continue ici, sans être partagé');

  check(errors0(a, b, other), `aucune erreur console (${[...a.errors, ...b.errors, ...other.errors].join(' | ')})`);
  await a.context.close(); await b.context.close(); await other.context.close();

  // 10. Relecture automatique (tâche de fond) : sans rien toucher sur B
  const db2 = makeMockSupabase();
  const p = await joinAs(browser, db2, 'auto-test', { pollMs: 300 });
  const q = await joinAs(browser, db2, 'auto-test', { pollMs: 300 });
  await p.page.locator('.start').click();
  await q.page.waitForFunction(() => window.t2r.state.run && window.t2r.state.run.pushed, null, { timeout: 8000 });
  check(true, 'relecture automatique : B suit le chrono de A sans rien toucher');
  await p.page.locator('.start').click();
  await q.page.waitForFunction(() => !window.t2r.state.run, null, { timeout: 8000 });
  check(true, 'relecture automatique : B arrête son chrono quand A termine');
  await q.page.waitForFunction(() => window.t2r.state.entries.length === 1, null, { timeout: 10000 });
  eq(db2.of('auto-test').length, 1, 'une seule entrée en ligne');
  check(errors0(p, q), `aucune erreur console (${[...p.errors, ...q.errors].join(' | ')})`);
  await p.context.close(); await q.context.close();
}
const errors0 = (...devs) => devs.every((d) => d.errors.length === 0);

main().catch((e) => { console.error(e); process.exit(1); });
