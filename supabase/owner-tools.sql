-- SoloPrint: private owner data (order notes, filament stock, expenses), customer reviews, and the data
-- the daily and weekly emails need.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Run after security.sql, gallery.sql, email-trigger.sql, library-and-backups.sql and site-settings.sql.

-- 1. Private owner data: one row per kind ('notes', 'inventory', 'money'). Only the owner can read or
--    change it; customers never see it (unlike orders, which customers can look up by email).
create table if not exists public.owner_private (
  key text primary key check (key ~ '^[a-z_]{1,40}$'),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.owner_private enable row level security;

revoke all on public.owner_private from anon, authenticated;
grant select, insert, update, delete on public.owner_private to authenticated;

-- 2. Reviews customers leave from the link in their "how did it turn out?" email. They only appear on
--    the site once the owner approves them (approving copies them into site settings).
create table if not exists public.customer_reviews (
  job_id text primary key,
  name text not null default '',
  text text not null,
  rating int check (rating between 1 and 5),
  status text not null default 'new' check (status in ('new', 'approved', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.customer_reviews add column if not exists photos text[] not null default '{}';

alter table public.customer_reviews enable row level security;

-- Start both tables' rules from scratch so re-running this file never leaves an old rule behind.
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('owner_private', 'customer_reviews') loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

revoke all on public.customer_reviews from anon, authenticated;
grant select, update, delete on public.customer_reviews to authenticated;

create policy "owner manages private data" on public.owner_private
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com');

create policy "owner manages customer reviews" on public.customer_reviews
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com');

-- Customers write their review through order-links.sql (submit_review needs their order's private link).

-- Customers may add review photos (only into the reviews/ folder, only small jpg files). The gallery
-- bucket already limits size and file type; nobody but the owner can change or delete what's uploaded.
drop policy if exists "customers add review photos" on storage.objects;
create policy "customers add review photos" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'gallery' and name like 'reviews/%' and name not like '%/%/%' and name ~ '\.jpg$');

-- 3. For the Google script (same secret as the email trigger): delivered orders due a review request,
--    marked as asked in the same step so each customer is asked once.
create or replace function public.due_review_requests(p_secret text, p_days int default 7)
returns setof jsonb
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
  return query
  with due as (
    update public.jobs
    set data = jsonb_set(data::jsonb, '{reviewRequestedAt}',
                         to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    where data->>'phase' = 'delivered'
      and coalesce(data->>'reviewRequestedAt', '') = ''
      and coalesce(nullif(data->'phaseHistory'->>'delivered', '')::timestamptz, created_at)
          < now() - make_interval(days => greatest(p_days, 1))
      and coalesce(nullif(data->'phaseHistory'->>'delivered', '')::timestamptz, created_at)
          > now() - make_interval(days => greatest(p_days, 1) + 30)
      and not exists (select 1 from public.customer_reviews r where r.job_id = jobs.id)
    returning data
  )
  select due.data::jsonb from due;
end;
$$;

revoke all on function public.due_review_requests(text, int) from public;
grant execute on function public.due_review_requests(text, int) to anon;

-- 4. For the Google script: orders, site settings and private owner data, for the weekly summary and
--    leftover-roll reminders.
create or replace function public.owner_report_data(p_secret text)
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
    'jobs', coalesce((select jsonb_agg(data::jsonb order by created_at) from public.jobs), '[]'::jsonb),
    'settings', coalesce((select data from public.site_settings where id = 1), '{}'::jsonb),
    'private', coalesce((select jsonb_object_agg(key, data) from public.owner_private), '{}'::jsonb),
    'new_reviews', (select count(*) from public.customer_reviews where status = 'new')
  );
end;
$$;

revoke all on function public.owner_report_data(text) from public;
grant execute on function public.owner_report_data(text) to anon;

-- 4. Color ideas customers send in from a design page ("Send to SoloPrint to share"). They only show on the
--    design once the owner publishes them (the owner can rename them first). Customers can add one, nothing more.
create table if not exists public.color_ideas (
  id uuid primary key default gen_random_uuid(),
  design_id text not null,
  name text not null default '',
  colors jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists color_ideas_created on public.color_ideas (created_at);
alter table public.color_ideas enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'color_ideas' loop
    execute format('drop policy %I on public.color_ideas', p.policyname);
  end loop;
end $$;

revoke all on public.color_ideas from anon, authenticated;
grant select, delete on public.color_ideas to authenticated;

create policy "owner manages color ideas" on public.color_ideas
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com');

create or replace function public.submit_color_idea(p_design text, p_name text, p_colors jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare k text; v jsonb;
begin
  if p_design is null or length(p_design) > 80 or not exists (select 1 from public.gallery_items where id = p_design) then
    raise exception 'invalid color idea';
  end if;
  if length(trim(coalesce(p_name, ''))) < 1 or length(p_name) > 40 then raise exception 'invalid color idea'; end if;
  if jsonb_typeof(p_colors) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_colors)) not between 1 and 12 then
    raise exception 'invalid color idea';
  end if;
  for k, v in select * from jsonb_each(p_colors) loop
    if k !~ '^[A-Za-z0-9_-]{1,40}$' or jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[a-z0-9-]{1,40}$' then raise exception 'invalid color idea'; end if;
  end loop;
  -- Keeps a flood out: at most 200 waiting in all, and 20 for one design.
  if (select count(*) from public.color_ideas) >= 200 or (select count(*) from public.color_ideas where design_id = p_design) >= 20 then
    raise exception 'too many color ideas waiting';
  end if;
  insert into public.color_ideas (design_id, name, colors) values (p_design, trim(p_name), p_colors);
end;
$$;

revoke all on function public.submit_color_idea(text, text, jsonb) from public;
grant execute on function public.submit_color_idea(text, text, jsonb) to anon, authenticated;
