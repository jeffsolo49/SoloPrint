-- SoloPrint gallery of finished work. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run. Anyone can see items marked published; only the owner account can add, edit or delete.

create table if not exists public.gallery_items (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  published boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.gallery_items enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'gallery_items' loop
    execute format('drop policy %I on public.gallery_items', p.policyname);
  end loop;
end $$;

revoke all on public.gallery_items from anon, authenticated;
grant select on public.gallery_items to anon, authenticated;
grant insert, update, delete on public.gallery_items to authenticated;

create policy "anyone can view published items" on public.gallery_items
  for select to anon, authenticated
  using (published);

create policy "owner manages the gallery" on public.gallery_items
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com');
