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

-- Photo storage for gallery items. Photos are public to view; only the owner account can upload or delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "owner uploads gallery photos" on storage.objects;
drop policy if exists "owner updates gallery photos" on storage.objects;
drop policy if exists "owner deletes gallery photos" on storage.objects;
drop policy if exists "owner reads gallery photos" on storage.objects;

create policy "owner uploads gallery photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gallery' and (auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com');

create policy "owner updates gallery photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'gallery' and (auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com');

create policy "owner deletes gallery photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'gallery' and (auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com');

create policy "owner reads gallery photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'gallery' and (auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com');
