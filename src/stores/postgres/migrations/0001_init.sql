-- longmem v0 schema: one table, one touch trigger, six SQL functions.
-- Run once in the Supabase SQL editor on a fresh project.
-- Spec: docs/superpowers/specs/2026-11-23-longmem-design.md §7

set search_path = public, extensions;

create extension if not exists pg_trgm with schema public;
create extension if not exists unaccent with schema public;

create table public.memories (
  id                 uuid primary key default gen_random_uuid(),
  scope              text not null check (scope in ('global','project')),
  project_key        text,
  kind               text not null check (kind in
                       ('lesson','mistake','misunderstanding','preference','fact')),
  title              text not null check (char_length(title) <= 120),
  trigger            text not null check (char_length(trigger) <= 200),
  body               text not null,
  tags               text[] not null default '{}',
  status             text not null default 'active'
                       check (status in ('active','superseded','archived')),
  superseded_by      uuid references public.memories(id),
  pinned             boolean not null default false,
  sensitive          boolean not null default false,
  source             text,
  agent_session      text,
  reinforced_count   integer not null default 0,
  last_reinforced_at timestamptz,
  recall_count       integer not null default 0,
  last_recalled_at   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- not a generated column: unaccent() is not immutable, so Postgres rejects
  -- `generated always as`. Maintained by memories_touch() instead.
  search_text        text not null default '',
  constraint scope_project_key check (
    (scope = 'global' and project_key is null) or
    (scope = 'project' and project_key is not null)
  )
);

create index memories_scope_idx on public.memories (scope, project_key, status);
create index memories_tags_idx  on public.memories using gin (tags);
create index memories_trgm_idx  on public.memories using gin (search_text gin_trgm_ops);

create or replace function public.memories_touch() returns trigger
language plpgsql as $$
begin
  new.search_text := lower(public.unaccent(
    coalesce(new.title,'') || ' ' || coalesce(new.trigger,'') || ' ' || coalesce(new.body,'')));
  -- clock_timestamp(), not now(): now() is transaction_timestamp(), so a batch
  -- script that inserts and updates in one transaction would never advance it.
  new.updated_at := clock_timestamp();
  return new;
end $$;

create trigger memories_touch_trg before insert or update on public.memories
  for each row execute function public.memories_touch();

-- Single-person store: the Edge Function uses the service role key and is the
-- only door. No policy for anon or authenticated, by design (spec §12).
alter table public.memories enable row level security;
revoke all on public.memories from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Read path 1: the index. Ordered so the cheapest-to-lose facts fall off the
-- byte budget first.
-- ---------------------------------------------------------------------------
create or replace function public.longmem_index_rows(p_project_key text default null)
returns setof public.memories
language sql stable security definer set search_path = public as $$
  select m.*
  from public.memories m
  where m.status = 'active'
    and (m.scope = 'global' or m.project_key = p_project_key)
  order by
    m.pinned desc,
    m.reinforced_count desc,
    case m.kind
      when 'preference' then 0
      when 'lesson' then 1
      when 'mistake' then 2
      when 'misunderstanding' then 3
      else 4
    end,
    m.updated_at desc
$$;

-- ---------------------------------------------------------------------------
-- Read path 2: search. p_by='recall' matches the whole text, p_by='related'
-- matches the trigger only (a related query describes a situation, not a claim).
-- ---------------------------------------------------------------------------
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
  left join public.memories rep on rep.id = m.superseded_by
  where m.status = 'active'
    and (m.scope = 'global' or m.project_key = p_project_key)
    and (p_kinds is null or m.kind = any (p_kinds))
    and (p_tags is null or m.tags && p_tags)
  order by score desc, m.reinforced_count desc, m.updated_at desc
  limit greatest(1, least(coalesce(p_k, 5), 50))
$$;

-- ---------------------------------------------------------------------------
-- Dedupe (advisory): the best active match in the same scope.
-- ---------------------------------------------------------------------------
create or replace function public.longmem_dedupe(
  p_title text,
  p_scope text,
  p_project_key text
)
returns table (id uuid, title text, similarity real)
language sql stable security definer set search_path = public as $$
  select
    m.id,
    m.title,
    similarity(lower(public.unaccent(m.title)), lower(public.unaccent(p_title))) as similarity
  from public.memories m
  where m.status = 'active'
    and m.scope = p_scope
    and m.project_key is not distinct from p_project_key
  order by similarity desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Cross-project warning: best match in a different project.
-- ---------------------------------------------------------------------------
create or replace function public.longmem_cross_project_similar(
  p_title text,
  p_project_key text
)
returns table (id uuid, title text, project_key text, similarity real)
language sql stable security definer set search_path = public as $$
  select
    m.id,
    m.title,
    m.project_key,
    similarity(lower(public.unaccent(m.title)), lower(public.unaccent(p_title))) as similarity
  from public.memories m
  where m.status = 'active'
    and m.scope = 'project'
    and m.project_key is distinct from p_project_key
  order by similarity desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Supersede: insert the replacement and retire the old row in one call.
-- Raises check_violation with a readable message for the HTTP layer to map.
-- ---------------------------------------------------------------------------
create or replace function public.longmem_supersede(p_old uuid, p_new jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_scope text := coalesce(nullif(p_new->>'scope', ''), 'global');
  v_project_key text := nullif(p_new->>'project_key', '');
  v_kind text := nullif(p_new->>'kind', '');
  v_title text := nullif(p_new->>'title', '');
  v_trigger text := nullif(p_new->>'trigger', '');
  v_body text := nullif(p_new->>'body', '');
  v_status text;
  v_new_id uuid;
begin
  select m.status into v_status from public.memories m where m.id = p_old for update;

  if v_status is null then
    raise exception 'old entry not found' using errcode = 'no_data_found';
  end if;
  if v_status <> 'active' then
    raise exception 'old entry is not active' using errcode = 'check_violation';
  end if;

  if v_kind not in ('lesson','mistake','misunderstanding','preference','fact') then
    raise exception 'kind must be one of lesson, mistake, misunderstanding, preference, fact'
      using errcode = 'check_violation';
  end if;
  if v_title is null or v_trigger is null or v_body is null then
    raise exception 'kind, title, trigger and body are required' using errcode = 'check_violation';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'title exceeds 120 characters' using errcode = 'check_violation';
  end if;
  if char_length(v_trigger) > 200 then
    raise exception 'trigger exceeds 200 characters' using errcode = 'check_violation';
  end if;
  if (v_scope = 'global' and v_project_key is not null)
     or (v_scope = 'project' and v_project_key is null) then
    raise exception 'scope and project_key do not agree' using errcode = 'check_violation';
  end if;

  insert into public.memories (
    scope, project_key, kind, title, trigger, body, tags,
    pinned, sensitive, source, agent_session
  )
  values (
    v_scope,
    v_project_key,
    v_kind,
    v_title,
    v_trigger,
    v_body,
    coalesce(
      (select array_agg(t.value) from jsonb_array_elements_text(coalesce(p_new->'tags', '[]'::jsonb)) as t),
      '{}'
    ),
    coalesce((p_new->>'pinned')::boolean, false),
    coalesce((p_new->>'sensitive')::boolean, false),
    p_new->>'source',
    p_new->>'agent_session'
  )
  returning id into v_new_id;

  update public.memories
     set status = 'superseded', superseded_by = v_new_id
   where id = p_old;

  return v_new_id;
end $$;

-- ---------------------------------------------------------------------------
-- Counters. supabase-js cannot express `x = x + 1`, so the increments live here.
-- ---------------------------------------------------------------------------
create or replace function public.longmem_reinforce(p_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update public.memories
     set reinforced_count = reinforced_count + 1,
         last_reinforced_at = now()
   where id = p_id and status = 'active'
  returning reinforced_count into v_count;

  if v_count is null then
    raise exception 'entry not found or not active' using errcode = 'no_data_found';
  end if;
  return v_count;
end $$;

create or replace function public.longmem_mark_recalled(p_ids uuid[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update public.memories
     set recall_count = recall_count + 1,
         last_recalled_at = now()
   where id = any (p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Counts for `longmem status` and the /health probe.
-- ---------------------------------------------------------------------------
create or replace function public.longmem_counts()
returns jsonb
language sql stable security definer set search_path = public as $$
  with base as (select * from public.memories)
  select jsonb_build_object(
    'total', (select count(*) from base),
    'active', (select count(*) from base where status = 'active'),
    'superseded', (select count(*) from base where status = 'superseded'),
    'archived', (select count(*) from base where status = 'archived'),
    'global', (select count(*) from base where status = 'active' and scope = 'global'),
    'project', (select count(*) from base where status = 'active' and scope = 'project'),
    'pinned', (select count(*) from base where status = 'active' and pinned),
    'by_kind', (
      select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
      from (select kind, count(*) as n from base group by kind) k
    )
  )
$$;
