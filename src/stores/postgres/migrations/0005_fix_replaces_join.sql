-- v1 fix: restore the 0002 lateral join so a superseding entry exposes the
-- entry it replaced. Migration 0004 redefined longmem_search with the old
-- (dead-code) equality join, which made replaces_id always null.

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
    select
      lower(public.unaccent(coalesce(p_query, ''))) as qtext,
      plainto_tsquery('simple', public.unaccent(coalesce(p_query, ''))) as tsq
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
    (
      case when p_by = 'related'
        then 0.5 * coalesce(ts_rank(to_tsvector('simple', public.unaccent(coalesce(m.trigger, ''))), q.tsq), 0)::real
        else 0.5 * coalesce(ts_rank(m.search_vector, q.tsq), 0)::real
      end
      + 0.3 * coalesce(
          case when p_by = 'related'
            then similarity(lower(public.unaccent(m.trigger)), q.qtext)
            else similarity(m.search_text, q.qtext)
          end, 0)::real
      + 0.1 * (least(m.reinforced_count, 5)::real / 5.0)
      + case when m.pinned then 0.1::real else 0::real end
    )::real as score,
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
    and (p_by <> 'related' or m.sensitive = false)
  order by score desc, m.reinforced_count desc, m.updated_at desc
  limit greatest(1, least(coalesce(p_k, 5), 50))
$$;

