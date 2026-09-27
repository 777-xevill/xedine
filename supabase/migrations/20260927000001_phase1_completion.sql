-- Phase 1 completion (ADR 0014): POS integrity and the remaining order lifecycle.
--
--   1. Order tables become writable only through the audited RPCs (no direct client INSERT/UPDATE).
--   2. Sensitive actions take a single-use manager approval (approve_action) instead of trusting a
--      long-lived manager staff session that happens to be open on the till.
--   3. Fixes: the void/close-shift approver role was checked against the browser login, not the
--      PIN'd staff member; cash change inflated expected cash; voids after a discount left the
--      discount behind; 86'd items were still sellable; paying an order closed its kitchen ticket.
--   4. New: add a round to an open order, cancel an unpaid order, refunds, a customer at the till,
--      daily order numbers, offline provisional receipt numbers, price history, staff guard,
--      receipt settings (Mushak-6.3-ready, TODO verify) and default channels/reasons for new orgs.

-- ---------------------------------------------------------------------------------------------
-- Types and columns
-- ---------------------------------------------------------------------------------------------
-- New event types are only referenced inside function bodies below, never at migration time.
alter type public.order_event_type add value if not exists 'items_added';
alter type public.order_event_type add value if not exists 'customer_attached';

create type public.approval_action as enum ('void_after_kot', 'refund', 'discount', 'close_shift', 'cancel_order');

-- What the customer handed over. amount_poisha is what was applied to the bill, so cash change
-- never inflates the till's expected cash.
alter table public.payments add column tendered_poisha bigint
  check (tendered_poisha is null or tendered_poisha >= amount_poisha);

alter table public.refunds add column shift_id uuid;
alter table public.refunds add column idempotency_key text;
alter table public.refunds add constraint refunds_shift_fk
  foreign key (org_id, shift_id) references public.shifts (org_id, id) on delete set null (shift_id);
alter table public.refunds add constraint refunds_idempotency_key_key unique (org_id, idempotency_key);
create index refunds_shift_idx on public.refunds (org_id, shift_id) where shift_id is not null;

-- Idempotency for "add a round" calls from an offline-capable till.
alter table public.order_items add column batch_key text;

-- A branch row can mean "86 this item here" without pinning a price: then the item keeps following
-- its base price. Without this flag, 86-ing an item froze a stale copy of the base price.
alter table public.branch_item_prices add column has_price_override boolean not null default true;

create or replace function private.resolve_item_price(p_org uuid, p_branch uuid, p_menu_item uuid, p_variant uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select bip.price_poisha from public.branch_item_prices bip
     where bip.org_id = p_org and bip.branch_id = p_branch and bip.menu_item_id = p_menu_item
       and bip.variant_id is not distinct from p_variant and bip.is_available and bip.has_price_override),
    (select mi.base_price_poisha + coalesce((select iv.price_delta_poisha from public.item_variants iv
                                              where iv.org_id = p_org and iv.id = p_variant), 0)
     from public.menu_items mi where mi.org_id = p_org and mi.id = p_menu_item and mi.is_active)
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Single-use manager approvals
-- ---------------------------------------------------------------------------------------------
create table public.staff_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  device_id uuid not null,
  approver_staff_id uuid not null,
  action public.approval_action not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_staff_id uuid,
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, device_id) references public.devices (org_id, id) on delete cascade,
  foreign key (org_id, approver_staff_id) references public.staff (org_id, id) on delete cascade,
  foreign key (org_id, used_by_staff_id) references public.staff (org_id, id) on delete set null (used_by_staff_id)
);
create index staff_approvals_branch_idx on public.staff_approvals (org_id, branch_id, created_at desc);
select private.register_table('staff_approvals', 'service_only',
  'single-use manager approvals: created by approve_action(), consumed by the order RPCs');
comment on table public.staff_approvals is
  'Single-use manager PIN approvals for sensitive POS actions (2-minute expiry). Service-only. | written by: pos | phase: 1';

-- ---------------------------------------------------------------------------------------------
-- Receipt settings (Mushak-6.3-ready fields are TODO(verify) with a local accountant)
-- ---------------------------------------------------------------------------------------------
create table public.org_receipt_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  legal_name text,
  -- TODO(verify): BIN and the rest of the Mushak 6.3 layout must be confirmed before receipts are
  -- presented as compliant (PRODUCT.md, ADR 0012 §2).
  bin text,
  address text,
  phone text,
  footer text,
  updated_at timestamptz not null default now()
);
create trigger org_receipt_settings_touch before update on public.org_receipt_settings
  for each row execute function private.touch_updated_at();
create trigger org_receipt_settings_audit after insert or update on public.org_receipt_settings
  for each row execute function private.audit_row_change('org_receipt_settings');
select private.apply_policies('org_receipt_settings', 'org', private.roles_all(), array['owner']::public.app_role[]);
comment on table public.org_receipt_settings is
  'Receipt header/footer and Mushak-6.3-ready fields (TODO verify). | written by: pos | phase: 1';

-- ---------------------------------------------------------------------------------------------
-- 1. Order tables: reads stay as before; every write goes through an audited RPC.
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['orders', 'order_items', 'order_item_modifiers', 'order_events', 'payments',
                           'discounts', 'refunds', 'voids', 'shifts', 'cash_counts'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('revoke insert, update, delete, truncate on table public.%I from authenticated', t);
    update private.policy_registry
       set write_roles = '{}', allow_delete = false,
           notes = 'written only by the audited POS RPCs (ADR 0014)'
     where table_name = t;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Staff: a branch manager cannot mint, promote or re-PIN a manager-level identity (that would let
-- them approve their own voids as "someone else"). Every staff change is audited (CLAUDE.md #5).
-- ---------------------------------------------------------------------------------------------
create function private.guard_staff_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Seed and service-role paths carry no end-user identity; RLS already keeps anon out.
  if (select auth.uid()) is null then return new; end if;
  if private.has_role(new.org_id, array['owner']::public.app_role[]) then return new; end if;
  if new.role in ('owner', 'manager') then
    raise exception 'only the owner can give a staff member the manager or owner role'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and old.role in ('owner', 'manager') then
    raise exception 'only the owner can change a manager-level staff member'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger staff_guard before insert or update on public.staff
  for each row execute function private.guard_staff_change();
create trigger staff_audit after insert or update on public.staff
  for each row execute function private.audit_row_change('staff');

create or replace function public.set_staff_pin(p_staff uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_staff public.staff;
begin
  select * into v_staff from public.staff where id = p_staff;
  if not found or not private.can_access_branch_role(v_staff.org_id, v_staff.branch_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'staff member not found' using errcode = 'no_data_found';
  end if;
  if v_staff.role in ('owner', 'manager')
     and not private.has_role(v_staff.org_id, array['owner']::public.app_role[])
     and v_staff.user_id is distinct from (select auth.uid()) then
    raise exception 'only the owner can set a manager-level PIN' using errcode = 'insufficient_privilege';
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

-- ---------------------------------------------------------------------------------------------
-- Menu: price history and an audit trail for price edits (CLAUDE.md #5).
-- ---------------------------------------------------------------------------------------------
create function private.record_price_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'menu_items' then
    if new.base_price_poisha is distinct from old.base_price_poisha then
      insert into public.price_history (org_id, branch_id, menu_item_id, variant_id, old_price_poisha, new_price_poisha, changed_by)
      values (new.org_id, null, new.id, null, old.base_price_poisha, new.base_price_poisha, (select auth.uid()));
    end if;
  elsif not new.has_price_override then
    null; -- an availability-only row (86) sets no price
  elsif tg_op = 'INSERT' or not old.has_price_override then
    insert into public.price_history (org_id, branch_id, menu_item_id, variant_id, old_price_poisha, new_price_poisha, changed_by)
    values (new.org_id, new.branch_id, new.menu_item_id, new.variant_id, null, new.price_poisha, (select auth.uid()));
  elsif new.price_poisha is distinct from old.price_poisha then
    insert into public.price_history (org_id, branch_id, menu_item_id, variant_id, old_price_poisha, new_price_poisha, changed_by)
    values (new.org_id, new.branch_id, new.menu_item_id, new.variant_id, old.price_poisha, new.price_poisha, (select auth.uid()));
  end if;
  return new;
end $$;
create trigger menu_items_price_history after update of base_price_poisha on public.menu_items
  for each row execute function private.record_price_change();
create trigger branch_item_prices_price_history after insert or update of price_poisha, has_price_override
  on public.branch_item_prices
  for each row execute function private.record_price_change();
create trigger menu_items_audit after update on public.menu_items
  for each row execute function private.audit_row_change('menu_item');
create trigger branch_item_prices_audit after insert or update on public.branch_item_prices
  for each row execute function private.audit_row_change('branch_item_price');

-- ---------------------------------------------------------------------------------------------
-- Customers at the till: +880 mobile numbers only, masked wherever they are logged (CLAUDE.md #8).
-- TS twin: src/lib/phone.ts (same cases in both test suites).
-- ---------------------------------------------------------------------------------------------
create function private.normalize_bd_phone(p_phone text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := translate(regexp_replace(coalesce(p_phone, ''), '[[:space:]()-]', '', 'g'), '০১২৩৪৫৬৭৮৯', '0123456789');
begin
  if v ~ '^01[3-9][0-9]{8}$' then v := '+88' || v;
  elsif v ~ '^8801[3-9][0-9]{8}$' then v := '+' || v;
  elsif v ~ '^008801[3-9][0-9]{8}$' then v := '+' || substr(v, 3);
  end if;
  if v ~ '^\+8801[3-9][0-9]{8}$' then return v; end if;
  return null;
end $$;

create function private.mask_phone(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case when p_phone is null then null
              else left(p_phone, 6) || repeat('*', greatest(length(p_phone) - 8, 0)) || right(p_phone, 2) end
$$;

-- ---------------------------------------------------------------------------------------------
-- PIN check without raising (a raise would roll back the failed-attempt counter). Same lockout as
-- start_staff_session: five misses lock the PIN for five minutes.
-- ---------------------------------------------------------------------------------------------
create function private.check_staff_pin(p_org uuid, p_branch uuid, p_device uuid, p_staff uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pin public.staff_pins;
  v_failed integer;
begin
  select * into v_pin from public.staff_pins where staff_id = p_staff for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_pin');
  end if;
  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_pin.locked_until);
  end if;
  if v_pin.pin_hash = extensions.crypt(coalesce(p_pin, ''), v_pin.pin_hash) then
    update public.staff_pins set failed_attempts = 0, locked_until = null where staff_id = p_staff;
    return jsonb_build_object('ok', true);
  end if;
  v_failed := v_pin.failed_attempts + 1;
  if v_failed >= 5 then
    update public.staff_pins set failed_attempts = 0, locked_until = now() + interval '5 minutes' where staff_id = p_staff;
  else
    update public.staff_pins set failed_attempts = v_failed where staff_id = p_staff;
  end if;
  perform private.write_audit(p_org, p_branch, 'staff.pin_failed', 'staff', p_staff::text, null,
    jsonb_build_object('failed_attempts', v_failed), null, p_device, p_staff);
  return jsonb_build_object('ok', false, 'reason', case when v_failed >= 5 then 'locked' else 'wrong_pin' end,
                            'attempts_left', greatest(5 - v_failed, 0));
end $$;

-- A manager (or the owner) types their PIN on this till for one named action. The approval is
-- single-use and expires in two minutes, so it can never be replayed later from the same device.
create function public.approve_action(p_device uuid, p_approver_staff uuid, p_pin text, p_action public.approval_action)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_dev public.devices;
  v_staff public.staff;
  v_check jsonb;
  v_id uuid;
begin
  select * into v_dev from public.devices where id = p_device;
  select * into v_staff from public.staff where id = p_approver_staff;
  if v_dev.id is null or v_staff.id is null
     or v_dev.org_id <> v_staff.org_id or v_dev.branch_id <> v_staff.branch_id
     or v_dev.status <> 'active' or not v_staff.is_active
     or not private.can_access_branch_role(v_dev.org_id, v_dev.branch_id,
          array['owner', 'manager', 'cashier', 'kitchen']::public.app_role[]) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if v_staff.role not in ('owner', 'manager') then
    return jsonb_build_object('ok', false, 'reason', 'not_a_manager');
  end if;
  v_check := private.check_staff_pin(v_dev.org_id, v_dev.branch_id, p_device, p_approver_staff, p_pin);
  if not coalesce((v_check ->> 'ok')::boolean, false) then
    return v_check;
  end if;
  insert into public.staff_approvals (org_id, branch_id, device_id, approver_staff_id, action, expires_at)
  values (v_dev.org_id, v_dev.branch_id, p_device, p_approver_staff, p_action, now() + interval '2 minutes')
  returning id into v_id;
  perform private.write_audit(v_dev.org_id, v_dev.branch_id, 'approval.grant', 'staff', p_approver_staff::text, null,
    jsonb_build_object('action', p_action, 'approval_id', v_id), null, p_device, p_approver_staff);
  return jsonb_build_object('ok', true, 'approval_id', v_id);
end $$;

-- Returns the approving staff id, or raises. A manager may approve their own action by typing their
-- own PIN again (ADR 0014); a cashier can never approve anything.
create function private.consume_approval(
  p_org uuid, p_branch uuid, p_device uuid, p_approval uuid, p_action public.approval_action, p_actor_staff uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_a public.staff_approvals;
begin
  if p_approval is null then
    raise exception 'manager approval required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_a from public.staff_approvals where org_id = p_org and id = p_approval for update;
  if not found or v_a.branch_id <> p_branch or v_a.device_id <> p_device or v_a.action <> p_action
     or v_a.used_at is not null or v_a.expires_at < now() then
    raise exception 'manager approval is missing, expired or already used' using errcode = 'insufficient_privilege';
  end if;
  update public.staff_approvals set used_at = now(), used_by_staff_id = p_actor_staff where id = v_a.id;
  return v_a.approver_staff_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Totals: one place that rebuilds an order's decomposition from its active lines and the latest
-- order-level discount percentage. Used after every change so voids never strand a discount.
-- ---------------------------------------------------------------------------------------------
create function private.recompute_order_totals(p_org uuid, p_order uuid) returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  v_o public.orders;
  v_sum record;
  v_pct integer;
  v_disc bigint;
  v_amounts record;
begin
  select * into v_o from public.orders where org_id = p_org and id = p_order for update;
  -- sum(bigint) is numeric in Postgres: cast back so the money helpers get their declared types.
  select coalesce(sum(gross_poisha), 0)::bigint as gross, coalesce(sum(net_before_discount_poisha), 0)::bigint as net_before,
         coalesce(sum(net_poisha), 0)::bigint as net, coalesce(sum(vat_poisha), 0)::bigint as vat,
         coalesce(sum(service_charge_poisha), 0)::bigint as service, coalesce(sum(total_poisha), 0)::bigint as total
    into v_sum
  from public.order_items where org_id = p_org and order_id = p_order and status = 'active';
  select d.percent_bps into v_pct from public.discounts d
   where d.org_id = p_org and d.order_id = p_order and d.order_item_id is null and d.percent_bps is not null
   order by d.created_at desc, d.id desc limit 1;

  if v_pct is null then
    update public.orders set
      gross_poisha = v_sum.gross, discount_poisha = 0, net_before_discount_poisha = v_sum.net_before,
      discount_net_poisha = 0, net_poisha = v_sum.net, vat_poisha = v_sum.vat,
      service_charge_poisha = v_sum.service, total_poisha = v_sum.total
    where id = p_order returning * into v_o;
  else
    v_disc := round(v_sum.gross * v_pct / 10000.0);
    select * into v_amounts from private.compute_line_amounts(
      v_sum.gross, v_disc, v_o.price_includes_vat, v_o.vat_rate_bps, v_o.service_charge_bps);
    update public.orders set
      gross_poisha = v_sum.gross, discount_poisha = v_disc, net_before_discount_poisha = v_amounts.net_before,
      discount_net_poisha = v_amounts.net_before - v_amounts.net, net_poisha = v_amounts.net,
      vat_poisha = v_amounts.vat, service_charge_poisha = v_amounts.service, total_poisha = v_amounts.total
    where id = p_order returning * into v_o;
  end if;
  return v_o;
end $$;

create function private.paid_poisha(p_org uuid, p_order uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(amount_poisha) from public.payments where org_id = p_org and order_id = p_order), 0)::bigint
$$;

create function private.refunded_poisha(p_org uuid, p_order uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(amount_poisha) from public.refunds where org_id = p_org and order_id = p_order), 0)::bigint
$$;

-- ---------------------------------------------------------------------------------------------
-- Order lines: shared by submit_order and add_order_items. The server always charges its own
-- resolved price; a client's cached price that disagrees is logged, never trusted (ARCHITECTURE.md
-- "Offline POS": store price snapshots and flag mismatches).
-- p_lines: [{menu_item_id, variant_id?, quantity, modifier_ids?[], note?, client_unit_price_poisha?}]
-- ---------------------------------------------------------------------------------------------
create function private.insert_order_lines(
  p_org uuid, p_branch uuid, p_order uuid, p_lines jsonb, p_service_bps integer,
  p_price_includes_vat boolean, p_vat_rate_bps integer, p_batch_key text, p_staff uuid, p_device uuid
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb;
  v_qty integer;
  v_item_id uuid;
  v_variant uuid;
  v_mi record;
  v_price bigint;
  v_line_id uuid;
  v_mod jsonb;
  v_mod_ids uuid[];
  v_mod_id uuid;
  v_mod_price bigint;
  v_mods_total bigint;
  v_group record;
  v_amounts record;
  v_client bigint;
  v_count integer := 0;
  v_mismatch jsonb := '[]'::jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'an order needs at least one line' using errcode = 'invalid_parameter_value';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line ->> 'quantity')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 999 then
      raise exception 'line quantity must be between 1 and 999' using errcode = 'invalid_parameter_value';
    end if;
    v_item_id := nullif(v_line ->> 'menu_item_id', '')::uuid;
    -- The item's default station may belong to another branch: route to this branch's station of
    -- the same name ("Grill" here, not "Grill" in Mirpur), or leave the line unrouted.
    select mi.name,
           (select s.id from public.stations s
             where s.org_id = p_org and s.branch_id = p_branch and s.is_active
               and s.name = (select d.name from public.stations d where d.org_id = p_org and d.id = mi.station_default_id)
             limit 1) as station_default_id
      into v_mi
      from public.menu_items mi where mi.org_id = p_org and mi.id = v_item_id and mi.is_active;
    if not found then raise exception 'unknown menu item' using errcode = 'invalid_parameter_value'; end if;

    v_variant := nullif(v_line ->> 'variant_id', '')::uuid;
    if v_variant is not null and not exists (
      select 1 from public.item_variants iv
      where iv.org_id = p_org and iv.id = v_variant and iv.menu_item_id = v_item_id and iv.is_active
    ) then
      raise exception 'unknown variant' using errcode = 'invalid_parameter_value';
    end if;

    -- 86: an explicit "not available" row for the item (or this variant) blocks the sale.
    if exists (
      select 1 from public.branch_item_prices bip
      where bip.org_id = p_org and bip.branch_id = p_branch and bip.menu_item_id = v_item_id
        and not bip.is_available and (bip.variant_id is null or bip.variant_id is not distinct from v_variant)
    ) then
      raise exception 'menu item is not available at this branch' using errcode = 'invalid_parameter_value';
    end if;
    v_price := private.resolve_item_price(p_org, p_branch, v_item_id, v_variant);
    if v_price is null then
      raise exception 'menu item is not available at this branch' using errcode = 'invalid_parameter_value';
    end if;

    -- Modifiers must belong to a group linked to this item, within each group's min/max.
    v_mod_ids := array(select distinct (m #>> '{}')::uuid
                         from jsonb_array_elements(coalesce(v_line -> 'modifier_ids', '[]'::jsonb)) as m);
    v_mods_total := 0;
    foreach v_mod_id in array v_mod_ids loop
      select m.price_poisha into v_mod_price
        from public.modifiers m
        join public.menu_item_modifier_groups g on g.org_id = m.org_id and g.modifier_group_id = m.group_id
       where m.org_id = p_org and m.id = v_mod_id and m.is_active and g.menu_item_id = v_item_id;
      if not found then raise exception 'unknown or inactive modifier' using errcode = 'invalid_parameter_value'; end if;
      v_mods_total := v_mods_total + v_mod_price;
    end loop;
    for v_group in
      select mg.id, mg.min_select, mg.max_select,
             (select count(*) from public.modifiers m where m.org_id = p_org and m.group_id = mg.id and m.id = any (v_mod_ids)) as chosen
        from public.menu_item_modifier_groups g
        join public.modifier_groups mg on mg.org_id = g.org_id and mg.id = g.modifier_group_id
       where g.org_id = p_org and g.menu_item_id = v_item_id and mg.is_active
    loop
      if v_group.chosen < v_group.min_select or v_group.chosen > v_group.max_select then
        raise exception 'modifier selection is outside the allowed range' using errcode = 'invalid_parameter_value';
      end if;
    end loop;
    if v_price + v_mods_total < 0 then
      raise exception 'a line cannot have a negative price' using errcode = 'invalid_parameter_value';
    end if;

    v_client := nullif(v_line ->> 'client_unit_price_poisha', '')::bigint;
    if v_client is not null and v_client <> v_price + v_mods_total then
      v_mismatch := v_mismatch || jsonb_build_object('menu_item_id', v_item_id, 'client', v_client, 'server', v_price + v_mods_total);
    end if;

    select * into v_amounts from private.compute_line_amounts(
      (v_price + v_mods_total) * v_qty, 0, p_price_includes_vat, p_vat_rate_bps, p_service_bps);

    v_line_id := gen_random_uuid();
    insert into public.order_items (id, org_id, branch_id, order_id, menu_item_id, variant_id, station_id,
      name_snapshot, quantity, unit_price_poisha, gross_poisha, net_before_discount_poisha, discount_net_poisha,
      net_poisha, vat_poisha, service_charge_poisha, total_poisha, status, notes, batch_key)
    values (v_line_id, p_org, p_branch, p_order, v_item_id, v_variant, v_mi.station_default_id,
      v_mi.name || coalesce(' (' || (select iv.name from public.item_variants iv where iv.org_id = p_org and iv.id = v_variant) || ')', ''),
      v_qty, v_price + v_mods_total, v_amounts.gross, v_amounts.net_before, 0,
      v_amounts.net, v_amounts.vat, v_amounts.service, v_amounts.total, 'active',
      left(nullif(btrim(v_line ->> 'note'), ''), 200), p_batch_key);

    insert into public.order_item_modifiers (org_id, branch_id, order_item_id, modifier_id, name_snapshot, price_poisha)
    select p_org, p_branch, v_line_id, m.id, m.name, m.price_poisha
      from public.modifiers m where m.org_id = p_org and m.id = any (v_mod_ids);
    v_count := v_count + 1;
  end loop;

  if jsonb_array_length(v_mismatch) > 0 then
    perform private.write_audit(p_org, p_branch, 'order.price_mismatch', 'order', p_order::text, null,
      jsonb_build_object('lines', v_mismatch), 'client price differs from server price; server price charged', p_device, p_staff);
  end if;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- submit_order: permission first, then idempotency. Daily order numbers per branch; an offline
-- till's provisional receipt number is kept alongside (ADR 0012 §2).
-- ---------------------------------------------------------------------------------------------
drop function public.submit_order(uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, integer, timestamptz, jsonb);
create function public.submit_order(
  p_org uuid, p_branch uuid, p_order_id uuid, p_idempotency_key text,
  p_device uuid, p_staff uuid, p_channel uuid, p_table uuid default null,
  p_guests integer default null, p_placed_at timestamptz default null, p_lines jsonb default '[]'::jsonb,
  p_provisional_receipt_no text default null
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.orders;
  v_order public.orders;
  v_cfg record;
  v_channel record;
  v_shift uuid;
  v_service_bps integer;
  v_placed timestamptz := coalesce(p_placed_at, now());
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed to create orders for this branch' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'an idempotency key is required' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_existing from public.orders where org_id = p_org and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.id <> p_order_id then
      raise exception 'idempotency key already used with a different order id' using errcode = 'unique_violation';
    end if;
    return v_existing;
  end if;

  if v_placed > now() + interval '10 minutes' then
    raise exception 'placed_at is in the future' using errcode = 'invalid_parameter_value';
  end if;
  select c.kind, c.is_active into v_channel from public.channels c where c.org_id = p_org and c.id = p_channel;
  if not found or not v_channel.is_active then
    raise exception 'unknown channel' using errcode = 'invalid_parameter_value';
  end if;
  if p_table is not null and not exists (
    select 1 from public.dining_tables t where t.org_id = p_org and t.id = p_table and t.branch_id = p_branch
  ) then
    raise exception 'unknown table' using errcode = 'invalid_parameter_value';
  end if;

  select price_includes_vat, vat_rate_bps, service_charge_bps into v_cfg from public.org_settings where org_id = p_org;
  v_service_bps := case when v_channel.kind = 'dine_in' then v_cfg.service_charge_bps else 0 end;
  select id into v_shift from public.shifts
   where org_id = p_org and branch_id = p_branch and device_id = p_device and status = 'open'
   order by opened_at desc limit 1;

  -- Serialise per branch: the daily order number stays gapless and a racing duplicate waits here.
  perform pg_advisory_xact_lock(hashtextextended('xedine:orders:' || p_branch::text, 0));
  insert into public.orders (id, org_id, branch_id, idempotency_key, channel_id, table_id, shift_id, staff_id,
    device_id, order_status, payment_status, guests, placed_at, received_at, business_date,
    price_includes_vat, vat_rate_bps, service_charge_bps, provisional_receipt_no)
  values (p_order_id, p_org, p_branch, p_idempotency_key, p_channel, p_table, v_shift, p_staff,
    p_device, 'open', 'unpaid', p_guests, v_placed, now(), private.business_date(v_placed, 240),
    v_cfg.price_includes_vat, v_cfg.vat_rate_bps, v_service_bps, left(nullif(btrim(p_provisional_receipt_no), ''), 40))
  on conflict (org_id, idempotency_key) do nothing
  returning * into v_order;
  if v_order.id is null then
    select * into v_existing from public.orders where org_id = p_org and idempotency_key = p_idempotency_key;
    if v_existing.id <> p_order_id then
      raise exception 'idempotency key already used with a different order id' using errcode = 'unique_violation';
    end if;
    return v_existing;
  end if;

  update public.orders set order_number = coalesce((
      select max(o.order_number) from public.orders o
      where o.org_id = p_org and o.branch_id = p_branch and o.business_date = v_order.business_date and o.id <> p_order_id
    ), 0) + 1
  where id = p_order_id;

  perform private.insert_order_lines(p_org, p_branch, p_order_id, p_lines, v_service_bps,
    v_cfg.price_includes_vat, v_cfg.vat_rate_bps, null, p_staff, p_device);
  v_order := private.recompute_order_totals(p_org, p_order_id);

  perform private.write_audit(p_org, p_branch, 'order.create', 'order', p_order_id::text, null,
    jsonb_build_object('total_poisha', v_order.total_poisha, 'channel_id', p_channel,
                       'provisional_receipt_no', v_order.provisional_receipt_no), null, p_device, p_staff);
  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id, occurred_at)
  values (p_org, p_branch, p_order_id, 'created', p_staff, p_device, v_placed);
  return v_order;
end $$;

-- A second round on an open order (dine-in). Idempotent per batch key.
create function public.add_order_items(
  p_org uuid, p_branch uuid, p_order uuid, p_batch_key text, p_device uuid, p_staff uuid, p_lines jsonb
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_n integer;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  if p_batch_key is null or length(p_batch_key) < 8 then
    raise exception 'a batch key is required' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_order from public.orders where org_id = p_org and id = p_order and branch_id = p_branch for update;
  if not found then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  if exists (select 1 from public.order_items where org_id = p_org and order_id = p_order and batch_key = p_batch_key) then
    return v_order;
  end if;
  if v_order.order_status in ('completed', 'cancelled') or v_order.payment_status not in ('unpaid', 'partially_paid') then
    raise exception 'this order is closed' using errcode = 'invalid_parameter_value';
  end if;

  v_n := private.insert_order_lines(p_org, p_branch, p_order, p_lines, v_order.service_charge_bps,
    v_order.price_includes_vat, v_order.vat_rate_bps, p_batch_key, p_staff, p_device);
  v_order := private.recompute_order_totals(p_org, p_order);
  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id, meta)
  values (p_org, p_branch, p_order, 'items_added', p_staff, p_device, jsonb_build_object('lines', v_n, 'batch_key', p_batch_key));
  perform private.write_audit(p_org, p_branch, 'order.add_items', 'order', p_order::text, null,
    jsonb_build_object('lines', v_n, 'total_poisha', v_order.total_poisha), null, p_device, p_staff);
  return v_order;
end $$;

-- Send whatever has not gone to the kitchen yet. A new round puts a served/ready order back on the KDS.
create or replace function public.send_to_kitchen(p_org uuid, p_branch uuid, p_order uuid, p_device uuid, p_staff uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_n integer;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  select * into v_order from public.orders where org_id = p_org and id = p_order and branch_id = p_branch for update;
  if not found then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  if v_order.order_status in ('completed', 'cancelled') then
    raise exception 'this order is closed' using errcode = 'invalid_parameter_value';
  end if;
  update public.order_items set kot_sent_at = now()
   where org_id = p_org and order_id = p_order and status = 'active' and kot_sent_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'nothing new to send to the kitchen' using errcode = 'invalid_parameter_value';
  end if;
  if v_order.order_status in ('open', 'ready', 'served') then
    update public.orders set order_status = 'sent_to_kitchen' where id = p_order;
  end if;
  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id, meta)
  values (p_org, p_branch, p_order, 'sent_to_kitchen', p_staff, p_device, jsonb_build_object('lines', v_n));
end $$;

-- Two-tap KDS. Serving a fully paid order completes it; payment alone never closes a kitchen ticket.
create or replace function public.advance_order_status(p_org uuid, p_branch uuid, p_order uuid, p_device uuid, p_staff uuid)
returns public.order_status language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_next public.order_status;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier', 'kitchen']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  select * into v_order from public.orders where org_id = p_org and id = p_order and branch_id = p_branch for update;
  if not found then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  v_next := case v_order.order_status
    when 'sent_to_kitchen' then 'preparing' when 'preparing' then 'ready'
    when 'ready' then 'served' else null end;
  if v_next is null then
    raise exception 'no forward transition from %', v_order.order_status using errcode = 'invalid_parameter_value';
  end if;
  update public.orders set order_status = v_next where id = p_order;
  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id)
  values (p_org, p_branch, p_order, v_next::text::public.order_event_type, p_staff, p_device);
  if v_next = 'served' and v_order.payment_status = 'paid' then
    update public.orders set order_status = 'completed' where id = p_order;
    insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id)
    values (p_org, p_branch, p_order, 'completed', p_staff, p_device);
  end if;
  return v_next;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Voids: after the KOT a manager approval is consumed. Voids on a paid order are refunds instead.
-- ---------------------------------------------------------------------------------------------
drop function public.void_order_item(uuid, uuid, uuid, uuid, text, uuid, uuid, uuid);
create function public.void_order_item(
  p_org uuid, p_branch uuid, p_order_item uuid, p_reason_code uuid, p_reason_note text,
  p_device uuid, p_staff uuid, p_approval uuid default null
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  v_item public.order_items;
  v_order public.orders;
  v_after_kot boolean;
  v_approver uuid;
  v_paid bigint;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  select * into v_item from public.order_items where org_id = p_org and id = p_order_item and branch_id = p_branch for update;
  if not found or v_item.status <> 'active' then
    raise exception 'line not found or already voided' using errcode = 'no_data_found';
  end if;
  if p_reason_code is null or not exists (
    select 1 from public.reason_codes r where r.org_id = p_org and r.id = p_reason_code and r.kind = 'void' and r.is_active
  ) then
    raise exception 'a void reason is required' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_order from public.orders where org_id = p_org and id = v_item.order_id for update;
  if v_order.order_status = 'cancelled' or v_order.payment_status not in ('unpaid', 'partially_paid') then
    raise exception 'this order is paid or closed; refund instead' using errcode = 'invalid_parameter_value';
  end if;

  v_after_kot := v_item.kot_sent_at is not null;
  if v_after_kot then
    v_approver := private.consume_approval(p_org, p_branch, p_device, p_approval, 'void_after_kot', p_staff);
  end if;

  update public.order_items set status = 'voided' where id = p_order_item;
  insert into public.voids (org_id, branch_id, order_id, order_item_id, value_poisha, after_kot, after_payment,
    reason_code_id, reason_note, voided_by_staff_id, approved_by_staff_id)
  values (p_org, p_branch, v_item.order_id, p_order_item, v_item.net_before_discount_poisha, v_after_kot,
    v_order.payment_status <> 'unpaid', p_reason_code, left(p_reason_note, 500), p_staff, v_approver);

  v_order := private.recompute_order_totals(p_org, v_item.order_id);
  v_paid := private.paid_poisha(p_org, v_item.order_id);
  if v_order.total_poisha < v_paid then
    raise exception 'this void would leave the order overpaid; refund instead' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id, meta)
  values (p_org, p_branch, v_item.order_id, 'voided', p_staff, p_device,
    jsonb_build_object('order_item_id', p_order_item, 'approved_by', v_approver));
  perform private.write_audit(p_org, p_branch, 'order.void', 'order_item', p_order_item::text,
    jsonb_build_object('name', v_item.name_snapshot, 'quantity', v_item.quantity, 'total_poisha', v_item.total_poisha),
    jsonb_build_object('after_kot', v_after_kot, 'approved_by_staff_id', v_approver, 'reason_code_id', p_reason_code),
    p_reason_note, p_device, p_staff);
  return v_order;
end $$;

-- Cancel an unpaid order. If anything already reached the kitchen, a manager approval is consumed.
create function public.cancel_order(
  p_org uuid, p_branch uuid, p_order uuid, p_reason_code uuid, p_reason_note text,
  p_device uuid, p_staff uuid, p_approval uuid default null
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_after_kot boolean;
  v_approver uuid;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  select * into v_order from public.orders where org_id = p_org and id = p_order and branch_id = p_branch for update;
  if not found then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  if v_order.order_status = 'cancelled' then return v_order; end if;
  if v_order.payment_status <> 'unpaid' then
    raise exception 'this order has payments; refund them first' using errcode = 'invalid_parameter_value';
  end if;
  if p_reason_code is null or not exists (
    select 1 from public.reason_codes r where r.org_id = p_org and r.id = p_reason_code and r.kind = 'void' and r.is_active
  ) then
    raise exception 'a reason is required' using errcode = 'invalid_parameter_value';
  end if;

  v_after_kot := exists (select 1 from public.order_items i
                         where i.org_id = p_org and i.order_id = p_order and i.status = 'active' and i.kot_sent_at is not null);
  if v_after_kot then
    v_approver := private.consume_approval(p_org, p_branch, p_device, p_approval, 'cancel_order', p_staff);
  end if;

  insert into public.voids (org_id, branch_id, order_id, order_item_id, value_poisha, after_kot, after_payment,
    reason_code_id, reason_note, voided_by_staff_id, approved_by_staff_id)
  select p_org, p_branch, p_order, i.id, i.net_before_discount_poisha, i.kot_sent_at is not null, false,
         p_reason_code, left(p_reason_note, 500), p_staff, v_approver
    from public.order_items i where i.org_id = p_org and i.order_id = p_order and i.status = 'active';
  update public.order_items set status = 'voided' where org_id = p_org and order_id = p_order and status = 'active';
  perform private.recompute_order_totals(p_org, p_order);
  update public.orders set order_status = 'cancelled' where id = p_order returning * into v_order;

  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id, meta)
  values (p_org, p_branch, p_order, 'cancelled', p_staff, p_device, jsonb_build_object('approved_by', v_approver));
  perform private.write_audit(p_org, p_branch, 'order.cancel', 'order', p_order::text, null,
    jsonb_build_object('after_kot', v_after_kot, 'approved_by_staff_id', v_approver, 'reason_code_id', p_reason_code),
    p_reason_note, p_device, p_staff);
  return v_order;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Discounts: order-level percentage. Reason codes flagged requires_manager_approval consume an
-- approval. The latest percentage is the order's discount; recompute keeps it right after voids.
-- ---------------------------------------------------------------------------------------------
drop function public.apply_order_discount(uuid, uuid, uuid, integer, uuid, text, uuid, uuid);
create function public.apply_order_discount(
  p_org uuid, p_branch uuid, p_order uuid, p_percent_bps integer, p_reason_code uuid, p_reason_note text,
  p_device uuid, p_staff uuid, p_approval uuid default null
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_reason public.reason_codes;
  v_approver uuid;
  v_new_discount bigint;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  if p_percent_bps is null or p_percent_bps <= 0 or p_percent_bps > 10000 then
    raise exception 'percent must be between 0 and 100' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_order from public.orders where org_id = p_org and id = p_order and branch_id = p_branch for update;
  if not found then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  if v_order.order_status = 'cancelled' or v_order.payment_status not in ('unpaid', 'partially_paid') then
    raise exception 'cannot discount a paid or closed order' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_reason from public.reason_codes r
   where r.org_id = p_org and r.id = p_reason_code and r.kind = 'discount' and r.is_active;
  if not found then raise exception 'a discount reason is required' using errcode = 'invalid_parameter_value'; end if;
  if v_reason.requires_manager_approval then
    v_approver := private.consume_approval(p_org, p_branch, p_device, p_approval, 'discount', p_staff);
  end if;

  v_new_discount := round(v_order.gross_poisha * p_percent_bps / 10000.0);
  if v_new_discount <= 0 then
    raise exception 'the discount rounds to zero' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.discounts (org_id, branch_id, order_id, amount_poisha, percent_bps, reason_code_id, reason_note,
    applied_by_staff_id, approved_by_staff_id)
  values (p_org, p_branch, p_order, v_new_discount, p_percent_bps, p_reason_code, left(p_reason_note, 500), p_staff, v_approver);

  v_order := private.recompute_order_totals(p_org, p_order);
  if v_order.total_poisha < private.paid_poisha(p_org, p_order) then
    raise exception 'this discount would leave the order overpaid' using errcode = 'invalid_parameter_value';
  end if;
  perform private.write_audit(p_org, p_branch, 'order.discount', 'order', p_order::text, null,
    jsonb_build_object('percent_bps', p_percent_bps, 'discount_poisha', v_order.discount_poisha,
                       'approved_by_staff_id', v_approver, 'reason_code_id', p_reason_code),
    p_reason_note, p_device, p_staff);
  return v_order;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Payments: one tender per call, idempotent. Cash above the balance is change (tendered_poisha),
-- never revenue. Non-cash above the balance is refused.
-- ---------------------------------------------------------------------------------------------
create or replace function public.record_payment(
  p_org uuid, p_branch uuid, p_order uuid, p_method public.payment_method, p_amount bigint,
  p_reference text, p_idempotency_key text, p_device uuid, p_staff uuid
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_paid bigint;
  v_due bigint;
  v_applied bigint;
  v_tendered bigint;
  v_shift uuid;
  v_invoice bigint;
  v_completed boolean;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'an idempotency key is required' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_order from public.orders where org_id = p_org and id = p_order and branch_id = p_branch for update;
  if not found then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  if exists (select 1 from public.payments where org_id = p_org and idempotency_key = p_idempotency_key) then
    return v_order;
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive' using errcode = 'invalid_parameter_value'; end if;
  if v_order.order_status = 'cancelled' then raise exception 'order is cancelled' using errcode = 'invalid_parameter_value'; end if;
  if v_order.payment_status not in ('unpaid', 'partially_paid') then
    raise exception 'order is already paid' using errcode = 'invalid_parameter_value';
  end if;

  v_paid := private.paid_poisha(p_org, p_order);
  v_due := v_order.total_poisha - v_paid;
  if v_due <= 0 then raise exception 'nothing left to pay' using errcode = 'invalid_parameter_value'; end if;
  v_applied := p_amount;
  if p_amount > v_due then
    if p_method <> 'cash' then
      raise exception 'amount is more than the balance due' using errcode = 'invalid_parameter_value';
    end if;
    v_applied := v_due;
    v_tendered := p_amount;
  end if;

  select id into v_shift from public.shifts
   where org_id = p_org and branch_id = p_branch and device_id = p_device and status = 'open' order by opened_at desc limit 1;
  insert into public.payments (org_id, branch_id, order_id, shift_id, staff_id, method, amount_poisha, tendered_poisha,
    reference, idempotency_key)
  values (p_org, p_branch, p_order, v_shift, p_staff, p_method, v_applied, v_tendered,
    left(nullif(btrim(p_reference), ''), 80), p_idempotency_key);
  v_paid := v_paid + v_applied;

  if v_paid >= v_order.total_poisha then
    v_completed := v_order.order_status = 'served';
    if v_order.invoice_no is null then
      v_invoice := private.next_invoice_number(p_org, p_branch);
    end if;
    update public.orders set
      payment_status = 'paid',
      order_status = case when v_completed then 'completed'::public.order_status else order_status end,
      invoice_no = coalesce(invoice_no,
        'INV-' || to_char(now() at time zone 'Asia/Dhaka', 'YYYYMM') || '-' || lpad(v_invoice::text, 6, '0'))
    where id = p_order;
    insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id)
    values (p_org, p_branch, p_order, 'paid', p_staff, p_device);
    if v_completed then
      insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id)
      values (p_org, p_branch, p_order, 'completed', p_staff, p_device);
    end if;
  else
    update public.orders set payment_status = 'partially_paid' where id = p_order;
  end if;

  perform private.write_audit(p_org, p_branch, 'order.payment', 'order', p_order::text, null,
    jsonb_build_object('method', p_method, 'amount_poisha', v_applied, 'tendered_poisha', v_tendered), null, p_device, p_staff);
  select * into v_order from public.orders where id = p_order;
  return v_order;
end $$;

-- Refunds always need a manager approval (CLAUDE.md #5). Cash refunds come out of this till's shift.
create function public.refund_order(
  p_org uuid, p_branch uuid, p_order uuid, p_method public.payment_method, p_amount bigint,
  p_reason_code uuid, p_reason_note text, p_idempotency_key text, p_device uuid, p_staff uuid, p_approval uuid
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_paid bigint;
  v_refunded bigint;
  v_approver uuid;
  v_shift uuid;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'an idempotency key is required' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_order from public.orders where org_id = p_org and id = p_order and branch_id = p_branch for update;
  if not found then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  if exists (select 1 from public.refunds where org_id = p_org and idempotency_key = p_idempotency_key) then
    return v_order;
  end if;
  if v_order.payment_status not in ('paid', 'partially_paid', 'partially_refunded') then
    raise exception 'nothing to refund on this order' using errcode = 'invalid_parameter_value';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive' using errcode = 'invalid_parameter_value'; end if;
  v_paid := private.paid_poisha(p_org, p_order);
  v_refunded := private.refunded_poisha(p_org, p_order);
  if p_amount > v_paid - v_refunded then
    raise exception 'refund is more than what was paid' using errcode = 'invalid_parameter_value';
  end if;
  if p_reason_code is null or not exists (
    select 1 from public.reason_codes r where r.org_id = p_org and r.id = p_reason_code and r.kind = 'refund' and r.is_active
  ) then
    raise exception 'a refund reason is required' using errcode = 'invalid_parameter_value';
  end if;
  v_approver := private.consume_approval(p_org, p_branch, p_device, p_approval, 'refund', p_staff);

  select id into v_shift from public.shifts
   where org_id = p_org and branch_id = p_branch and device_id = p_device and status = 'open' order by opened_at desc limit 1;
  insert into public.refunds (org_id, branch_id, order_id, method, amount_poisha, reason_code_id, reason_note,
    refunded_by_staff_id, approved_by_staff_id, shift_id, idempotency_key)
  values (p_org, p_branch, p_order, p_method, p_amount, p_reason_code, left(p_reason_note, 500),
    p_staff, v_approver, v_shift, p_idempotency_key);
  v_refunded := v_refunded + p_amount;

  update public.orders set payment_status = case when v_refunded >= v_paid then 'refunded'::public.payment_status
                                                   else 'partially_refunded'::public.payment_status end
   where id = p_order returning * into v_order;
  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id, meta)
  values (p_org, p_branch, p_order, 'refunded', p_staff, p_device,
    jsonb_build_object('amount_poisha', p_amount, 'method', p_method, 'approved_by', v_approver));
  perform private.write_audit(p_org, p_branch, 'order.refund', 'order', p_order::text,
    jsonb_build_object('paid_poisha', v_paid, 'refunded_poisha', v_refunded - p_amount),
    jsonb_build_object('amount_poisha', p_amount, 'method', p_method, 'approved_by_staff_id', v_approver,
                       'reason_code_id', p_reason_code),
    p_reason_note, p_device, p_staff);
  return v_order;
end $$;

-- ---------------------------------------------------------------------------------------------
-- A customer at the till (optional, with an explicit marketing-consent answer).
-- ---------------------------------------------------------------------------------------------
create function public.attach_customer(
  p_org uuid, p_branch uuid, p_order uuid, p_phone text, p_name text, p_marketing_consent boolean,
  p_device uuid, p_staff uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_phone text;
  v_customer uuid;
  v_channel public.consent_channel;
  v_latest boolean;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  v_phone := private.normalize_bd_phone(p_phone);
  if v_phone is null then
    raise exception 'not a valid Bangladeshi mobile number' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.orders where org_id = p_org and id = p_order and branch_id = p_branch) then
    raise exception 'order not found' using errcode = 'no_data_found';
  end if;

  insert into public.customers (org_id, phone, name)
  values (p_org, v_phone, left(nullif(btrim(p_name), ''), 120))
  on conflict (org_id, phone) do update set name = coalesce(excluded.name, public.customers.name)
  returning id into v_customer;

  if p_marketing_consent is not null then
    foreach v_channel in array array['whatsapp', 'sms']::public.consent_channel[] loop
      select c.granted into v_latest from public.consents c
       where c.org_id = p_org and c.customer_id = v_customer and c.channel = v_channel and c.purpose = 'marketing'
       order by c.recorded_at desc limit 1;
      if v_latest is distinct from p_marketing_consent then
        insert into public.consents (org_id, customer_id, channel, purpose, granted, source, recorded_by_staff_id)
        values (p_org, v_customer, v_channel, 'marketing', p_marketing_consent, 'pos', p_staff);
      end if;
    end loop;
  end if;

  update public.orders set customer_id = v_customer where id = p_order;
  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id)
  values (p_org, p_branch, p_order, 'customer_attached', p_staff, p_device);
  perform private.write_audit(p_org, p_branch, 'order.customer', 'order', p_order::text, null,
    jsonb_build_object('phone', private.mask_phone(v_phone), 'marketing_consent', p_marketing_consent), null, p_device, p_staff);
  return v_customer;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Shifts: expected cash = float + cash taken − cash refunded on this shift. Closing needs a
-- manager-level staff member (the PIN'd person, not the browser login) or their approval.
-- ---------------------------------------------------------------------------------------------
drop function public.close_shift(uuid, uuid, uuid, bigint, uuid, uuid);
create function public.close_shift(
  p_org uuid, p_branch uuid, p_shift uuid, p_counted_cash bigint, p_device uuid, p_staff uuid,
  p_approval uuid default null
) returns public.shifts language plpgsql security definer set search_path = '' as $$
declare
  v_shift public.shifts;
  v_role public.app_role;
  v_approver uuid;
  v_cash_in bigint;
  v_cash_out bigint;
  v_expected bigint;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager']::public.app_role[]) then
    raise exception 'only a manager or owner can close a shift' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  select * into v_shift from public.shifts where org_id = p_org and id = p_shift and branch_id = p_branch for update;
  if not found or v_shift.status <> 'open' then
    raise exception 'shift not found or already closed' using errcode = 'no_data_found';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'counted cash must be >= 0' using errcode = 'invalid_parameter_value';
  end if;
  select role into v_role from public.staff where org_id = p_org and id = p_staff;
  if v_role not in ('owner', 'manager') then
    v_approver := private.consume_approval(p_org, p_branch, p_device, p_approval, 'close_shift', p_staff);
  end if;

  select coalesce(sum(amount_poisha), 0) into v_cash_in from public.payments
   where org_id = p_org and shift_id = p_shift and method = 'cash';
  select coalesce(sum(amount_poisha), 0) into v_cash_out from public.refunds
   where org_id = p_org and shift_id = p_shift and method = 'cash';
  v_expected := v_shift.opening_float_poisha + v_cash_in - v_cash_out;

  update public.shifts set status = 'closed', closed_by_staff_id = p_staff, closed_at = now(),
    expected_cash_poisha = v_expected, counted_cash_poisha = p_counted_cash, over_short_poisha = p_counted_cash - v_expected
  where id = p_shift returning * into v_shift;
  insert into public.cash_counts (org_id, branch_id, shift_id, kind, counted_by_staff_id, total_poisha)
  values (p_org, p_branch, p_shift, 'closing', p_staff, p_counted_cash);
  perform private.write_audit(p_org, p_branch, 'shift.close', 'shift', p_shift::text,
    jsonb_build_object('expected', v_expected, 'cash_in', v_cash_in, 'cash_refunded', v_cash_out),
    jsonb_build_object('counted', p_counted_cash, 'over_short', p_counted_cash - v_expected, 'approved_by_staff_id', v_approver),
    null, p_device, p_staff);
  return v_shift;
end $$;

-- ---------------------------------------------------------------------------------------------
-- New organizations: the channels, reason codes and kitchen station a till needs on day one.
-- Idempotent; names follow the org's default language and stay editable data, not UI strings.
-- ---------------------------------------------------------------------------------------------
create function public.ensure_org_defaults(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_bn boolean;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'only the owner can set up defaults' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(default_locale = 'bn', true) into v_bn from public.org_settings where org_id = p_org;

  insert into public.channels (org_id, name, kind)
  select p_org, v.name, v.kind::public.channel_kind
    from (values
      (case when v_bn then 'ডাইন-ইন' else 'Dine-in' end, 'dine_in'),
      (case when v_bn then 'টেকঅ্যাওয়ে' else 'Takeaway' end, 'takeaway'),
      (case when v_bn then 'নিজস্ব ডেলিভারি' else 'Own delivery' end, 'own_delivery'),
      ('foodpanda', 'foodpanda'),
      ('Pathao Food', 'pathao_food')
    ) as v(name, kind)
   where not exists (select 1 from public.channels c where c.org_id = p_org and c.kind = v.kind::public.channel_kind)
  on conflict (org_id, name) do nothing;

  insert into public.reason_codes (org_id, kind, code, label, label_bn, requires_manager_approval)
  values
    (p_org, 'void', 'wrong_item', 'Wrong item entered', 'ভুল আইটেম দেওয়া হয়েছে', false),
    (p_org, 'void', 'customer_changed', 'Customer changed their mind', 'গ্রাহক মত বদলেছেন', false),
    (p_org, 'void', 'kitchen_issue', 'Kitchen could not make it', 'রান্নাঘর বানাতে পারেনি', false),
    (p_org, 'discount', 'regular', 'Regular customer', 'নিয়মিত গ্রাহক', false),
    (p_org, 'discount', 'complaint', 'Service complaint', 'সেবা নিয়ে অভিযোগ', false),
    (p_org, 'discount', 'staff_meal', 'Staff meal', 'স্টাফের খাবার', true),
    (p_org, 'discount', 'owner_guest', 'Owner''s guest', 'মালিকের অতিথি', true),
    (p_org, 'refund', 'quality', 'Food quality complaint', 'খাবারের মান নিয়ে অভিযোগ', false),
    (p_org, 'refund', 'wrong_order', 'Wrong order served', 'ভুল অর্ডার পরিবেশন', false),
    (p_org, 'refund', 'overcharged', 'Customer was overcharged', 'গ্রাহকের কাছ থেকে বেশি নেওয়া হয়েছে', false)
  on conflict (org_id, kind, code) do nothing;

  insert into public.stations (org_id, branch_id, name)
  select p_org, b.id, case when v_bn then 'রান্নাঘর' else 'Kitchen' end
    from public.branches b where b.org_id = p_org
  on conflict (org_id, branch_id, name) do nothing;

  perform private.write_audit(p_org, null, 'org.defaults', 'organization', p_org::text, null, null, null);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants: new private helpers are for other functions only; RPCs are for signed-in users.
-- ---------------------------------------------------------------------------------------------
revoke execute on function private.guard_staff_change() from public, anon, authenticated;
revoke execute on function private.record_price_change() from public, anon, authenticated;
revoke execute on function private.normalize_bd_phone(text) from public, anon, authenticated;
revoke execute on function private.mask_phone(text) from public, anon, authenticated;
revoke execute on function private.check_staff_pin(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function private.consume_approval(uuid, uuid, uuid, uuid, public.approval_action, uuid) from public, anon, authenticated;
revoke execute on function private.recompute_order_totals(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.paid_poisha(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.refunded_poisha(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.insert_order_lines(uuid, uuid, uuid, jsonb, integer, boolean, integer, text, uuid, uuid)
  from public, anon, authenticated;
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('submit_order', 'add_order_items', 'send_to_kitchen', 'advance_order_status', 'void_order_item',
                        'cancel_order', 'apply_order_discount', 'record_payment', 'refund_order', 'attach_customer',
                        'close_shift', 'approve_action', 'ensure_org_defaults', 'set_staff_pin')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

comment on function public.submit_order is 'Create a complete order in one idempotent call; daily order number; offline provisional receipt no. Phase 1.';
comment on function public.add_order_items is 'Add a round to an open order; idempotent per batch key. Phase 1.';
comment on function public.void_order_item is 'Void a line; after the KOT a single-use manager approval is consumed. Phase 1.';
comment on function public.cancel_order is 'Cancel an unpaid order; approval needed if anything reached the kitchen. Phase 1.';
comment on function public.apply_order_discount is 'Order-level percentage discount with a reason; approval when the reason requires it. Phase 1.';
comment on function public.record_payment is 'One tender; idempotent; cash change is recorded as tendered, never as revenue. Phase 1.';
comment on function public.refund_order is 'Refund part or all of what was paid; always manager-approved; audited. Phase 1.';
comment on function public.attach_customer is 'Attach a +880 customer and their marketing-consent answer to an order. Phase 1.';
comment on function public.close_shift is 'Close a shift: expected = float + cash in - cash refunded; over/short recorded. Phase 1.';
comment on function public.approve_action is 'Manager PIN approval for one action on one device; single use, 2-minute expiry. Phase 1.';
comment on function public.ensure_org_defaults is 'Idempotently add default channels, reason codes and a kitchen station. Phase 1.';
