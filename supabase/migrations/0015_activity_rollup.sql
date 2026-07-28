-- Server-side activity rollup for Home + Monitoring analytics.
--
-- WHY: PostgREST caps any response at 1,000 rows. Both dashboards used to
-- fetch raw agent_interactions rows (newest first) and aggregate client-side
-- — one heavy day (>1,000 calls) filled the entire window and every earlier
-- day rendered as zero ("my history is missing"). Aggregation belongs in SQL.
--
-- SECURITY INVOKER (the default): RLS applies AND the org filter is explicit.

create or replace function public.activity_rollup(p_days int default 14)
returns table (
  day date,
  model text,
  surface text,
  calls bigint,
  tokens_in bigint,
  tokens_out bigint,
  errors bigint,
  latency_ms_sum bigint
)
language sql
stable
as $$
  select
    (ai.created_at at time zone 'utc')::date as day,
    ai.model,
    ai.surface,
    count(*)                                        as calls,
    coalesce(sum(ai.input_tokens), 0)               as tokens_in,
    coalesce(sum(ai.output_tokens), 0)              as tokens_out,
    count(*) filter (where ai.status <> 'ok')       as errors,
    coalesce(sum(ai.latency_ms), 0)                 as latency_ms_sum
  from agent_interactions ai
  where ai.org_id = public.user_org()
    and ai.created_at >= (now() - make_interval(days => greatest(p_days, 1)))
  group by 1, 2, 3
  order by 1
$$;

grant execute on function public.activity_rollup(int) to authenticated;
