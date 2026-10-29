-- Time2Relax : table de l'historique, avec sécurité par ligne.
-- À coller une seule fois dans Supabase : « SQL Editor » → « New query » → Run.
-- Chaque utilisateur ne voit et ne modifie QUE ses propres lignes.

create table if not exists public.breaks (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date       date not null,
  time       text not null check (time ~ '^[0-9]{2}:[0-9]{2}$'),
  type       text not null check (type in ('break', 'lunch')),
  seconds    integer not null check (seconds >= 0),
  created_at timestamptz not null default now()
);

create index if not exists breaks_user_date_idx on public.breaks (user_id, date);

alter table public.breaks enable row level security;

create policy "lire ses lignes"
  on public.breaks for select
  using ((select auth.uid()) = user_id);

create policy "ajouter ses lignes"
  on public.breaks for insert
  with check ((select auth.uid()) = user_id);

create policy "modifier ses lignes"
  on public.breaks for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "supprimer ses lignes"
  on public.breaks for delete
  using ((select auth.uid()) = user_id);
