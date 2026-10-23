-- ---------------------------------------------------------------------------------------------
-- Discount codes (ADR 0038). The owner or a manager makes a secret code (EID10: 10% off); the
-- restaurant gives it to a customer; the cashier types it in "Apply discount" at the till and the
-- bill drops by the code's percent. A code can be limited to a number of bills and/or an end date.
--
--  * discount_codes: read and written by owner + manager only (a cashier never lists the codes).
--  * discounts.discount_code_id: which code gave a discount, so uses can be counted.
--  * apply_discount_code(): the only way a code is used; it needs no manager PIN because the owner
--    or manager already decided the discount when they made the code.
-- ---------------------------------------------------------------------------------------------

create table public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Capital letters and digits only, so a cashier never has to match dashes, spaces or case.
  code text not null constraint discount_codes_code check (code ~ '^[A-Z0-9]{4,20}$'),
  percent_bps integer not null constraint discount_codes_percent check (percent_bps between 1 and 10000),
  -- null = no limit on how many bills; ends_on null = no end date (inclusive, in business days).
  max_uses integer constraint discount_codes_max_uses check (max_uses is null or max_uses between 1 and 100000),
  ends_on date,
  note text constraint discount_codes_note check (note is null or length(note) <= 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, code)
);

alter table public.discounts add column discount_code_id uuid;
alter table public.discounts
  add constraint discounts_discount_code_fk
  foreign key (org_id, discount_code_id) references public.discount_codes (org_id, id)
  on delete set null (discount_code_id);
create index discounts_code_idx on public.discounts (org_id, discount_code_id) where discount_code_id is not null;

select private.apply_policies('discount_codes', 'org',
  array['owner', 'manager']::public.app_role[], array['owner', 'manager']::public.app_role[], true,
  'secret codes: a cashier uses one through apply_discount_code and never lists them (ADR 0038)');

comment on table public.discount_codes is 'Secret discount codes the restaurant gives customers: percent off, optional limit and end date. | written by: pos | phase: 11';

-- ---------------------------------------------------------------------------------------------
-- How many bills each code is on. A use is a bill whose current (latest) order-level discount is this
-- code, so a cancelled bill, or a bill where the code was replaced by another discount, gives the use
-- back. p_code limits it to one code; p_except_order leaves out the bill being discounted now.
-- ---------------------------------------------------------------------------------------------
create function private.discount_code_uses(p_org uuid, p_code uuid default null, p_except_order uuid default null)
returns table (discount_code_id uuid, uses bigint)
language sql stable security definer set search_path = '' as $$
  select x.discount_code_id, count(*)
    from (select distinct on (d.order_id) d.discount_code_id
            from public.discounts d
            join public.orders o on o.org_id = d.org_id and o.id = d.order_id
           where d.org_id = p_org and d.order_item_id is null
             and o.order_status <> 'cancelled' and o.id is distinct from p_except_order
             and exists (select 1 from public.discounts c
                          where c.org_id = p_org and c.order_id = d.order_id
                            and c.discount_code_id is not null
                            and (p_code is null or c.discount_code_id = p_code))
           order by d.order_id, d.created_at desc, d.id desc) x
   where x.discount_code_id is not null and (p_code is null or x.discount_code_id = p_code)
   group by x.discount_code_id
$$;
revoke execute on function private.discount_code_uses(uuid, uuid, uuid) from public, anon, authenticated;

-- The owner's and managers' list of codes shows these counts (a branch manager sees every branch's uses).
create function public.discount_code_uses(p_org uuid)
returns table (discount_code_id uuid, uses bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query select u.discount_code_id, u.uses from private.discount_code_uses(p_org) u;
end $$;
revoke execute on function public.discount_code_uses(uuid) from public, anon;
grant execute on function public.discount_code_uses(uuid) to authenticated, service_role;
comment on function public.discount_code_uses is 'How many bills each discount code is on, for the owner and managers (ADR 0038).';

-- ---------------------------------------------------------------------------------------------
-- Using a code on an open order. Same rules as apply_order_discount (open order, latest discount
-- wins, never overpay), plus: the code must exist and be on, not past its end date, and not used up.
-- The code row is locked, so two tills cannot both take the last use.
-- ---------------------------------------------------------------------------------------------
create function public.apply_discount_code(
  p_org uuid, p_branch uuid, p_order uuid, p_code text, p_device uuid, p_staff uuid
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_code public.discount_codes;
  v_clean text;
  v_used integer;
  v_discount bigint;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);

  v_clean := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into v_order from public.orders where org_id = p_org and id = p_order and branch_id = p_branch for update;
  if not found then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  if v_order.order_status = 'cancelled' or v_order.payment_status not in ('unpaid', 'partially_paid') then
    raise exception 'cannot discount a paid or closed order' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_code from public.discount_codes c where c.org_id = p_org and c.code = v_clean for update;
  if not found or not v_code.is_active then
    raise exception 'code_not_found' using errcode = 'invalid_parameter_value';
  end if;
  if v_code.ends_on is not null and v_order.business_date > v_code.ends_on then
    raise exception 'code_expired' using errcode = 'invalid_parameter_value';
  end if;
  if v_code.max_uses is not null then
    select coalesce(max(u.uses), 0) into v_used from private.discount_code_uses(p_org, v_code.id, p_order) u;
    if v_used >= v_code.max_uses then
      raise exception 'code_used_up' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  v_discount := round(v_order.gross_poisha * v_code.percent_bps / 10000.0);
  if v_discount <= 0 then
    raise exception 'the discount rounds to zero' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.discounts (org_id, branch_id, order_id, amount_poisha, percent_bps, reason_note,
    applied_by_staff_id, discount_code_id)
  values (p_org, p_branch, p_order, v_discount, v_code.percent_bps, 'Code ' || v_code.code, p_staff, v_code.id);

  v_order := private.recompute_order_totals(p_org, p_order);
  if v_order.total_poisha < private.paid_poisha(p_org, p_order) then
    raise exception 'this discount would leave the order overpaid' using errcode = 'invalid_parameter_value';
  end if;
  perform private.write_audit(p_org, p_branch, 'order.discount', 'order', p_order::text, null,
    jsonb_build_object('percent_bps', v_code.percent_bps, 'discount_poisha', v_order.discount_poisha,
                       'discount_code', v_code.code),
    'Code ' || v_code.code, p_device, p_staff);
  return v_order;
end $$;

revoke execute on function public.apply_discount_code(uuid, uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.apply_discount_code(uuid, uuid, uuid, text, uuid, uuid) to authenticated, service_role;
comment on function public.apply_discount_code is 'A cashier types a customer''s secret code: percent off the open order, limited by uses and end date (ADR 0038).';
