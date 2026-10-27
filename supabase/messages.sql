-- SoloPrint messages: the conversation on each order. Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Run after email-trigger.sql (it uses the same webhook). Safe to re-run.
--
-- Messages come from four places:
--   owner + site:   you write on the order card; the email script emails it to the customer
--   customer + site: the customer writes on their order page; the email script emails it to you
--   email:          replies found in your Gmail (customers' replies, and your replies from Gmail)
--   auto:           the shop's own emails (quote, confirmed, ...), logged as they're sent

create table if not exists public.order_messages (
  id bigint generated always as identity primary key,
  job_id text not null,
  sender text not null check (sender in ('owner', 'customer')),
  via text not null default 'site' check (via in ('site', 'email', 'auto')),
  subject text not null default '' check (length(subject) <= 300),
  body text not null check (length(body) between 1 and 10000),
  email_id text unique,            -- Gmail message id, so a reply is never recorded twice
  created_at timestamptz not null default now()
);
create index if not exists order_messages_job on public.order_messages (job_id, created_at);
alter table public.order_messages enable row level security;
revoke all on public.order_messages from anon, authenticated;
grant select, insert, update, delete on public.order_messages to authenticated;

drop policy if exists "owner full access" on public.order_messages;
create policy "owner full access" on public.order_messages
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com');

-- Customer: the messages on one of their own orders (same check as customer_jobs: the order's email).
create or replace function public.customer_messages(p_job_id text, p_email text)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', m.id, 'sender', m.sender, 'via', m.via, 'subject', m.subject, 'body', m.body, 'at', m.created_at)
  from public.order_messages m
  join public.jobs j on j.id::text = m.job_id
  where m.job_id = p_job_id
    and length(trim(coalesce(p_email, ''))) > 3
    and lower(j.data->>'clientEmail') = lower(trim(p_email))
  order by m.created_at, m.id;
$$;

-- Customer: send a message on one of their own orders. At most 20 a day per order.
create or replace function public.customer_send_message(p_job_id text, p_email text, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(trim(coalesce(p_body, ''))) < 1 or length(p_body) > 5000 then
    raise exception 'message must be 1 to 5000 characters';
  end if;
  if not exists (select 1 from public.jobs where id::text = p_job_id
                 and length(trim(coalesce(p_email, ''))) > 3 and lower(data->>'clientEmail') = lower(trim(p_email))) then
    raise exception 'order not found';
  end if;
  if (select count(*) from public.order_messages where job_id = p_job_id and sender = 'customer'
      and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many messages today';
  end if;
  insert into public.order_messages (job_id, sender, via, body) values (p_job_id, 'customer', 'site', trim(p_body));
end;
$$;

-- Email script only (needs the shared secret): record replies found in Gmail and the shop's own emails.
-- Each row: { job_id (may be blank), email (the customer's address), sender, via ('email' or 'auto'),
-- subject, body, email_id, at }. A row is kept only when the email address belongs to the order's
-- customer; with no (or a wrong) order id it goes on that customer's latest open order.
create or replace function public.record_messages(p_secret text, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
  r jsonb;
  jid text;
  addr text;
  added int := 0;
  n int;
begin
  select secret into expected from private.email_settings where id = 1;
  if expected is null or length(expected) < 20 or p_secret is distinct from expected then
    raise exception 'forbidden';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    addr := lower(trim(coalesce(r->>'email', '')));
    continue when length(addr) < 4
      or coalesce(r->>'sender', '') not in ('owner', 'customer')
      or coalesce(r->>'via', '') not in ('email', 'auto')
      or length(trim(coalesce(r->>'body', ''))) < 1;
    select id::text into jid from public.jobs
      where id::text = coalesce(r->>'job_id', '') and lower(data->>'clientEmail') = addr;
    if jid is null then
      select id::text into jid from public.jobs
        where lower(data->>'clientEmail') = addr
        order by (coalesce(data->>'phase', '') = 'delivered'), created_at desc
        limit 1;
    end if;
    continue when jid is null;
    insert into public.order_messages (job_id, sender, via, subject, body, email_id, created_at)
    values (jid, r->>'sender', r->>'via', left(coalesce(r->>'subject', ''), 300), left(r->>'body', 10000),
            nullif(r->>'email_id', ''),
            coalesce((case when (r->>'at') ~ '^\d{4}-\d\d-\d\dT' then (r->>'at')::timestamptz end), now()))
    on conflict (email_id) do nothing;
    get diagnostics n = row_count;
    added := added + n;
  end loop;
  return added;
end;
$$;

revoke all on function public.customer_messages(text, text) from public;
revoke all on function public.customer_send_message(text, text, text) from public;
revoke all on function public.record_messages(text, jsonb) from public;
grant execute on function public.customer_messages(text, text) to anon, authenticated;
grant execute on function public.customer_send_message(text, text, text) to anon, authenticated;
grant execute on function public.record_messages(text, jsonb) to anon;

-- Messages written on the site are emailed by the email script: yours to the customer, theirs to you.
create or replace function private.send_order_message()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg private.email_settings;
  job jsonb;
begin
  if new.via <> 'site' then
    return new;
  end if;
  select * into cfg from private.email_settings where id = 1;
  if cfg.webhook_url is null or cfg.webhook_url not like 'https://%' then
    return new;
  end if;
  select data::jsonb into job from public.jobs where id::text = new.job_id;
  if job is null then
    return new;
  end if;
  perform net.http_post(
    url := cfg.webhook_url,
    body := jsonb_build_object('secret', cfg.secret, 'type', 'MESSAGE', 'message', to_jsonb(new), 'record', job),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
  return new;
end;
$$;

drop trigger if exists send_order_message on public.order_messages;
create trigger send_order_message
  after insert on public.order_messages
  for each row execute function private.send_order_message();
