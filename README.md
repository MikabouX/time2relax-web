# Time2Relax — version web (PC)

Chrono de break et de lunch, minuteur avec alertes, historique (avec ajout et modification d'une
entrée oubliée), commande de repas, mode nuit, français et néerlandais. Même esprit que l'appli
Android, dans un navigateur : **rien à installer**. (Pas de liens Waze / Google Maps : inutiles sur PC.)

## Utiliser la page

- **Un seul fichier** : ouvre `dist/time2relax.html` (double-clic) dans Edge ou Chrome.
  Généré par `python3 tools/build_standalone.py`.
- **Adresse web** (GitHub Pages) : la page est servie depuis ce dépôt. Depuis Edge ou Chrome,
  menu ⋯ → « Applications » → « Installer ce site en tant qu'application » (sans droits administrateur).

Historique : le bouton **+** ajoute une entrée oubliée (type, date, heure de début, durée), le crayon
modifie une entrée existante. En mode nuit, la boîte indique dans quelle journée l'entrée sera rangée.

Les données restent dans le navigateur (localStorage). Réglages → « Fichier de sauvegarde » exporte
et réimporte l'historique au même format que l'appli Android
(`date;heure;type;durée_en_secondes`).

## Compte en ligne (facultatif)

Sans compte, tout fonctionne en local. Avec un compte, l'historique est gardé sur un serveur
([Supabase](https://supabase.com), offre gratuite) : la session reste ouverte d'un jour à l'autre,
et l'historique se retrouve si le navigateur est vidé ou sur un autre ordinateur.

1. Crée un projet gratuit sur supabase.com (région Europe).
2. *SQL Editor* → colle le contenu de `supabase/schema.sql` → *Run*. Chaque utilisateur ne voit
   que ses propres lignes (sécurité par ligne).
3. *Project Settings → API* : copie l'**URL du projet** et la clé **publique** (« publishable » ou « anon »).
   Ne copie jamais la clé « secret » / « service_role ».
4. Renseigne-les dans `config.js` :
   ```js
   window.T2R_CONFIG = { supabaseUrl: 'https://xxxx.supabase.co', supabaseKey: 'sb_publishable_…' };
   ```
5. (Optionnel) *Authentication → Providers → Email* : désactiver « Confirm email » pour ne pas
   dépendre de l'envoi d'e-mails.

### Mot de passe oublié

Le bouton « Mot de passe oublié ? » envoie un e-mail avec un lien ; le lien rouvre la page, qui
demande un nouveau mot de passe. Deux réglages Supabase sont nécessaires :

1. *Authentication → URL Configuration* : mettre l'adresse de la page (ex.
   `https://mikaboux.github.io/time2relax-web/`) dans **Site URL** et dans **Redirect URLs**.
   Sans cela, le lien de l'e-mail mène à `localhost`.
2. **Envoi des e-mails.** Le service par défaut de Supabase ne livre qu'aux adresses des membres de
   l'organisation Supabase (et au plus 2 messages par heure) : il suffit pour le propriétaire, pas
   pour des collègues. Pour eux, configurer un serveur SMTP dans *Authentication → Emails → SMTP
   Settings* (par exemple Brevo ou Resend, offres gratuites).

### Garder le projet actif

Un projet gratuit est mis en pause par Supabase après une semaine sans activité. La tâche
`.github/workflows/keep-alive.yml` interroge la base une fois par jour avec la clé publique de
`config.js`. Elle peut être lancée à la main (onglet *Actions* du dépôt). GitHub désactive les tâches
planifiées d'un dépôt public sans aucune modification depuis 60 jours : il suffit alors de la
réactiver dans l'onglet *Actions*.

## Tests

`node tests/e2e.js` lance Chromium (Playwright) : chrono, alertes, historique (ajout, modification,
suppression), mode nuit, vidage, import/export, néerlandais, compte, mot de passe oublié et synchronisation (serveur simulé).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html`, `style.css` | page et styles |
| `i18n.js` | textes français / néerlandais |
| `store.js` | stockage local, journée de travail (mode nuit), import/export |
| `timer.js` | chrono, minuteur, alertes, sons, notifications |
| `sync.js` | compte, mot de passe oublié et synchronisation (sans bibliothèque) |
| `ui.js`, `main.js` | écrans et démarrage |
| `sw.js`, `manifest.webmanifest` | utilisation hors-ligne et installation comme appli |
