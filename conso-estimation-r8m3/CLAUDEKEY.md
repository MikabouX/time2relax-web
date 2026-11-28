# CLAUDEKEY — Simulateur énergie (fiche de reprise pour Claude)

Dernière mise à jour : 26 novembre 2026 (Ave Maria). Michaël tutoie, parle français, veut des textes très concis.

## Quoi
Outil interne pour les collègues de Michaël (centre de contact, sous-traitant d'ENGIE) :
https://time2relax.app/conso-estimation-r8m3/ (page non référencée). Une seule page avec :
- vignettes : TVA (HT ↔ 6 % ↔ 21 %), HR helper (4,5 ↔ 4 h 30), code postal → gestionnaire de réseau
  (secteur ORES, téléphones par énergie) ;
- barre commune : code postal + consommation (élec ☀️ HI + 🌙 LO | ☀️/🌙 TH = total auto, ou mono-horaire tapé dans TH ; gaz) + 3 boutons de zone :
  1. **Estimation** (grille du formateur, profils Économe −20 %, Relax −10 %, Calories + +10 %) ;
  2. **Les détails de prix** (iframe `prix/?embed=1`) + « Coût annuel et acompte » ;
  3. **La régularisation** (segments de contrats, profils Synergrid).
- `admin-prix/` : encodage des prix, tarif social, avis (réponses), cartes ENGIE du mois.
- `avis/` : avis publics des collègues avec réponses.
- `prix/` : seule, redirige vers `../#prix` ; avec `?embed=1`, c'est l'outil « détails de prix ».

## Où
- Dépôt GitHub `MikabouX/time2relax-web`, branche `main` (GitHub Pages, publié en 1–2 min).
  Dossier `conso-estimation-r8m3/`. SQL : `supabase/conso_prix.sql`, `supabase/conso_avis.sql`.
- Copie du SQL aussi dans `MikabouX/appli-pauses`, `docs/sql/2026-11-20-conso-prix.sql` (branche `v1.9`,
  puis fusionner `v1.9` dans `proto-partage` et pousser — consigne du CLAUDE.md de ce dépôt).
- Supabase : projet `gxftbzbvbveocwpdavtt` (clé publique dans les pages ; admin = compte Supabase de Michaël).
- Mac mini : `~/Claude/Tarifs/AAAA-MM/` (cartes PDF ENGIE), `Tarifs/a trier/` (dépôt de Michaël),
  `Tarifs/Synergrid/` (profils RLP), `Tarifs/_outils/` (scripts de lecture des cartes).
  Archive figée : `~/Claude/20261126 Simulateur énergie/`.

## Données (Supabase, tout en HTVA sauf `conso_detail` R)
- `conso_prix` (mois, segment R/P/*, type energie/reseau/taxes, energie e/g, cle, region, prix…) : prix
  agrégés par mois encodé (garde 17 mois, `conso_prix_purge`). RPC `conso_prix_get(p_mois)` → grd, prix, mois_dispo.
- `conso_formule` (mois, segment, energie, cle, param, k/j/n/x/t1/t2/t3 _a/_b, fixe_an, doc) :
  prix = a + b × indice (€/MWh) en c€/kWh HTVA ; param `FIXE` = prix fixe (b = 0).
  R : août 2025 → nov. 2026 ; P : mars → nov. 2026. `conso_indice(param, mois, valeur)` :
  ENDEX101, ZTP101, EPEXDAM, ZTPDAM. RPC `conso_formule_get()`.
- `conso_detail` (mois, segment, energie, region, data jsonb) : réseau + suppléments comme sur les fiches,
  valable jusqu'au suivant. data = {l: mise en page eW/eW25/eV/eB/gW/gV/gB, t: tableaux
  [[code, nom, [valeurs]]], p: [[titre, libellé, valeur]], v: énergie verte, s: fiche source, ht: true pour P}.
  R = valeurs TVAC des fiches ; P = HTVA. Réseau pro = réseau particulier hors TVA (vérifié).
- `conso_tarif_social`, `conso_grd`, `conso_cp` (+ `conso_cp_get`, `conso_cp_search`), `conso_avis`,
  `conso_prix_propositions`.

## Encoder un nouveau mois (skill « prix-engie-simulateur »)
1. Michaël télécharge les cartes du mois (bouton admin-prix) dans `Tarifs/a trier`.
2. Ranger par mois (`mv` d'après le suffixe `_AAAAMM.pdf`).
3. Particuliers : formules (`parse.py`, `fixe.py`), contrôle carte = formule × indice.
4. Pros : `python3 pro.py AAAAMM` (contrôle « True » partout), `detail.py` puis `pro_sql.py` → `pro.sql`.
5. Comparer au mois précédent ; n'écrire que ce qui change (`conso_detail` vaut jusqu'au suivant).
6. Écrire avec `execute_sql` (récap à Michaël ; pour les pros il a donné son accord permanent).
7. Indices : ENDEX101/ZTP101 du mois ; EPEXDAM/ZTPDAM connus en fin de mois (rappel le 1er).

## Pièges vécus
- Les archives ENGIE (mois passés) refusent tout lien direct (401, anti-robot) : pas de liens d'archives
  dans l'outil, Michaël télécharge à la main sur engie.be. Ne jamais contourner.
- Le Mac n'a pas de réseau ni d'identifiants GitHub ; le container n'atteint pas supabase.co (tests avec mocks
  Playwright, voir `tests/` de la session).
- Impact (tri-horaire wallon) : PIC et MEDIUM = prix heures pleines, ECO = heures creuses.
- Tarif capacitaire flamand : minimum 2,5 kW, saisissable.
- Accise : moyenne pondérée par tranches selon la consommation ; pros : 1,11/0,90/0,83 c€ depuis nov. 2026.
- Fichiers envoyés au Mac : nom unique. `$HOME/work` du shell distant disparaît : garder les scripts dans `Tarifs/_outils`.

## Règles de Michaël
- Aucune donnée client. Textes très concis. Rien supprimé sans lui (déplacer dans `_A SUPPRIMER`).
- Ne pas télécharger les PDF ENGIE soi-même. Dynamic (quart d'heure) ignoré.

## Pistes
- Facteur de conversion gaz par zone (aujourd'hui 11,6 kWh/m³ moyen).
- Fiches pros Bruxelles de novembre (repris d'octobre avec la nouvelle accise).
- Mise à jour annuelle des profils Synergrid.

## Version mobile (time2relax.app/prix-mobile/)
- Fichier généré : `prix-mobile/index.html`. Après chaque modification de `conso-estimation-r8m3/index.html`, lancer `python3 tools/build_prix_mobile.py` puis committer les deux.
- Différences : sans outils TVA et HR helper, installable (manifest, sw.js et icônes dans `prix-mobile/`). Mise en page téléphone (barre d'onglets en bas, une colonne) seulement sous 820 px de large ; sur ordinateur, mise en page normale.
- Le script copie aussi `prix/` et `concurrence/` dans `prix-mobile/` (pour que tout reste dans la portée du service worker). Après une modification de ces pages, relancer le script.
- Hors ligne (`prix-mobile/sw.js`) : pages en cache ; réponses des rpc Supabase (POST) gardées dans le cache `prix-mobile-data` et resservies sans connexion ; à chaque activation, téléchargement d'avance de conso_prix_get (tous les mois), formules, détails, tarif social. Codes postaux hors ligne : `prix-mobile/cp.json` (copie de conso_cp et conso_cp_nom, 28/11/2026 ; à régénérer si ces tables changent). Bandeau jaune « Hors ligne » en haut. Changer `CACHE` (prix-mobile-vN) quand le sw.js change.
- Une balise `<base href="/conso-estimation-r8m3/">` fait pointer les sous-pages (prix, concurrence, avis) vers celles du simulateur.

## Concurrence
- Page `conso-estimation-r8m3/concurrence/` ; données dans `concurrence/cartes.json` (prix TVAC relevés sur les cartes, par région, élec et gaz ; ENGIE repris des cartes ENGIE).
- Cartes du mois : admin-prix/#concurrence → « Tout télécharger » (fonction Supabase `conc-cartes`, ZIP) ; Luminus à prendre via Chrome (son site refuse le serveur).
