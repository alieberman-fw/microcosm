-- Per-participant model tier in Conversations: { "<personaKey>": "<model id>" }.
-- Missing keys ride the default (Haiku tier). Set via the thread-header toggle.
alter table conversations
  add column if not exists model_overrides jsonb not null default '{}'::jsonb;
