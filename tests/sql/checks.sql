-- Each block raises an exception (failing the run) if a rule doesn't hold.
\set ON_ERROR_STOP 1
create function pg_temp.expect_denied(sql text, what text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'ALLOWED but should be denied: %', what;
exception when insufficient_privilege or raise_exception or check_violation or unique_violation then
  if sqlerrm like 'ALLOWED but should be denied%' then raise; end if;
end $$;
grant execute on function pg_temp.expect_denied(text, text) to anon, authenticated;

-- Visitors (anon)
set role anon;
select pg_temp.expect_denied('select count(*) from public.jobs', 'anon reading jobs');
select pg_temp.expect_denied('delete from public.jobs', 'anon deleting jobs');
select pg_temp.expect_denied($q$select public.submit_job('{"id":"100","clientEmail":"x@y.com","items":[]}')$q$, 'overwriting an order through submit_job');
select pg_temp.expect_denied($q$select public.submit_job('{"id":"301","clientEmail":"x@y.com","paymentStatus":"payment_recieved","items":[]}')$q$, 'submitting an already-paid order');
select pg_temp.expect_denied($q$select public.submit_job('{"id":"302","clientEmail":"x@y.com","phase":"delivered","items":[]}')$q$, 'submitting a delivered order');
select pg_temp.expect_denied($q$insert into public.model_library (key, data) values ('x', '{}')$q$, 'anon writing saved models');
select pg_temp.expect_denied($q$insert into public.gallery_items (id) values ('x')$q$, 'anon writing gallery');
select pg_temp.expect_denied($q$select public.backup_export('wrong-secret')$q$, 'backup with a wrong secret');
select pg_temp.expect_denied('select * from private.email_settings', 'anon reading the email secret');
select public.submit_job('{"id":"300","clientName":"Sam","clientEmail":"sam@example.com","phase":"estimate","paymentStatus":"unpaid","items":[]}');
do $$ begin
  if (select count(*) from public.customer_jobs('JANE@example.com')) <> 1 then raise exception 'exact email lookup should return 1 order'; end if;
  if (select count(*) from public.customer_jobs('%@%.%')) <> 0 then raise exception 'wildcard email lookup returned orders'; end if;
end $$;
select public.customer_approve_quote('100', 'bob@example.com');
do $$ begin if exists (select 1 from public.customer_jobs('jane@example.com') d where d->>'customerApprovedAt' <> '') then raise exception 'another email approved Jane''s quote'; end if; end $$;
select public.customer_approve_quote('100', 'jane@example.com');
do $$ begin if not exists (select 1 from public.customer_jobs('jane@example.com') d where d->>'customerApprovedAt' <> '') then raise exception 'Jane could not approve her own quote'; end if; end $$;
do $$ begin if (select count(*) from public.model_library) < 0 then raise exception 'unreachable'; end if; end $$;
do $$ begin
  if jsonb_typeof(public.backup_export('0123456789abcdef0123456789abcdef')->'jobs') <> 'array' then raise exception 'backup with the right secret failed'; end if;
end $$;
reset role;

-- Another signed-in account
set role authenticated;
set request.jwt.claims = '{"email":"stranger@example.com"}';
do $$ begin if (select count(*) from public.jobs) <> 0 then raise exception 'a stranger account can read orders'; end if; end $$;
update public.jobs set data = '{}';
update public.model_library set data = '{}';
reset role;
do $$ begin if exists (select 1 from public.jobs where data = '{}'::jsonb) then raise exception 'a stranger account changed orders'; end if; end $$;

-- The owner
set role authenticated;
set request.jwt.claims = '{"email":"jeffsolo49@gmail.com"}';
do $$ begin if (select count(*) from public.jobs) <> 3 then raise exception 'owner should see all 3 orders'; end if; end $$;
insert into public.model_library (key, data) values ('name:benchy', '{"name":"Benchy","minutes":90,"grams":20}');
insert into public.gallery_items (id, data, published) values ('g1', '{"title":"Shown"}', true), ('g2', '{"title":"Hidden"}', false);
insert into storage.objects (bucket_id, name) values ('gallery', 'g1/a.jpg');
reset role;
set role anon;
do $$ begin
  if (select count(*) from public.gallery_items) <> 1 then raise exception 'visitors should see only published gallery items'; end if;
  if (select count(*) from public.model_library) <> 1 then raise exception 'visitors should be able to read saved models'; end if;
end $$;
select pg_temp.expect_denied($q$insert into storage.objects (bucket_id, name) values ('gallery', 'evil.jpg')$q$, 'anon uploading photos');
reset role;

-- Email trigger: new orders, stage changes and approvals call the script; other edits don't.
do $$ begin
  if (select count(*) from net.calls) <> 2 then raise exception 'expected 2 email calls (new order + approval), got %', (select count(*) from net.calls); end if;
end $$;
-- Site settings: anyone reads, only the owner writes.
set role authenticated;
set request.jwt.claims = '{"email":"jeffsolo49@gmail.com"}';
insert into public.site_settings (id, data) values (1, '{"about":{"text":"Hi"}}') on conflict (id) do update set data = excluded.data;
reset role;
set role anon;
do $$ begin if (select data->'about'->>'text' from public.site_settings where id = 1) <> 'Hi' then raise exception 'visitors cannot read site settings'; end if; end $$;
select pg_temp.expect_denied($q$update public.site_settings set data = '{}'$q$, 'anon changing site settings');
reset role;
set role authenticated;
set request.jwt.claims = '{"email":"stranger@example.com"}';
update public.site_settings set data = '{}';
reset role;
do $$ begin if (select data->'about'->>'text' from public.site_settings where id = 1) <> 'Hi' then raise exception 'a stranger account changed site settings'; end if; end $$;

-- Quote reminders: one reminder per old, unapproved quote; never for recent or approved ones.
insert into public.jobs (id, data) values
  ('r-old',  jsonb_build_object('id','r-old','clientEmail','a@example.com','phase','quote_sent','phaseHistory', jsonb_build_object('quote_sent', (now() - interval '5 days')::text))),
  ('r-new',  jsonb_build_object('id','r-new','clientEmail','b@example.com','phase','quote_sent','phaseHistory', jsonb_build_object('quote_sent', (now() - interval '1 day')::text))),
  ('r-done', jsonb_build_object('id','r-done','clientEmail','c@example.com','phase','quote_sent','customerApprovedAt','2026-01-01T00:00:00Z','phaseHistory', jsonb_build_object('quote_sent', (now() - interval '9 days')::text)));
create temp table calls_before as select count(*) as n from net.calls;
grant select on calls_before to anon;
set role anon;
select pg_temp.expect_denied($q$select public.due_quote_reminders('wrong-secret')$q$, 'reminders with a wrong secret');
do $$ declare ids text; begin
  select string_agg(d->>'id', ',' order by d->>'id') into ids from public.due_quote_reminders('0123456789abcdef0123456789abcdef') d;
  if ids is distinct from 'r-old' then raise exception 'first reminder run should return only r-old, got %', ids; end if;
  if (select count(*) from public.due_quote_reminders('0123456789abcdef0123456789abcdef')) <> 0 then raise exception 'a quote was reminded twice'; end if;
end $$;
reset role;
do $$ begin if (select count(*) from net.calls) <> (select n from calls_before) then raise exception 'marking a reminder should not send an order email'; end if; end $$;

\echo 'All SQL checks passed.'
