# Simulateur énergie

Outil interne (non référencé) : https://time2relax.app/conso-estimation-r8m3/

- `index.html` : page principale (outils TVA / HR / code postal, estimation, détails de prix + acompte, régularisation).
- `prix/` : détails de prix (utilisé en iframe `?embed=1` ; seule, la page renvoie vers `../#prix`).
- `admin-prix/` : encodage des prix, tarif social, avis, cartes ENGIE du mois (connexion admin).
- `avis/` : avis des collègues et réponses.
- SQL : `../supabase/conso_prix.sql`, `../supabase/conso_avis.sql`.

Tout le détail pour reprendre le projet : `CLAUDEKEY.md` et le lisez-moi Word dans
`~/Claude/20261126 Simulateur énergie/` sur le Mac mini.

## Version mobile
La version téléphone (time2relax.app/prix-mobile/) est fabriquée à partir du simulateur : après une modification, lancer `python3 tools/build_prix_mobile.py`.
