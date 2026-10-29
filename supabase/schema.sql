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
