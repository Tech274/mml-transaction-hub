-- SCRUM-62: pre-change / post-change fingerprint. READ-ONLY: one SELECT, nothing is written.
-- Run it in the SQL editor right before a live change and again right after (and after any
-- restore). Save each result as CSV with the time (IST) in the release log. Compare the two:
-- only the objects the change was meant to touch should differ.
--
-- Output: section | object | n | fingerprint
--   data       one row per public table: row count + md5 of all rows (no row contents are shown)
--   columns    one row per public table: md5 of column names, types, nullability, defaults
--   policies   one row per public table: md5 of its RLS policies (name, command, roles, expressions)
--   grants     one row per public table: md5 of table privileges
--   functions  one row: md5 of every public function definition and its EXECUTE grants
--   storage    one row per bucket: object count + md5 of names and eTags (storage files are NOT in
--              database backups, so this is how you know they were untouched)
--   migrations one row: number of recorded migrations + the latest version
-- Safe on live: it reads every table once (small tables today). It returns counts and hashes only.
with tbl as (
  select c.oid, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
),
data as (
  select 'data'::text as section, t.relname::text as object, x
    from tbl t,
         lateral (select query_to_xml(format(
           'select count(*) as n, md5(coalesce(string_agg(r::text, E''\n'' order by r::text), '''')) as f from public.%I r',
           t.relname), false, true, '')::text as x) q
),
storage_x as (
  select 'storage'::text as section, b.id::text as object,
         query_to_xml(format(
           'select count(*) as n, md5(coalesce(string_agg(o.name || '':'' || coalesce(o.metadata->>''eTag'', ''''), E''\n'' order by o.name), '''')) as f
              from storage.objects o where o.bucket_id = %L', b.id), false, true, '')::text as x
    from storage.buckets b
),
migrations_x as (
  select 'migrations'::text as section, 'supabase_migrations.schema_migrations'::text as object,
         query_to_xml(case when to_regclass('supabase_migrations.schema_migrations') is null
                           then 'select 0 as n, ''(no migration history table)'' as f'
                           else 'select count(*) as n, max(version) as f from supabase_migrations.schema_migrations' end,
                      false, true, '')::text as x
)
select section, object,
       substring(x from '<n>([0-9]+)</n>')::bigint as n,
       substring(x from '<f>([^<]*)</f>') as fingerprint
  from (select * from data union all select * from storage_x union all select * from migrations_x) s
union all
select 'columns', t.relname::text, count(a.attnum),
       md5(string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' ||
                      coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' order by a.attnum))
  from tbl t
  join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 group by t.relname
union all
select 'policies', t.relname::text, count(p.policyname),
       md5(coalesce(string_agg(p.policyname || '|' || p.permissive || '|' || p.cmd || '|' || p.roles::text || '|' ||
                               coalesce(p.qual, '') || '|' || coalesce(p.with_check, ''), E'\n' order by p.policyname), ''))
  from tbl t left join pg_policies p on p.schemaname = 'public' and p.tablename = t.relname
 group by t.relname
union all
select 'grants', t.relname::text, count(g.privilege_type),
       md5(coalesce(string_agg(g.grantee || ':' || g.privilege_type, ',' order by g.grantee, g.privilege_type), ''))
  from tbl t left join information_schema.role_table_grants g on g.table_schema = 'public' and g.table_name = t.relname
 group by t.relname
union all
select 'functions', 'public.*', count(*),
       md5(coalesce(string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), E'\n' order by p.oid::regprocedure::text), ''))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind in ('f', 'p')
order by 1, 2;
