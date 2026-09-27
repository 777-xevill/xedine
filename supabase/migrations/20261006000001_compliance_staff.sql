-- Phase 10 (1/N) — compliance reminders, the sales-VAT summary, and staff-lite (ROADMAP Phase 10, ADR 0023).
--   Licences: expiry status and reminders at each org-set threshold (default 60/30/7 days).
--   VAT return: a configurable due day (TODO(verify) with an accountant — never hardcoded as law).
--   Staff-lite: advances balances (money), attendance summary, sales per staff.

-- TODO(verify): the monthly VAT return due day (currently set per org; 15 is a placeholder default to confirm
-- with an accountant). Stored as config so a wrong assumption is a settings change, not a migration.
alter table public.org_settings
  add column vat_return_due_day smallint not null default 15 check (vat_return_due_day between 1 and 28);

insert into public.message_templates (key, channel, language, body, provider_template_name, variables, status)
values
  ('compliance_reminder', 'whatsapp', 'en', 'Reminder: {{1}}', 'xedine_compliance_en', '{body}', 'draft'),
  ('compliance_reminder', 'whatsapp', 'bn', 'মনে করিয়ে দিচ্ছি: {{1}}', 'xedine_compliance_bn', '{body}', 'draft')
on conflict (key, channel, language) do nothing;

-- Licence and advance changes are audited (CLAUDE.md #5).
create trigger licences_audit after insert or update or delete on public.licences
  for each row execute function private.audit_row_change('licence');
create trigger advances_audit after insert or update or delete on public.advances
  for each row execute function private.audit_row_change('advance');

-- The next VAT return due date on or after p_asof, for the org's configured due day.
create function private.vat_due(p_org uuid, p_asof date) returns date
language sql stable security definer set search_path = '' as $$
  with d as (select coalesce((select s.vat_return_due_day from public.org_settings s where s.org_id = p_org), 15) as day)
  select case when make_date(extract(year from p_asof)::integer, extract(month from p_asof)::integer, d.day) >= p_asof
              then make_date(extract(year from p_asof)::integer, extract(month from p_asof)::integer, d.day)
              else (make_date(extract(year from p_asof)::integer, extract(month from p_asof)::integer, d.day)
                    + interval '1 month')::date end
    from d
$$;

-- What is due: every licence and the next VAT return, with days left and a status band.
create function public.metric_compliance(p_org uuid, p_now timestamptz)
returns table (kind text, ref_id uuid, label text, branch_id uuid, number text, due_on date, days_left integer,
               status text, reminder_days integer[])
language plpgsql stable security definer set search_path = '' as $$
declare
  v_asof date;
  v_vat date;
begin
  if not private.is_service_role()
     and not private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_asof := private.business_date(p_now, private.org_cutoff(p_org));
  v_vat := private.vat_due(p_org, v_asof);
  return query
    select x.* from (
      select 'licence'::text, l.id, l.kind, l.branch_id, l.number, l.expires_on, (l.expires_on - v_asof)::integer,
             case when l.expires_on < v_asof then 'expired'
                  when l.expires_on - v_asof <= 7 then 'urgent'
                  when l.expires_on - v_asof <= 30 then 'due'
                  when l.expires_on - v_asof <= 60 then 'upcoming'
                  else 'ok' end,
             l.reminder_days
        from public.licences l where l.org_id = p_org
      union all
      select 'vat_return', null::uuid, to_char((v_vat - interval '1 month')::date, 'YYYY-MM'), null::uuid, null::text,
             v_vat, (v_vat - v_asof)::integer,
             case when v_vat - v_asof <= 2 then 'urgent' when v_vat - v_asof <= 7 then 'due' else 'ok' end,
             array[7, 2]
    ) x
    order by 7, 3;
end $$;

-- Reminders due today (service role, one org). Each carries a stable key — the licence (or return), its due
-- date and the threshold crossed — so the outbox sends it once however often the job runs.
create function public.job_compliance_reminders(p_org uuid, p_now timestamptz)
returns table (reminder_key text, kind text, label text, due_on date, days_left integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    with c as (select * from public.metric_compliance(p_org, p_now)),
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
revoke execute on function public.job_compliance_reminders(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.job_compliance_reminders(uuid, timestamptz) to service_role;

-- Sales-VAT summary from the stored order decomposition (ADR 0005): completed orders by branch and VAT basis.
-- A working summary for the accountant, not a Mushak return. TODO(verify) the return's fields with an accountant.
create function public.metric_vat_summary(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (branch_id uuid, vat_rate_bps integer, price_includes_vat boolean, orders bigint, net_poisha bigint,
               vat_poisha bigint, service_charge_poisha bigint, total_poisha bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'pick a period of at most a year' using errcode = 'invalid_parameter_value';
  end if;
  if not private.is_service_role() and not private.has_role(p_org, array['owner', 'accountant']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select o.branch_id, o.vat_rate_bps, o.price_includes_vat, count(*), sum(o.net_poisha)::bigint,
           sum(o.vat_poisha)::bigint, sum(o.service_charge_poisha)::bigint, sum(o.total_poisha)::bigint
      from public.orders o
     where o.org_id = p_org and o.branch_id = any (private.metric_scope(p_org, p_branch))
       and o.order_status = 'completed' and o.business_date between p_from and p_to
     group by o.branch_id, o.vat_rate_bps, o.price_includes_vat
     order by o.branch_id, o.vat_rate_bps;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Staff-lite
-- ---------------------------------------------------------------------------------------------
-- Advances: given (positive) and repaid (negative) per staff member; money (ADR 0007).
create function public.metric_advance_balances(p_org uuid, p_branch uuid)
returns table (staff_id uuid, display_name text, branch_id uuid, given_poisha bigint, repaid_poisha bigint,
               balance_poisha bigint, last_on date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_money(p_org);
  return query
    select s.id, s.display_name, s.branch_id,
           coalesce(sum(a.amount_poisha) filter (where a.amount_poisha > 0), 0)::bigint,
           coalesce(-sum(a.amount_poisha) filter (where a.amount_poisha < 0), 0)::bigint,
           coalesce(sum(a.amount_poisha), 0)::bigint, max(a.occurred_on)
      from public.staff s join public.advances a on a.org_id = s.org_id and a.staff_id = s.id
     where s.org_id = p_org and s.branch_id = any (private.metric_scope(p_org, p_branch))
     group by s.id, s.display_name, s.branch_id
     order by 6 desc, 2;
end $$;

create function public.metric_attendance(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (staff_id uuid, display_name text, branch_id uuid, present bigint, half_day bigint, on_leave bigint,
               absent bigint, unmarked bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'pick a period of at most 93 days' using errcode = 'invalid_parameter_value';
  end if;
  if not private.is_service_role()
     and not private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select s.id, s.display_name, s.branch_id,
           count(*) filter (where a.status = 'present'), count(*) filter (where a.status = 'half_day'),
           count(*) filter (where a.status = 'leave'), count(*) filter (where a.status = 'absent'),
           (p_to - p_from + 1) - count(a.id)
      from public.staff s
      left join public.attendance a on a.org_id = s.org_id and a.staff_id = s.id and a.work_date between p_from and p_to
     where s.org_id = p_org and s.is_active and s.branch_id = any (private.metric_scope(p_org, p_branch))
     group by s.id, s.display_name, s.branch_id
     order by s.display_name;
end $$;

-- Sales per staff (METRICS.md sales.per_staff): orders taken and completed net sales; exceptions alongside.
create function public.metric_staff_sales(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (staff_id uuid, staff_name text, branch_id uuid, orders bigint, completed_net_poisha bigint,
               void_after_kot_count bigint, discount_count bigint, refund_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'pick a period of at most 93 days' using errcode = 'invalid_parameter_value';
  end if;
  if not private.is_service_role()
     and not private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select x.staff_id, x.staff_name, x.branch_id, x.orders, x.completed_net_poisha, x.void_after_kot_count,
           x.discount_count, x.refund_count
      from private.m_staff_exceptions(p_org, private.metric_scope(p_org, p_branch), p_from, p_to) x
     order by x.completed_net_poisha desc;
end $$;

-- Mark attendance for one staff member and day (owner/manager of that branch); re-marking updates.
create function public.mark_attendance(p_staff uuid, p_date date, p_status public.attendance_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.staff;
begin
  select * into s from public.staff where id = p_staff;
  if not found or not private.can_access_branch_role(s.org_id, s.branch_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  insert into public.attendance (org_id, branch_id, staff_id, work_date, status)
  values (s.org_id, s.branch_id, s.id, p_date, p_status)
  on conflict (org_id, staff_id, work_date) do update set status = excluded.status;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'private' and p.proname in ('vat_due'))
        or (n.nspname = 'public' and p.proname in ('metric_compliance', 'metric_vat_summary', 'metric_advance_balances',
              'metric_attendance', 'metric_staff_sales', 'mark_attendance'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

comment on function public.metric_compliance is 'Licences and the next VAT return with days left and a status band. Phase 10.';
comment on function public.job_compliance_reminders is 'Reminders due today with stable keys (service role). Phase 10.';
comment on function public.metric_vat_summary is 'Sales-VAT working summary from stored order decomposition; not a Mushak return (TODO verify). Phase 10.';
comment on function public.metric_advance_balances is 'Staff advances given, repaid and outstanding (money). Phase 10.';
comment on function public.metric_attendance is 'Attendance counts per staff over a period. Phase 10.';
comment on function public.metric_staff_sales is 'sales.per_staff with exceptions alongside. Phase 10.';
