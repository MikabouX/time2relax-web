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
