-- Prix du simulateur de consommation (time2relax.app/conso-estimation-r8m3/), appliqué sur Supabase le 20 novembre 2026
-- (migrations conso_tarifs, conso_prix_composantes, conso_prix_prosumer). Montants TVAC. 6 mois conservés.
-- Encodage : page time2relax.app/conso-estimation-r8m3/admin-prix/ (compte admin T2R) ou par Claude via SQL.

create table if not exists public.conso_grd (
  code text primary key, nom text not null,
  region text not null check (region in ('Wallonie','Bruxelles','Flandre')),
  elec boolean not null default true, gaz boolean not null default true,
  actif boolean not null default true, ordre int not null default 100);
alter table public.conso_grd enable row level security;
revoke all on public.conso_grd from anon, authenticated;
-- Gestionnaires de départ : ores, resa, aieg, aiesh, rew (Wallonie) ; sibelga (Bruxelles) ;
-- fl-antwerpen, fl-limburg, fl-west, fl-gaselwest, fl-imewo, fl-intergem, fl-iveka, fl-iverlek, fl-sibelgas, fl-pbe (Flandre).

-- type : 'energie' (cle = contrat, par région), 'reseau' (cle = code gestionnaire), 'taxes' (cle = région)
create table if not exists public.conso_prix (
  mois date not null check (extract(day from mois) = 1),
  type text not null check (type in ('energie','reseau','taxes')),
  energie text not null check (energie in ('e','g')),
  cle text not null check (char_length(cle) between 1 and 80),
  region text not null check (region in ('Wallonie','Bruxelles','Flandre')),
  prix_kwh numeric(8,3) check (prix_kwh >= 0),     -- c€/kWh (simple ou gaz)
  prix_jour numeric(8,3) check (prix_jour >= 0),   -- c€/kWh bi-horaire jour
  prix_nuit numeric(8,3) check (prix_nuit >= 0),   -- c€/kWh bi-horaire nuit
  fixe_an numeric(8,2) check (fixe_an >= 0),       -- €/an
  prosumer_kwe numeric(8,2) check (prosumer_kwe >= 0), -- €/kWe/an (réseau élec, Wallonie)
  note text check (char_length(note) <= 200),
  updated_at timestamptz not null default now(),
  primary key (mois, type, energie, cle, region));
alter table public.conso_prix enable row level security;
revoke all on public.conso_prix from anon, authenticated;

create or replace function public.conso_prix_purge()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from conso_prix where mois < (date_trunc('month', now() at time zone 'Europe/Brussels') - interval '5 months')::date;
  get diagnostics n = row_count; return n;
end $$;

create or replace function public.conso_prix_get(p_mois date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m date; cur date := date_trunc('month', now() at time zone 'Europe/Brussels')::date;
begin
  m := coalesce(date_trunc('month', p_mois)::date,
                (select max(mois) from conso_prix where mois <= cur),
                (select min(mois) from conso_prix));
  return jsonb_build_object(
    'mois', m,
    'mois_dispo', coalesce((select jsonb_agg(x.mois order by x.mois desc) from (select distinct mois from conso_prix where mois >= (cur - interval '5 months')::date) x), '[]'::jsonb),
    'grd', coalesce((select jsonb_agg(jsonb_build_object('code',code,'nom',nom,'region',region,'elec',elec,'gaz',gaz) order by ordre, nom) from conso_grd where actif), '[]'::jsonb),
    'prix', coalesce((select jsonb_agg(jsonb_build_object('type',type,'energie',energie,'cle',cle,'region',region,'prix_kwh',prix_kwh,'prix_jour',prix_jour,'prix_nuit',prix_nuit,'fixe_an',fixe_an,'prosumer_kwe',prosumer_kwe,'note',note) order by type, cle)
                      from conso_prix where mois = m), '[]'::jsonb));
end $$;

create or replace function public.conso_prix_save(p_mois date, p_type text, p_energie text, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_mois)::date; r jsonb; n int := 0;
begin
  if not t2r_is_admin() then raise exception 'réservé aux administrateurs'; end if;
  delete from conso_prix p where p.mois = m and p.type = p_type and p.energie = p_energie
    and not exists (select 1 from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) x
                    where btrim(x->>'cle') = p.cle and x->>'region' = p.region);
  for r in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    if nullif(btrim(r->>'cle'),'') is null then continue; end if;
    insert into conso_prix(mois, type, energie, cle, region, prix_kwh, prix_jour, prix_nuit, fixe_an, prosumer_kwe, note, updated_at)
    values (m, p_type, p_energie, btrim(r->>'cle'), r->>'region', (r->>'prix_kwh')::numeric, (r->>'prix_jour')::numeric,
            (r->>'prix_nuit')::numeric, (r->>'fixe_an')::numeric, (r->>'prosumer_kwe')::numeric, nullif(btrim(r->>'note'),''), now())
    on conflict (mois, type, energie, cle, region) do update set prix_kwh = excluded.prix_kwh, prix_jour = excluded.prix_jour,
      prix_nuit = excluded.prix_nuit, fixe_an = excluded.fixe_an, prosumer_kwe = excluded.prosumer_kwe, note = excluded.note, updated_at = now();
    n := n + 1;
  end loop;
  perform conso_prix_purge();
  return n;
end $$;

create or replace function public.conso_prix_copy(p_from date, p_to date)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not t2r_is_admin() then raise exception 'réservé aux administrateurs'; end if;
  insert into conso_prix(mois, type, energie, cle, region, prix_kwh, prix_jour, prix_nuit, fixe_an, prosumer_kwe, note)
  select date_trunc('month', p_to)::date, type, energie, cle, region, prix_kwh, prix_jour, prix_nuit, fixe_an, prosumer_kwe, note
  from conso_prix where mois = date_trunc('month', p_from)::date
  on conflict do nothing;
  get diagnostics n = row_count;
  perform conso_prix_purge();
  return n;
end $$;

create or replace function public.conso_prix_delete_month(p_mois date)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not t2r_is_admin() then raise exception 'réservé aux administrateurs'; end if;
  delete from conso_prix where mois = date_trunc('month', p_mois)::date;
  get diagnostics n = row_count; return n;
end $$;

-- conso_grd_list() et conso_grd_save(...) : lecture / ajout de gestionnaires, réservés aux administrateurs.

revoke all on function public.conso_prix_purge() from public, anon, authenticated;
revoke all on function public.conso_prix_get(date) from public;
grant execute on function public.conso_prix_get(date) to anon, authenticated;
revoke all on function public.conso_prix_save(date,text,text,jsonb) from public, anon;
revoke all on function public.conso_prix_copy(date,date) from public, anon;
revoke all on function public.conso_prix_delete_month(date) from public, anon;
grant execute on function public.conso_prix_save(date,text,text,jsonb) to authenticated;
grant execute on function public.conso_prix_copy(date,date) to authenticated;
grant execute on function public.conso_prix_delete_month(date) to authenticated;

-- Purge quotidienne (pg_cron) : job « conso-prix-purge », 03:17.
-- select cron.schedule('conso-prix-purge', '17 3 * * *', 'select public.conso_prix_purge()');

-- ===== Propositions de prix des collègues (migration conso_prix_propositions, 20 novembre 2026) =====
-- Envoyées depuis le simulateur (anonyme, 6 lignes max par envoi, 100 par heure), validées dans admin-prix/.
create table if not exists public.conso_prix_propositions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  mois date not null check (extract(day from mois) = 1),
  type text not null check (type in ('energie','reseau','taxes')),
  energie text not null check (energie in ('e','g')),
  cle text not null check (char_length(cle) between 1 and 80),
  region text not null check (region in ('Wallonie','Bruxelles','Flandre')),
  prix_kwh numeric(8,3) check (prix_kwh >= 0 and prix_kwh < 1000),
  prix_jour numeric(8,3) check (prix_jour >= 0 and prix_jour < 1000),
  prix_nuit numeric(8,3) check (prix_nuit >= 0 and prix_nuit < 1000),
  fixe_an numeric(8,2) check (fixe_an >= 0 and fixe_an < 100000),
  prosumer_kwe numeric(8,2) check (prosumer_kwe >= 0 and prosumer_kwe < 10000),
  note text check (char_length(note) <= 200));
alter table public.conso_prix_propositions enable row level security;
revoke all on public.conso_prix_propositions from anon, authenticated;

-- conso_prix_proposer(p_mois date, p_rows jsonb, p_note text) : public ; mois entre -5 et +2 mois ; purge > 60 jours.
-- conso_prix_propositions_list() : admin ; propositions + valeur actuelle de la liste.
-- conso_prix_proposition_decider(p_id bigint, p_accept boolean) : admin ; accepter = upsert dans conso_prix
--   (coalesce : un champ vide garde la valeur actuelle), puis suppression de la proposition.
-- Texte complet des fonctions : voir la migration « conso_prix_propositions » dans Supabase.

-- ===== Segment particulier / professionnel (migration conso_prix_segment, 20 novembre 2026) =====
-- Les montants sont désormais HTVA (TVA appliquée par le simulateur : 6 % particulier, 21 % professionnel).
-- segment : 'R' particulier, 'P' professionnel, '*' commun (toujours utilisé pour type = 'reseau').
-- alter table conso_prix add column segment text not null default '*' check (segment in ('R','P','*'));
-- clé primaire : (mois, segment, type, energie, cle, region) ; même colonne dans conso_prix_propositions.
-- conso_seg(type, segment) : renvoie '*' pour le réseau, sinon 'R' ou 'P'.
-- conso_prix_save(p_mois, p_segment, p_type, p_energie, p_rows) remplace l'ancienne version à 4 paramètres.

-- ===== Code postal -> gestionnaire (migration conso_cp, 20 novembre 2026) =====
-- Sources : données ouvertes Fluvius (netbeheerder per gemeente, 8 zones actuelles), ORES (points d'accès par localité 2024,
-- électricité et gaz, portail ODWB), RESA gaz par commune (2025), codes postaux belges (ODWB), désignations CWaPE
-- (AIEG : Andenne, Gesves, Ohey, Viroinval, Rumes ; AIESH : Beaumont, Froidchapelle, Couvin, Chimay, Momignies, Sivry-Rance ;
-- REW : Wavre). Bruxelles : Sibelga. 1145 codes, 2040 lignes ; plusieurs lignes = le simulateur propose le choix.
-- Zones Fluvius ajoutées : fl-antwerpen, fl-halle-vilvoorde, fl-imewo, fl-kempen, fl-limburg, fl-midden-vlaanderen, fl-west,
-- fl-zenne-dijle ; désactivées : fl-gaselwest, fl-intergem, fl-iveka, fl-iverlek, fl-sibelgas, fl-pbe.
create table if not exists public.conso_cp (
  code int not null check (code between 1000 and 9999),
  energie text not null check (energie in ('e','g')),
  grd text not null references public.conso_grd(code) on update cascade,
  primary key (code, energie, grd));
alter table public.conso_cp enable row level security;
revoke all on public.conso_cp from anon, authenticated;
-- conso_cp_get(p_code int) -> {connu, e:[grd], g:[grd]} ; public (anon).

-- ===== Lien vers la carte ENGIE (migration conso_prix_doc, 20 novembre 2026) =====
-- conso_prix.doc = code de la carte (ex. E_EASY_R_GREEN_C_I_12_W_F) ; renvoyé par conso_prix_get, gardé par conso_prix_save
-- (coalesce si la page admin ne l'envoie pas) et recopié par conso_prix_copy. Le simulateur affiche « Carte ENGIE (PDF) ».
alter table public.conso_prix add column if not exists doc text check (doc is null or doc ~ '^[EG]_[A-Z_]+_[RP]_(GREEN|GREY)_C_[IF]_[0-9]{2}_[VBW]_F$');

-- ===== Énergie verte séparée (migration conso_prix_vert, 20 novembre 2026) =====
-- conso_prix.vert_kwh = coût énergie verte / cogénération (c€/kWh HTVA) des contrats électricité, hors prix_kwh/jour/nuit.
-- Renvoyé par conso_prix_get, enregistré par conso_prix_save (gardé si la clé est absente), recopié par conso_prix_copy.
alter table public.conso_prix add column if not exists vert_kwh numeric check (vert_kwh is null or vert_kwh >= 0);
-- Premier encodage : 115 lignes pour novembre 2026 (cartes ENGIE), via execute_sql.

-- ===== Recherche par localité (migrations conso_cp_nom, conso_cp_search, 20 novembre 2026) =====
-- conso_cp_nom(code, nom, commune) : 2757 localités bpost (ODWB « code-postaux-belge ») + noms français des villes flamandes
-- (Anvers, Gand, Louvain, Bruges, Malines…). Import fait par une fonction temporaire, supprimée ensuite.
-- conso_cp_search(p_q text) -> [{code, nom, commune}] (12 max) : début de code postal ou nom (sans accents) ; public (anon).
create table if not exists public.conso_cp_nom (
  code int not null check (code between 1000 and 9999),
  nom text not null check (length(nom) between 1 and 80),
  commune text,
  primary key (code, nom));
alter table public.conso_cp_nom enable row level security;
revoke all on public.conso_cp_nom from anon, authenticated;
create extension if not exists unaccent schema extensions;

-- ===== Précision (migration conso_prix_precision, 20 novembre 2026) =====
-- Le simulateur affiche les prix comme les cartes ENGIE (particulier TVAC, pro HTVA) : plus de décimales pour retrouver
-- exactement les montants TVAC après ÷ 1,06 puis × 1,06.
alter table public.conso_prix alter column prix_kwh type numeric(10,5), alter column prix_jour type numeric(10,5), alter column prix_nuit type numeric(10,5), alter column fixe_an type numeric(10,4);
alter table public.conso_prix_propositions alter column prix_kwh type numeric(10,5), alter column prix_jour type numeric(10,5), alter column prix_nuit type numeric(10,5), alter column fixe_an type numeric(10,4);

-- ===== Tri-horaire (migration conso_prix_trihoraire, 20 novembre 2026) =====
-- prix_t1 / prix_t2 / prix_t3 (c€/kWh HTVA) : énergie Flextime (heures pleines / creuses / super-creuses, Empower variable)
-- et réseau wallon Impact (PIC / MEDIUM / ECO, transport compris). Sans valeur : pleines = jour, creuses et super-creuses = nuit.
-- Renvoyés par conso_prix_get, gardés par conso_prix_save si la clé est absente, recopiés par conso_prix_copy.
alter table public.conso_prix add column if not exists prix_t1 numeric(10,5), add column if not exists prix_t2 numeric(10,5), add column if not exists prix_t3 numeric(10,5);

-- ===== Historique 18 mois + tarif social CREG (migration conso_historique_18_mois_tarif_social, 21 novembre 2026) =====
-- conso_prix_purge(), conso_prix_get() (mois_dispo) et conso_prix_proposer() : fenêtre portée de 5 à 17 mois en arrière
-- (mois en cours + 17 = 18 mois), pour recalculer une régularisation de 15 mois.
--   delete from conso_prix where mois < (date_trunc('month', now() at time zone 'Europe/Brussels') - interval '17 months')::date;
create table if not exists public.conso_tarif_social (
  trimestre date primary key check (extract(day from trimestre) = 1 and extract(month from trimestre) in (1,4,7,10)),
  e_mono numeric(10,5) check (e_mono >= 0 and e_mono < 1000),
  e_jour numeric(10,5) check (e_jour >= 0 and e_jour < 1000),
  e_nuit numeric(10,5) check (e_nuit >= 0 and e_nuit < 1000),
  e_excl numeric(10,5) check (e_excl >= 0 and e_excl < 1000),
  g numeric(10,5) check (g >= 0 and g < 1000),
  note text check (char_length(note) <= 200),
  updated_at timestamptz not null default now());
alter table public.conso_tarif_social enable row level security;
revoke all on public.conso_tarif_social from anon, authenticated;

create or replace function public.conso_tarif_social_get()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('trimestre',trimestre,'e_mono',e_mono,'e_jour',e_jour,'e_nuit',e_nuit,'e_excl',e_excl,'g',g,'note',note) order by trimestre desc), '[]'::jsonb)
  from conso_tarif_social;
$$;

create or replace function public.conso_tarif_social_save(p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; t date; n int := 0;
begin
  if not t2r_is_admin() then raise exception 'réservé aux administrateurs'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    t := date_trunc('quarter', (r->>'trimestre')::date)::date;
    if coalesce(r->>'e_mono', r->>'e_jour', r->>'e_nuit', r->>'e_excl', r->>'g') is null then
      delete from conso_tarif_social where trimestre = t; continue;
    end if;
    insert into conso_tarif_social(trimestre, e_mono, e_jour, e_nuit, e_excl, g, note, updated_at)
    values (t, (r->>'e_mono')::numeric, (r->>'e_jour')::numeric, (r->>'e_nuit')::numeric, (r->>'e_excl')::numeric, (r->>'g')::numeric, left(nullif(btrim(r->>'note'),''), 200), now())
    on conflict (trimestre) do update set e_mono = excluded.e_mono, e_jour = excluded.e_jour, e_nuit = excluded.e_nuit,
      e_excl = excluded.e_excl, g = excluded.g, note = excluded.note, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.conso_tarif_social_get() from public;
grant execute on function public.conso_tarif_social_get() to anon, authenticated;
revoke all on function public.conso_tarif_social_save(jsonb) from public, anon;
grant execute on function public.conso_tarif_social_save(jsonb) to authenticated;
-- Données : tarifs sociaux CREG T1 2025 à T4 2026 (c€/kWh HTVA) encodés le 21 novembre 2026.
-- Correction le même jour : taxes « Tarif social » électricité de novembre 2026 = accise 1 €/MWh
--   → 0,10000 c€/kWh (Flandre, Bruxelles), 0,17075 (Wallonie, redevance de raccordement comprise) au lieu de 1,00000 / 1,07075.

-- ===== Formules des contrats variables et paramètres d'indexation (migration conso_formules_indices, 22 novembre 2026) =====
-- Prix énergie d'un contrat variable (c€/kWh HTVA) = a + b × paramètre du mois de fourniture (€/MWh),
-- avec la formule de la carte du mois de signature (identique dans les 3 régions).
create table if not exists public.conso_formule (
  mois date not null check (extract(day from mois) = 1),
  segment text not null check (segment in ('R','P')),
  energie text not null check (energie in ('e','g')),
  cle text not null check (char_length(cle) between 1 and 80),
  param text not null check (param ~ '^[A-Za-z0-9_]{2,20}$'),
  k_a numeric(10,4), k_b numeric(10,5), j_a numeric(10,4), j_b numeric(10,5), n_a numeric(10,4), n_b numeric(10,5),
  x_a numeric(10,4), x_b numeric(10,5),
  t1_a numeric(10,4), t1_b numeric(10,5), t2_a numeric(10,4), t2_b numeric(10,5), t3_a numeric(10,4), t3_b numeric(10,5),
  fixe_an numeric(10,4) check (fixe_an >= 0),
  doc text check (char_length(doc) <= 80),
  updated_at timestamptz not null default now(),
  primary key (mois, segment, energie, cle));
alter table public.conso_formule enable row level security;
revoke all on public.conso_formule from anon, authenticated;

create table if not exists public.conso_indice (
  param text not null check (param ~ '^[A-Za-z0-9_]{2,20}$'),
  mois date not null check (extract(day from mois) = 1),
  valeur numeric(10,4) not null,
  source text check (char_length(source) <= 120),
  updated_at timestamptz not null default now(),
  primary key (param, mois));
alter table public.conso_indice enable row level security;
revoke all on public.conso_indice from anon, authenticated;

create or replace function public.conso_formule_get()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'formules', coalesce((select jsonb_agg(to_jsonb(f) - 'updated_at' order by f.mois desc, f.cle) from conso_formule f), '[]'::jsonb),
    'indices', coalesce((select jsonb_agg(jsonb_build_object('param', i.param, 'mois', i.mois, 'valeur', i.valeur) order by i.param, i.mois) from conso_indice i), '[]'::jsonb));
$$;
revoke all on function public.conso_formule_get() from public;
grant execute on function public.conso_formule_get() to anon, authenticated;

-- ===== Réponses aux avis (migration conso_avis_reponses, 24 novembre 2026) =====
alter table public.conso_avis add column if not exists reponse text check (char_length(reponse) <= 2000);
alter table public.conso_avis add column if not exists reponse_at timestamptz;
-- conso_avis_list() renvoie aussi reponse et reponse_at.
create or replace function public.conso_avis_repondre(p_id bigint, p_reponse text)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.t2r_is_admin() then raise exception 'réservé aux administrateurs'; end if;
  update public.conso_avis set reponse = left(nullif(btrim(p_reponse), ''), 2000),
         reponse_at = case when nullif(btrim(p_reponse), '') is null then null else now() end
   where id = p_id;
  return found;
end $function$;
create or replace function public.conso_avis_public()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('date', created_at::date, 'note', note, 'commentaire', commentaire, 'reponse', reponse, 'reponse_at', reponse_at::date) order by created_at desc), '[]'::jsonb)
  from (select * from public.conso_avis where reponse is not null order by created_at desc limit 50) a;
$function$;
revoke all on function public.conso_avis_repondre(bigint, text) from public, anon;
grant execute on function public.conso_avis_repondre(bigint, text) to authenticated;
revoke all on function public.conso_avis_public() from public;
grant execute on function public.conso_avis_public() to anon, authenticated;

-- 2026-11-25 · conso_detail_cartes : détail des fiches Easy particuliers (réseau distribution/transport, suppléments), valeurs TVAC des fiches.
-- Un enregistrement vaut jusqu'au suivant pour le même segment / énergie / région. data = {l: mise en page, t: tableaux par gestionnaire, p: suppléments [titre, libellé, valeur], v: énergie verte, s: fiche source}.
create table if not exists public.conso_detail (
  mois date not null, segment text not null, energie text not null, region text not null,
  data jsonb not null, updated_at timestamptz not null default now(),
  primary key (mois, segment, energie, region));
alter table public.conso_detail enable row level security;
create or replace function public.conso_detail_get()
 returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('mois', mois, 'segment', segment, 'energie', energie, 'region', region, 'data', data) order by mois), '[]'::jsonb) from conso_detail;
$$;
revoke all on function public.conso_detail_get() from public;
grant execute on function public.conso_detail_get() to anon, authenticated;

-- ===== Concurrence : prix des contrats en cours saisis par les collègues (page Concurrence, « Mon contrat actuel ») =====
-- Aucune donnée de client : fournisseur, contrat, prix, région. Écriture anonyme via conso_conc_saisir ; lecture réservée aux administrateurs.
create table if not exists public.conso_conc_saisie (
  id bigint generated always as identity primary key,
  cree timestamptz not null default now(),
  region text not null check (region in ('Wallonie', 'Bruxelles', 'Flandre')),
  energie text not null check (energie in ('e', 'g')),
  fournisseur text not null check (length(fournisseur) between 1 and 60),
  contrat text check (contrat is null or length(contrat) <= 80),
  type text check (type is null or type in ('fixe', 'variable', 'dynamique')),
  prix_kwh numeric(8,3) not null check (prix_kwh > 0 and prix_kwh < 150),
  redevance numeric(8,2) check (redevance is null or (redevance >= 0 and redevance < 2000)),
  souscrit date check (souscrit is null or (souscrit > '2000-01-01' and souscrit <= current_date + 31)),
  conso integer check (conso is null or (conso >= 0 and conso < 1000000))
);
alter table public.conso_conc_saisie enable row level security;
revoke all on public.conso_conc_saisie from anon, authenticated;

create or replace function public.conso_conc_saisir(p_region text, p_energie text, p_fournisseur text, p_contrat text, p_type text,
  p_prix numeric, p_redevance numeric, p_souscrit date, p_conso integer)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  -- garde-fou simple contre les envois en rafale
  if (select count(*) from conso_conc_saisie where cree > now() - interval '1 minute') > 30 then
    raise exception 'trop d''envois, réessayez dans une minute';
  end if;
  insert into conso_conc_saisie(region, energie, fournisseur, contrat, type, prix_kwh, redevance, souscrit, conso)
  values (p_region, p_energie, left(trim(p_fournisseur), 60), nullif(left(trim(coalesce(p_contrat, '')), 80), ''), p_type,
          round(p_prix, 3), round(p_redevance, 2), p_souscrit, p_conso)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.conso_conc_saisir(text, text, text, text, text, numeric, numeric, date, integer) from public;
grant execute on function public.conso_conc_saisir(text, text, text, text, text, numeric, numeric, date, integer) to anon, authenticated;

create or replace function public.conso_conc_liste(p_limite integer default 500)
returns setof public.conso_conc_saisie language plpgsql security definer set search_path = public as $$
begin
  if not t2r_is_admin() then raise exception 'réservé aux administrateurs'; end if;
  return query select * from conso_conc_saisie order by cree desc limit greatest(1, least(p_limite, 5000));
end $$;
revoke all on function public.conso_conc_liste(integer) from public;
grant execute on function public.conso_conc_liste(integer) to authenticated;

create or replace function public.conso_conc_supprimer(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not t2r_is_admin() then raise exception 'réservé aux administrateurs'; end if;
  delete from conso_conc_saisie where id = p_id;
end $$;
revoke all on function public.conso_conc_supprimer(bigint) from public;
grant execute on function public.conso_conc_supprimer(bigint) to authenticated;
