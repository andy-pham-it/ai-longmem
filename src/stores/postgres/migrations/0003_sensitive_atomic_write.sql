-- 0003: close three doors the v0 review found open.
--
-- 1. `sensitive` was a flag with no reader. The index is the one external call
--    v0 makes — it leaves Supabase for a model provider every turn — so a
--    sensitive entry must not be in it. `related` is agent-pushed, so it is
--    filtered too; `recall` is explicit and human-initiated, so it still sees
--    everything.
-- 2. The platitude rule lived only in the Edge Function, so Studio and any
--    future endpoint could store "be careful". A table constraint covers every
--    door. `validate.ts` keeps the friendlier message; the two lists must stay
--    in step.
-- 3. Dedupe and insert were two PostgREST round trips, i.e. two transactions,
--    so two writers with the same title could both pass the check and both
--    insert. They now share one transaction and one advisory lock per scope.

-- 1a. The injected index never contains a sensitive entry.
create or replace function public.longmem_index_rows(p_project_key text default null)
returns setof public.memories
language sql stable security definer set search_path = public as $$
  select m.*
  from public.memories m
  where m.status = 'active'
    and m.sensitive = false
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

-- 1b. `related` is pushed by the agent before the user asked for anything, so
-- it respects the flag. `recall` is an explicit human query and does not.
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
    and (p_by <> 'related' or m.sensitive = false)
    and (m.scope = 'global' or m.project_key = p_project_key)
    and (p_kinds is null or m.kind = any (p_kinds))
    and (p_tags is null or m.tags && p_tags)
  order by score desc, m.reinforced_count desc, m.updated_at desc
  limit greatest(1, least(coalesce(p_k, 5), 50))
$$;

-- 2. A trigger that names no situation is not an entry, whichever door the row
-- comes through. Patterns mirror PLATITUDES in
-- supabase/functions/_shared/validate.ts: change one, change both.
alter table public.memories
  add constraint trigger_not_platitude check (
    trigger !~* ('(be careful|pay attention|communicate clearly|double[- ]?check'
                || '|think before|be thorough|mind the details'
                || '|verify[^.]*(before claiming|things))')
  );

-- 3. Dedupe and insert in one transaction, serialized per scope by an advisory
-- lock. A writer that loses the race gets the winner back as `existing_id`
-- instead of a second copy of the same claim.
create or replace function public.longmem_write(p_new jsonb, p_force boolean default false)
returns table (created_id uuid, existing_id uuid, existing_title text, similarity real)
language plpgsql security definer set search_path = public as $$
declare
  v_scope text := coalesce(nullif(p_new->>'scope', ''), 'global');
  v_project text := nullif(p_new->>'project_key', '');
  v_title text := trim(coalesce(p_new->>'title', ''));
  v_match record;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(v_scope || ':' || coalesce(v_project, '')));

  if not coalesce(p_force, false) then
    select m.id, m.title,
           similarity(lower(public.unaccent(m.title)), lower(public.unaccent(v_title))) as sim
    into v_match
    from public.memories m
    where m.status = 'active'
      and m.scope = v_scope
      and m.project_key is not distinct from v_project
    order by sim desc
    limit 1;

    if found and v_match.sim > 0.7 then
      return query select null::uuid, v_match.id, v_match.title, v_match.sim;
      return;
    end if;
  end if;

  insert into public.memories (
    scope, project_key, kind, title, trigger, body, tags,
    pinned, sensitive, source, agent_session
  )
  values (
    v_scope,
    v_project,
    p_new->>'kind',
    v_title,
    p_new->>'trigger',
    p_new->>'body',
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(coalesce(p_new->'tags', '[]'::jsonb)) as x),
      '{}'
    ),
    coalesce((p_new->>'pinned')::boolean, false),
    coalesce((p_new->>'sensitive')::boolean, false),
    coalesce(nullif(p_new->>'source', ''), 'api'),
    nullif(p_new->>'agent_session', '')
  )
  returning id into v_id;

  return query select v_id, null::uuid, null::text, null::real;
end $$;
