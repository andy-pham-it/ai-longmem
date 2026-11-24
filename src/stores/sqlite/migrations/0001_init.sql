create table if not exists memories (
  id text primary key,
  scope text not null check (scope in ('global','project')),
  project_key text,
  kind text not null,
  title text not null,
  trigger text not null,
  body text not null,
  tags text not null default '[]',
  status text not null default 'active' check (status in ('active','superseded','archived')),
  superseded_by text,
  pinned integer not null default 0,
  sensitive integer not null default 0,
  source text,
  agent_session text,
  reinforced_count integer not null default 0,
  last_reinforced_at text,
  recall_count integer not null default 0,
  last_recalled_at text,
  created_at text not null,
  updated_at text not null
);

create table if not exists _longmem_migrations (
  name text primary key,
  applied_at text not null
);

create index if not exists memories_scope_project_idx on memories (scope, project_key);
create index if not exists memories_status_idx on memories (status);
