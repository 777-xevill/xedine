-- ADR 0060: Costs in two sections — Rent & bills, and Salaries — and the owner marks who has been paid.
--
--  * salary_entries gains what was actually paid (amount, day, how) so the owner no longer keeps it on paper.
--    The cost of a month is still salary + allowances (accrual); "paid" never changes a profit figure.
--  * Every change to a salary or a fixed cost is audited by a row trigger, whichever way it is written.
--  * Owner-only functions (money is sensitive, ADR 0007): save_salary, mark_salary_paid, mark_salaries_paid,
--    copy_salaries_from_previous_month, update_fixed_cost. An edited fixed-cost amount starts a new row from
--    today, so past days' profit does not move (the old row ends yesterday).

alter table public.salary_entries
  add column paid_poisha bigint not null default 0 check (paid_poisha >= 0),
  add column paid_on date,
  add column paid_method text check (paid_method in ('cash', 'bkash', 'nagad', 'bank', 'other')),
  add constraint salary_entries_paid_shape check (
    (paid_poisha = 0 and paid_on is null and paid_method is null)
    or (paid_poisha > 0 and paid_on is not null and paid_method is not null)
  );

comment on column public.salary_entries.paid_poisha is 'How much of this month''s pay (salary + allowances) has been paid so far.';

create trigger salary_entries_audit after insert or update or delete on public.salary_entries
  for each row execute function private.audit_row_change('salary');
create trigger fixed_costs_audit after insert or update or delete on public.fixed_costs
  for each row execute function private.audit_row_change('fixed_cost');

-- ---------------------------------------------------------------------------------------------
-- Salaries
-- ---------------------------------------------------------------------------------------------
create function public.save_salary(
  p_org uuid, p_staff uuid, p_month date, p_salary bigint, p_allowances bigint, p_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid;
  v_paid bigint;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'only the owner can change salaries' using errcode = 'insufficient_privilege';
  end if;
  if p_salary is null or p_salary < 0 or coalesce(p_allowances, 0) < 0 or char_length(coalesce(v_note, '')) > 300
     or p_month <> date_trunc('month', p_month)::date then
    raise exception 'invalid salary' using errcode = 'invalid_parameter_value';
  end if;
  select branch_id into v_branch from public.staff where org_id = p_org and id = p_staff;
  if v_branch is null then
    raise exception 'staff not found' using errcode = 'invalid_parameter_value';
  end if;
  select paid_poisha into v_paid from public.salary_entries
   where org_id = p_org and staff_id = p_staff and month = p_month;
  if coalesce(v_paid, 0) > p_salary + coalesce(p_allowances, 0) then
    raise exception 'pay is lower than what was already paid' using errcode = 'check_violation';
  end if;
  insert into public.salary_entries (org_id, branch_id, staff_id, month, salary_poisha, allowances_poisha, notes)
  values (p_org, v_branch, p_staff, p_month, p_salary, coalesce(p_allowances, 0), v_note)
  on conflict (org_id, staff_id, month) do update
     set salary_poisha = excluded.salary_poisha, allowances_poisha = excluded.allowances_poisha,
         notes = excluded.notes;
end $$;

-- p_amount null = the whole pay; 0 = not paid (undo). Part payments are allowed up to the pay.
create function public.mark_salary_paid(
  p_org uuid, p_staff uuid, p_month date, p_amount bigint, p_paid_on date, p_method text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.salary_entries;
  v_amount bigint;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'only the owner can mark salaries paid' using errcode = 'insufficient_privilege';
  end if;
  select * into e from public.salary_entries where org_id = p_org and staff_id = p_staff and month = p_month for update;
  if not found then
    raise exception 'enter the pay first' using errcode = 'invalid_parameter_value';
  end if;
  v_amount := coalesce(p_amount, e.salary_poisha + e.allowances_poisha);
  if v_amount < 0 or v_amount > e.salary_poisha + e.allowances_poisha then
    raise exception 'paid more than the pay' using errcode = 'check_violation';
  end if;
  if v_amount = 0 then
    update public.salary_entries set paid_poisha = 0, paid_on = null, paid_method = null where id = e.id;
  else
    if p_paid_on is null or p_method is null then
      raise exception 'say when and how it was paid' using errcode = 'invalid_parameter_value';
    end if;
    update public.salary_entries set paid_poisha = v_amount, paid_on = p_paid_on, paid_method = p_method where id = e.id;
  end if;
end $$;

-- "Mark all paid": everyone with pay entered and still owed, paid in full the same day the same way.
create function public.mark_salaries_paid(p_org uuid, p_month date, p_paid_on date, p_method text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'only the owner can mark salaries paid' using errcode = 'insufficient_privilege';
  end if;
  if p_paid_on is null or p_method not in ('cash', 'bkash', 'nagad', 'bank', 'other') then
    raise exception 'say when and how it was paid' using errcode = 'invalid_parameter_value';
  end if;
  update public.salary_entries e
     set paid_poisha = e.salary_poisha + e.allowances_poisha, paid_on = p_paid_on, paid_method = p_method
   where e.org_id = p_org and e.month = p_month
     and e.salary_poisha + e.allowances_poisha > 0
     and e.paid_poisha < e.salary_poisha + e.allowances_poisha
     and exists (select 1 from public.staff s where s.org_id = e.org_id and s.id = e.staff_id and s.is_active);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Same pay as last month for everyone still active who has none this month (nothing is marked paid).
create function public.copy_salaries_from_previous_month(p_org uuid, p_month date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'only the owner can change salaries' using errcode = 'insufficient_privilege';
  end if;
  insert into public.salary_entries (org_id, branch_id, staff_id, month, salary_poisha, allowances_poisha)
  select p.org_id, s.branch_id, p.staff_id, p_month, p.salary_poisha, p.allowances_poisha
    from public.salary_entries p
    join public.staff s on s.org_id = p.org_id and s.id = p.staff_id and s.is_active
   where p.org_id = p_org and p.month = (p_month - interval '1 month')::date
  on conflict (org_id, staff_id, month) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Rent & bills
-- ---------------------------------------------------------------------------------------------
create function public.update_fixed_cost(
  p_org uuid, p_id uuid, p_kind public.fixed_cost_kind, p_label text, p_monthly bigint, p_today date
) returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.fixed_costs;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'only the owner can change costs' using errcode = 'insufficient_privilege';
  end if;
  if p_monthly is null or p_monthly < 0 or char_length(coalesce(v_label, '')) > 120 or p_today is null then
    raise exception 'invalid cost' using errcode = 'invalid_parameter_value';
  end if;
  select * into c from public.fixed_costs where org_id = p_org and id = p_id for update;
  if not found or (c.effective_to is not null and c.effective_to < p_today) then
    raise exception 'cost not found' using errcode = 'invalid_parameter_value';
  end if;
  if c.monthly_poisha = p_monthly or c.effective_from >= p_today then
    -- Same amount (only the words changed), or it started today: change it in place.
    update public.fixed_costs set kind = p_kind, label = v_label, monthly_poisha = p_monthly where id = c.id;
  else
    -- A new amount counts from today; the days before keep the old one.
    update public.fixed_costs set effective_to = p_today - 1 where id = c.id;
    insert into public.fixed_costs (org_id, branch_id, kind, label, monthly_poisha, effective_from)
    values (p_org, c.branch_id, p_kind, v_label, p_monthly, p_today);
  end if;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('save_salary', 'mark_salary_paid', 'mark_salaries_paid',
                         'copy_salaries_from_previous_month', 'update_fixed_cost')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

comment on function public.save_salary is 'Owner sets a month''s salary and extra pay for one person; audited by trigger. ADR 0060.';
comment on function public.mark_salary_paid is 'Owner marks a month''s pay paid (all, part, or none) with day and method. ADR 0060.';
comment on function public.mark_salaries_paid is 'Owner marks every still-owed active person paid in full. ADR 0060.';
comment on function public.update_fixed_cost is 'Owner edits a rent/bill; a new amount starts today so past days keep the old one. ADR 0060.';
