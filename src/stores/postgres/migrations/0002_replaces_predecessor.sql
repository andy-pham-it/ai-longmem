-- 0002: `replaces` must point at the entry this row superseded.
--
-- 0001 joined `rep.id = m.superseded_by`, i.e. the successor of the row being
-- returned. Since the query only returns active rows and superseding sets
-- superseded_by on the retired row, that join could never match: `replaces`
-- was dead code and recall silently hid that a claim had changed.
--
-- Reading the field from the entry's point of view ("this entry replaces X")
-- matches the name and is what a reader needs: the predecessor is the only
-- history reachable from a live row.

create or replace function public.longmem_search(
  p_query text,
  p_project_key text default null,
  p_k integer default 5,
  p_kinds text[] default null,
  p_tags text[] default null,
  p_by text default 'recall'
)
returns table (
  id uuid,
  scope text,
  project_key text,
  kind text,
  title text,
  trigger text,
  body text,
  tags text[],
  status text,
  superseded_by uuid,
  pinned boolean,
  sensitive boolean,
  source text,
  agent_session text,
  reinforced_count integer,
  last_reinforced_at timestamptz,
  recall_count integer,
  last_recalled_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  score real,
  replaces_id uuid,
  replaces_title text,
  replaces_created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with q as (
    select lower(public.unaccent(coalesce(p_query, ''))) as qtext
  )
  select
    m.id,
    m.scope,
    m.project_key,
    m.kind,
    m.title,
    m.trigger,
    m.body,
    m.tags,
    m.status,
    m.superseded_by,
    m.pinned,
    m.sensitive,
    m.source,
    m.agent_session,
    m.reinforced_count,
    m.last_reinforced_at,
    m.recall_count,
    m.last_recalled_at,
    m.created_at,
    m.updated_at,
    case
      when p_by = 'related'
        then similarity(lower(public.unaccent(m.trigger)), q.qtext)
      else similarity(m.search_text, q.qtext)
    end as score,
    rep.id as replaces_id,
    rep.title as replaces_title,
    rep.created_at as replaces_created_at
  from public.memories m
  cross join q
  left join lateral (
    select p.id, p.title, p.created_at
    from public.memories p
    where p.superseded_by = m.id
    order by p.created_at desc
    limit 1
  ) rep on true
  where m.status = 'active'
    and (m.scope = 'global' or m.project_key = p_project_key)
    and (p_kinds is null or m.kind = any (p_kinds))
    and (p_tags is null or m.tags && p_tags)
  order by score desc, m.reinforced_count desc, m.updated_at desc
  limit greatest(1, least(coalesce(p_k, 5), 50))
$$;
