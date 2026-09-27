-- Phase 10 fixes from the phase-reviewer pass (ADR 0023):
--   1. licences was registered scope='org' (like advances, an owner/accountant-only table), but any
--      manager can read it — so a manager scoped to one branch could see every branch's licence numbers
--      and expiry dates, both directly and through metric_compliance. Re-register it scope='branch', like
--      attendance: owner and accountant always see everything (branch_scope = 'all' is enforced by a table
--      constraint on their memberships, foundation migration), a manager sees only their own branch(es).
--   2. (TS-only) the growth-idea number check missed the title and shot list.
--   3. (TS-only) reading a menu photo could be triggered by any member, not just the owner.
-- This migration covers (1); (2) and (3) are fixed in the same commit's application code.

drop policy if exists licences_select on public.licences;
drop policy if exists licences_insert on public.licences;
drop policy if exists licences_update on public.licences;
drop policy if exists licences_delete on public.licences;
create policy licences_select on public.licences for select to authenticated
  using (private.can_access_branch_role(org_id, branch_id, array['owner', 'manager', 'accountant']::public.app_role[]));
create policy licences_insert on public.licences for insert to authenticated
  with check (private.can_access_branch_role(org_id, branch_id, array['owner']::public.app_role[]));
create policy licences_update on public.licences for update to authenticated
  using (private.can_access_branch_role(org_id, branch_id, array['owner']::public.app_role[]))
  with check (private.can_access_branch_role(org_id, branch_id, array['owner']::public.app_role[]));
create policy licences_delete on public.licences for delete to authenticated
  using (private.can_access_branch_role(org_id, branch_id, array['owner']::public.app_role[]));
update private.policy_registry set scope = 'branch' where table_name = 'licences';

-- An org-wide licence (branch_id is null) has no branch to check against — can_access_branch_role would
-- always fail it, so treat a null branch_id as visible/writable by role alone, org-wide.
create or replace function private.can_access_branch_role(p_org uuid, p_branch uuid, p_roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role = any (p_roles)
      and (
        p_branch is null
        or m.branch_scope = 'all'
        or exists (
          select 1 from public.membership_branches mb
          where mb.membership_id = m.id and mb.branch_id = p_branch
        )
      )
  )
$$;

drop function public.metric_compliance(uuid, timestamptz);

-- What is due: licences the caller's branch scope can see, plus the org-wide VAT return, with days left
-- and a status band. A manager restricted to one branch no longer sees another branch's licence numbers.
create function public.metric_compliance(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (kind text, ref_id uuid, label text, branch_id uuid, number text, due_on date, days_left integer,
               status text, reminder_days integer[])
language plpgsql stable security definer set search_path = '' as $$
declare
  v_asof date;
  v_vat date;
  v_scope uuid[];
begin
  if not private.is_service_role()
     and not private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_asof := private.business_date(p_now, private.org_cutoff(p_org));
  v_vat := private.vat_due(p_org, v_asof);
  -- An accountant has no branch memberships (org-level role), so scope by role, not can_access_branch.
  v_scope := case when private.is_service_role() or private.has_role(p_org, array['owner', 'accountant']::public.app_role[])
                  then (select coalesce(array_agg(b.id), '{}') from public.branches b where b.org_id = p_org)
                  else private.metric_scope(p_org, p_branch) end;
  return query
    select x.* from (
      select 'licence'::text, l.id, l.kind, l.branch_id, l.number, l.expires_on, (l.expires_on - v_asof)::integer,
             case when l.expires_on < v_asof then 'expired'
                  when l.expires_on - v_asof <= 7 then 'urgent'
                  when l.expires_on - v_asof <= 30 then 'due'
                  when l.expires_on - v_asof <= 60 then 'upcoming'
                  else 'ok' end,
             l.reminder_days
        from public.licences l
       where l.org_id = p_org and (l.branch_id is null or l.branch_id = any (v_scope))
      union all
      select 'vat_return', null::uuid, to_char((v_vat - interval '1 month')::date, 'YYYY-MM'), null::uuid, null::text,
             v_vat, (v_vat - v_asof)::integer,
             case when v_vat - v_asof <= 2 then 'urgent' when v_vat - v_asof <= 7 then 'due' else 'ok' end,
             array[7, 2]
    ) x
    order by 7, 3;
end $$;

create or replace function public.job_compliance_reminders(p_org uuid, p_now timestamptz)
returns table (reminder_key text, kind text, label text, due_on date, days_left integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    with c as (select * from public.metric_compliance(p_org, null, p_now)),
    t as (
      select c.*, case when c.days_left < 0 then 'expired'
                       else (select min(x)::text from unnest(c.reminder_days) x where x >= c.days_left) end as threshold
        from c
    )
    select t.kind || ':' || coalesce(t.ref_id::text, t.label) || ':' || t.due_on || ':' || t.threshold,
           t.kind, t.label, t.due_on, t.days_left
      from t
     where t.threshold is not null and (t.days_left >= -30);
end $$;

revoke execute on function public.metric_compliance(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.metric_compliance(uuid, uuid, timestamptz) to authenticated, service_role;

comment on function public.metric_compliance is 'Licences in the caller''s branch scope, plus the org-wide VAT return. Phase 10.';
