-- SCRUM-57: LOCAL TEST STAND-IN for the Supabase platform objects our migrations reference.
-- Used only by the in-process test database (PGlite) in src/test-support/local-db.ts.
-- It is NOT a migration and is never applied to sandbox or live.
--
-- Mirrors what matters for access rules:
--   * roles anon / authenticated / service_role (service_role bypasses RLS);
--   * Supabase's default privileges: new public tables, sequences and functions are granted
--     to anon, authenticated and service_role (so RLS, not grants, is the real guard, as on live);
--   * auth.uid() / auth.jwt() read the same settings PostgREST sets;
--   * minimal storage / vault / cron / net objects so the migrations apply.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
create schema vault;
create schema cron;
create schema net;
create schema extensions;

create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;

create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;

create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default null) returns uuid
  language sql as $$ insert into vault.secrets(name, secret, description) values (new_name, new_secret, new_description) returning id $$;

create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid
$$;
create function cron.unschedule(job_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = job_name returning 1) select exists(select 1 from d)
$$;
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
  returns bigint language sql as $$ select 1::bigint $$;
create function extensions.gen_random_bytes(int) returns bytea language sql as $$ select decode(md5(random()::text), 'hex') $$;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt(), auth.role() to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;

-- Supabase default privileges for objects created by the migration role.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
