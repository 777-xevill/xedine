-- Org settings, devices, staff PINs, invitations, audit log, job runs, and the tenancy RPCs.
-- ADR 0003 (auth/invites), 0004 (jobs), 0005 (VAT), 0007 (money visibility).

create type public.context_kind as enum ('goal', 'rule', 'constraint');
create type public.device_kind as enum ('pos', 'kds', 'qr');
create type public.device_status as enum ('pending', 'active', 'revoked');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.job_status as enum ('running', 'succeeded', 'failed', 'skipped');

-- ---------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------
create table public.org_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- ADR 0005. Cannot change once the org has orders (trigger below).
  price_includes_vat boolean not null default true,
  -- TODO(verify): regulatory values are owner-entered config with a 0 default, never a hardcoded fact.
  vat_rate_bps integer not null default 0 check (vat_rate_bps between 0 and 10000),
  service_charge_bps integer not null default 0 check (service_charge_bps between 0 and 10000),
  vat_on_service_charge boolean not null default false,
  default_cutoff_minutes integer not null default 240 check (default_cutoff_minutes between 0 and 1439),
  -- 0 = Sunday … 6 = Saturday. Default Saturday.
  week_start smallint not null default 6 check (week_start between 0 and 6),
  dayparts jsonb not null default '[
    {"key":"breakfast","start":"06:00","end":"11:00"},
    {"key":"lunch","start":"11:00","end":"16:00"},
    {"key":"snacks","start":"16:00","end":"19:00"},
    {"key":"dinner","start":"19:00","end":"23:00"},
    {"key":"late","start":"23:00","end":"04:00"}
  ]'::jsonb,
  default_locale public.locale_code not null default 'bn',
  benchmark_opt_in boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.org_profile (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  cuisine text,
  format text,
  price_band text,
  city text,
  area text,
  owner_whatsapp text,
  updated_at timestamptz not null default now()
);

-- Cost-flavoured settings live apart so they can be money-gated (ADR 0007).
create table public.org_cost_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- P2 flash P&L uses this owner-entered assumption until recipes exist (P3). Labelled in the UI.
  assumed_food_cost_bps integer check (assumed_food_cost_bps between 0 and 10000),
  updated_at timestamptz not null default now()
);

create table public.org_context (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind public.context_kind not null,
  body text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);
create index org_context_org_idx on public.org_context (org_id, is_active);

create trigger org_settings_touch before update on public.org_settings for each row execute function private.touch_updated_at();
create trigger org_profile_touch before update on public.org_profile for each row execute function private.touch_updated_at();
create trigger org_cost_settings_touch before update on public.org_cost_settings for each row execute function private.touch_updated_at();
create trigger org_context_touch before update on public.org_context for each row execute function private.touch_updated_at();

-- ADR 0005: flipping the price basis would make a branch's history incomparable.
create function private.guard_price_basis() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.price_includes_vat is distinct from old.price_includes_vat
     and exists (select 1 from public.orders o where o.org_id = new.org_id limit 1) then
    raise exception 'price_includes_vat cannot change after the organization has orders'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger org_settings_guard_price_basis before update on public.org_settings
  for each row execute function private.guard_price_basis();

-- ---------------------------------------------------------------------------------------------
-- Devices and staff (POS shared tablets; ARCHITECTURE.md "Tenancy & security")
-- ---------------------------------------------------------------------------------------------
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  name text not null,
  kind public.device_kind not null default 'pos',
  status public.device_status not null default 'pending',
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  registered_by uuid references auth.users (id) on delete set null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);
create index devices_branch_idx on public.devices (org_id, branch_id);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null,
  role public.app_role not null default 'cashier',
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);
create index staff_branch_idx on public.staff (org_id, branch_id);

create table public.staff_pins (
  staff_id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (org_id, staff_id) references public.staff (org_id, id) on delete cascade
);

create table public.staff_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  device_id uuid not null,
  staff_id uuid not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, device_id) references public.devices (org_id, id) on delete cascade,
  foreign key (org_id, staff_id) references public.staff (org_id, id) on delete cascade
);
create index staff_sessions_active_idx on public.staff_sessions (org_id, branch_id, staff_id) where ended_at is null;

create trigger devices_touch before update on public.devices for each row execute function private.touch_updated_at();
create trigger staff_touch before update on public.staff for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Invitations (ADR 0003): the owner invites an email with a role and branch scope.
-- ---------------------------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role public.app_role not null,
  branch_ids uuid[] not null default '{}',
  token_hash text not null unique,
  status public.invitation_status not null default 'pending',
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create index invitations_org_idx on public.invitations (org_id, status);
create index invitations_email_idx on public.invitations (lower(email)) where status = 'pending';

-- ---------------------------------------------------------------------------------------------
-- audit_log: append-only (CLAUDE.md non-negotiable #5). Written only by security-definer code.
-- ---------------------------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  branch_id uuid,
  actor_user_id uuid,
  actor_staff_id uuid,
  device_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index audit_log_org_time_idx on public.audit_log (org_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (org_id, entity, entity_id);

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function private.forbid_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.forbid_mutation();

create function private.write_audit(
  p_org uuid, p_branch uuid, p_action text, p_entity text, p_entity_id text,
  p_before jsonb, p_after jsonb, p_reason text,
  p_device uuid default null, p_staff uuid default null
) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log
    (org_id, branch_id, actor_user_id, actor_staff_id, device_id, action, entity, entity_id, before, after, reason)
  values
    (p_org, p_branch, (select auth.uid()), p_staff,
     coalesce(p_device, nullif(current_setting('app.device_id', true), '')::uuid),
     p_action, p_entity, p_entity_id, p_before, p_after, p_reason)
$$;

-- App-facing audit entry point. The actor is always the caller; nobody can write as someone else.
create function public.log_audit(
  p_org uuid, p_branch uuid, p_action text, p_entity text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null, p_reason text default null,
  p_device uuid default null, p_staff uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_org_member(p_org) then
    raise exception 'not a member of this organization' using errcode = 'insufficient_privilege';
  end if;
  perform private.write_audit(p_org, p_branch, p_action, p_entity, p_entity_id, p_before, p_after, p_reason, p_device, p_staff);
end $$;

-- Trigger flavour: attach to sensitive tables (price, recipe, settings edits) with the entity name.
create function private.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    if (v_old - 'updated_at') = (v_new - 'updated_at') then
      return new;
    end if;
  else
    v_new := to_jsonb(new);
  end if;
  v_row := coalesce(v_new, v_old);
  perform private.write_audit(
    (v_row ->> 'org_id')::uuid,
    nullif(v_row ->> 'branch_id', '')::uuid,
    lower(tg_argv[0]) || '.' || lower(tg_op),
    tg_argv[0],
    coalesce(v_row ->> 'id', v_row ->> 'org_id'),
    v_old, v_new, null
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger org_settings_audit after update on public.org_settings
  for each row execute function private.audit_row_change('org_settings');
create trigger org_cost_settings_audit after update on public.org_cost_settings
  for each row execute function private.audit_row_change('org_cost_settings');
create trigger branches_audit after update on public.branches
  for each row execute function private.audit_row_change('branch');

-- ---------------------------------------------------------------------------------------------
-- job_runs (ADR 0004): idempotent per (job, org, period). Written only by the service role.
-- ---------------------------------------------------------------------------------------------
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  org_id uuid references public.organizations (id),
  period_key text not null,
  status public.job_status not null default 'running',
  attempts integer not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  meta jsonb not null default '{}'::jsonb,
  unique nulls not distinct (job, org_id, period_key)
);
create index job_runs_job_time_idx on public.job_runs (job, started_at desc);

-- Which jobs must run, and how often. Drives job_health() (the alert on missing runs).
create table public.job_schedules (
  job text primary key,
  cron_expr text not null,
  expected_every interval not null,
  is_enabled boolean not null default true
);

-- Claim a run. Returns the run id if this caller should do the work, null if it is already
-- running (fresh), succeeded or skipped. A failed or stale (>30 min) run can be retried.
create function public.job_run_begin(p_job text, p_org uuid, p_period text) returns uuid
language sql security definer set search_path = '' as $$
  insert into public.job_runs as r (job, org_id, period_key)
  values (p_job, p_org, p_period)
  on conflict (job, org_id, period_key) do update
    set status = 'running', attempts = r.attempts + 1, started_at = now(), finished_at = null, error = null
    where r.status = 'failed' or (r.status = 'running' and r.started_at < now() - interval '30 minutes')
  returning r.id
$$;

create function public.job_run_finish(p_run uuid, p_status public.job_status, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.job_runs set status = p_status, error = p_error, finished_at = now() where id = p_run
$$;

create function public.job_health()
returns table (job text, last_success_at timestamptz, expected_every interval, is_overdue boolean)
language sql stable security definer set search_path = '' as $$
  select s.job,
         (select max(r.finished_at) from public.job_runs r where r.job = s.job and r.status = 'succeeded'),
         s.expected_every,
         coalesce(
           (select max(r.finished_at) from public.job_runs r where r.job = s.job and r.status = 'succeeded')
             < now() - s.expected_every * 2,
           true
         )
  from public.job_schedules s
  where s.is_enabled
$$;

-- ---------------------------------------------------------------------------------------------
-- Auth hook: every new auth user gets a profile.
-- ---------------------------------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, full_name, phone)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.phone, ''))
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- RPCs. Tenancy writes go through these so they are atomic and audited (CLAUDE.md #5).
-- ---------------------------------------------------------------------------------------------
create function public.create_organization(
  p_name text,
  p_slug text,
  p_branches jsonb default '[]'::jsonb,
  p_locale public.locale_code default 'bn'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_branch jsonb;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'invalid_authorization_specification';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'organization name is required' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), v_uid)
  returning id into v_org;

  insert into public.org_settings (org_id, default_locale) values (v_org, p_locale);
  insert into public.org_profile (org_id) values (v_org);
  insert into public.org_cost_settings (org_id) values (v_org);

  for v_branch in select * from jsonb_array_elements(coalesce(p_branches, '[]'::jsonb)) loop
    if btrim(coalesce(v_branch ->> 'name', '')) = '' then
      raise exception 'every branch needs a name' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.branches (org_id, name, city, area)
    values (v_org, btrim(v_branch ->> 'name'), nullif(v_branch ->> 'city', ''), nullif(v_branch ->> 'area', ''));
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    insert into public.branches (org_id, name) values (v_org, 'Main');
  end if;

  insert into public.memberships (user_id, org_id, role, branch_scope) values (v_uid, v_org, 'owner', 'all');

  perform private.write_audit(v_org, null, 'org.create', 'organization', v_org::text, null,
    jsonb_build_object('name', btrim(p_name), 'slug', lower(btrim(p_slug)), 'branches', greatest(v_count, 1)), null);
  return v_org;
end $$;

create function public.create_invitation(
  p_org uuid,
  p_email text,
  p_role public.app_role,
  p_branch_ids uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_branches uuid[] := coalesce(p_branch_ids, '{}');
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'only an owner can invite members' using errcode = 'insufficient_privilege';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'a valid email is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_role = 'owner' then
    raise exception 'owners cannot be invited in this version' using errcode = 'invalid_parameter_value';
  end if;
  if p_role = 'accountant' then
    v_branches := '{}';
  else
    if cardinality(v_branches) = 0 then
      raise exception 'this role needs at least one branch' using errcode = 'invalid_parameter_value';
    end if;
    if exists (
      select 1 from unnest(v_branches) b
      where not exists (select 1 from public.branches br where br.id = b and br.org_id = p_org)
    ) then
      raise exception 'branch does not belong to this organization' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  update public.invitations set status = 'revoked'
  where org_id = p_org and lower(email) = v_email and status = 'pending';

  insert into public.invitations (org_id, email, role, branch_ids, token_hash, invited_by, expires_at)
  values (p_org, v_email, p_role, v_branches,
          encode(sha256(convert_to(v_token, 'utf8')), 'hex'), (select auth.uid()), now() + interval '7 days')
  returning id into v_id;

  perform private.write_audit(p_org, null, 'invitation.create', 'invitation', v_id::text, null,
    jsonb_build_object('email', v_email, 'role', p_role, 'branch_ids', v_branches), null);
  -- The raw token is returned once and never stored.
  return jsonb_build_object('invitation_id', v_id, 'token', v_token);
end $$;

create function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from public.invitations where id = p_invitation;
  if not found or not private.has_role(v_inv.org_id, array['owner']::public.app_role[]) then
    raise exception 'invitation not found' using errcode = 'no_data_found';
  end if;
  update public.invitations set status = 'revoked' where id = p_invitation and status = 'pending';
  perform private.write_audit(v_inv.org_id, null, 'invitation.revoke', 'invitation', p_invitation::text,
    jsonb_build_object('email', v_inv.email, 'role', v_inv.role), null, null);
end $$;

create function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_inv public.invitations;
  v_membership uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'invalid_authorization_specification';
  end if;

  select * into v_inv from public.invitations
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
  for update;

  if not found or v_inv.status <> 'pending' or v_inv.expires_at < now() then
    raise exception 'this invitation is invalid or has expired' using errcode = 'no_data_found';
  end if;
  if lower(v_inv.email) <> v_email then
    raise exception 'this invitation was sent to a different email address' using errcode = 'insufficient_privilege';
  end if;

  insert into public.memberships (user_id, org_id, role, branch_scope)
  values (v_uid, v_inv.org_id, v_inv.role, (case when v_inv.role = 'accountant' then 'all' else 'list' end)::public.branch_scope)
  on conflict (user_id, org_id, role) do nothing
  returning id into v_membership;
  if v_membership is null then
    raise exception 'you already have this role in the organization' using errcode = 'unique_violation';
  end if;

  insert into public.membership_branches (membership_id, branch_id, org_id)
  select v_membership, b, v_inv.org_id from unnest(v_inv.branch_ids) b;

  update public.invitations set status = 'accepted', accepted_by = v_uid, accepted_at = now() where id = v_inv.id;

  perform private.write_audit(v_inv.org_id, null, 'member.add', 'membership', v_membership::text, null,
    jsonb_build_object('user_id', v_uid, 'role', v_inv.role, 'branch_ids', v_inv.branch_ids), null);
  return v_inv.org_id;
end $$;

create function public.update_membership(
  p_membership uuid,
  p_role public.app_role default null,
  p_branch_ids uuid[] default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_m public.memberships;
  v_before jsonb;
  v_role public.app_role;
  v_branches uuid[];
begin
  select * into v_m from public.memberships where id = p_membership;
  if not found or not private.has_role(v_m.org_id, array['owner']::public.app_role[]) then
    raise exception 'membership not found' using errcode = 'no_data_found';
  end if;
  if v_m.role = 'owner' or p_role = 'owner' then
    raise exception 'owner memberships cannot be changed in this version' using errcode = 'invalid_parameter_value';
  end if;

  select jsonb_build_object('role', v_m.role, 'branch_scope', v_m.branch_scope,
           'branch_ids', coalesce((select array_agg(branch_id) from public.membership_branches where membership_id = v_m.id), '{}'))
    into v_before;

  v_role := coalesce(p_role, v_m.role);
  v_branches := coalesce(p_branch_ids,
    (select array_agg(branch_id) from public.membership_branches where membership_id = v_m.id), '{}');

  if v_role = 'accountant' then
    v_branches := '{}';
  elsif cardinality(v_branches) = 0 then
    raise exception 'this role needs at least one branch' using errcode = 'invalid_parameter_value';
  elsif exists (
    select 1 from unnest(v_branches) b
    where not exists (select 1 from public.branches br where br.id = b and br.org_id = v_m.org_id)
  ) then
    raise exception 'branch does not belong to this organization' using errcode = 'invalid_parameter_value';
  end if;

  update public.memberships
  set role = v_role, branch_scope = (case when v_role = 'accountant' then 'all' else 'list' end)::public.branch_scope
  where id = v_m.id;
  delete from public.membership_branches where membership_id = v_m.id;
  insert into public.membership_branches (membership_id, branch_id, org_id)
  select v_m.id, b, v_m.org_id from unnest(v_branches) b;

  perform private.write_audit(v_m.org_id, null, 'member.update', 'membership', v_m.id::text, v_before,
    jsonb_build_object('role', v_role, 'branch_ids', v_branches), null);
end $$;

create function public.remove_membership(p_membership uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership;
  if not found or not private.has_role(v_m.org_id, array['owner']::public.app_role[]) then
    raise exception 'membership not found' using errcode = 'no_data_found';
  end if;
  if v_m.role = 'owner' then
    raise exception 'owner memberships cannot be removed in this version' using errcode = 'invalid_parameter_value';
  end if;
  delete from public.memberships where id = v_m.id;
  perform private.write_audit(v_m.org_id, null, 'member.remove', 'membership', v_m.id::text,
    jsonb_build_object('user_id', v_m.user_id, 'role', v_m.role), null, null);
end $$;

-- Devices: register (owner/manager), then claim with the one-time pairing code.
create function public.register_device(
  p_org uuid, p_branch uuid, p_name text, p_kind public.device_kind default 'pos'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_id uuid;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed to register devices for this branch' using errcode = 'insufficient_privilege';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'device name is required' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.devices (org_id, branch_id, name, kind, registered_by, pairing_code_hash, pairing_expires_at)
  values (p_org, p_branch, btrim(p_name), p_kind, (select auth.uid()),
          encode(sha256(convert_to(v_code, 'utf8')), 'hex'), now() + interval '15 minutes')
  returning id into v_id;
  perform private.write_audit(p_org, p_branch, 'device.register', 'device', v_id::text, null,
    jsonb_build_object('name', btrim(p_name), 'kind', p_kind), null);
  return jsonb_build_object('device_id', v_id, 'pairing_code', v_code);
end $$;

create function public.claim_device(p_device uuid, p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_dev public.devices;
begin
  select * into v_dev from public.devices where id = p_device for update;
  if not found or not private.can_access_branch(v_dev.org_id, v_dev.branch_id) then
    return false;
  end if;
  if v_dev.status <> 'pending' or v_dev.pairing_expires_at is null or v_dev.pairing_expires_at < now()
     or v_dev.pairing_code_hash is distinct from encode(sha256(convert_to(upper(coalesce(p_code, '')), 'utf8')), 'hex') then
    return false;
  end if;
  update public.devices
  set status = 'active', pairing_code_hash = null, pairing_expires_at = null, last_seen_at = now()
  where id = v_dev.id;
  perform private.write_audit(v_dev.org_id, v_dev.branch_id, 'device.claim', 'device', v_dev.id::text, null, null, null);
  return true;
end $$;

create function public.revoke_device(p_device uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_dev public.devices;
begin
  select * into v_dev from public.devices where id = p_device;
  if not found or not private.can_access_branch_role(v_dev.org_id, v_dev.branch_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'device not found' using errcode = 'no_data_found';
  end if;
  update public.devices set status = 'revoked', pairing_code_hash = null, pairing_expires_at = null where id = v_dev.id;
  update public.staff_sessions set ended_at = now() where device_id = v_dev.id and ended_at is null;
  perform private.write_audit(v_dev.org_id, v_dev.branch_id, 'device.revoke', 'device', v_dev.id::text, null, null, null);
end $$;

-- Staff PINs: bcrypt in the database. Only 4-6 digits, so the real protection is the lockout.
create function public.set_staff_pin(p_staff uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff where id = p_staff;
  if not found or not private.can_access_branch_role(v_staff.org_id, v_staff.branch_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'staff member not found' using errcode = 'no_data_found';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4 to 6 digits' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.staff_pins (staff_id, org_id, pin_hash)
  values (p_staff, v_staff.org_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
  on conflict (staff_id) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, updated_at = now();
  perform private.write_audit(v_staff.org_id, v_staff.branch_id, 'staff.pin_set', 'staff', p_staff::text, null, null, null);
end $$;

-- A wrong PIN must not raise: raising would roll back the failed-attempt counter and defeat the
-- lockout. Returns {ok, reason, ...} instead.
create function public.start_staff_session(p_device uuid, p_staff uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_dev public.devices;
  v_staff public.staff;
  v_pin public.staff_pins;
  v_session uuid;
  v_failed integer;
begin
  select * into v_dev from public.devices where id = p_device;
  select * into v_staff from public.staff where id = p_staff;
  if v_dev.id is null or v_staff.id is null
     or v_dev.org_id <> v_staff.org_id or v_dev.branch_id <> v_staff.branch_id
     or v_dev.status <> 'active' or not v_staff.is_active
     or not private.can_access_branch_role(v_dev.org_id, v_dev.branch_id,
          array['owner', 'manager', 'cashier', 'kitchen']::public.app_role[]) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  select * into v_pin from public.staff_pins where staff_id = p_staff for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_pin');
  end if;
  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_pin.locked_until);
  end if;

  if v_pin.pin_hash = extensions.crypt(coalesce(p_pin, ''), v_pin.pin_hash) then
    update public.staff_pins set failed_attempts = 0, locked_until = null where staff_id = p_staff;
    insert into public.staff_sessions (org_id, branch_id, device_id, staff_id, expires_at)
    values (v_dev.org_id, v_dev.branch_id, p_device, p_staff, now() + interval '12 hours')
    returning id into v_session;
    perform private.write_audit(v_dev.org_id, v_dev.branch_id, 'staff.session_start', 'staff', p_staff::text, null, null, null, p_device, p_staff);
    return jsonb_build_object('ok', true, 'session_id', v_session);
  end if;

  v_failed := v_pin.failed_attempts + 1;
  if v_failed >= 5 then
    update public.staff_pins set failed_attempts = 0, locked_until = now() + interval '5 minutes' where staff_id = p_staff;
  else
    update public.staff_pins set failed_attempts = v_failed where staff_id = p_staff;
  end if;
  perform private.write_audit(v_dev.org_id, v_dev.branch_id, 'staff.pin_failed', 'staff', p_staff::text, null,
    jsonb_build_object('failed_attempts', v_failed), null, p_device, p_staff);
  return jsonb_build_object('ok', false, 'reason', case when v_failed >= 5 then 'locked' else 'wrong_pin' end,
                            'attempts_left', greatest(5 - v_failed, 0));
end $$;

create function public.end_staff_session(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.staff_sessions;
begin
  select * into v_s from public.staff_sessions where id = p_session;
  if found and private.can_access_branch(v_s.org_id, v_s.branch_id) then
    update public.staff_sessions set ended_at = now() where id = p_session and ended_at is null;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------------------------
select private.apply_policies('org_settings', 'org', private.roles_all(), array['owner']::public.app_role[]);
select private.apply_policies('org_profile', 'org', private.roles_all(), array['owner']::public.app_role[]);
select private.apply_policies('org_cost_settings', 'org', array['owner', 'accountant']::public.app_role[], array['owner']::public.app_role[],
  false, 'money-gated (ADR 0007)');
select private.apply_policies('org_context', 'org', array['owner', 'manager', 'accountant']::public.app_role[], array['owner']::public.app_role[], true);
select private.apply_policies('devices', 'branch', array['owner', 'manager', 'cashier', 'kitchen']::public.app_role[],
  array['owner', 'manager']::public.app_role[], false, 'pairing via register_device()/claim_device()');
select private.apply_policies('staff', 'branch', array['owner', 'manager', 'cashier', 'kitchen', 'accountant']::public.app_role[],
  array['owner', 'manager']::public.app_role[]);
select private.apply_policies('staff_sessions', 'branch', array['owner', 'manager']::public.app_role[], '{}',
  false, 'created only by start_staff_session()');
select private.register_table('staff_pins', 'service_only', 'PIN hashes; only security-definer RPCs touch them');
select private.register_table('invitations', 'custom', 'select: owner; writes only via RPCs');
create policy invitations_select on public.invitations for select to authenticated
  using (private.has_role(org_id, array['owner']::public.app_role[]));
select private.register_table('audit_log', 'custom', 'append-only; select: owner, accountant; written only by private.write_audit()');
create policy audit_log_select on public.audit_log for select to authenticated
  using (private.has_role(org_id, array['owner', 'accountant']::public.app_role[]));
select private.register_table('job_runs', 'custom', 'select: owner for their org; written only by the service role');
create policy job_runs_select on public.job_runs for select to authenticated
  using (org_id is not null and private.has_role(org_id, array['owner']::public.app_role[]));
select private.register_table('job_schedules', 'service_only');

-- Seed the schedule the pg_cron bootstrap will drive (ADR 0004).
insert into public.job_schedules (job, cron_expr, expected_every) values
  ('refresh_today', '*/10 * * * *', interval '10 minutes'),
  ('close_business_day', '30 22 * * *', interval '1 day');

comment on table public.profiles is 'One row per auth user: display name, phone, locale. | written by: tenancy | phase: 0';
comment on table public.organizations is 'A restaurant business (tenant). | written by: tenancy | phase: 0';
comment on table public.branches is 'A restaurant location; optional business-day cutoff override. | written by: tenancy | phase: 0';
comment on table public.memberships is 'User role in an org; branch scope all or list. One role per row. | written by: tenancy | phase: 0';
comment on table public.membership_branches is 'Branch list for memberships with scope=list. | written by: tenancy | phase: 0';
comment on table public.org_settings is 'VAT/service-charge config, price basis, cutoff, dayparts, week start, locale. | written by: tenancy | phase: 0';
comment on table public.org_profile is 'Business profile: cuisine, format, price band, area, owner WhatsApp. | written by: tenancy | phase: 0';
comment on table public.org_cost_settings is 'Money-gated cost assumptions (assumed food cost %). | written by: tenancy | phase: 0';
comment on table public.org_context is 'Owner-stated goals, rules and constraints the assistant must respect. | written by: assistant | phase: 4';
comment on table public.devices is 'Registered POS/KDS/QR devices bound to a branch. | written by: tenancy | phase: 0';
comment on table public.staff is 'Shared-device staff identities (PIN users), per branch. | written by: staff | phase: 0';
comment on table public.staff_pins is 'Bcrypt PIN hashes and lockout counters. Service-only. | written by: tenancy | phase: 0';
comment on table public.staff_sessions is 'Who is acting on a device: created by start_staff_session(). | written by: tenancy | phase: 0';
comment on table public.invitations is 'Pending/accepted invites with hashed tokens. | written by: tenancy | phase: 0';
comment on table public.audit_log is 'Append-only record of sensitive actions (who, what, before/after, device). | written by: tenancy | phase: 0';
comment on table public.job_runs is 'Idempotent scheduled-job ledger per (job, org, period). | written by: jobs | phase: 0';
comment on table public.job_schedules is 'Expected job cadence; drives job_health(). | written by: jobs | phase: 0';
