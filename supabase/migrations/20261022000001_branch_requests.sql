-- ADR 0036: a new branch needs the platform operator's approval. The owner asks (name + area); a platform
-- admin approves or declines in the admin console. Only the approval creates the branch, with its
-- default "Kitchen" station, so adding a branch can never raise an org's monthly bill (per branch, ADR 0008)
-- without the operator knowing. Direct inserts into public.branches by clients are closed.

create table public.branch_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (btrim(name) <> '' and char_length(name) <= 80),
  area text check (char_length(area) <= 80),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  requested_by uuid not null references auth.users (id),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 300),
  branch_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete set null (branch_id)
);
create index branch_requests_org_idx on public.branch_requests (org_id, created_at desc);
create index branch_requests_branch_idx on public.branch_requests (org_id, branch_id) where branch_id is not null;
-- One open ask per name, so a double tap does not queue the same branch twice.
create unique index branch_requests_open_name_uniq on public.branch_requests (org_id, lower(btrim(name)))
  where status = 'pending';

-- The owner reads the requests of their own restaurant. Every write goes through the functions below.
create policy branch_requests_select on public.branch_requests for select to authenticated
  using (private.has_role(org_id, array['owner']::public.app_role[]));
select private.register_table('branch_requests', 'custom',
  'select: owner; writes only via request_branch / cancel_branch_request / admin_decide_branch_request');
revoke insert, update, delete, truncate on table public.branch_requests from anon, authenticated;
comment on table public.branch_requests is 'An owner''s ask for a new branch, decided by a platform admin. | written by: tenancy | phase: 11';

-- Only the approval creates a branch (create_organization() and the functions below are definer).
drop policy branches_insert on public.branches;
select private.register_table('branches', 'custom',
  'select: members with access to the branch; update: owner; create only via create_organization() or an approved branch request');

create function public.request_branch(p_org uuid, p_name text, p_area text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_area text := nullif(btrim(coalesce(p_area, '')), '');
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'only the owner can ask for a branch' using errcode = 'insufficient_privilege';
  end if;
  if v_name = '' or char_length(v_name) > 80 or char_length(coalesce(v_area, '')) > 80 then
    raise exception 'a branch needs a name' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.branches b where b.org_id = p_org and lower(b.name) = lower(v_name)) then
    raise exception 'branch name already used' using errcode = 'unique_violation';
  end if;
  insert into public.branch_requests (org_id, name, area, requested_by)
  values (p_org, v_name, v_area, (select auth.uid()))
  returning id into v_id;
  perform private.write_audit(p_org, null, 'branch.request', 'branch_request', v_id::text, null,
    jsonb_build_object('name', v_name, 'area', v_area), null);
  return v_id;
end $$;

create function public.cancel_branch_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.branch_requests;
begin
  select * into r from public.branch_requests where id = p_request for update;
  if not found or not private.has_role(r.org_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if r.status <> 'pending' then
    raise exception 'this request was already decided' using errcode = 'invalid_parameter_value';
  end if;
  update public.branch_requests set status = 'cancelled', decided_at = now() where id = p_request;
  perform private.write_audit(r.org_id, null, 'branch.request_cancel', 'branch_request', p_request::text, null, null, null);
end $$;

-- The operator's inbox: open requests with what the extra branch adds to the monthly bill. Metadata only.
create function public.admin_branch_requests(p_now timestamptz)
returns table (id uuid, org_id uuid, org_name text, slug text, name text, area text, status text,
               created_at timestamptz, branches bigint, plan_code text, price_per_branch_poisha bigint,
               pilot_discount_bps integer, decision_note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select r.id, r.org_id, o.name, o.slug, r.name, r.area, r.status, r.created_at, p.branches, p.plan_code,
           p.price_per_branch_poisha, p.pilot_discount_bps, r.decision_note
      from public.branch_requests r
      join public.organizations o on o.id = r.org_id
      cross join lateral private.org_plan(r.org_id, p_now) p
     where r.status = 'pending' or r.decided_at > p_now - interval '14 days'
     order by (r.status = 'pending') desc, r.created_at desc;
end $$;

create function public.admin_decide_branch_request(p_request uuid, p_approve boolean, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r public.branch_requests;
  v_branch uuid;
  v_bn boolean;
begin
  if not private.is_platform_admin() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.branch_requests where id = p_request for update;
  if not found or r.status <> 'pending' then
    raise exception 'request not found or already decided' using errcode = 'invalid_parameter_value';
  end if;
  if p_approve then
    insert into public.branches (org_id, name, area) values (r.org_id, r.name, r.area)
    returning id into v_branch;
    select coalesce(default_locale = 'bn', true) into v_bn from public.org_settings where org_id = r.org_id;
    insert into public.stations (org_id, branch_id, name)
    values (r.org_id, v_branch, case when v_bn then 'রান্নাঘর' else 'Kitchen' end)
    on conflict (org_id, branch_id, name) do nothing;
  end if;
  update public.branch_requests
     set status = case when p_approve then 'approved' else 'declined' end,
         decided_by = (select auth.uid()), decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), ''), branch_id = v_branch
   where id = p_request;
  perform private.write_audit(r.org_id, v_branch, case when p_approve then 'branch.approve' else 'branch.decline' end,
    'branch_request', p_request::text, jsonb_build_object('name', r.name, 'area', r.area),
    jsonb_build_object('status', case when p_approve then 'approved' else 'declined' end), 'platform admin');
  return v_branch;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('request_branch', 'cancel_branch_request', 'admin_branch_requests', 'admin_decide_branch_request')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

comment on function public.request_branch is 'Owner asks for a new branch; a platform admin must approve it. ADR 0036.';
comment on function public.admin_decide_branch_request is 'Platform admin approves (creates the branch + a Kitchen station) or declines; audited. ADR 0036.';
