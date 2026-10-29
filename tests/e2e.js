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

      await page.locator('.start').click();
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
      await page.getByRole('button', { name: '10 min' }).click();
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
      await page.getByRole('button', { name: 'Nederlands' }).click();
      eq(await text(page, 'h1'), 'Instellingen', 'titre des réglages en néerlandais');
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
      eq(hrefs.length, 1, "un seul raccourci : « Commander »");
      eq(hrefs[0], 'https://www.smile-sandwicherie.be/', 'bouton « Commander » vers la sandwicherie par défaut');
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
      check(hrefs[0] === 'https://www.smile-sandwicherie.be/', 'sélecteur rapide de site de commande');
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
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\n${passed} vérifications réussies, ${failed} échec(s).`);
  process.exit(failed ? 1 : 0);
}

/* ---------- Faux Supabase en mémoire : les trois fonctions SQL, par nom d'utilisateur ---------- */
function makeMockSupabase() {
  const db = { rows: [], log: [], delayPost: 0 };
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
    const m = /^\/rest\/v1\/rpc\/(t2r_list|t2r_save|t2r_delete)$/.exec(url.pathname);
    if (!m || req.method() !== 'POST') return json(404, { message: 'not found' });
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    const who = String(body.p_username || '').trim().toLowerCase();
    if (who.length < 2 || who.length > 40) return json(400, { code: 'P0001', message: "nom d'utilisateur invalide" });

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

const CFG = "window.T2R_CONFIG = { supabaseUrl: 'https://mock.supabase.test', supabaseKey: 'sb_publishable_test' };";

async function openWithMock(browser, db, startIso) {
  const context = await browser.newContext({ timezoneId: 'Europe/Brussels', locale: 'fr-BE', viewport: { width: 420, height: 900 } });
  await context.addInitScript(initScript(startIso));
  await context.route('**/config.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: CFG }));
  await context.route('https://mock.supabase.test/**', db.handler);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto(BASE);
  return { page, context, errors };
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
  check(await page.locator('#toast .toast-action', { hasText: 'Reprendre' }).isVisible(), "bouton « Reprendre » proposé dans le message");
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

main().catch((e) => { console.error(e); process.exit(1); });
