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

-- A customer can review a delivered order of theirs (matched by email), once; they can rewrite it until
-- the owner has looked at it.
drop function if exists public.submit_review(text, text, text, text, int);
create or replace function public.submit_review(p_job_id text, p_email text, p_name text, p_text text, p_rating int, p_photos text[] default '{}')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare ph text;
begin
  if length(trim(coalesce(p_text, ''))) < 3 or length(p_text) > 600 or length(coalesce(p_name, '')) > 60
     or (p_rating is not null and p_rating not between 1 and 5) then
    raise exception 'invalid review';
  end if;
  -- Up to 2 photos, each one a file the customer uploaded to the gallery bucket's reviews/ folder.
  if coalesce(array_length(p_photos, 1), 0) > 2 then raise exception 'invalid review'; end if;
  foreach ph in array coalesce(p_photos, '{}') loop
    if ph !~ '^https://[a-z0-9.-]+/storage/v1/object/public/gallery/reviews/[A-Za-z0-9_.-]+\.jpg$' then raise exception 'invalid review'; end if;
  end loop;
  if not exists (
    select 1 from public.jobs
    where id = p_job_id
      and length(trim(coalesce(p_email, ''))) > 3
      and lower(data->>'clientEmail') = lower(trim(p_email))
      and data->>'phase' = 'delivered'
  ) then
    raise exception 'order not found';
  end if;
  insert into public.customer_reviews (job_id, name, text, rating, photos)
  values (p_job_id, trim(coalesce(p_name, '')), trim(p_text), p_rating, coalesce(p_photos, '{}'))
  on conflict (job_id) do update
    set name = excluded.name, text = excluded.text, rating = excluded.rating, photos = excluded.photos, created_at = now()
    where customer_reviews.status = 'new';
end;
$$;

revoke all on function public.submit_review(text, text, text, text, int, text[]) from public;
grant execute on function public.submit_review(text, text, text, text, int, text[]) to anon, authenticated;

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
