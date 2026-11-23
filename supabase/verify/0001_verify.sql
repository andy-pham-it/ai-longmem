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

-- 8. All six RPC functions exist.
insert into _longmem_verify
select 8, 'six RPC functions exist',
  case when count(*) = 6 then 'ok' else 'FAIL: found ' || count(*) end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'longmem_index_rows', 'longmem_search', 'longmem_dedupe',
    'longmem_cross_project_similar', 'longmem_supersede', 'longmem_counts'
  );

-- 9. RLS is on and there is no policy at all.
insert into _longmem_verify values (9, 'RLS enabled and no policies on public.memories',
  case when (select relrowsecurity from pg_class where relname = 'memories')
            and (select count(*) from pg_policies
                 where schemaname = 'public' and tablename = 'memories') = 0
       then 'ok' else 'FAIL: RLS off or a policy exists' end);

-- Clean up the rows this script created.
delete from public.memories where title in ('verify seed title', 'verify renamed title');

select n, assertion, result from _longmem_verify order by n, assertion;
