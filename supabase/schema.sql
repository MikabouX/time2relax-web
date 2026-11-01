-- Time2Relax : historique rangé par nom d'utilisateur, sans mot de passe.
-- À coller une seule fois dans Supabase : « SQL Editor » → « New query » → Run.
--
-- La table n'est pas accessible directement (RLS active, aucune règle, droits retirés) : la page
-- passe par trois fonctions qui exigent le nom d'utilisateur. Sans connaître le nom, on ne peut ni
-- lire, ni modifier, ni lister les historiques. Avec le nom, on voit et on modifie tout : choisir un
-- nom que personne d'autre n'utilise.

create table if not exists public.pauses (
  id         uuid primary key,
  username   text not null check (char_length(username) between 2 and 40),
  date       date not null,
  time       text not null check (time ~ '^[0-9]{2}:[0-9]{2}$'),
  type       text not null check (type in ('break', 'lunch')),
  seconds    integer not null check (seconds >= 0 and seconds <= 86400),
  created_at timestamptz not null default now()
);

create index if not exists pauses_username_idx on public.pauses (username, date);

alter table public.pauses enable row level security;
revoke all on public.pauses from anon, authenticated;

-- Lire l'historique d'un nom (la page demande par tranches de 1000).
create or replace function public.t2r_list(p_username text)
returns table (id uuid, "date" date, "time" text, "type" text, seconds integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.date, p.time, p.type, p.seconds
  from public.pauses p
  where p.username = lower(trim(p_username))
  order by p.date, p.time, p.id
$$;

-- Ajouter ou modifier des entrées (une entrée d'un autre nom n'est jamais touchée).
create or replace function public.t2r_save(p_username text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  u text := lower(trim(p_username));
begin
  if char_length(u) < 2 or char_length(u) > 40 then
    raise exception 'nom d''utilisateur invalide';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'trop d''entrées en une fois';
  end if;
  insert into public.pauses (id, username, date, time, type, seconds)
  select (r->>'id')::uuid, u, (r->>'date')::date, r->>'time', r->>'type', (r->>'seconds')::integer
  from jsonb_array_elements(p_rows) as r
  on conflict (id) do update
    set date = excluded.date, time = excluded.time, type = excluded.type, seconds = excluded.seconds
    where public.pauses.username = u;
end
$$;

-- Supprimer des entrées d'un nom.
create or replace function public.t2r_delete(p_username text, p_ids uuid[])
returns void
language sql security definer set search_path = public as $$
  delete from public.pauses
  where username = lower(trim(p_username)) and id = any (p_ids)
$$;

revoke all on function public.t2r_list(text) from public;
revoke all on function public.t2r_save(text, jsonb) from public;
revoke all on function public.t2r_delete(text, uuid[]) from public;
grant execute on function public.t2r_list(text) to anon, authenticated;
grant execute on function public.t2r_save(text, jsonb) to anon, authenticated;
grant execute on function public.t2r_delete(text, uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Chrono partagé : un seul chrono en cours par nom, suivi depuis tous les appareils.
-- (À coller une seule fois, comme la partie du haut ; sans danger si on le colle deux fois.)
--
-- Le temps écoulé est calculé ici, avec l'horloge du serveur : les appareils n'ont pas besoin
-- d'avoir la même heure. Un chrono resté en route plus de 24 h est abandonné.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.runs (
  username   text primary key check (char_length(username) between 2 and 40),
  id         uuid not null,
  started_at timestamptz not null,
  type       text not null check (type in ('break', 'lunch')),
  planned    integer not null check (planned >= 0 and planned <= 86400),
  created_at timestamptz not null default now()
);

alter table public.runs enable row level security;
revoke all on public.runs from anon, authenticated;

-- Chrono en cours de ce nom (aucune ligne : pas de chrono).
create or replace function public.t2r_run_get(p_username text)
returns table (run_id uuid, elapsed_ms bigint, kind text, planned_s integer)
language sql security definer set search_path = public as $$
  select r.id, (extract(epoch from clock_timestamp() - r.started_at) * 1000)::bigint, r.type, r.planned
  from public.runs r
  where r.username = lower(trim(p_username))
    and r.started_at > clock_timestamp() - interval '24 hours'
$$;

-- Démarre un chrono (déjà écoulé depuis p_elapsed_ms : 0 au départ, plus pour « Reprendre »).
-- S'il y en a déjà un, il reste en place : la réponse donne toujours le chrono en vigueur.
create or replace function public.t2r_run_start(
  p_username text, p_id uuid, p_type text, p_planned integer, p_elapsed_ms bigint)
returns table (run_id uuid, elapsed_ms bigint, kind text, planned_s integer)
language plpgsql security definer set search_path = public as $$
declare
  u text := lower(trim(p_username));
begin
  if char_length(u) < 2 or char_length(u) > 40 then
    raise exception 'nom d''utilisateur invalide';
  end if;
  if p_type not in ('break', 'lunch') or p_planned < 0 or p_planned > 86400 then
    raise exception 'chrono invalide';
  end if;
  delete from public.runs r
  where r.username = u and r.started_at <= clock_timestamp() - interval '24 hours';
  insert into public.runs (username, id, started_at, type, planned)
  values (
    u, p_id,
    clock_timestamp() - make_interval(secs => (least(greatest(p_elapsed_ms, 0), 86399000) / 1000.0)::double precision),
    p_type, p_planned)
  on conflict (username) do nothing;
  return query select * from public.t2r_run_get(u);
end
$$;

-- Termine le chrono p_id (vrai s'il était encore en cours ; un autre chrono n'est jamais touché).
create or replace function public.t2r_run_stop(p_username text, p_id uuid)
returns boolean
language sql security definer set search_path = public as $$
  with gone as (
    delete from public.runs
    where username = lower(trim(p_username)) and id = p_id
    returning 1
  )
  select exists (select 1 from gone)
$$;

revoke all on function public.t2r_run_get(text) from public;
revoke all on function public.t2r_run_start(text, uuid, text, integer, bigint) from public;
revoke all on function public.t2r_run_stop(text, uuid) from public;
grant execute on function public.t2r_run_get(text) to anon, authenticated;
grant execute on function public.t2r_run_start(text, uuid, text, integer, bigint) to anon, authenticated;
grant execute on function public.t2r_run_stop(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Réglages rangés sous le nom d'utilisateur (langue, sandwicheries, breaks prévus, minuteurs…).
-- (À coller une seule fois, comme les parties du haut ; sans danger si on le colle deux fois.)
--
-- Les adresses (maison, bureau) ne sont JAMAIS enregistrées ici : la fonction ci-dessous ne garde
-- que les réglages de la liste blanche et jette tout le reste, même si une appli en envoyait.
-- Les réglages sont envoyés par morceaux (« patch ») : une appli ne touche que ce qu'elle a changé.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.settings (
  username   text primary key check (char_length(username) between 2 and 40),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;
revoke all on public.settings from anon, authenticated;

-- Réglages d'un nom (null : rien d'enregistré).
create or replace function public.t2r_settings_get(p_username text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select s.data from public.settings s where s.username = lower(trim(p_username))
$$;

-- Ajoute ou remplace les réglages envoyés (liste blanche), garde les autres ; renvoie le résultat.
create or replace function public.t2r_settings_set(p_username text, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u text := lower(trim(p_username));
  allowed text[] := array['lang', 'theme_color', 'theme_mode', 'confirm_stop', 'night_mode', 'night_cutoff', 'use_timer',
                          'pause_minutes', 'lunch_minutes', 'plan_notify', 'plan_notify_lead',
                          'os_lead', 'nav_app', 'shops', 'shop_index', 'plan'];
  clean jsonb;
  res jsonb;
begin
  if char_length(u) < 2 or char_length(u) > 40 then
    raise exception 'nom d''utilisateur invalide';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'réglages invalides';
  end if;
  if octet_length(p_patch::text) > 20000 then
    raise exception 'réglages trop gros';
  end if;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into clean
  from jsonb_each(p_patch) as e where e.key = any (allowed);
  insert into public.settings (username, data) values (u, clean)
  on conflict (username) do update
    set data = public.settings.data || excluded.data, updated_at = now()
  returning data into res;
  if octet_length(res::text) > 30000 then
    raise exception 'réglages trop gros';
  end if;
  return res;
end
$$;

revoke all on function public.t2r_settings_get(text) from public;
revoke all on function public.t2r_settings_set(text, jsonb) from public;
grant execute on function public.t2r_settings_get(text) to anon, authenticated;
grant execute on function public.t2r_settings_set(text, jsonb) to anon, authenticated;


-- Efface les réglages rangés sous un nom (« Réinitialiser l'application » / « Réinitialiser cette page »).
-- L'historique et le chrono ne sont pas touchés. Renvoie vrai s'il y avait des réglages.
create or replace function public.t2r_settings_clear(p_username text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  u text := lower(trim(p_username));
  n integer;
begin
  if char_length(u) < 2 or char_length(u) > 40 then
    raise exception 'nom invalide';
  end if;
  delete from public.settings where username = u;
  get diagnostics n = row_count;
  return n > 0;
end
$$;

revoke all on function public.t2r_settings_clear(text) from public;
grant execute on function public.t2r_settings_clear(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Historique gardé une semaine (novembre 2026) : chaque nuit, les entrées de plus de 7 jours sont
-- effacées. À exécuter une fois dans Supabase → SQL Editor.
create extension if not exists pg_cron;

create or replace function public.t2r_purge_old() returns void
language sql security definer set search_path to 'public' as $$
  delete from public.pauses where date < current_date - 7;
  delete from public.breaks where date < current_date - 7;
$$;
revoke all on function public.t2r_purge_old() from public, anon, authenticated;

select cron.schedule('t2r-purge-7-jours', '15 2 * * *', 'select public.t2r_purge_old()');
