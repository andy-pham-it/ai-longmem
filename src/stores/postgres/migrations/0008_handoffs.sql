create table if not exists handoffs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  summary text not null,
  next text,
  blocked text,
  context text,
  task_ref jsonb,
  scope text not null check (scope in ('global','project')),
  project_key text,
  status text not null default 'active' check (status in ('active','completed','expired'))
);
create index if not exists handoffs_latest_idx on handoffs (scope, project_key, status, expires_at desc);