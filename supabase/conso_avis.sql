-- Avis anonymes sur l'outil d'estimation de consommation (time2relax.app/conso-estimation-r8m3/avis/)
-- Déjà appliqué sur le projet Supabase (migration « conso_avis », 19 novembre 2026).
-- Lecture des avis : tableau de bord Supabase → Table Editor → conso_avis.
create table if not exists public.conso_avis (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  note smallint check (note between 1 and 5),
  commentaire text check (char_length(commentaire) <= 2000)
);
alter table public.conso_avis enable row level security;
revoke all on public.conso_avis from anon, authenticated;

create or replace function public.conso_avis_add(p_note int, p_commentaire text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c text := nullif(btrim(coalesce(p_commentaire, '')), '');
begin
  if p_note is null or p_note < 1 or p_note > 5 then raise exception 'note invalide'; end if;
  if c is not null and char_length(c) > 2000 then c := left(c, 2000); end if;
  if (select count(*) from public.conso_avis where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'trop d''avis récents, réessayez plus tard';
  end if;
  insert into public.conso_avis(note, commentaire) values (p_note::smallint, c);
  return true;
end $$;
revoke all on function public.conso_avis_add(int, text) from public;
grant execute on function public.conso_avis_add(int, text) to anon, authenticated;
