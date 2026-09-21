-- Stand-ins for the Supabase pieces the migrations rely on, so the DB suite can run on an in-process
-- Postgres (PGlite) with no Docker. This is an EMULATION of Supabase's auth schema and role setup:
-- real Supabase in CI remains the authority (ADR 0011).

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema extensions;
create extension pgcrypto with schema extensions;

create schema auth;
create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text unique, encrypted_password text,
  email_confirmed_at timestamptz, phone text, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  confirmation_token text default '', recovery_token text default '', email_change_token_new text default '',
  email_change text default '', email_change_token_current text default '', phone_change text default '',
  phone_change_token text default '', reauthentication_token text default ''
);
create table auth.identities (
  id uuid primary key, user_id uuid references auth.users (id) on delete cascade, identity_data jsonb,
  provider text, provider_id text, last_sign_in_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

-- Same claim lookup as Supabase's auth.uid() / auth.jwt().
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;

-- Supabase's default privileges: every new table is granted to the API roles, and RLS decides access.
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on all tables in schema auth to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
