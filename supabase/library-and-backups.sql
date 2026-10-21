-- SoloPrint: saved models in the database, and a backup export for the weekly Google Drive backup.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Run after security.sql, gallery.sql and email-trigger.sql.

-- 1. Saved models (print time and grams you've recorded for a model).
--    Anyone can read them, so customers get "we've printed this before" estimates; only the owner can change them.
create table if not exists public.model_library (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.model_library enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'model_library' loop
    execute format('drop policy %I on public.model_library', p.policyname);
  end loop;
end $$;

revoke all on public.model_library from anon, authenticated;
grant select on public.model_library to anon, authenticated;
grant insert, update, delete on public.model_library to authenticated;

create policy "anyone can read saved models" on public.model_library
  for select to anon, authenticated using (true);

create policy "owner manages saved models" on public.model_library
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com');

-- 2. Backup export. Returns every order, gallery item and saved model, but only when given the same
--    secret the email script uses (stored in private.email_settings), so only your Google script can call it.
create or replace function public.backup_export(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
begin
  select secret into expected from private.email_settings where id = 1;
  if expected is null or length(expected) < 20 or p_secret is distinct from expected then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'exported_at', now(),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'data', data) order by created_at) from public.jobs), '[]'::jsonb),
    'gallery_items', coalesce((select jsonb_agg(to_jsonb(g) order by g.created_at) from public.gallery_items g), '[]'::jsonb),
    'model_library', coalesce((select jsonb_agg(to_jsonb(m) order by m.key) from public.model_library m), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.backup_export(text) from public;
grant execute on function public.backup_export(text) to anon;
