-- SoloPrint order emails. Run in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run supabase/security.sql first. Safe to re-run (e.g. to change the URL or secret).
--
-- Whenever an order is created, or its stage, payment status, approval or delivery details change,
-- Supabase sends the order to your Google Apps Script (email/Code.gs), which emails from your Gmail.
--
-- Fill in the two values below before running:
--   webhook_url: the Web app URL from Apps Script (Deploy -> New deployment -> Web app)
--   secret:      the same secret you put in SECRET at the top of email/Code.gs

create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.email_settings (
  id int primary key default 1 check (id = 1),
  webhook_url text not null,
  secret text not null
);

insert into private.email_settings (id, webhook_url, secret)
values (1, 'PASTE-WEB-APP-URL-HERE', 'PASTE-YOUR-SECRET-HERE')
on conflict (id) do update set webhook_url = excluded.webhook_url, secret = excluded.secret;

create or replace function private.send_order_email()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg private.email_settings;
  rec jsonb := new.data::jsonb;
  prev jsonb := case when tg_op = 'UPDATE' then old.data::jsonb end;
begin
  select * into cfg from private.email_settings where id = 1;
  if cfg.webhook_url is null or cfg.webhook_url not like 'https://%' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and (prev->>'phase') is not distinct from (rec->>'phase')
     and (prev->>'paymentStatus') is not distinct from (rec->>'paymentStatus')
     and (prev->>'customerApprovedAt') is not distinct from (rec->>'customerApprovedAt')
     and (prev->>'deliveryDate') is not distinct from (rec->>'deliveryDate')
     and (prev->>'deliveryTracking') is not distinct from (rec->>'deliveryTracking')
     and (prev->>'deliveryNotes') is not distinct from (rec->>'deliveryNotes') then
    return new;
  end if;
  -- Sent in the background; a slow or failed email never blocks saving the order.
  perform net.http_post(
    url := cfg.webhook_url,
    body := jsonb_build_object('secret', cfg.secret, 'type', tg_op, 'record', rec, 'old_record', prev),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
  return new;
end;
$$;

drop trigger if exists send_order_email on public.jobs;
create trigger send_order_email
  after insert or update on public.jobs
  for each row execute function private.send_order_email();
