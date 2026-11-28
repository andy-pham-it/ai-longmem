create table if not exists public.handoffs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  summary text not null check (length(summary) between 1 and 500),
  next text,
  blocked text,
  context text,
  task_ref jsonb,
  scope text not null check (scope in ('global','project')),
  project_key text,
  status text not null default 'active' check (status in ('active','completed','expired')),
  check (scope = 'global' or project_key is not null),
  check (scope = 'project' or project_key is null)
);

create index if not exists handoffs_latest_idx on public.handoffs (scope, project_key, status, expires_at desc);

alter table public.handoffs enable row level security;
revoke all on public.handoffs from anon, authenticated;