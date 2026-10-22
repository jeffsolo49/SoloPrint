-- SoloPrint: unsent requests saved as drafts, so a customer can finish later and gets one reminder email.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Run after the other files (security.sql ... owner-tools.sql).

-- One draft per email address. Nobody reads or writes the table directly: customers go through the
-- functions below, the owner can look at it, and the Google script sends the reminders.
create table if not exists public.request_drafts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null default '',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  reminded_at timestamptz
);
create unique index if not exists request_drafts_email on public.request_drafts (lower(email));

alter table public.request_drafts enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'request_drafts' loop
    execute format('drop policy %I on public.request_drafts', p.policyname);
  end loop;
end $$;

revoke all on public.request_drafts from anon, authenticated;
grant select, delete on public.request_drafts to authenticated;

create policy "owner reads drafts" on public.request_drafts
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com');

-- Saves (or updates) the draft for an email address. Returns nothing, so it can't be used to read drafts.
create or replace function public.save_request_draft(p_email text, p_name text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 200
     or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 40000 then
    raise exception 'invalid draft';
  end if;
  insert into public.request_drafts (email, name, data)
  values (trim(p_email), left(coalesce(p_name, ''), 120), p_data)
  on conflict (lower(email)) do update
    set name = excluded.name, data = excluded.data, updated_at = now();
end;
$$;

-- Removes the draft once the customer sends their request.
create or replace function public.clear_request_draft(p_email text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.request_drafts where lower(email) = lower(trim(coalesce(p_email, '')));
$$;

-- Opens a draft from the link in the reminder email (the id is a long random value only that email has).
create or replace function public.get_request_draft(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('name', name, 'email', email, 'data', data)
  from public.request_drafts
  where id = p_id and updated_at > now() - interval '60 days';
$$;

-- For the Google script (same secret as the email trigger): drafts untouched for p_days with no request
-- sent since, each reminded once. Drafts older than 30 days are left alone.
create or replace function public.due_draft_reminders(p_secret text, p_days int default 7)
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
    update public.request_drafts d
    set reminded_at = now()
    where d.reminded_at is null
      and d.updated_at < now() - make_interval(days => greatest(p_days, 1))
      and d.updated_at > now() - make_interval(days => greatest(p_days, 1) + 30)
      and not exists (
        select 1 from public.jobs j
        where lower(j.data->>'clientEmail') = lower(d.email) and j.created_at > d.updated_at - interval '1 day'
      )
    returning d.id, d.email, d.name, d.data
  )
  select jsonb_build_object('id', due.id, 'clientEmail', due.email, 'clientName', due.name, 'data', due.data) from due;
end;
$$;

revoke all on function public.save_request_draft(text, text, jsonb) from public;
revoke all on function public.clear_request_draft(text) from public;
revoke all on function public.get_request_draft(uuid) from public;
revoke all on function public.due_draft_reminders(text, int) from public;
grant execute on function public.save_request_draft(text, text, jsonb) to anon, authenticated;
grant execute on function public.clear_request_draft(text) to anon, authenticated;
grant execute on function public.get_request_draft(uuid) to anon, authenticated;
grant execute on function public.due_draft_reminders(text, int) to anon;
