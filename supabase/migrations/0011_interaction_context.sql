-- Monitoring depth: interactions carry their simulation + a small context
-- payload (problem snippet, seat counts, guidance) so expanded rows can show
-- what a casting/corpus call actually did and deep-link to the simulation.
alter table agent_interactions add column if not exists sim_id uuid references simulations(id) on delete set null;
alter table agent_interactions add column if not exists detail jsonb;
