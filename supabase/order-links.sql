-- SoloPrint private order links. Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Run after all the other files (it replaces the customer functions that used to look orders up by email).
-- Safe to re-run.
--
-- Every order gets its own random key (jobs.access_token, 12 characters from a 57-letter alphabet with no look-alikes,
-- about 70 bits). The link in each email carries it (https://.../?o=<key>), and everything a customer does with an
-- order (see it, approve the quote, message you, review it) needs that key. An email address alone opens nothing.
-- A customer who lost their links asks for them by email; only the address on the order receives them.
-- Earlier, longer keys (old_access_token) keep working so links already sent still open.
--
-- When a customer taps "Looks good" the order moves straight to Confirmed & Printing, which sends them the
-- deposit request (turn this off in Settings > Show or hide: "Send the deposit request automatically").

-- 1. A key for every order, new and old. A key can't be changed afterwards, and it is copied into the
--    order's data (as accessToken) so the email script can build links from the order it is given.
create schema if not exists private;

create or replace function private.new_order_key()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  out text := '';
  i int;
begin
  for i in 0..11 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return out;
end;
$$;

alter table public.jobs add column if not exists access_token text;
alter table public.jobs add column if not exists old_access_token text;
alter table public.jobs alter column access_token drop default;

create or replace function private.keep_access_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.access_token := old.access_token;
    new.old_access_token := old.old_access_token;
  elsif coalesce(new.access_token, '') = '' then
    new.access_token := private.new_order_key();
  end if;
  new.data := new.data::jsonb || jsonb_build_object('accessToken', new.access_token);
  return new;
end;
$$;

drop trigger if exists keep_access_token on public.jobs;
create trigger keep_access_token
  before insert or update on public.jobs
  for each row execute function private.keep_access_token();

-- Orders with no key, or with an earlier long key, get a 12-character key (the long one is kept so old links still open).
alter table public.jobs disable trigger keep_access_token;
update public.jobs j
  set old_access_token = case when length(coalesce(j.access_token, '')) > 12 then j.access_token else j.old_access_token end,
      access_token = k.key,
      data = j.data::jsonb || jsonb_build_object('accessToken', k.key)
  from (select id, private.new_order_key() as key from public.jobs where coalesce(access_token, '') = '' or length(access_token) > 12) k
  where j.id = k.id;
alter table public.jobs enable trigger keep_access_token;

alter table public.jobs alter column access_token set not null;
create unique index if not exists jobs_access_token_key on public.jobs (access_token);
create index if not exists jobs_old_access_token_key on public.jobs (old_access_token) where old_access_token is not null;

-- Make sure every order's data carries its key too.
alter table public.jobs disable trigger keep_access_token;
update public.jobs set data = data::jsonb || jsonb_build_object('accessToken', access_token)
  where coalesce(data->>'accessToken', '') is distinct from access_token;
alter table public.jobs enable trigger keep_access_token;

-- 2. Close the old email-only doors.
drop function if exists public.customer_jobs(text);
drop function if exists public.customer_approve_quote(text, text);
drop function if exists public.customer_messages(text, text);
drop function if exists public.customer_send_message(text, text, text);
drop function if exists public.submit_review(text, text, text, text, int, text[]);
drop function if exists public.submit_job(jsonb);

-- 3. Customer: submit a new request. Inserts only, so existing orders can't be overwritten.
--    Returns the new order's key, so the customer's browser can open it straight away.
create or replace function public.submit_job(job jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare tok text;
begin
  if coalesce(job->>'id', '') !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'invalid id';
  end if;
  if coalesce(job->>'phase', 'estimate') <> 'estimate'
     or coalesce(job->>'paymentStatus', 'unpaid') <> 'unpaid'
     or coalesce(job->>'customerApprovedAt', '') <> ''
     or coalesce(job->>'clientEmail', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or jsonb_typeof(job->'items') <> 'array'
     or length(job::text) > 200000 then
    raise exception 'invalid request';
  end if;
  -- Prices, charges and order records are the owner's to set, never the customer's.
  job := job - array['extraCharges', 'rates', 'specialOrderCost', 'designTerms', 'stockTaken', 'paidAt', 'finishedPhotos', 'ownerEditedAt', 'depositAt', 'depositAmount', 'customerApprovedAt', 'status', 'accessToken'];
  job := jsonb_set(job, '{items}', coalesce((select jsonb_agg(case when jsonb_typeof(it) = 'object' then it - 'ownerPrice' else it end order by n)
    from jsonb_array_elements(job->'items') with ordinality as e(it, n)), '[]'::jsonb));
  insert into public.jobs (id, data)
  select r.id, r.data
  from jsonb_populate_record(null::public.jobs, jsonb_build_object('id', job->>'id', 'data', job)) r
  returning access_token into tok;
  return tok;
end;
$$;

-- 4. Customer: the orders that go with the keys their browser holds (at most 25 at a time).
create or replace function public.customer_orders(p_tokens text[])
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select data::jsonb
  from public.jobs
  where access_token = any (p_tokens[1:25]) or old_access_token = any (p_tokens[1:25])
  order by created_at;
$$;

-- 5. Customer: approve their own quote ("Looks good"). Only works while the order is at "Quote Sent". Unless the
--    owner switched it off, the order moves straight to Confirmed & Printing, which emails the deposit request.
create or replace function public.customer_approve_quote(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  auto boolean := coalesce((select (data->'features'->>'autoDeposit') is distinct from 'false' from public.site_settings where id = 1), true);
  stamp text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  update public.jobs
  set data = data::jsonb || jsonb_build_object('customerApprovedAt', stamp)
    || case when auto then jsonb_build_object('phase', 'order_received',
         'phaseHistory', coalesce(data->'phaseHistory', '{}'::jsonb) || jsonb_build_object('order_received', stamp))
       else '{}'::jsonb end
  where (access_token = p_token or old_access_token = p_token)
    and data->>'phase' = 'quote_sent'
    and coalesce(data->>'customerApprovedAt', '') = '';
end;
$$;

-- 6. Customer: the messages on their order, and sending one (at most 20 a day per order).
create or replace function public.customer_messages(p_token text)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', m.id, 'sender', m.sender, 'via', m.via, 'subject', m.subject, 'body', m.body, 'at', m.created_at)
  from public.order_messages m
  join public.jobs j on j.id::text = m.job_id
  where (j.access_token = p_token or j.old_access_token = p_token)
  order by m.created_at, m.id;
$$;

create or replace function public.customer_send_message(p_token text, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare jid text;
begin
  if length(trim(coalesce(p_body, ''))) < 1 or length(p_body) > 5000 then
    raise exception 'message must be 1 to 5000 characters';
  end if;
  select id::text into jid from public.jobs where access_token = p_token or old_access_token = p_token;
  if jid is null then
    raise exception 'order not found';
  end if;
  if (select count(*) from public.order_messages where job_id = jid and sender = 'customer'
      and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many messages today';
  end if;
  insert into public.order_messages (job_id, sender, via, body) values (jid, 'customer', 'site', trim(p_body));
end;
$$;

-- 7. Customer: review a delivered order, once; they can rewrite it until the owner has looked at it.
create or replace function public.submit_review(p_token text, p_name text, p_text text, p_rating int, p_photos text[] default '{}')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare ph text; jid text;
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
  select id::text into jid from public.jobs where (access_token = p_token or old_access_token = p_token) and data->>'phase' = 'delivered';
  if jid is null then
    raise exception 'order not found';
  end if;
  insert into public.customer_reviews (job_id, name, text, rating, photos)
  values (jid, trim(coalesce(p_name, '')), trim(p_text), p_rating, coalesce(p_photos, '{}'))
  on conflict (job_id) do update
    set name = excluded.name, text = excluded.text, rating = excluded.rating, photos = excluded.photos, created_at = now()
    where customer_reviews.status = 'new';
end;
$$;

-- 8. "Email me my links": for a customer who lost them. Always answers the same, so it can't be used to learn
--    which addresses have orders. At most one email per address per hour and 300 a day in all; the email
--    script sends it, and only to the address that is on the orders.
create table if not exists public.link_requests (
  id bigint generated always as identity primary key,
  email text not null,
  created_at timestamptz not null default now()
);
create index if not exists link_requests_email on public.link_requests (email, created_at);
alter table public.link_requests enable row level security;
revoke all on public.link_requests from anon, authenticated;

create or replace function public.request_order_links(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare addr text := lower(trim(coalesce(p_email, '')));
begin
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(addr) > 200 then return; end if;
  if not exists (select 1 from public.jobs where lower(data->>'clientEmail') = addr) then return; end if;
  if exists (select 1 from public.link_requests where email = addr and created_at > now() - interval '1 hour') then return; end if;
  if (select count(*) from public.link_requests where created_at > now() - interval '1 day') >= 300 then return; end if;
  insert into public.link_requests (email) values (addr);
end;
$$;

-- Email script only (needs the shared secret): the orders (with their keys) behind one email address.
create or replace function public.order_links_for_email(p_secret text, p_email text)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare expected text;
begin
  select secret into expected from private.email_settings where id = 1;
  if expected is null or length(expected) < 20 or p_secret is distinct from expected then
    raise exception 'forbidden';
  end if;
  return query
    select data::jsonb
    from public.jobs
    where lower(data->>'clientEmail') = lower(trim(coalesce(p_email, '')))
    order by created_at desc
    limit 20;
end;
$$;

create or replace function private.send_order_links()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare cfg private.email_settings;
begin
  select * into cfg from private.email_settings where id = 1;
  if cfg.webhook_url is null or cfg.webhook_url not like 'https://%' then
    return new;
  end if;
  perform net.http_post(
    url := cfg.webhook_url,
    body := jsonb_build_object('secret', cfg.secret, 'type', 'LINKS', 'email', new.email),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
  return new;
end;
$$;

drop trigger if exists send_order_links on public.link_requests;
create trigger send_order_links
  after insert on public.link_requests
  for each row execute function private.send_order_links();

-- 9. Who may call what.
revoke all on function public.submit_job(jsonb) from public;
revoke all on function public.customer_orders(text[]) from public;
revoke all on function public.customer_approve_quote(text) from public;
revoke all on function public.customer_messages(text) from public;
revoke all on function public.customer_send_message(text, text) from public;
revoke all on function public.submit_review(text, text, text, int, text[]) from public;
revoke all on function public.request_order_links(text) from public;
revoke all on function public.order_links_for_email(text, text) from public;
grant execute on function public.submit_job(jsonb) to anon, authenticated;
grant execute on function public.customer_orders(text[]) to anon, authenticated;
grant execute on function public.customer_approve_quote(text) to anon, authenticated;
grant execute on function public.customer_messages(text) to anon, authenticated;
grant execute on function public.customer_send_message(text, text) to anon, authenticated;
grant execute on function public.submit_review(text, text, text, int, text[]) to anon, authenticated;
grant execute on function public.request_order_links(text) to anon, authenticated;
grant execute on function public.order_links_for_email(text, text) to anon;
