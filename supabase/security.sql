-- SoloPrint database rules. Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run.
--
-- After this runs:
--   * Only the signed-in owner account can read, edit or delete orders directly.
--   * Visitors (the public key in index.html) can only call the customer functions in order-links.sql
--     (submit a request, open an order with its private link, approve a quote, message, review).
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

-- 2. Customer functions (submit a request, see an order, approve a quote, message, review) are in
-- order-links.sql. Run it after all the other files: customers get in with a long private link, never an email.
