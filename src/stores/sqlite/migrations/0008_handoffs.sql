create table if not exists handoffs (
  id text primary key,
  created_at text not null,
  expires_at text not null,
  summary text not null,
  next text,
  blocked text,
  context text,
  task_ref text,
  scope text not null check (scope in ('global','project')),
  project_key text,
  status text not null default 'active' check (status in ('active','completed','expired'))
);
create index if not exists handoffs_latest_idx on handoffs (scope, project_key, status, expires_at desc);