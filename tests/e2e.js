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
    console.log('F. Compte et synchronisation (Supabase simulé)');
    await syncTests(browser);

    console.log('H. Synchronisation des ajouts et modifications');
    await editSyncTests(browser);

    console.log('I. Mot de passe oublié');
    await recoveryTests(browser);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\n${passed} vérifications réussies, ${failed} échec(s).`);
  process.exit(failed ? 1 : 0);
}

/* ---------- Faux Supabase en mémoire ---------- */
function makeMockSupabase() {
  const db = { users: new Map(), tokens: new Map(), refresh: new Map(), rows: [], log: [], recoveries: [] };
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'apikey, authorization, content-type, prefer, x-client-info',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  };
  let counter = 0;
  const issue = (user, expiresIn) => {
    counter += 1;
    const access = `access-${counter}`;
    const refresh = `refresh-${counter}`;
    db.tokens.set(access, user.id);
    db.refresh.set(refresh, user.id);
    return { access_token: access, token_type: 'bearer', expires_in: expiresIn, refresh_token: refresh, user: { id: user.id, email: user.email } };
  };
  db.expiresIn = 3600;
  db.handler = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const h = req.headers();
    db.log.push(`${req.method()} ${url.pathname}${url.search}`);
    if (!h.apikey) return json(401, { message: 'No API key found in request' });

    if (url.pathname === '/auth/v1/signup') {
      if ([...db.users.values()].some((u) => u.email === body.email)) return json(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      const user = { id: `00000000-0000-4000-8000-${String(db.users.size + 1).padStart(12, '0')}`, email: body.email, password: body.password };
      db.users.set(user.id, user);
      return json(200, issue(user, db.expiresIn));
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const user = [...db.users.values()].find((u) => u.email === body.email && u.password === body.password);
      if (!user) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(200, issue(user, db.expiresIn));
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const uid = db.refresh.get(body.refresh_token);
      if (!uid) return json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
      db.refresh.delete(body.refresh_token); // rotation, comme le vrai serveur
      return json(200, issue(db.users.get(uid), db.expiresIn));
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/auth/v1/recover') {
      db.recoveries.push({ email: body.email, redirect: url.searchParams.get('redirect_to') });
      return json(200, {}); // même réponse que le compte existe ou non
    }
    if (url.pathname === '/auth/v1/user' && req.method() === 'PUT') {
      const uid = db.tokens.get((h.authorization || '').replace('Bearer ', ''));
      if (!uid) return json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT: unable to parse or verify signature, token is expired' });
      const user = db.users.get(uid);
      if (body.password === user.password) return json(422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' });
      if (String(body.password).length < 6) return json(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
      user.password = body.password;
      return json(200, { id: user.id, email: user.email });
    }

    if (url.pathname === '/rest/v1/breaks') {
      const auth = (h.authorization || '').replace('Bearer ', '');
      const uid = db.tokens.get(auth);
      if (!uid) return json(401, { code: 'PGRST301', message: 'JWT expired or invalid' });
      if (req.method() === 'GET') {
        const mine = db.rows.filter((r) => r.user_id === uid).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        const limit = Number(url.searchParams.get('limit') || 1000);
        const offset = Number(url.searchParams.get('offset') || 0);
        return json(200, mine.slice(offset, offset + limit).map(({ id, date, time, type, seconds }) => ({ id, date, time, type, seconds })));
      }
      if (req.method() === 'POST') {
        if (db.delayPost) await new Promise((r) => setTimeout(r, db.delayPost)); // serveur lent (test de modification pendant l'envoi)
        if (url.searchParams.get('on_conflict') !== 'id' || !/merge-duplicates/.test(h.prefer || '')) return json(409, { message: 'duplicate key' });
        for (const r of body) {
          if (!/^\d{2}:\d{2}$/.test(r.time) || !['break', 'lunch'].includes(r.type)) return json(400, { message: 'check constraint' });
          const i = db.rows.findIndex((x) => x.id === r.id);
          if (i >= 0) { if (db.rows[i].user_id !== uid) return json(403, { message: 'RLS' }); db.rows[i] = { ...r, user_id: uid }; } else db.rows.push({ ...r, user_id: uid });
        }
        return route.fulfill({ status: 201, headers: cors });
      }
      if (req.method() === 'DELETE') {
        const m = /^in\.\((.*)\)$/.exec(url.searchParams.get('id') || '');
        const ids = m ? m[1].split(',') : [];
        db.rows = db.rows.filter((r) => !(r.user_id === uid && ids.includes(r.id)));
        return route.fulfill({ status: 204, headers: cors });
      }
    }
    return json(404, { message: 'not found' });
  };
  return db;
}

async function syncTests(browser) {
  const db = makeMockSupabase();
  db.expiresIn = 30; // jetons très courts : chaque appel doit passer par le renouvellement
  const cfg = "window.T2R_CONFIG = { supabaseUrl: 'https://mock.supabase.test', supabaseKey: 'sb_publishable_test' };";
  const open = async (startIso) => {
    const context = await browser.newContext({ timezoneId: 'Europe/Brussels', locale: 'fr-BE', viewport: { width: 420, height: 900 } });
    await context.addInitScript(initScript(startIso));
    await context.route('**/config.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: cfg }));
    await context.route('https://mock.supabase.test/**', db.handler);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
    await page.goto(BASE);
    return { page, context, errors };
  };
  const waitIdle = (page) => page.waitForFunction(() => !window.t2r.state.sync.busy && !document.querySelector('#syncStatus')?.textContent.includes('Synchronisation'), null, { timeout: 8000 });

  // Poste 1 : un break fait hors connexion, puis création du compte
  const a = await open('2026-10-29T10:00:00+01:00');
  await a.page.getByRole('button', { name: 'Continuer' }).click();
  await a.page.locator('.start').click();
  await advance(a.page, 61000);
  await a.page.locator('.start').click();
  await a.page.getByRole('button', { name: 'Réglages' }).click();
  check(await a.page.locator('#acctCard').isVisible(), 'carte « Compte » visible quand la synchro est configurée');

  await a.page.locator('#acctEmail').fill('moi@example.com');
  await a.page.locator('#acctPass').fill('123');
  await a.page.getByRole('button', { name: 'Se connecter' }).click();
  check((await text(a.page, '#acctMsg')).includes('6 caractères'), 'mot de passe trop court refusé');
  await a.page.locator('#acctPass').fill('motdepasse');
  await a.page.getByRole('button', { name: 'Se connecter' }).click();
  await a.page.waitForFunction(() => document.getElementById('acctMsg').textContent.includes('incorrect'), null, { timeout: 8000 });
  check(true, 'compte inconnu : message clair');
  await a.page.getByRole('button', { name: 'Créer un compte' }).click();
  await a.page.waitForSelector('#syncStatus');
  await waitIdle(a.page);
  check((await text(a.page, '#acctCard')).includes('Connecté : moi@example.com'), 'compte créé et connecté');
  eq(db.rows.length, 1, "l'entrée faite avant la connexion est envoyée au serveur");
  check(db.log.some((l) => l.includes('on_conflict=id')), 'envoi par « upsert » (pas de doublon possible)');
  check((await text(a.page, '#syncStatus')).startsWith('Dernière synchro'), 'état de synchro affiché');

  // Nouveau break, supprimé ensuite
  await a.page.getByRole('button', { name: 'Retour' }).click();
  await a.page.locator('.start').click();
  await advance(a.page, 125000);
  await a.page.locator('.start').click();
  await a.page.waitForFunction(() => window.t2r.state.entries.every((e) => e.synced), null, { timeout: 8000 });
  eq(db.rows.length, 2, 'deuxième entrée synchronisée automatiquement');
  check(db.log.some((l) => l.includes('grant_type=refresh_token')), 'jeton renouvelé automatiquement (session qui reste ouverte)');

  // Poste 2 (autre navigateur) : connexion et récupération de l'historique
  const b = await open('2026-10-30T09:00:00+01:00');
  await b.page.getByRole('button', { name: 'Continuer' }).click();
  await b.page.getByRole('button', { name: 'Réglages' }).click();
  await b.page.locator('#acctEmail').fill('moi@example.com');
  await b.page.locator('#acctPass').fill('mauvais-mdp');
  await b.page.getByRole('button', { name: 'Se connecter' }).click();
  await b.page.waitForFunction(() => document.getElementById('acctMsg').textContent.includes('incorrect'), null, { timeout: 8000 });
  check(true, 'mauvais mot de passe refusé');
  await b.page.locator('#acctPass').fill('motdepasse');
  await b.page.getByRole('button', { name: 'Se connecter' }).click();
  await b.page.waitForFunction(() => window.t2r.state.entries.length === 2, null, { timeout: 8000 });
  check(true, "le second poste retrouve les 2 entrées du compte");

  // Suppression sur le poste 2, vue sur le poste 1 après resynchronisation
  await b.page.getByRole('button', { name: 'Retour' }).click();
  await b.page.getByRole('button', { name: 'Historique' }).click();
  await b.page.locator('.entry').first().getByRole('button', { name: 'Supprimer' }).click();
  await b.page.waitForFunction(() => window.t2r.state.deleted.length === 0, null, { timeout: 8000 });
  eq(db.rows.length, 1, 'suppression répercutée sur le serveur');
  await a.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await a.page.reload();
  await a.page.waitForFunction(() => window.t2r.state.entries.length === 1 && !window.t2r.state.sync.busy, null, { timeout: 8000 });
  check(true, 'le poste 1 voit la suppression après rechargement (session toujours ouverte)');

  // Annulation d'une suppression déjà envoyée : l'entrée est renvoyée
  await b.page.locator('.toast-action').click().catch(() => {});
  await b.page.waitForTimeout(100);

  // Déconnexion : l'historique local est effacé mais reste au compte
  await a.page.getByRole('button', { name: 'Réglages' }).click();
  await a.page.getByRole('button', { name: 'Se déconnecter' }).click();
  await a.page.locator('.dlg').getByRole('button', { name: 'Se déconnecter' }).click();
  await a.page.waitForSelector('#acctEmail');
  eq(await a.page.evaluate(() => window.t2r.state.entries.length), 0, 'déconnexion : historique local effacé');
  await a.page.locator('#acctEmail').fill('moi@example.com');
  await a.page.locator('#acctPass').fill('motdepasse');
  await a.page.getByRole('button', { name: 'Se connecter' }).click();
  await a.page.waitForFunction(() => window.t2r.state.entries.length >= 1, null, { timeout: 8000 });
  check(true, "reconnexion : l'historique revient depuis le compte");

  // Session expirée : le serveur oublie les jetons de renouvellement
  db.refresh.clear();
  await advance(a.page, 120000); // le jeton (30 s) est périmé : il faut le renouveler
  await a.page.reload();
  await a.page.waitForFunction(() => window.t2r.state.session === null, null, { timeout: 8000 });
  await a.page.getByRole('button', { name: 'Réglages' }).click();
  await a.page.waitForSelector('#acctEmail', { timeout: 8000 });
  check((await text(a.page, '#acctMsg')).includes('Session expirée'), 'session expirée : invitation à se reconnecter');
  check((await a.page.evaluate(() => window.t2r.state.entries.length)) >= 1, "l'historique local n'est pas perdu quand la session expire");

  // Serveur injoignable
  const c = await open('2026-10-30T09:00:00+01:00');
  await c.page.getByRole('button', { name: 'Continuer' }).click();
  await c.context.route('https://mock.supabase.test/**', (r) => r.abort());
  await c.page.getByRole('button', { name: 'Réglages' }).click();
  await c.page.locator('#acctEmail').fill('moi@example.com');
  await c.page.locator('#acctPass').fill('motdepasse');
  await c.page.getByRole('button', { name: 'Se connecter' }).click();
  await c.page.waitForFunction(() => document.getElementById('acctMsg').textContent.includes('Hors ligne'), null, { timeout: 8000 });
  check(true, 'hors ligne : message clair, la page reste utilisable');

  for (const x of [a, b, c]) {
    check(x.errors.length === 0, `aucune erreur console (${x.errors.join(' | ')})`);
    await x.context.close();
  }
}

/** Ajout et modification d'entrées avec un compte : une seule ligne côté serveur, même pendant un envoi lent. */
async function editSyncTests(browser) {
  const db = makeMockSupabase();
  const cfg = "window.T2R_CONFIG = { supabaseUrl: 'https://mock.supabase.test', supabaseKey: 'sb_publishable_test' };";
  const context = await browser.newContext({ timezoneId: 'Europe/Brussels', locale: 'fr-BE', viewport: { width: 420, height: 900 } });
  await context.addInitScript(initScript('2026-10-29T10:00:00+01:00'));
  await context.route('**/config.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: cfg }));
  await context.route('https://mock.supabase.test/**', db.handler);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto(BASE);
  const waitFor = async (fn, ms = 10000) => {
    const t0 = Date.now();
    while (!fn()) {
      if (Date.now() - t0 > ms) throw new Error('délai dépassé');
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const posts = () => db.log.filter((l) => l.startsWith('POST /rest/v1/breaks')).length;
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
  await page.locator('#acctEmail').fill('moi@example.com');
  await page.locator('#acctPass').fill('motdepasse');
  await page.getByRole('button', { name: 'Créer un compte' }).click();
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
  check(db.rows.length === 1 && db.rows[0].seconds === 600 && db.rows[0].time === '09:15' && db.rows[0].date === '2026-10-29', 'entrée ajoutée à la main : envoyée au serveur');

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

  check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

/** « Mot de passe oublié » : demande par e-mail, retour du lien, nouveau mot de passe. */
async function recoveryTests(browser) {
  const db = makeMockSupabase();
  const cfg = "window.T2R_CONFIG = { supabaseUrl: 'https://mock.supabase.test', supabaseKey: 'sb_publishable_test' };";
  const context = await browser.newContext({ timezoneId: 'Europe/Brussels', locale: 'fr-BE', viewport: { width: 420, height: 900 } });
  await context.addInitScript(initScript('2026-10-29T10:00:00+01:00'));
  await context.route('**/config.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: cfg }));
  await context.route('https://mock.supabase.test/**', db.handler);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });

  // un compte existant, avec un break déjà envoyé
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.locator('#acctEmail').fill('moi@example.com');
  await page.locator('#acctPass').fill('ancienmdp');
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await page.waitForSelector('#syncStatus');
  await page.getByRole('button', { name: 'Retour' }).click();
  await page.locator('.start').click();
  await advance(page, 61000);
  await page.locator('.start').click();
  await page.waitForFunction(() => window.t2r.state.entries.length === 1 && window.t2r.state.entries[0].synced, null, { timeout: 8000 });
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.locator('.dlg').getByRole('button', { name: 'Se déconnecter' }).click();
  await page.waitForSelector('#acctEmail');

  // 1. demande du lien
  await page.locator('#acctEmail').fill('moi@example.com');
  await page.getByRole('button', { name: 'Mot de passe oublié' }).click();
  eq(await page.locator('#acctEmail').inputValue(), 'moi@example.com', "l'adresse déjà tapée est reprise");
  await page.locator('#acctEmail').fill('pas-une-adresse');
  await page.getByRole('button', { name: 'Envoyer le lien' }).click();
  check(db.recoveries.length === 0 && await page.locator('#acctEmail').evaluate((el) => !el.checkValidity()), "adresse mal écrite : refusée par le navigateur, rien n'est envoyé");
  await page.locator('#acctEmail').fill('');
  await page.getByRole('button', { name: 'Envoyer le lien' }).click();
  check((await text(page, '#acctMsg')).includes('adresse e-mail') && db.recoveries.length === 0, 'adresse vide refusée avec un message');
  await page.locator('#acctEmail').fill('moi@example.com');
  await page.getByRole('button', { name: 'Envoyer le lien' }).click();
  await page.waitForFunction(() => document.getElementById('acctMsg').textContent.includes('e-mail vient d'));
  eq(db.recoveries.length, 1, 'une demande envoyée au serveur');
  check(db.recoveries[0].email === 'moi@example.com' && db.recoveries[0].redirect === BASE, `adresse de retour = la page elle-même (${db.recoveries[0].redirect})`);
  check(!(await text(page, '#acctMsg')).includes('existe pas'), "le message ne révèle pas si l'adresse a un compte");
  await page.getByRole('button', { name: 'Retour à la connexion' }).click();
  check(await page.locator('#acctPass').isVisible(), 'retour au formulaire de connexion');

  // 2. clic sur le lien reçu par e-mail : la page s'ouvre avec les jetons après le #
  const user = [...db.users.values()][0];
  db.tokens.set('rec-token-1', user.id);
  db.refresh.set('rec-refresh-1', user.id);
  await page.goto(`${BASE}?lien=1#access_token=rec-token-1&refresh_token=rec-refresh-1&expires_in=3600&token_type=bearer&type=recovery`);
  await page.waitForSelector('#newPass');
  eq(new URL(page.url()).hash, '', "les jetons sont retirés de l'adresse aussitôt");
  check((await text(page, '#acctCard')).includes('nouveau mot de passe'), 'formulaire « nouveau mot de passe »');
  await page.locator('#newPass').fill('abc');
  await page.locator('#newPass2').fill('abc');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  check((await text(page, '#acctMsg')).includes('trop court'), 'mot de passe trop court refusé');
  await page.locator('#newPass').fill('nouveaumdp');
  await page.locator('#newPass2').fill('autrechose');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  check((await text(page, '#acctMsg')).includes('pas identiques'), 'deux saisies différentes refusées');
  await page.locator('#newPass2').fill('nouveaumdp');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForFunction(() => document.getElementById('acctCard').textContent.includes('Connecté : moi@example.com'), null, { timeout: 8000 });
  eq(user.password, 'nouveaumdp', 'le mot de passe est changé sur le serveur');
  check((await text(page, '#toast')).includes('Mot de passe modifié'), 'message de confirmation');
  await page.waitForFunction(() => window.t2r.state.entries.length === 1, null, { timeout: 8000 });
  check(true, "connecté directement : l'historique du compte est récupéré");

  // 3. l'ancien mot de passe ne marche plus, le nouveau oui
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.locator('.dlg').getByRole('button', { name: 'Se déconnecter' }).click();
  await page.waitForSelector('#acctEmail');
  await page.locator('#acctEmail').fill('moi@example.com');
  await page.locator('#acctPass').fill('ancienmdp');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('acctMsg').textContent.includes('incorrect'), null, { timeout: 8000 });
  await page.locator('#acctPass').fill('nouveaumdp');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.waitForFunction(() => window.t2r.state.session !== null, null, { timeout: 8000 });
  check(true, 'ancien mot de passe refusé, nouveau accepté');

  // 4. lien déjà utilisé / expiré (erreur renvoyée dans l'adresse) et jeton refusé
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.locator('.dlg').getByRole('button', { name: 'Se déconnecter' }).click();
  await page.waitForSelector('#acctEmail');
  await page.goto(`${BASE}?lien=2#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
  await page.waitForSelector('#acctMsg');
  check((await text(page, '#acctMsg')).includes('expiré'), 'lien expiré : message clair');
  eq(new URL(page.url()).hash, '', "adresse nettoyée aussi en cas d'erreur");
  await page.goto(`${BASE}?lien=3#access_token=jeton-inconnu&refresh_token=x&expires_in=3600&type=recovery`);
  await page.waitForSelector('#newPass');
  await page.locator('#newPass').fill('encoreunautre');
  await page.locator('#newPass2').fill('encoreunautre');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForFunction(() => document.getElementById('acctMsg') && document.getElementById('acctMsg').textContent.includes('expiré'), null, { timeout: 8000 });
  check(true, 'jeton refusé par le serveur : retour à la connexion avec un message');
  await page.waitForFunction(() => !document.getElementById('newPass'));

  // 5. néerlandais
  await page.evaluate(() => { localStorage.setItem('t2r.prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('t2r.prefs')), lang: 'nl' })); });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Instellingen' }).click();
  check(await page.getByRole('button', { name: 'Wachtwoord vergeten?' }).isVisible(), 'néerlandais : « Wachtwoord vergeten? »');

  check(errors.length === 0, `aucune erreur console (${errors.join(' | ')})`);
  await context.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
