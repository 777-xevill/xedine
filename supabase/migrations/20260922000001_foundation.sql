-- Xedine foundation: extensions, enums, tenancy core, RLS helpers, policy engine.
-- ADR 0003 (auth), 0006 (P0 scope), 0007 (money visibility).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------------------------
create type public.app_role as enum ('owner', 'manager', 'cashier', 'kitchen', 'purchaser', 'accountant');
create type public.branch_scope as enum ('all', 'list');
create type public.member_status as enum ('active', 'suspended');
create type public.locale_code as enum ('bn', 'en');

-- ---------------------------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------------------------
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- business_date: Asia/Dhaka wall clock minus the branch cutoff, as a date (ADR 0006).
-- TS twin: src/lib/time/business-date.ts. Both are tested against tests/fixtures/business-date-cases.json.
create function private.business_date(p_ts timestamptz, p_cutoff_minutes integer default 240)
returns date language sql immutable parallel safe set search_path = '' as $$
  select ((p_ts at time zone 'Asia/Dhaka') - make_interval(mins => p_cutoff_minutes))::date
$$;

-- Blocks UPDATE/DELETE/TRUNCATE. Used for append-only tables (audit_log, order_events, ...).
create function private.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Tenancy core
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  locale public.locale_code not null default 'bn',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  is_demo boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  code text,
  address text,
  city text,
  area text,
  -- null = use org_settings.default_cutoff_minutes. Minutes after local midnight (240 = 04:00).
  cutoff_minutes integer check (cutoff_minutes between 0 and 1439),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, name)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  role public.app_role not null,
  branch_scope public.branch_scope not null default 'all',
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, org_id, role),
  unique (org_id, id),
  -- Owners and accountants always see every branch.
  constraint memberships_scope_matches_role check (role not in ('owner', 'accountant') or branch_scope = 'all')
);
create index memberships_user_idx on public.memberships (user_id) where status = 'active';

create table public.membership_branches (
  membership_id uuid not null,
  branch_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  primary key (membership_id, branch_id),
  foreign key (org_id, membership_id) references public.memberships (org_id, id) on delete cascade,
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);
create index membership_branches_branch_idx on public.membership_branches (org_id, branch_id);

create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger organizations_touch before update on public.organizations for each row execute function private.touch_updated_at();
create trigger branches_touch before update on public.branches for each row execute function private.touch_updated_at();
create trigger memberships_touch before update on public.memberships for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- RLS helper functions (security definer, fixed search_path, stable).
-- Policies always call these; auth.uid() is wrapped in a scalar subselect so it is evaluated once.
-- ---------------------------------------------------------------------------------------------
create function private.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
  )
$$;

create function private.has_role(p_org uuid, p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role = any (p_roles)
  )
$$;

-- Any active membership that reaches the branch (scope 'all', or the branch is in the member's list).
create function private.can_access_branch(p_org uuid, p_branch uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
      and (
        m.branch_scope = 'all'
        or exists (
          select 1 from public.membership_branches mb
          where mb.membership_id = m.id and mb.branch_id = p_branch
        )
      )
  )
$$;

create function private.can_access_branch_role(p_org uuid, p_branch uuid, p_roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role = any (p_roles)
      and (
        m.branch_scope = 'all'
        or exists (
          select 1 from public.membership_branches mb
          where mb.membership_id = m.id and mb.branch_id = p_branch
        )
      )
  )
$$;

-- ADR 0007: cost, margin, profit and finding ৳ impact are owner + accountant only.
create function private.can_see_money(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(p_org, array['owner', 'accountant']::public.app_role[])
$$;

create function private.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.org_id = mine.org_id
    where mine.user_id = (select auth.uid()) and mine.status = 'active'
      and theirs.user_id = p_user
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Policy engine. Every public table is registered here; a test fails if one is missing.
--   kind 'tenant'        standard role/branch policies generated by apply_policies()
--   kind 'custom'        hand-written policies (tenancy tables, per-user data)
--   kind 'service_only'  no client access at all (jobs and webhooks use the service role)
--   kind 'platform_read' non-tenant reference data: no org_id, read-only for signed-in users
-- ---------------------------------------------------------------------------------------------
create table private.policy_registry (
  table_name text primary key,
  kind text not null check (kind in ('tenant', 'custom', 'service_only', 'platform_read')),
  scope text check (scope in ('org', 'branch')),
  read_roles public.app_role[],
  write_roles public.app_role[],
  allow_delete boolean not null default false,
  notes text
);

create function private.roles_all() returns public.app_role[]
language sql immutable set search_path = '' as $$
  select array['owner', 'manager', 'cashier', 'kitchen', 'purchaser', 'accountant']::public.app_role[]
$$;

create function private.apply_policies(
  p_table text,
  p_scope text,
  p_read public.app_role[],
  p_write public.app_role[],
  p_allow_delete boolean default false,
  p_notes text default null
) returns void language plpgsql set search_path = '' as $$
declare
  v_read text;
  v_write text;
begin
  if p_scope not in ('org', 'branch') then
    raise exception 'apply_policies: bad scope %', p_scope;
  end if;
  -- Writers must be able to read the rows they write (UPDATE needs SELECT visibility).
  if not (coalesce(p_write, '{}') <@ coalesce(p_read, '{}')) then
    raise exception 'apply_policies(%): write roles % must be a subset of read roles %', p_table, p_write, p_read;
  end if;

  if p_scope = 'org' then
    v_read := format('private.has_role(org_id, %L::public.app_role[])', p_read);
    v_write := format('private.has_role(org_id, %L::public.app_role[])', p_write);
  else
    v_read := format('private.can_access_branch_role(org_id, branch_id, %L::public.app_role[])', p_read);
    v_write := format('private.can_access_branch_role(org_id, branch_id, %L::public.app_role[])', p_write);
  end if;

  execute format('alter table public.%I enable row level security', p_table);
  execute format('create policy %I on public.%I for select to authenticated using (%s)',
    p_table || '_select', p_table, v_read);

  if coalesce(cardinality(p_write), 0) > 0 then
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
      p_table || '_insert', p_table, v_write);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
      p_table || '_update', p_table, v_write, v_write);
    if p_allow_delete then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)',
        p_table || '_delete', p_table, v_write);
    end if;
  end if;

  insert into private.policy_registry (table_name, kind, scope, read_roles, write_roles, allow_delete, notes)
  values (p_table, 'tenant', p_scope, p_read, coalesce(p_write, '{}'), p_allow_delete, p_notes)
  on conflict (table_name) do update
    set kind = 'tenant', scope = excluded.scope, read_roles = excluded.read_roles,
        write_roles = excluded.write_roles, allow_delete = excluded.allow_delete, notes = excluded.notes;
end $$;

-- For tables whose policies are written by hand, or that clients must never touch.
create function private.register_table(p_table text, p_kind text, p_notes text default null)
returns void language plpgsql set search_path = '' as $$
begin
  if p_kind not in ('custom', 'service_only', 'platform_read') then
    raise exception 'register_table: bad kind %', p_kind;
  end if;
  execute format('alter table public.%I enable row level security', p_table);
  if p_kind = 'service_only' then
    -- No policies, and no privileges either: a client gets "permission denied", not an empty result.
    execute format('revoke all on table public.%I from anon, authenticated', p_table);
  elsif p_kind = 'platform_read' then
    execute format('create policy %I on public.%I for select to authenticated using (true)',
      p_table || '_select', p_table);
    execute format('revoke insert, update, delete, truncate on table public.%I from anon, authenticated', p_table);
  end if;
  insert into private.policy_registry (table_name, kind, notes) values (p_table, p_kind, p_notes)
  on conflict (table_name) do update set kind = excluded.kind, notes = excluded.notes;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Tenancy policies (hand-written)
-- ---------------------------------------------------------------------------------------------
create policy organizations_select on public.organizations for select to authenticated
  using (private.is_org_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (private.has_role(id, array['owner']::public.app_role[]))
  with check (private.has_role(id, array['owner']::public.app_role[]));
select private.register_table('organizations', 'custom', 'select: members; update: owner; create only via create_organization()');

create policy branches_select on public.branches for select to authenticated
  using (private.can_access_branch(org_id, id));
create policy branches_insert on public.branches for insert to authenticated
  with check (private.has_role(org_id, array['owner']::public.app_role[]));
create policy branches_update on public.branches for update to authenticated
  using (private.has_role(org_id, array['owner']::public.app_role[]))
  with check (private.has_role(org_id, array['owner']::public.app_role[]));
select private.register_table('branches', 'custom', 'select: members with access to the branch; write: owner');

create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role(org_id, array['owner']::public.app_role[]));
select private.register_table('memberships', 'custom', 'select: own rows, or owner for the org; writes only via RPCs (audited)');

create policy membership_branches_select on public.membership_branches for select to authenticated
  using (
    private.has_role(org_id, array['owner']::public.app_role[])
    or exists (
      select 1 from public.memberships m
      where m.id = membership_id and m.user_id = (select auth.uid())
    )
  );
select private.register_table('membership_branches', 'custom', 'select: own membership or owner; writes only via RPCs');

create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or private.shares_org_with(user_id));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
select private.register_table('profiles', 'custom', 'select: self or org co-members; update: self; row created by auth trigger');
