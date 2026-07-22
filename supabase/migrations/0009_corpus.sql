-- Corpus v1 (CLAUDE.md §2 Stage 2): documents carry Anthropic Files API ids so
-- agents consume whole docs directly (native document blocks + citations +
-- prompt caching); doc_chunks gains FTS as the retrieval substrate for the
-- verifier pass and large-corpus mode. Embeddings stay dormant until a
-- provider key lands (pgvector column already exists).

alter table documents add column if not exists size_bytes bigint;
alter table documents add column if not exists mime text;
alter table documents add column if not exists anthropic_file_id text;
alter table documents add column if not exists token_estimate int;
alter table documents add column if not exists page_count int;
alter table documents add column if not exists parse_error text;
alter table documents add column if not exists created_by uuid references users(id);

alter table doc_chunks add column if not exists seq int not null default 0;
alter table doc_chunks add column if not exists search tsvector
  generated always as (to_tsvector('english', left(content, 20000))) stored;
create index if not exists doc_chunks_search_idx on doc_chunks using gin (search);
create index if not exists doc_chunks_document_idx on doc_chunks (document_id, seq);

-- app routes write chunks under the user's session (RLS), not service role
create policy chunk_write on doc_chunks for insert
  with check (document_id in (select id from documents where project_id in
    (select id from projects where org_id = public.user_org())));
create policy chunk_delete on doc_chunks for delete
  using (document_id in (select id from documents where project_id in
    (select id from projects where org_id = public.user_org())));
