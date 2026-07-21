-- Agent Library filter rail + pagination: search_personas gains category
-- filter, sort modes, offset, and a windowed total; library_facets feeds the
-- filter dropdowns with counts. (Old 6-arg signature dropped to avoid
-- PostgREST overload ambiguity.)

drop function if exists public.search_personas(text, int, int, text, text[], int);

create or replace function public.search_personas(
  q text default '',
  age_min int default null,
  age_max int default null,
  tenure_f text default null,
  kinds text[] default null,
  cats text[] default null,
  sort text default 'relevance',   -- relevance | name | age_asc | age_desc | newest
  off_set int default 0,
  lim int default 24
) returns table (id uuid, kind text, spec jsonb, rank real, total bigint)
language sql stable
set search_path = public
as $$
  select p.id, p.kind, p.spec,
    case when coalesce(q,'') = '' then 0::real
         else ts_rank(p.search, websearch_to_tsquery('english', q)) end as rank,
    count(*) over() as total
  from personas p
  where p.org_id is null and p.source = 'library'
    and (coalesce(q,'') = '' or p.search @@ websearch_to_tsquery('english', q))
    and (age_min is null or ((p.spec->'demographics'->>'age') ~ '^\d+$'
         and (p.spec->'demographics'->>'age')::int >= age_min))
    and (age_max is null or ((p.spec->'demographics'->>'age') ~ '^\d+$'
         and (p.spec->'demographics'->>'age')::int <= age_max))
    and (tenure_f is null or p.spec->'demographics'->>'tenure' ilike '%' || tenure_f || '%')
    and (kinds is null or p.kind = any(kinds))
    and (cats is null or p.spec->>'category' = any(cats))
  order by
    case when sort = 'relevance' and coalesce(q,'') <> ''
      then ts_rank(p.search, websearch_to_tsquery('english', q)) end desc nulls last,
    case when sort = 'age_asc' and (p.spec->'demographics'->>'age') ~ '^\d+$'
      then (p.spec->'demographics'->>'age')::int end asc nulls last,
    case when sort = 'age_desc' and (p.spec->'demographics'->>'age') ~ '^\d+$'
      then (p.spec->'demographics'->>'age')::int end desc nulls last,
    case when sort = 'newest' then p.created_at end desc nulls last,
    (p.spec->>'name') asc
  offset greatest(coalesce(off_set, 0), 0)
  limit least(greatest(coalesce(lim, 24), 1), 200)
$$;

create or replace function public.library_facets()
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from personas where org_id is null and source = 'library'),
    'kinds', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'n', n) order by n desc), '[]'::jsonb)
      from (select kind, count(*) n from personas where org_id is null and source = 'library' group by 1) k
    ),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object('cat', cat, 'n', n) order by cat), '[]'::jsonb)
      from (select spec->>'category' cat, count(*) n from personas
            where org_id is null and source = 'library' and spec->>'category' is not null group by 1) c
    )
  )
$$;
