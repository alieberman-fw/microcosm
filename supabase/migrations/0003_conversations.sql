-- Conversations: persistent direct chats with personas (1:1 and group).
-- Distinct from simulations: conversations are user-driven, iMessage-style.

create table conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  created_by uuid references users(id),
  title text not null default 'New conversation',
  participant_keys text[] not null default '{}',   -- library keys (e.g. 'RM') or custom persona UUIDs
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table conversation_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'agent')),
  agent_key text,                                   -- which persona spoke (null for user)
  agent_name text,
  content text not null,
  created_at timestamptz not null default now()
);

create index conv_msgs_by_conv on conversation_messages (conversation_id, id);

alter table conversations enable row level security;
alter table conversation_messages enable row level security;

create policy conv_all on conversations for all
  using (org_id = public.user_org()) with check (org_id = public.user_org());

create policy convmsg_all on conversation_messages for all
  using (conversation_id in (select id from conversations where org_id = public.user_org()))
  with check (conversation_id in (select id from conversations where org_id = public.user_org()));
