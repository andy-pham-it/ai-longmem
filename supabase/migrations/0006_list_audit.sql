-- longmem list/audit: list every entry across scopes and statuses.
-- NULL parameter means "no filter"; p_status='all' means no status filter.
-- This is an explicit audit path: sensitive rows are returned and marked by the client.

create or replace function public.longmem_list(
  p_scope text default null,
  p_project_key text default null,
  p_kind text default null,
  p_tag text default null,
  p_status text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  scope text,
  project_key text,
  kind text,
  title text,
  trigger text,
  status text,
  pinned boolean,
  sensitive boolean,
  reinforced_count integer,
  recall_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    m.id,
    m.scope,
    m.project_key,
    m.kind,
    m.title,
    m.trigger,
    m.status,
    m.pinned,
    m.sensitive,
    m.reinforced_count,
    m.recall_count,
    m.created_at,
    m.updated_at
  from public.memories m
  where (p_scope is null or m.scope = p_scope)
    and (p_project_key is null or m.project_key = p_project_key)
    and (p_kind is null or m.kind = p_kind)
    and (p_tag is null or p_tag = any(m.tags))
    and (p_status is null or p_status = 'all' or m.status = p_status)
  order by m.pinned desc, m.updated_at desc
  limit greatest(1, least(p_limit, 500));
$$;
