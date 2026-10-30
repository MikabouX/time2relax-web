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

### Breaks prévus (facultatif)

L'icône calendrier (à côté des réglages) ouvre une page où l'on saisit l'heure de ses breaks et de son
lunch. Sur l'accueil, un arc gris autour du cadran (il se remplit pendant les 2 dernières heures) et une
ligne grise sous le cadran (« Prochain break · 10:15 · dans 1:42:10 ») donnent le temps restant. À l'heure
prévue : « C'est l'heure du break » pendant 10 minutes, puis le suivant. **Aucune alerte.** Un break lancé
jusqu'à 30 minutes avant l'heure prévue compte pour celui-ci. « Répéter chaque jour de semaine » (lundi à
vendredi) est activé par défaut ; désactivé, les horaires ne valent que pour le jour où on les a saisis.
Les horaires restent sur l'appareil (pas de synchronisation). Le mode nuit est respecté.

## Historique en ligne (facultatif), sous un nom d'utilisateur

Sans nom d'utilisateur, tout fonctionne en local. Avec un nom, l'historique est aussi gardé sur un
serveur ([Supabase](https://supabase.com), offre gratuite) : on le retrouve en tapant le même nom sur un
autre appareil, ou après avoir vidé le navigateur. **Il n'y a pas de mot de passe** : toute personne
qui tape le même nom voit et peut modifier le même historique (à choisir : un nom que personne
d'autre n'utilise, par exemple `prénom-nom-1234`). Rien n'est affiché ni listé sans connaître le nom.

1. Crée un projet gratuit sur supabase.com (région Europe).
2. *SQL Editor* → colle le contenu de `supabase/schema.sql` → *Run*. Cela crée les tables et les
   fonctions (`t2r_list`, `t2r_save`, `t2r_delete`, et `t2r_run_*` pour le chrono partagé) ; les tables
   elles-mêmes ne sont pas accessibles directement.
3. *Project Settings → API Keys* : copie l'**URL du projet** et la clé **publique** (« publishable » ou
   « anon »). Ne copie jamais la clé « secret » / « service_role ».
4. Renseigne-les dans `config.js` :
   ```js
   window.T2R_CONFIG = { supabaseUrl: 'https://xxxx.supabase.co', supabaseKey: 'sb_publishable_…' };
   ```

Aucun e-mail n'est collecté ni envoyé : les réglages « Authentication » de Supabase ne servent pas.

### Chrono partagé entre appareils

Avec un nom d'utilisateur, le chrono en cours est aussi gardé sur le serveur (un seul par nom) : un
chrono lancé sur le PC se retrouve sur le téléphone (et inversement), avec le même temps écoulé ;
l'arrêter sur l'un l'arrête sur l'autre, et le break n'est enregistré qu'une fois. Les appareils
relisent le chrono toutes les 5 secondes tant que la page (ou l'appli) est ouverte. Le temps est
calculé par le serveur : les appareils n'ont pas besoin d'avoir la même heure. Un chrono oublié plus
de 24 h est abandonné. Les alarmes sonnent sur les appareils où la page / l'appli est ouverte (il n'y
a pas de notification « push » : un téléphone dont l'appli est fermée ne sonne pas).
Ça demande la partie « Chrono partagé » de `supabase/schema.sql` (une seule fois, sans danger si on
la colle deux fois) ; sans elle, tout fonctionne comme avant, en local.

### Garder le projet actif

Un projet gratuit est mis en pause par Supabase après une semaine sans activité. La tâche
`.github/workflows/keep-alive.yml` interroge la base une fois par jour avec la clé publique de
`config.js`. Elle peut être lancée à la main (onglet *Actions* du dépôt). GitHub désactive les tâches
planifiées d'un dépôt public sans aucune modification depuis 60 jours : il suffit alors de la
réactiver dans l'onglet *Actions*.

## Tests

`node tests/e2e.js` lance Chromium (Playwright) : chrono, alertes, historique (ajout, modification,
suppression), mode nuit, vidage, import/export, néerlandais, nom d'utilisateur, synchronisation (serveur simulé), chrono partagé et breaks prévus.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html`, `style.css` | page et styles |
| `i18n.js` | textes français / néerlandais |
| `store.js` | stockage local, journée de travail (mode nuit), import/export |
| `timer.js` | chrono, minuteur, alertes, sons, notifications |
| `plan.js` | breaks prévus : décompte grisé sur l'accueil (sans alerte) |
| `sync.js` | nom d'utilisateur et synchronisation (sans bibliothèque) |
| `ui.js`, `main.js` | écrans et démarrage |
| `sw.js`, `manifest.webmanifest` | utilisation hors-ligne et installation comme appli |
