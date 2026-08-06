-- 0018 — run-chain locking + idempotent round-close artifacts (field fix, 2026-08-06).
--
-- Field incident: a dev run produced TWO sentiment events per round with
-- diverging distributions. Two engine chains drove the same run concurrently:
-- every entrance (launch, /run/continue, the reaper, LiveRun's auto-reclaim)
-- did read-check-then-write on run_state.worker, and a live worker never
-- re-checked ownership — its heartbeat blindly overwrote run_state, so twin
-- chains kept each other alive and both polled the crowd. Duplicate posts
-- were silently swallowed by posts(sim_id, seq) UNIQUE; events had no key,
-- so both polls persisted.
--
-- Two DB-enforced guarantees:
--   1. claim_run(): one atomic compare-and-swap on run_state.worker — every
--      entrance and every worker write goes through it, so exactly one chain
--      can drive a run and a usurped worker finds out on its next write.
--   2. events.dedupe_key: round-close artifacts (sentiment/coverage/agenda)
--      carry a per-round key under a UNIQUE index — a second chain's
--      duplicate lands on the index and is dropped (ON CONFLICT DO NOTHING),
--      instead of trusting each chain's in-memory polledRounds set.

alter table events add column dedupe_key text;

-- NULLs are distinct: unkeyed events (stage/tool/votes — votes dedupe in
-- post_votes) stay unlimited; keyed artifacts are once per sim per key.
create unique index events_sim_dedupe on events (sim_id, dedupe_key);

-- The chain lock. SECURITY INVOKER on purpose: the launcher's RLS client and
-- the admin client both call it — org policies (sim_all) gate the user path.
-- p_run_state MERGES over the existing run_state (callers pass exactly the
-- keys they own — merge is why a heartbeat write can never clobber a
-- concurrent stop_requested); NULL p_run_state clears it (finalize).
create or replace function claim_run(
  p_sim_id uuid,
  p_expected_worker text,
  p_run_state jsonb,
  p_status text default 'running',
  p_config_patch jsonb default '{}'::jsonb
) returns boolean
language sql volatile as $$
  with claimed as (
    update simulations set
      status = p_status,
      config = case
        when p_run_state is null
          then (coalesce(config, '{}'::jsonb) || p_config_patch)
               || jsonb_build_object('run_state', null)
        else jsonb_set(
          coalesce(config, '{}'::jsonb) || p_config_patch,
          '{run_state}',
          (case when jsonb_typeof(config->'run_state') = 'object'
                then config->'run_state' else '{}'::jsonb end) || p_run_state
        )
      end
    where id = p_sim_id
      and (config->'run_state'->>'worker') is not distinct from p_expected_worker
    returning 1
  )
  select count(*) > 0 from claimed;
$$;
