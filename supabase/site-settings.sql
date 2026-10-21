-- SoloPrint: site settings (about text, links, colors, reviews) and quote reminders.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Run after security.sql, gallery.sql, email-trigger.sql and library-and-backups.sql.

-- 1. Site settings: a single row. Anyone can read it; only the owner can change it.
create table if not exists public.site_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'site_settings' loop
    execute format('drop policy %I on public.site_settings', p.policyname);
  end loop;
end $$;

revoke all on public.site_settings from anon, authenticated;
grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;

create policy "anyone can read site settings" on public.site_settings
  for select to anon, authenticated using (true);

create policy "owner manages site settings" on public.site_settings
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com');

-- 2. Quote reminders. Returns quotes sent more than p_days ago that the customer hasn't approved and
--    that haven't had a reminder, and marks them reminded in the same step (so each gets one reminder).
--    Only the Google script can call it: it needs the same secret as the email trigger.
create or replace function public.due_quote_reminders(p_secret text, p_days int default 3)
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
    set data = jsonb_set(data::jsonb, '{reminderSentAt}',
                         to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    where data->>'phase' = 'quote_sent'
      and coalesce(data->>'customerApprovedAt', '') = ''
      and coalesce(data->>'reminderSentAt', '') = ''
      and coalesce(nullif(data->'phaseHistory'->>'quote_sent', '')::timestamptz, created_at)
          < now() - make_interval(days => greatest(p_days, 1))
    returning data
  )
  select due.data::jsonb from due;
end;
$$;

revoke all on function public.due_quote_reminders(text, int) from public;
grant execute on function public.due_quote_reminders(text, int) to anon;
