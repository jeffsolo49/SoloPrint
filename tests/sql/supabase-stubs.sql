-- Stand-ins for the parts of Supabase the SQL files rely on, so they can run on plain Postgres.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
grant usage on schema public to anon, authenticated;
create schema extensions;
create schema net;
create table net.calls (id serial, url text, body jsonb);
create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) returns bigint
  language sql as $$ insert into net.calls (url, body) values (url, body) returning id::bigint $$;
create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id serial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated;
grant usage on sequence storage.objects_id_seq to anon, authenticated;
-- The jobs table as it exists in the live project.
create table public.jobs (id text primary key, data jsonb, created_at timestamptz default now());
grant all on public.jobs to anon, authenticated;
create policy "open (replaced by security.sql)" on public.jobs for all using (true) with check (true);
insert into public.jobs (id, data) values
  ('100', '{"id":"100","clientName":"Jane","clientEmail":"jane@example.com","phase":"quote_sent","items":[]}'),
  ('200', '{"id":"200","clientName":"Bob","clientEmail":"bob@example.com","phase":"estimate","items":[]}');
