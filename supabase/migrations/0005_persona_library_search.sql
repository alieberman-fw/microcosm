-- Persona library at scale (CLAUDE.md §3.3): full-text search over library
-- personas + the RPC behind /api/personas/search. Library rows are global
-- (org_id null, source 'library') and readable by every org via persona_read.

alter table personas add column if not exists search tsvector
  generated always as (
    to_tsvector('english',
      coalesce(spec->>'name','') || ' ' ||
      coalesce(spec->>'role','') || ' ' ||
      coalesce(spec->>'tagline','') || ' ' ||
      coalesce(spec->>'category','') || ' ' ||
      coalesce(spec->>'subgroup','') || ' ' ||
      coalesce(spec->>'discipline','') || ' ' ||
      coalesce(spec->>'skills','') || ' ' ||
      coalesce(spec->>'stances','') || ' ' ||
      coalesce(spec->'demographics'->>'occupation','') || ' ' ||
      coalesce(spec->'demographics'->>'metro','') || ' ' ||
      coalesce(spec->'demographics'->>'state','') || ' ' ||
      coalesce(spec->'demographics'->>'tenure','') || ' ' ||
      coalesce(spec->>'backstory','')
    )
  ) stored;

create index if not exists personas_search_idx on personas using gin (search);
create index if not exists personas_library_idx on personas (created_at)
  where org_id is null and source = 'library';

-- Invoker-rights (RLS applies). q uses websearch syntax ("data center OR grid").
create or replace function public.search_personas(
  q text default '',
  age_min int default null,
  age_max int default null,
  tenure_f text default null,
  kinds text[] default null,
  lim int default 60
) returns table (id uuid, kind text, spec jsonb, rank real)
language sql stable
set search_path = public
as $$
  select p.id, p.kind, p.spec,
    case when coalesce(q,'') = '' then 0::real
         else ts_rank(p.search, websearch_to_tsquery('english', q)) end as rank
  from personas p
  where p.org_id is null and p.source = 'library'
    and (coalesce(q,'') = '' or p.search @@ websearch_to_tsquery('english', q))
    and (age_min is null or ((p.spec->'demographics'->>'age') ~ '^\d+$'
         and (p.spec->'demographics'->>'age')::int >= age_min))
    and (age_max is null or ((p.spec->'demographics'->>'age') ~ '^\d+$'
         and (p.spec->'demographics'->>'age')::int <= age_max))
    and (tenure_f is null or p.spec->'demographics'->>'tenure' ilike '%' || tenure_f || '%')
    and (kinds is null or p.kind = any(kinds))
  order by rank desc, (p.spec->>'name')
  limit least(greatest(coalesce(lim, 60), 1), 200)
$$;
