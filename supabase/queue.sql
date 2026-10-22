-- SoloPrint: the order queue customers see ("3 orders ahead, about 4-7 days").
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Run after the other files (security.sql ... drafts.sql).

-- Confirmed and printing orders, oldest first, with only what the wait estimate needs: when each was
-- confirmed, whether it's printing now, and whether it includes a custom design. No names, emails,
-- items or prices, so anyone can call it.
create or replace function public.order_queue()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(q order by q->>'at'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'at', coalesce(nullif(data->'phaseHistory'->>'order_received', ''), to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      'printing', data->>'phase' = 'production',
      'custom', coalesce(nullif(data->>'designTerms', ''), '') <> ''
                or exists (select 1 from jsonb_array_elements(coalesce(data->'items', '[]'::jsonb)) it where it->>'mode' = 'idea')
    ) as q
    from public.jobs
    where data->>'phase' in ('order_received', 'production')
  ) rows;
$$;

revoke all on function public.order_queue() from public;
grant execute on function public.order_queue() to anon, authenticated;
