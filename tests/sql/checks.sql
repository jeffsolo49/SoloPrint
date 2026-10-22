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

-- Private owner data: only the owner can read or write it.
set role anon;
select pg_temp.expect_denied('select count(*) from public.owner_private', 'anon reading private owner data');
select pg_temp.expect_denied($q$insert into public.owner_private (key, data) values ('notes', '{}')$q$, 'anon writing private owner data');
select pg_temp.expect_denied('select count(*) from public.customer_reviews', 'anon reading unapproved reviews');
reset role;
set role authenticated;
set request.jwt.claims = '{"email":"stranger@example.com"}';
do $$ begin if (select count(*) from public.owner_private) <> 0 then raise exception 'unreachable'; end if; end $$;
select pg_temp.expect_denied($q$insert into public.owner_private (key, data) values ('notes', '{}')$q$, 'a stranger writing private owner data');
reset role;
set role authenticated;
set request.jwt.claims = '{"email":"jeffsolo49@gmail.com"}';
insert into public.owner_private (key, data) values ('notes', '{"100":"secret note"}') on conflict (key) do update set data = excluded.data;
reset role;
set role authenticated;
set request.jwt.claims = '{"email":"stranger@example.com"}';
do $$ begin if (select count(*) from public.owner_private) <> 0 then raise exception 'a stranger account can read private owner data'; end if; end $$;
reset role;
do $$ begin if exists (select 1 from public.customer_jobs('jane@example.com') d where d::text like '%secret note%') then raise exception 'private notes leaked into customer orders'; end if; end $$;

-- Reviews: only for the customer's own delivered order; reviewing doesn't touch the order.
insert into public.jobs (id, data) values
  ('d-1', jsonb_build_object('id','d-1','clientEmail','dee@example.com','phase','delivered','phaseHistory', jsonb_build_object('delivered', (now() - interval '8 days')::text))),
  ('d-2', jsonb_build_object('id','d-2','clientEmail','dee@example.com','phase','delivered','phaseHistory', jsonb_build_object('delivered', (now() - interval '2 days')::text))),
  ('d-3', jsonb_build_object('id','d-3','clientEmail','old@example.com','phase','delivered','phaseHistory', jsonb_build_object('delivered', (now() - interval '90 days')::text)));
create temp table calls_before_reviews as select count(*) as n from net.calls;
grant select on calls_before_reviews to anon;
set role anon;
select pg_temp.expect_denied($q$select public.submit_review('d-1', 'someone@example.com', 'X', 'Great print', 5)$q$, 'reviewing someone else''s order');
select pg_temp.expect_denied($q$select public.submit_review('100', 'jane@example.com', 'Jane', 'Great print', 5)$q$, 'reviewing an order that is not delivered');
select pg_temp.expect_denied($q$select public.submit_review('d-1', 'dee@example.com', 'Dee', 'x', 9)$q$, 'an invalid review');
select public.submit_review('d-2', 'DEE@example.com', 'Dee', 'Came out great', 5);
select pg_temp.expect_denied($q$select public.due_review_requests('wrong-secret')$q$, 'review requests with a wrong secret');
select pg_temp.expect_denied($q$select public.owner_report_data('wrong-secret')$q$, 'report data with a wrong secret');
do $$ declare ids text; begin
  select string_agg(d->>'id', ',' order by d->>'id') into ids from public.due_review_requests('0123456789abcdef0123456789abcdef') d;
  if ids is distinct from 'd-1' then raise exception 'review requests should return only d-1 (d-2 is too recent and reviewed, d-3 too old), got %', ids; end if;
  if (select count(*) from public.due_review_requests('0123456789abcdef0123456789abcdef')) <> 0 then raise exception 'a customer was asked for a review twice'; end if;
  if (public.owner_report_data('0123456789abcdef0123456789abcdef')->'private'->>'notes') is null then raise exception 'report data is missing private data'; end if;
  if (public.owner_report_data('0123456789abcdef0123456789abcdef')->>'new_reviews')::int <> 1 then raise exception 'report data should count 1 new review'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from net.calls) <> (select n from calls_before_reviews) then raise exception 'review requests should not send order emails'; end if;
  if (select text from public.customer_reviews where job_id = 'd-2') <> 'Came out great' then raise exception 'review not saved'; end if;
end $$;
update public.customer_reviews set status = 'approved' where job_id = 'd-2';
set role anon;
select public.submit_review('d-2', 'dee@example.com', 'Dee', 'Changed my mind', 1);
reset role;
do $$ begin if (select text from public.customer_reviews where job_id = 'd-2') <> 'Came out great' then raise exception 'an approved review was rewritten'; end if; end $$;

-- Drafts: customers save and clear through the functions only; reminders once, and not after a request.
set role anon;
select pg_temp.expect_denied('select count(*) from public.request_drafts', 'anon reading drafts');
select pg_temp.expect_denied($q$select public.save_request_draft('not-an-email', 'X', '{}')$q$, 'a draft without a valid email');
select public.save_request_draft('kim@example.com', 'Kim', '{"items":[{"notes":"phone stand"}]}');
select public.save_request_draft('KIM@example.com', 'Kim', '{"items":[{"notes":"phone stand, blue"}]}');
select public.save_request_draft('lou@example.com', 'Lou', '{"items":[{"notes":"hook"}]}');
reset role;
do $$ begin
  if (select count(*) from public.request_drafts) <> 2 then raise exception 'one draft per email expected'; end if;
  if (select data->'items'->0->>'notes' from public.request_drafts where lower(email) = 'kim@example.com') <> 'phone stand, blue' then raise exception 'draft not updated'; end if;
end $$;
update public.request_drafts set updated_at = now() - interval '8 days';
insert into public.jobs (id, data, created_at) values ('lou-1', '{"id":"lou-1","clientEmail":"lou@example.com","phase":"estimate","items":[]}', now() - interval '2 days');
create temp table draft_ids as select id from public.request_drafts where lower(email) = 'kim@example.com';
grant select on draft_ids to anon;
set role anon;
select pg_temp.expect_denied($q$select public.due_draft_reminders('wrong-secret')$q$, 'draft reminders with a wrong secret');
do $$ declare got text; begin
  select string_agg(d->>'clientEmail', ',') into got from public.due_draft_reminders('0123456789abcdef0123456789abcdef', 7) d;
  if got is distinct from 'KIM@example.com' and got is distinct from 'kim@example.com' then raise exception 'only Kim should be reminded (Lou sent a request), got %', got; end if;
  if (select count(*) from public.due_draft_reminders('0123456789abcdef0123456789abcdef', 7)) <> 0 then raise exception 'a draft was reminded twice'; end if;
  if (public.get_request_draft((select id from draft_ids)))->>'name' <> 'Kim' then raise exception 'resume link does not open the draft'; end if;
end $$;
select public.clear_request_draft('Kim@Example.com');
do $$ begin if public.get_request_draft((select id from draft_ids)) is not null then raise exception 'draft not cleared after sending'; end if; end $$;
reset role;

-- Order queue: anyone can see the line, but only timing and whether it's custom, never details.
insert into public.jobs (id, data) values
  ('q-1', jsonb_build_object('id','q-1','clientName','Secret Name','clientEmail','q1@example.com','phase','order_received','phaseHistory', jsonb_build_object('order_received','2026-10-01T10:00:00.000Z'),'items', jsonb_build_array(jsonb_build_object('name','Hook','mode','link')))),
  ('q-2', jsonb_build_object('id','q-2','clientEmail','q2@example.com','phase','production','phaseHistory', jsonb_build_object('order_received','2026-10-02T10:00:00.000Z'),'items', jsonb_build_array(jsonb_build_object('name','Thing','mode','idea'))));
set role anon;
do $$ declare q jsonb; begin
  q := public.order_queue();
  if jsonb_array_length(q) <> 2 then raise exception 'queue should list the 2 confirmed/printing orders, got %', q; end if;
  if q::text like '%Secret%' or q::text like '%example.com%' or q::text like '%Hook%' then raise exception 'queue leaks order details: %', q; end if;
  if (q->0->>'custom')::boolean or not (q->1->>'custom')::boolean or not (q->1->>'printing')::boolean then raise exception 'queue flags wrong: %', q; end if;
end $$;
reset role;


-- submit_job drops prices and charges only the owner sets
set role anon;
select public.submit_job('{"id":"303","clientEmail":"cut@example.com","extraCharges":[{"label":"Discount","amount":5}],"rates":{"baseFee":0},"specialOrderCost":0,"items":[{"name":"A","ownerPrice":0},{"name":"B"}]}');
do $$ declare d jsonb := (select d from public.customer_jobs('cut@example.com') d); begin
  if d ? 'extraCharges' or d ? 'rates' or d ? 'specialOrderCost' then raise exception 'submit_job kept owner-only fields'; end if;
  if d->'items'->0 ? 'ownerPrice' or d->'items'->0->>'name' <> 'A' or d->'items'->1->>'name' <> 'B' then raise exception 'submit_job kept an item price or lost item order: %', d->'items'; end if;
end $$;
reset role;

\echo 'All SQL checks passed.'
