-- SoloPrint database rules. Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run.
--
-- After this runs:
--   * Only the signed-in owner account can read, edit or delete orders directly.
--   * Visitors (the public key in index.html) can only call the three functions below:
--     submit a new request, look up orders for an exact email, and approve their own quote.
--
-- Before running, create the owner login: Dashboard -> Authentication -> Users -> Add user,
-- email jeffsolo49@gmail.com, a new password, and tick "Auto Confirm User".
-- Then turn off new sign-ups: Authentication -> Sign In / Providers -> uncheck "Allow new users to sign up".

-- 1. Lock the table down and remove any existing open policies.
alter table public.jobs enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'jobs' loop
    execute format('drop policy %I on public.jobs', p.policyname);
  end loop;
end $$;

revoke all on public.jobs from anon;
grant select, insert, update, delete on public.jobs to authenticated;

create policy "owner full access" on public.jobs
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'jeffsolo49@gmail.com');

-- 2. Customer: submit a new request. Inserts only, so existing orders can't be overwritten.
create or replace function public.submit_job(job jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(job->>'id', '') !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'invalid id';
  end if;
  if coalesce(job->>'phase', 'estimate') not in ('estimate', 'quote_sent')
     or coalesce(job->>'paymentStatus', 'unpaid') not in ('unpaid', 'payment_requested')
     or coalesce(job->>'customerApprovedAt', '') <> ''
     or coalesce(job->>'clientEmail', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or jsonb_typeof(job->'items') <> 'array'
     or length(job::text) > 200000 then
    raise exception 'invalid request';
  end if;
  -- Prices, charges and order records are the owner's to set, never the customer's.
  job := job - array['extraCharges', 'rates', 'specialOrderCost', 'designTerms', 'stockTaken', 'paidAt', 'finishedPhotos', 'ownerEditedAt', 'depositAt', 'depositAmount'];
  job := jsonb_set(job, '{items}', coalesce((select jsonb_agg(case when jsonb_typeof(it) = 'object' then it - 'ownerPrice' else it end order by n)
    from jsonb_array_elements(job->'items') with ordinality as e(it, n)), '[]'::jsonb));
  insert into public.jobs (id, data)
  select r.id, r.data
  from jsonb_populate_record(null::public.jobs, jsonb_build_object('id', job->>'id', 'data', job)) r;
end;
$$;

-- 3. Customer: orders for one exact email address (no wildcards).
create or replace function public.customer_jobs(email text)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select data::jsonb
  from public.jobs
  where length(trim(email)) > 3
    and lower(data->>'clientEmail') = lower(trim(email))
  order by created_at;
$$;

-- 4. Customer: approve their own quote. Only works while the order is at "Quote Sent".
create or replace function public.customer_approve_quote(job_id text, email text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.jobs
  set data = jsonb_set(data::jsonb, '{customerApprovedAt}',
                       to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
  where id::text = job_id
    and lower(data->>'clientEmail') = lower(trim(email))
    and data->>'phase' = 'quote_sent'
    and coalesce(data->>'customerApprovedAt', '') = '';
$$;

revoke all on function public.submit_job(jsonb) from public;
revoke all on function public.customer_jobs(text) from public;
revoke all on function public.customer_approve_quote(text, text) from public;
grant execute on function public.submit_job(jsonb) to anon, authenticated;
grant execute on function public.customer_jobs(text) to anon, authenticated;
grant execute on function public.customer_approve_quote(text, text) to anon, authenticated;
