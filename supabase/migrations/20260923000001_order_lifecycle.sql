-- Phase 1: order lifecycle RPCs (submit, status, void, discount, payment, invoice number),
-- shift open/close, and Realtime for the KDS. ADR 0013 (device auth), ADR 0005 (money), ADR 0006 (clock).

-- ---------------------------------------------------------------------------------------------
-- Realtime: the KDS subscribes to order/order_item/order_event changes for its branch.
-- ---------------------------------------------------------------------------------------------
alter publication supabase_realtime add table public.orders, public.order_items, public.order_events;

-- Which kitchen station an item routes to by default (KDS station filter). Nullable: unrouted
-- items show on every station's queue.
alter table public.menu_items add column if not exists station_default_id uuid;
alter table public.menu_items add constraint menu_items_station_fk
  foreign key (org_id, station_default_id) references public.stations (org_id, id) on delete set null;

-- ---------------------------------------------------------------------------------------------
-- ADR 0013: every order-mutating RPC proves the acting staff member actually PIN'd in on this
-- device. RLS is satisfied by the browser's manager/owner session; this is the separate
-- attribution check that keeps that session from acting "as" an unverified staff member.
-- ---------------------------------------------------------------------------------------------
create function private.verify_staff_session(p_org uuid, p_device uuid, p_staff uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.staff_sessions s
    where s.org_id = p_org and s.device_id = p_device and s.staff_id = p_staff
      and s.ended_at is null and s.expires_at > now()
  ) then
    raise exception 'no active staff session for this device' using errcode = 'insufficient_privilege';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Pricing: resolve what a line should cost right now (branch override, else the item's base
-- price, plus the variant's delta). Used by submit_order.
-- ---------------------------------------------------------------------------------------------
create function private.resolve_item_price(p_org uuid, p_branch uuid, p_menu_item uuid, p_variant uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select bip.price_poisha from public.branch_item_prices bip
     where bip.org_id = p_org and bip.branch_id = p_branch and bip.menu_item_id = p_menu_item
       and bip.variant_id is not distinct from p_variant and bip.is_available),
    (select mi.base_price_poisha + coalesce((select iv.price_delta_poisha from public.item_variants iv
                                              where iv.org_id = p_org and iv.id = p_variant), 0)
     from public.menu_items mi where mi.org_id = p_org and mi.id = p_menu_item and mi.is_active)
  )
$$;

-- Pure arithmetic (ADR 0005). Mirrors src/lib/money's computeLine exactly; a unit test asserts SQL
-- and TypeScript agree on the same inputs. `discount` is on the printed (gross) basis, as in TS.
create function private.compute_line_amounts(
  p_gross bigint, p_discount bigint, p_price_includes_vat boolean, p_vat_rate_bps integer, p_service_bps integer
) returns table (gross bigint, net_before bigint, net bigint, vat bigint, service bigint, total bigint)
language plpgsql immutable set search_path = '' as $$
declare
  v_base bigint := p_gross - p_discount;
  v_net_before bigint; v_net bigint; v_vat bigint; v_service bigint;
begin
  if p_price_includes_vat then
    v_net_before := round(p_gross * 10000.0 / (10000 + p_vat_rate_bps));
    v_net := round(v_base * 10000.0 / (10000 + p_vat_rate_bps));
    v_vat := v_base - v_net;
  else
    v_net_before := p_gross; v_net := v_base; v_vat := round(v_net * p_vat_rate_bps / 10000.0);
  end if;
  v_service := round(v_net * p_service_bps / 10000.0);
  gross := p_gross; net_before := v_net_before; net := v_net; vat := v_vat; service := v_service;
  total := v_net + v_vat + v_service;
  return next;
end $$;

-- ---------------------------------------------------------------------------------------------
-- submit_order: the whole cart in one call, so an offline POS can push a complete order after
-- reconnecting rather than building it over several round trips (CLAUDE.md #7: never double-count).
-- Idempotent on (org_id, idempotency_key) — a retried sync is a no-op, not a duplicate sale.
-- p_lines: [{menu_item_id, variant_id?, quantity, modifier_ids?[], note?}]
-- ---------------------------------------------------------------------------------------------
create function public.submit_order(
  p_org uuid, p_branch uuid, p_order_id uuid, p_idempotency_key text,
  p_device uuid, p_staff uuid, p_channel uuid, p_table uuid default null,
  p_guests integer default null, p_placed_at timestamptz default null, p_lines jsonb default '[]'::jsonb
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.orders;
  v_cfg record;
  v_shift uuid;
  v_line jsonb;
  v_price bigint;
  v_qty integer;
  v_gross bigint := 0; v_net_before bigint := 0; v_net bigint := 0; v_vat bigint := 0; v_service bigint := 0; v_total bigint := 0;
  v_service_bps integer;
  v_dine_in boolean;
  v_order public.orders;
  v_line_id uuid;
  v_mi record;
  v_mod jsonb; v_mod_id uuid; v_mod_price bigint; v_mods_total bigint;
  v_amounts record;
  v_placed timestamptz := coalesce(p_placed_at, now());
begin
  select * into v_existing from public.orders where org_id = p_org and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.id <> p_order_id then
      raise exception 'idempotency key already used with a different order id' using errcode = 'unique_violation';
    end if;
    return v_existing;
  end if;

  if not private.can_access_branch_role(p_org, p_branch, array['owner','manager','cashier']::public.app_role[]) then
    raise exception 'not allowed to create orders for this branch' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'an order needs at least one line' using errcode = 'invalid_parameter_value';
  end if;

  select price_includes_vat, vat_rate_bps, service_charge_bps into v_cfg from public.org_settings where org_id = p_org;
  select kind = 'dine_in' into v_dine_in from public.channels where org_id = p_org and id = p_channel;
  if v_dine_in is null then raise exception 'unknown channel' using errcode = 'invalid_parameter_value'; end if;
  v_service_bps := case when v_dine_in then v_cfg.service_charge_bps else 0 end;

  select id into v_shift from public.shifts
   where org_id = p_org and branch_id = p_branch and device_id = p_device and status = 'open'
   order by opened_at desc limit 1;

  insert into public.orders (id, org_id, branch_id, idempotency_key, channel_id, table_id, shift_id, staff_id,
    device_id, order_status, payment_status, guests, placed_at, received_at, business_date,
    price_includes_vat, vat_rate_bps, service_charge_bps)
  values (p_order_id, p_org, p_branch, p_idempotency_key, p_channel, p_table, v_shift, p_staff,
    p_device, 'open', 'unpaid', p_guests, v_placed, now(), private.business_date(v_placed, 240),
    v_cfg.price_includes_vat, v_cfg.vat_rate_bps, v_service_bps)
  on conflict (org_id, idempotency_key) do nothing;
  select * into v_existing from public.orders where org_id = p_org and idempotency_key = p_idempotency_key;
  if v_existing.id <> p_order_id then
    raise exception 'idempotency key already used with a different order id' using errcode = 'unique_violation';
  end if;
  -- A concurrent duplicate call (e.g. two offline-sync retries racing) can both pass the header
  -- insert's ON CONFLICT and reach here; only the one that actually inserted lines should build
  -- them. CLAUDE.md #7: never double-count.
  if exists (select 1 from public.order_items where org_id = p_org and order_id = p_order_id) then
    return v_existing;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line ->> 'quantity')::integer;
    if v_qty is null or v_qty < 1 then raise exception 'line quantity must be >= 1' using errcode = 'invalid_parameter_value'; end if;

    select mi.name, mi.station_default_id into v_mi
    from public.menu_items mi where mi.org_id = p_org and mi.id = (v_line ->> 'menu_item_id')::uuid;
    if not found then raise exception 'unknown menu item' using errcode = 'invalid_parameter_value'; end if;

    v_price := private.resolve_item_price(p_org, p_branch, (v_line ->> 'menu_item_id')::uuid, nullif(v_line ->> 'variant_id', '')::uuid);
    if v_price is null then raise exception 'menu item is not available at this branch' using errcode = 'invalid_parameter_value'; end if;

    v_line_id := gen_random_uuid();
    v_mods_total := 0;
    for v_mod in select * from jsonb_array_elements(coalesce(v_line -> 'modifier_ids', '[]'::jsonb)) loop
      v_mod_id := v_mod::text::uuid;
      select price_poisha into v_mod_price from public.modifiers where org_id = p_org and id = v_mod_id and is_active;
      if not found then raise exception 'unknown or inactive modifier' using errcode = 'invalid_parameter_value'; end if;
      v_mods_total := v_mods_total + v_mod_price;
    end loop;

    select * into v_amounts from private.compute_line_amounts(
      (v_price + v_mods_total) * v_qty, 0, v_cfg.price_includes_vat, v_cfg.vat_rate_bps, v_service_bps);

    insert into public.order_items (id, org_id, branch_id, order_id, menu_item_id, variant_id, station_id,
      name_snapshot, quantity, unit_price_poisha, gross_poisha, net_before_discount_poisha, discount_net_poisha,
      net_poisha, vat_poisha, service_charge_poisha, total_poisha, status, notes)
    values (v_line_id, p_org, p_branch, p_order_id, (v_line ->> 'menu_item_id')::uuid, nullif(v_line ->> 'variant_id', '')::uuid,
      v_mi.station_default_id, v_mi.name, v_qty, v_price + v_mods_total, v_amounts.gross, v_amounts.net_before, 0,
      v_amounts.net, v_amounts.vat, v_amounts.service, v_amounts.total, 'active', nullif(v_line ->> 'note', ''));

    for v_mod in select * from jsonb_array_elements(coalesce(v_line -> 'modifier_ids', '[]'::jsonb)) loop
      v_mod_id := v_mod::text::uuid;
      insert into public.order_item_modifiers (org_id, branch_id, order_item_id, modifier_id, name_snapshot, price_poisha)
      select p_org, p_branch, v_line_id, id, name, price_poisha from public.modifiers where org_id = p_org and id = v_mod_id;
    end loop;

    v_gross := v_gross + v_amounts.gross; v_net_before := v_net_before + v_amounts.net_before;
    v_net := v_net + v_amounts.net; v_vat := v_vat + v_amounts.vat; v_service := v_service + v_amounts.service;
    v_total := v_total + v_amounts.total;
  end loop;

  update public.orders set
    gross_poisha = v_gross, discount_poisha = 0, net_before_discount_poisha = v_net_before, discount_net_poisha = 0,
    net_poisha = v_net, vat_poisha = v_vat, service_charge_poisha = v_service, total_poisha = v_total
  where id = p_order_id
  returning * into v_order;

  perform private.write_audit(p_org, p_branch, 'order.create', 'order', p_order_id::text, null,
    jsonb_build_object('total_poisha', v_total, 'channel_id', p_channel), null, p_device, p_staff);
  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id, occurred_at)
  values (p_org, p_branch, p_order_id, 'created', p_staff, p_device, v_placed);

  return v_order;
end $$;

-- ---------------------------------------------------------------------------------------------
-- KDS lifecycle: send to kitchen (stamps KOT time), then two-tap forward transitions.
-- ---------------------------------------------------------------------------------------------
create function public.send_to_kitchen(p_org uuid, p_branch uuid, p_order uuid, p_device uuid, p_staff uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status public.order_status; begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner','manager','cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  select order_status into v_status from public.orders where org_id = p_org and id = p_order for update;
  if v_status is null then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  if v_status <> 'open' then raise exception 'order already sent' using errcode = 'invalid_parameter_value'; end if;
  update public.order_items set kot_sent_at = now() where org_id = p_org and order_id = p_order and status = 'active' and kot_sent_at is null;
  update public.orders set order_status = 'sent_to_kitchen' where id = p_order;
  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id)
  values (p_org, p_branch, p_order, 'sent_to_kitchen', p_staff, p_device);
end $$;

-- Kitchen advances the order as a whole (oldest-first queue, two-tap): sent_to_kitchen → preparing → ready → served.
create function public.advance_order_status(p_org uuid, p_branch uuid, p_order uuid, p_device uuid, p_staff uuid)
returns public.order_status language plpgsql security definer set search_path = '' as $$
declare v_status public.order_status; v_next public.order_status; begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner','manager','cashier','kitchen']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  select order_status into v_status from public.orders where org_id = p_org and id = p_order for update;
  if v_status is null then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  v_next := case v_status
    when 'sent_to_kitchen' then 'preparing' when 'preparing' then 'ready'
    when 'ready' then 'served' else null end;
  if v_next is null then raise exception 'no forward transition from %', v_status using errcode = 'invalid_parameter_value'; end if;
  update public.orders set order_status = v_next where id = p_order;
  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id)
  values (p_org, p_branch, p_order, v_next::text::public.order_event_type, p_staff, p_device);
  return v_next;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Voids. Before the kitchen ticket: any cashier. After: a manager PIN must approve (CLAUDE.md #5).
-- ---------------------------------------------------------------------------------------------
create function public.void_order_item(
  p_org uuid, p_branch uuid, p_order_item uuid, p_reason_code uuid, p_reason_note text,
  p_device uuid, p_staff uuid, p_approver_staff uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item public.order_items; v_order public.orders; v_after_kot boolean; v_after_payment boolean;
begin
  select * into v_item from public.order_items where org_id = p_org and id = p_order_item for update;
  if not found or v_item.status <> 'active' then raise exception 'line not found or already voided' using errcode = 'no_data_found'; end if;
  select * into v_order from public.orders where org_id = p_org and id = v_item.order_id;
  if not private.can_access_branch_role(p_org, p_branch, array['owner','manager','cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);

  v_after_kot := v_item.kot_sent_at is not null;
  v_after_payment := v_order.payment_status <> 'unpaid';
  if v_after_kot then
    if p_approver_staff is null then raise exception 'manager approval required to void after KOT' using errcode = 'insufficient_privilege'; end if;
    perform private.verify_staff_session(p_org, p_device, p_approver_staff);
    if not private.can_access_branch_role(p_org, p_branch, array['owner','manager']::public.app_role[]) then
      raise exception 'approver must be a manager or owner' using errcode = 'insufficient_privilege';
    end if;
    if p_approver_staff = p_staff then
      raise exception 'the approver must be a different staff member' using errcode = 'insufficient_privilege';
    end if;
  end if;

  update public.order_items set status = 'voided' where id = p_order_item;
  insert into public.voids (org_id, branch_id, order_id, order_item_id, value_poisha, after_kot, after_payment,
    reason_code_id, reason_note, voided_by_staff_id, approved_by_staff_id)
  values (p_org, p_branch, v_item.order_id, p_order_item, v_item.net_before_discount_poisha, v_after_kot, v_after_payment,
    p_reason_code, p_reason_note, p_staff, p_approver_staff);

  update public.orders o set
    gross_poisha = o.gross_poisha - v_item.gross_poisha,
    net_before_discount_poisha = o.net_before_discount_poisha - v_item.net_before_discount_poisha,
    net_poisha = o.net_poisha - v_item.net_poisha,
    vat_poisha = o.vat_poisha - v_item.vat_poisha,
    service_charge_poisha = o.service_charge_poisha - v_item.service_charge_poisha,
    total_poisha = o.total_poisha - v_item.total_poisha
  where o.id = v_item.order_id;

  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id, meta)
  values (p_org, p_branch, v_item.order_id, 'voided', p_staff, p_device, jsonb_build_object('order_item_id', p_order_item));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Discounts. Order-level only in Phase 1 (item-level discounts are a later refinement).
-- ---------------------------------------------------------------------------------------------
create function public.apply_order_discount(
  p_org uuid, p_branch uuid, p_order uuid, p_percent_bps integer, p_reason_code uuid, p_reason_note text,
  p_device uuid, p_staff uuid
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare v_order public.orders; v_new_discount bigint; v_amounts record; begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner','manager','cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  if p_percent_bps is null or p_percent_bps <= 0 or p_percent_bps > 10000 then
    raise exception 'percent must be between 0 and 100' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_order from public.orders where org_id = p_org and id = p_order for update;
  if not found then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  if v_order.order_status in ('cancelled', 'completed') then
    raise exception 'cannot discount a closed order' using errcode = 'invalid_parameter_value';
  end if;

  v_new_discount := round(v_order.gross_poisha * p_percent_bps / 10000.0);
  select * into v_amounts from private.compute_line_amounts(
    v_order.gross_poisha, v_new_discount, v_order.price_includes_vat, v_order.vat_rate_bps, v_order.service_charge_bps);

  insert into public.discounts (org_id, branch_id, order_id, amount_poisha, percent_bps, reason_code_id, reason_note, applied_by_staff_id)
  values (p_org, p_branch, p_order, v_new_discount - v_order.discount_poisha, p_percent_bps, p_reason_code, p_reason_note, p_staff);

  update public.orders set
    discount_poisha = v_new_discount,
    discount_net_poisha = v_amounts.net_before - v_amounts.net,
    net_poisha = v_amounts.net, vat_poisha = v_amounts.vat, service_charge_poisha = v_amounts.service, total_poisha = v_amounts.total
  where id = p_order returning * into v_order;
  return v_order;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Invoice numbers: server-assigned, gapless per (branch, series). Offline receipts print the
-- client's provisional_receipt_no instead; this is called once, when the order is paid in full.
-- ---------------------------------------------------------------------------------------------
create function private.next_invoice_number(p_org uuid, p_branch uuid, p_series text default 'default')
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_n bigint; begin
  insert into public.invoice_sequences (org_id, branch_id, series) values (p_org, p_branch, p_series)
    on conflict (org_id, branch_id, series) do nothing;
  update public.invoice_sequences set next_number = next_number + 1
    where org_id = p_org and branch_id = p_branch and series = p_series
    returning next_number - 1 into v_n;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Payments. Split-capable: call once per tender. The tender that satisfies the balance marks
-- the order paid and assigns the invoice number.
-- ---------------------------------------------------------------------------------------------
create function public.record_payment(
  p_org uuid, p_branch uuid, p_order uuid, p_method public.payment_method, p_amount bigint,
  p_reference text, p_idempotency_key text, p_device uuid, p_staff uuid
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders; v_paid bigint; v_shift uuid; v_invoice bigint;
begin
  select * into v_order from public.orders where org_id = p_org and id = p_order for update;
  if not found then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  if exists (select 1 from public.payments where org_id = p_org and idempotency_key = p_idempotency_key) then
    return v_order;
  end if;
  if not private.can_access_branch_role(p_org, p_branch, array['owner','manager','cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  if p_amount <= 0 then raise exception 'amount must be positive' using errcode = 'invalid_parameter_value'; end if;
  if v_order.order_status = 'cancelled' then raise exception 'order is cancelled' using errcode = 'invalid_parameter_value'; end if;

  select id into v_shift from public.shifts
   where org_id = p_org and branch_id = p_branch and device_id = p_device and status = 'open' order by opened_at desc limit 1;

  insert into public.payments (org_id, branch_id, order_id, shift_id, staff_id, method, amount_poisha, reference, idempotency_key)
  values (p_org, p_branch, p_order, v_shift, p_staff, p_method, p_amount, p_reference, p_idempotency_key);

  select coalesce(sum(amount_poisha), 0) into v_paid from public.payments where org_id = p_org and order_id = p_order;

  if v_paid >= v_order.total_poisha and v_order.invoice_no is null then
    v_invoice := private.next_invoice_number(p_org, p_branch);
    update public.orders set payment_status = 'paid', order_status = 'completed',
      invoice_no = 'INV-' || to_char(now() at time zone 'Asia/Dhaka', 'YYYYMM') || '-' || lpad(v_invoice::text, 6, '0')
      where id = p_order;
    insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id)
    values (p_org, p_branch, p_order, 'paid', p_staff, p_device);
    insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id)
    values (p_org, p_branch, p_order, 'completed', p_staff, p_device);
  elsif v_paid >= v_order.total_poisha then
    update public.orders set payment_status = 'paid', order_status = 'completed' where id = p_order;
  elsif v_paid > 0 then
    update public.orders set payment_status = 'partially_paid' where id = p_order;
  end if;

  select * into v_order from public.orders where id = p_order;
  return v_order;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Shifts: open with a float, close with a counted total. Expected cash = float + cash payments
-- taken on this shift (Phase 1 has no cash refunds or till-out tracking yet).
-- ---------------------------------------------------------------------------------------------
create function public.open_shift(p_org uuid, p_branch uuid, p_device uuid, p_staff uuid, p_opening_float bigint)
returns public.shifts language plpgsql security definer set search_path = '' as $$
declare v_shift public.shifts; begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner','manager','cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  if exists (select 1 from public.shifts where org_id = p_org and device_id = p_device and status = 'open') then
    raise exception 'a shift is already open on this device' using errcode = 'unique_violation';
  end if;
  if p_opening_float < 0 then raise exception 'opening float must be >= 0' using errcode = 'invalid_parameter_value'; end if;

  insert into public.shifts (org_id, branch_id, device_id, opened_by_staff_id, business_date, opening_float_poisha)
  values (p_org, p_branch, p_device, p_staff, private.business_date(now(), 240), p_opening_float)
  returning * into v_shift;
  insert into public.cash_counts (org_id, branch_id, shift_id, kind, counted_by_staff_id, total_poisha)
  values (p_org, p_branch, v_shift.id, 'opening', p_staff, p_opening_float);
  perform private.write_audit(p_org, p_branch, 'shift.open', 'shift', v_shift.id::text, null,
    jsonb_build_object('opening_float_poisha', p_opening_float), null, p_device, p_staff);
  return v_shift;
end $$;

create function public.close_shift(p_org uuid, p_branch uuid, p_shift uuid, p_counted_cash bigint, p_device uuid, p_staff uuid)
returns public.shifts language plpgsql security definer set search_path = '' as $$
declare v_shift public.shifts; v_cash_in bigint; v_expected bigint; begin
  select * into v_shift from public.shifts where org_id = p_org and id = p_shift for update;
  if not found or v_shift.status <> 'open' then raise exception 'shift not found or already closed' using errcode = 'no_data_found'; end if;
  if not private.can_access_branch_role(p_org, p_branch, array['owner','manager']::public.app_role[]) then
    raise exception 'only a manager or owner can close a shift' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  if p_counted_cash < 0 then raise exception 'counted cash must be >= 0' using errcode = 'invalid_parameter_value'; end if;

  select coalesce(sum(amount_poisha), 0) into v_cash_in from public.payments
   where org_id = p_org and shift_id = p_shift and method = 'cash';
  v_expected := v_shift.opening_float_poisha + v_cash_in;

  update public.shifts set status = 'closed', closed_by_staff_id = p_staff, closed_at = now(),
    expected_cash_poisha = v_expected, counted_cash_poisha = p_counted_cash, over_short_poisha = p_counted_cash - v_expected
  where id = p_shift returning * into v_shift;
  insert into public.cash_counts (org_id, branch_id, shift_id, kind, counted_by_staff_id, total_poisha)
  values (p_org, p_branch, p_shift, 'closing', p_staff, p_counted_cash);
  perform private.write_audit(p_org, p_branch, 'shift.close', 'shift', p_shift::text,
    jsonb_build_object('expected', v_expected), jsonb_build_object('counted', p_counted_cash, 'over_short', p_counted_cash - v_expected),
    null, p_device, p_staff);
  return v_shift;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants: the new private.* helpers are for other functions only; only the intended RPCs are
-- opened to signed-in users.
-- ---------------------------------------------------------------------------------------------
revoke execute on function private.verify_staff_session(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.resolve_item_price(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.compute_line_amounts(bigint, bigint, boolean, integer, integer) from public, anon, authenticated;
revoke execute on function private.next_invoice_number(uuid, uuid, text) from public, anon, authenticated;
do $$
declare f record; begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('submit_order','send_to_kitchen','advance_order_status','void_order_item',
                         'apply_order_discount','record_payment','open_shift','close_shift')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

comment on function public.submit_order is 'Create a complete order (header + lines + modifiers) in one idempotent call. Phase 1.';
comment on function public.send_to_kitchen is 'Stamp KOT time on active lines and move the order to sent_to_kitchen. Phase 1.';
comment on function public.advance_order_status is 'KDS two-tap: sent_to_kitchen -> preparing -> ready -> served. Phase 1.';
comment on function public.void_order_item is 'Void a line; after KOT needs a second, manager-role staff session. Phase 1.';
comment on function public.apply_order_discount is 'Order-level percentage discount with a reason code. Phase 1.';
comment on function public.record_payment is 'One tender; idempotent; closes the order and assigns an invoice number once fully paid. Phase 1.';
comment on function public.open_shift is 'Open a cash shift on a device with an opening float. Phase 1.';
comment on function public.close_shift is 'Close a shift; records expected vs counted cash and the over/short. Phase 1.';
