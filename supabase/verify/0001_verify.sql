-- longmem v0 schema assertions. Paste into the Supabase SQL editor after
-- 0001_init.sql. Every row in the final result must start with 'ok'.
-- Leaves one temp table behind for the session; nothing is written to memories
-- except one row that is deleted before the results are printed.

set search_path = public, extensions;

create temp table _longmem_verify (n integer, assertion text, result text);

-- 1. unaccent folds Vietnamese diacritics.
insert into _longmem_verify values (1, 'unaccent folds Vietnamese diacritics',
  case when unaccent('kiểm tra') = 'kiem tra' then 'ok'
       else 'FAIL: got ' || unaccent('kiểm tra') end);

-- 2. Duplicates are legal: no unique index on active (scope, project_key).
insert into _longmem_verify
select 2, 'no unique index on (scope, project_key) for active rows',
  case when count(*) = 0 then 'ok'
       else 'FAIL: ' || count(*) || ' unique index(es) on memories' end
from pg_index i
join pg_class c on c.oid = i.indrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'memories'
  and i.indisunique
  and pg_get_expr(i.indpred, i.indrelid) is not null;

-- 3 + 4. The touch trigger maintains search_text and advances updated_at.
insert into public.memories (scope, kind, title, trigger, body)
values ('global', 'lesson', 'verify seed title', 'verify trigger', 'verify body');

insert into _longmem_verify values (3, 'trigger maintains search_text on insert',
  case when (select search_text from public.memories where title = 'verify seed title')
            like '%verify seed title%'
       then 'ok' else 'FAIL: search_text not populated on insert' end);

update public.memories set title = 'verify renamed title' where title = 'verify seed title';

insert into _longmem_verify values (3, 'trigger maintains search_text on update',
  case when (select search_text from public.memories where title = 'verify renamed title')
            like '%verify renamed title%'
       then 'ok' else 'FAIL: search_text not refreshed on update' end);

insert into _longmem_verify values (4, 'updated_at advances on update',
  case when (select updated_at > created_at from public.memories where title = 'verify renamed title')
       then 'ok' else 'FAIL: updated_at did not advance' end);

-- 5. scope='global' with a project_key is rejected.
do $do$
begin
  begin
    insert into public.memories (scope, project_key, kind, title, trigger, body)
    values ('global', 'someone/else', 'lesson', 't', 'tr', 'b');
    insert into _longmem_verify values (5, 'global scope with project_key is rejected', 'FAIL: insert succeeded');
  exception when check_violation then
    insert into _longmem_verify values (5, 'global scope with project_key is rejected', 'ok');
  end;
end $do$;

-- 6. title longer than 120 characters is rejected.
do $do$
begin
  begin
    insert into public.memories (scope, kind, title, trigger, body)
    values ('global', 'lesson', repeat('x', 121), 'tr', 'b');
    insert into _longmem_verify values (6, 'title longer than 120 characters is rejected', 'FAIL: insert succeeded');
  exception when check_violation then
    insert into _longmem_verify values (6, 'title longer than 120 characters is rejected', 'ok');
  end;
end $do$;

-- 7. The embedding column exists with the v2 dimension, and is unused in v0.
insert into _longmem_verify values (7, 'embedding column is vector(768)',
  coalesce((
    select case when format_type(a.atttypid, a.atttypmod) = 'vector(768)' then 'ok'
                else 'FAIL: ' || format_type(a.atttypid, a.atttypmod) end
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'memories'
      and a.attname = 'embedding' and a.attnum > 0
  ), 'FAIL: column missing'));

-- 8. All eight RPC functions exist.
insert into _longmem_verify
select 8, 'eight RPC functions exist',
  case when count(*) = 8 then 'ok' else 'FAIL: found ' || count(*) end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'longmem_index_rows', 'longmem_search', 'longmem_dedupe',
    'longmem_cross_project_similar', 'longmem_supersede', 'longmem_counts',
    'longmem_reinforce', 'longmem_mark_recalled'
  );

-- 9. RLS is on and there is no policy at all.
insert into _longmem_verify values (9, 'RLS enabled and no policies on public.memories',
  case when (select relrowsecurity from pg_class where relname = 'memories')
            and (select count(*) from pg_policies
                 where schemaname = 'public' and tablename = 'memories') = 0
       then 'ok' else 'FAIL: RLS off or a policy exists' end);

-- 10. The API roles hold no privilege on the table. The project setting
-- "Grant API access to new tables automatically" grants them at create time,
-- so the migration's revoke has to win. RLS alone would not be enough: with
-- a table grant, anon could read through any future policy by accident.
insert into _longmem_verify values (10, 'anon and authenticated have no table privilege',
  case when not has_table_privilege('anon', 'public.memories', 'select')
            and not has_table_privilege('anon', 'public.memories', 'insert')
            and not has_table_privilege('authenticated', 'public.memories', 'select')
            and not has_table_privilege('authenticated', 'public.memories', 'insert')
       then 'ok' else 'FAIL: API role still holds a privilege on memories' end);

-- 11. A superseding entry exposes the entry it replaced.
do $do$
declare a uuid; b uuid; got uuid;
begin
  insert into public.memories (scope, kind, title, trigger, body)
  values ('global', 'lesson', 'verify lineage v1', 'verify lineage trigger', 'verify lineage body v1')
  returning id into a;
  perform public.longmem_supersede(a, jsonb_build_object(
    'scope', 'global', 'kind', 'lesson', 'title', 'verify lineage v2',
    'trigger', 'verify lineage trigger', 'body', 'verify lineage body v2'));
  select id into b from public.memories where title = 'verify lineage v2';
  select s.replaces_id into got
  from public.longmem_search('verify lineage v2', null, 5, null, null, 'recall') s
  where s.id = b;
  insert into _longmem_verify values (11, 'superseded entry exposes replaces predecessor',
    case when got = a then 'ok' else 'FAIL: replaces_id is ' || coalesce(got::text, 'null') end);
exception when others then
  insert into _longmem_verify values (11, 'superseded entry exposes replaces predecessor',
    'FAIL: ' || sqlerrm);
end $do$;

-- 12. A sensitive entry never reaches the injected index. The index is the one
-- external call v0 makes (it leaves for a model provider every turn), so the
-- flag has to hold here or it holds nowhere.
do $do$
declare visible integer;
begin
  insert into public.memories (scope, kind, title, trigger, body, sensitive)
  values ('global', 'fact', 'verify sensitive title', 'verify sensitive trigger', 'verify sensitive body', true);
  select count(*) into visible from public.longmem_index_rows(null) where title = 'verify sensitive title';
  insert into _longmem_verify values (12, 'sensitive entry is absent from the index',
    case when visible = 0 then 'ok' else 'FAIL: sensitive entry is in the index' end);
exception when others then
  insert into _longmem_verify values (12, 'sensitive entry is absent from the index', 'FAIL: ' || sqlerrm);
end $do$;

-- 13. The platitude rule cannot be bypassed by writing the table directly
-- (Supabase Studio, a psql session, or any future endpoint).
do $do$
begin
  insert into public.memories (scope, kind, title, trigger, body)
  values ('global', 'lesson', 'verify platitude title', 'be careful', 'verify platitude body');
  insert into _longmem_verify values (13, 'a platitude trigger is rejected by the table',
    'FAIL: the row was stored');
exception when check_violation then
  insert into _longmem_verify values (13, 'a platitude trigger is rejected by the table', 'ok');
when others then
  insert into _longmem_verify values (13, 'a platitude trigger is rejected by the table', 'FAIL: ' || sqlerrm);
end $do$;

-- 14. Dedupe and insert share one transaction: a concurrent write with the same
-- title is refused by the database, not only by a check that ran a moment earlier.
do $do$
declare first_write record; second_write record;
begin
  select * into first_write from public.longmem_write(jsonb_build_object(
    'scope', 'global', 'kind', 'lesson', 'title', 'verify atomic title',
    'trigger', 'verify atomic trigger', 'body', 'verify atomic body'), false);
  select * into second_write from public.longmem_write(jsonb_build_object(
    'scope', 'global', 'kind', 'lesson', 'title', 'verify atomic title',
    'trigger', 'verify atomic trigger', 'body', 'verify atomic body'), false);
  insert into _longmem_verify values (14, 'duplicate write is refused in the same transaction',
    case when first_write.created_id is not null
              and second_write.created_id is null
              and second_write.existing_id = first_write.created_id
         then 'ok'
         else 'FAIL: created/ existing ids did not line up' end);
exception when others then
  insert into _longmem_verify values (14, 'duplicate write is refused in the same transaction', 'FAIL: ' || sqlerrm);
end $do$;

-- v1: search_vector populated on insert.
do $do$
declare v_vec tsvector;
begin
  insert into public.memories (scope, kind, title, trigger, body)
    values ('global', 'lesson', 'verify fts insert title', 'verify fts insert trigger', 'verify fts insert body')
    returning search_vector into v_vec;
  insert into _longmem_verify values (15, 'search_vector is populated on insert',
    case when v_vec is not null and v_vec <> ''::tsvector then 'ok' else 'FAIL: empty search_vector' end);
exception when others then
  insert into _longmem_verify values (15, 'search_vector is populated on insert', 'FAIL: ' || sqlerrm);
end $do$;

-- v1: search_vector updates when title changes.
do $do$
declare v_before tsvector; v_after tsvector;
begin
  insert into public.memories (scope, kind, title, trigger, body)
    values ('global', 'lesson', 'verify fts before title', 'verify fts trigger', 'verify fts body')
    returning search_vector into v_before;
  update public.memories set title = 'verify fts after title' where title = 'verify fts before title'
    returning search_vector into v_after;
  insert into _longmem_verify values (16, 'search_vector updates when title changes',
    case when v_after is not null and v_after <> v_before then 'ok' else 'FAIL: search_vector did not change' end);
exception when others then
  insert into _longmem_verify values (16, 'search_vector updates when title changes', 'FAIL: ' || sqlerrm);
end $do$;

-- v1: GIN index on search_vector exists.
do $do$
begin
  insert into _longmem_verify values (17, 'gin index on search_vector exists',
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'memories_search_vector_idx')
         then 'ok' else 'FAIL: index missing' end);
end $do$;

-- v1: an FTS-only match ranks above a pure trigram match.
do $do$
declare v_top text;
begin
  insert into public.memories (scope, kind, title, trigger, body)
    values ('global', 'lesson', 'verify fts ipv6 host', 'database host unreachable', 'network path broken');
  select title into v_top from public.longmem_search('ipv6 database host', null, 1, null, null, 'recall');
  insert into _longmem_verify values (18, 'fts match ranks above trigram-only match',
    case when v_top = 'verify fts ipv6 host' then 'ok' else 'FAIL: top was ' || coalesce(v_top, '<null>') end);
exception when others then
  insert into _longmem_verify values (18, 'fts match ranks above trigram-only match', 'FAIL: ' || sqlerrm);
end $do$;

-- 19. The list RPC includes every status when asked for 'all'.
do $do$
declare v_count integer;
begin
  insert into public.memories (scope, kind, title, trigger, body, status)
    values ('global', 'lesson', 'verify list active', 't', 'b', 'active'),
           ('global', 'lesson', 'verify list superseded', 't', 'b', 'superseded'),
           ('global', 'lesson', 'verify list archived', 't', 'b', 'archived');
  select count(*) into v_count
  from public.longmem_list(null, null, null, null, 'all', 100)
  where title like 'verify list %';
  insert into _longmem_verify values (19, 'list rpc includes all statuses',
    case when v_count = 3 then 'ok' else 'FAIL: got ' || v_count || ' of 3' end);
exception when others then
  insert into _longmem_verify values (19, 'list rpc includes all statuses', 'FAIL: ' || sqlerrm);
end $do$;

-- Clean up the rows this script created.
delete from public.memories where title in (
  'verify seed title', 'verify renamed title', 'verify lineage v1', 'verify lineage v2',
  'verify sensitive title', 'verify atomic title', 'verify platitude title',
  'verify fts insert title', 'verify fts before title', 'verify fts after title', 'verify fts ipv6 host',
  'verify list active', 'verify list superseded', 'verify list archived');

select n, assertion, result from _longmem_verify order by n, assertion;
