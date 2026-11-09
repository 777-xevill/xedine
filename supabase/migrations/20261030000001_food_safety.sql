-- ADR 0043 (1/3): food safety. Expired or unsafe ingredients cannot go into a dish.
--
-- 1. A shelf life per ingredient, set once ("chicken: 2 days"). Every purchase then has an expiry date by
--    itself (bought on + days), so the purchaser is asked nothing (ADR 0029/0030). A packet's own date can
--    be written on a lot, and a person who checked it can move the date on, with a reason.
-- 2. An item is BLOCKED at a branch when someone put it on hold (smell, fridge failed, a recall), or when
--    the newest lot that reached the branch has passed its date: there is nothing in-date to cook with.
-- 3. A blocked item's dishes leave the till, and submit_order / add_order_items refuse them. An order the
--    till already took offline is never refused when it syncs (CLAUDE.md #7): it is accepted and flagged
--    to the owner.

-- ingredients.shelf_life_days has existed since Phase 3, unused until now.
comment on column public.ingredients.shelf_life_days is
  'Days an item stays safe after it arrives; null = not set, so it is never blocked by date. ADR 0043.';

alter table public.purchase_lines add column expires_on date;
comment on column public.purchase_lines.expires_on is
  'Last safe day written on this lot (packet date, or moved by someone who checked it); null = bought on + shelf life. ADR 0043.';
alter table public.transfer_lines add column expires_on date;
comment on column public.transfer_lines.expires_on is
  'Last safe day written on this lot at the receiving branch; null = received on + shelf life. ADR 0043.';

alter table public.org_settings
  add column food_safety_block_expired boolean not null default true;
comment on column public.org_settings.food_safety_block_expired is
  'true: an expired lot takes its dishes off the till. false: warn only. A hold always blocks. ADR 0043.';

-- A purchaser can edit their purchase lines, but a lot's safe date only moves through set_lot_expiry
-- (who, why, before/after). Functions run as their owner, so only a direct client update is stopped.
create function private.guard_lot_expiry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.expires_on is distinct from old.expires_on and current_user in ('authenticated', 'anon') then
    raise exception 'a safe date is changed with set_lot_expiry' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger purchase_lines_guard_expiry before update of expires_on on public.purchase_lines
  for each row execute function private.guard_lot_expiry();

create table public.ingredient_holds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  ingredient_id uuid not null,
  reason text not null constraint ingredient_holds_reason check (length(btrim(reason)) between 1 and 300),
  held_by uuid references auth.users (id) on delete set null,
  held_at timestamptz not null default now(),
  released_by uuid references auth.users (id) on delete set null,
  released_at timestamptz,
  release_note text constraint ingredient_holds_release_note check (release_note is null or length(release_note) <= 300),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete cascade
);
create unique index ingredient_holds_one_active on public.ingredient_holds (org_id, branch_id, ingredient_id)
  where released_at is null;
create index ingredient_holds_branch_idx on public.ingredient_holds (org_id, branch_id, held_at desc);
create index ingredient_holds_ingredient_idx on public.ingredient_holds (org_id, ingredient_id);

do $$
begin
  perform private.apply_policies('ingredient_holds', 'branch',
    array['owner', 'manager', 'kitchen', 'purchaser', 'accountant']::public.app_role[], '{}'::public.app_role[], false,
    'written by hold_ingredient and release_ingredient_hold only (audited)');
end $$;
comment on table public.ingredient_holds is
  'An ingredient someone marked unsafe at a branch; its dishes cannot be sold until released. | written by: inventory | phase: 11';

-- ---------------------------------------------------------------------------------------------
-- Lots and what is blocked (METRICS.md "Food safety")
-- ---------------------------------------------------------------------------------------------
-- Every arrival at a branch, with its safe date: the date written on the lot, else arrival + shelf life.
create function private.m_lots(p_org uuid, p_branches uuid[])
returns table (branch_id uuid, ingredient_id uuid, lot_kind text, lot_id uuid, received_on date, qty numeric, expires_on date)
language sql stable security definer set search_path = '' as $$
  select pl.branch_id, pl.ingredient_id, 'purchase'::text, pl.id, p.purchased_on, pl.qty_base,
         coalesce(pl.expires_on, p.purchased_on + i.shelf_life_days)
    from public.purchase_lines pl
    join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
    join public.ingredients i on i.org_id = pl.org_id and i.id = pl.ingredient_id
   where pl.org_id = p_org and pl.branch_id = any (p_branches) and p.status = 'confirmed' and i.is_active
  union all
  select t.to_branch_id, tl.ingredient_id, 'transfer', tl.id, t.received_on, coalesce(tl.qty_base_received, 0),
         coalesce(tl.expires_on, t.received_on + i.shelf_life_days)
    from public.transfer_lines tl
    join public.transfers t on t.org_id = tl.org_id and t.id = tl.transfer_id
    join public.ingredients i on i.org_id = tl.org_id and i.id = tl.ingredient_id
   where tl.org_id = p_org and t.to_branch_id = any (p_branches) and t.status in ('received', 'disputed')
     and coalesce(tl.qty_base_received, 0) > 0 and i.is_active
$$;

-- food_safety.blocked: held, or the newest lot is past its date (when the restaurant blocks on dates).
create function private.m_blocked_ingredients(p_org uuid, p_branch uuid, p_today date)
returns table (ingredient_id uuid, reason text, expired_on date, hold_id uuid, note text)
language sql stable security definer set search_path = '' as $$
  select h.ingredient_id, 'held'::text, null::date, h.id, h.reason
    from public.ingredient_holds h
   where h.org_id = p_org and h.branch_id = p_branch and h.released_at is null
  union all
  select n.ingredient_id, 'expired', n.expires_on, null::uuid, null::text
    from (
      select distinct on (l.ingredient_id) l.ingredient_id, l.expires_on
        from private.m_lots(p_org, array[p_branch]) l
       where l.received_on <= p_today
       order by l.ingredient_id, l.received_on desc, l.expires_on desc nulls first
    ) n
   where n.expires_on < p_today
     and coalesce((select s.food_safety_block_expired from public.org_settings s where s.org_id = p_org), true)
     and not exists (select 1 from public.ingredient_holds h
                      where h.org_id = p_org and h.branch_id = p_branch and h.ingredient_id = n.ingredient_id
                        and h.released_at is null)
$$;

-- The dishes (and variants, by the recipe each one really uses) that need a blocked ingredient.
create function private.m_blocked_items(p_org uuid, p_branch uuid, p_today date)
returns table (menu_item_id uuid, variant_id uuid, ingredient_id uuid, reason text)
language sql stable security definer set search_path = '' as $$
  with b as (
    select * from private.m_blocked_ingredients(p_org, p_branch, p_today)
  ), targets as (
    select mi.id as item, null::uuid as variant from public.menu_items mi
     where mi.org_id = p_org and mi.is_active and exists (select 1 from b)
    union all
    select v.menu_item_id, v.id from public.item_variants v
     where v.org_id = p_org and v.is_active and exists (select 1 from b)
  ), recipes as (
    select t.item, t.variant, private.active_recipe(p_org, t.item, t.variant) as recipe_id from targets t
  )
  select r.item, r.variant, e.ingredient_id, b.reason
    from recipes r
    cross join lateral private.recipe_explode(p_org, r.recipe_id) e
    join b on b.ingredient_id = e.ingredient_id
   where r.recipe_id is not null
$$;

-- Refuses a live order that needs a blocked ingredient. p_live = false (an order taken offline, reaching
-- the server late) is accepted and written to the audit log for the owner to see.
create function private.food_safety_guard(
  p_org uuid, p_branch uuid, p_order uuid, p_lines jsonb, p_live boolean, p_device uuid, p_staff uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.business_date(now(), private.branch_cutoff(p_org, p_branch));
  v_ids uuid[];
begin
  if jsonb_typeof(p_lines) <> 'array' then
    return;
  end if;
  select array_agg(distinct b.ingredient_id) into v_ids
    from jsonb_array_elements(p_lines) l
    join private.m_blocked_items(p_org, p_branch, v_today) b
      on b.menu_item_id = nullif(l ->> 'menu_item_id', '')::uuid
     and b.variant_id is not distinct from nullif(l ->> 'variant_id', '')::uuid;
  if v_ids is null then
    return;
  end if;
  if p_live then
    raise exception 'food_safety_blocked' using errcode = 'invalid_parameter_value';
  end if;
  perform private.write_audit(p_org, p_branch, 'food_safety.sold_while_blocked', 'order', p_order::text, null,
    jsonb_build_object('ingredient_ids', to_jsonb(v_ids)), 'taken offline before the till knew of the block',
    p_device, p_staff);
end $$;

-- ---------------------------------------------------------------------------------------------
-- The till: the only two changes are the guard calls
-- ---------------------------------------------------------------------------------------------
create or replace function public.submit_order(
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

  -- Rung up within the last two minutes = the cashier is standing there; older = it waited offline.
  perform private.food_safety_guard(p_org, p_branch, p_order_id, p_lines,
    v_placed >= now() - interval '2 minutes', p_device, p_staff);

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

create or replace function public.add_order_items(
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

  -- A second round never goes through the offline queue, so the cashier is always there to be told.
  perform private.food_safety_guard(p_org, p_branch, p_order, p_lines, true, p_device, p_staff);

  v_n := private.insert_order_lines(p_org, p_branch, p_order, p_lines, v_order.service_charge_bps,
    v_order.price_includes_vat, v_order.vat_rate_bps, p_batch_key, p_staff, p_device);
  v_order := private.recompute_order_totals(p_org, p_order);
  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id, meta)
  values (p_org, p_branch, p_order, 'items_added', p_staff, p_device, jsonb_build_object('lines', v_n, 'batch_key', p_batch_key));
  perform private.write_audit(p_org, p_branch, 'order.add_items', 'order', p_order::text, null,
    jsonb_build_object('lines', v_n, 'total_poisha', v_order.total_poisha), null, p_device, p_staff);
  return v_order;
end $$;

-- ---------------------------------------------------------------------------------------------
-- What people read
-- ---------------------------------------------------------------------------------------------
-- The till and kitchen: what cannot be sold right now, and because of which ingredient.
create function public.food_safety_blocked_items(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (menu_item_id uuid, variant_id uuid, ingredient_id uuid, ingredient_name text, ingredient_name_bn text, reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service_role() and not private.can_access_branch_role(p_org, p_branch,
       array['owner', 'manager', 'cashier', 'kitchen']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select b.menu_item_id, b.variant_id, b.ingredient_id, i.name, i.name_bn, b.reason
      from private.m_blocked_items(p_org, p_branch,
             private.business_date(p_now, private.branch_cutoff(p_org, p_branch))) b
      join public.ingredients i on i.org_id = p_org and i.id = b.ingredient_id
     order by i.name;
end $$;

-- food_safety.blocks: each blocked ingredient at each branch, with the dishes it takes off the menu.
create function public.metric_food_safety_blocks(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (branch_id uuid, ingredient_id uuid, name text, name_bn text, reason text, expired_on date, hold_id uuid,
               note text, held_at timestamptz, lot_kind text, lot_id uuid, dishes text[], dishes_bn text[], as_of date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[] := private.stock_scope(p_org, p_branch);
begin
  return query
    select s.b, bi.ingredient_id, i.name, i.name_bn, bi.reason, bi.expired_on, bi.hold_id, bi.note, h.held_at,
           lot.lot_kind, lot.lot_id,
           coalesce((select array_agg(distinct mi.name order by mi.name)
                       from private.m_blocked_items(p_org, s.b, s.today) x
                       join public.menu_items mi on mi.org_id = p_org and mi.id = x.menu_item_id
                      where x.ingredient_id = bi.ingredient_id), '{}'),
           coalesce((select array_agg(distinct coalesce(mi.name_bn, mi.name))
                       from private.m_blocked_items(p_org, s.b, s.today) x
                       join public.menu_items mi on mi.org_id = p_org and mi.id = x.menu_item_id
                      where x.ingredient_id = bi.ingredient_id), '{}'),
           s.today
      from (select u as b, private.business_date(p_now, private.branch_cutoff(p_org, u)) as today
              from unnest(v_scope) u) s
     cross join lateral private.m_blocked_ingredients(p_org, s.b, s.today) bi
      join public.ingredients i on i.org_id = p_org and i.id = bi.ingredient_id
      left join public.ingredient_holds h on h.org_id = p_org and h.id = bi.hold_id
      left join lateral (
        select l.lot_kind, l.lot_id from private.m_lots(p_org, array[s.b]) l
         where l.ingredient_id = bi.ingredient_id and bi.reason = 'expired' and l.received_on <= s.today
         order by l.received_on desc, l.expires_on desc nulls first
         limit 1
      ) lot on true
     order by i.name;
end $$;

-- food_safety.lots: lots near or past their date. What is still on the shelf is worked out from the
-- stock figure, oldest used first: the stock is laid over the newest lots, and what reaches an old lot
-- is what is probably left of it (estimated when nobody has counted the item at this branch).
create function public.metric_food_safety(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (branch_id uuid, ingredient_id uuid, name text, name_bn text, base text, lot_kind text, lot_id uuid,
               received_on date, lot_qty numeric, expires_on date, days_left integer, on_shelf_qty numeric,
               estimated boolean, is_newest boolean, status text, as_of date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := private.business_date(p_now, private.org_cutoff(p_org));
  v_scope uuid[] := private.stock_scope(p_org, p_branch);
begin
  return query
    with st as (
      select * from private.m_stock(p_org, v_scope, v_date)
    ), est as (
      select * from private.m_stock_estimate(p_org, v_scope, v_date)
    ), onhand as (
      select coalesce(s.branch_id, e.branch_id) as branch_id, coalesce(s.ingredient_id, e.ingredient_id) as ingredient_id,
             greatest(coalesce(case when s.last_count_date is not null then s.stock_qty else e.est_qty end, 0), 0) as q,
             s.last_count_date is null as est
        from st s
        full join est e on e.branch_id = s.branch_id and e.ingredient_id = s.ingredient_id
    ), lots as (
      select l.*,
             row_number() over w as rn,
             coalesce(sum(l.qty) over (w rows between unbounded preceding and 1 preceding), 0) as newer_qty
        from private.m_lots(p_org, v_scope) l
       where l.received_on <= v_date
      window w as (partition by l.branch_id, l.ingredient_id
                   order by l.received_on desc, l.expires_on desc nulls first, l.lot_id)
    ), shelf as (
      select l.*, greatest(least(l.qty, coalesce(o.q, 0) - l.newer_qty), 0) as left_qty, coalesce(o.est, true) as est,
             private.business_date(p_now, private.branch_cutoff(p_org, l.branch_id)) as today
        from lots l
        left join onhand o on o.branch_id = l.branch_id and o.ingredient_id = l.ingredient_id
    )
    select s.branch_id, s.ingredient_id, i.name, i.name_bn, i.base::text, s.lot_kind, s.lot_id, s.received_on, s.qty,
           s.expires_on, s.expires_on - s.today, s.left_qty, s.est, s.rn = 1,
           case when s.expires_on < s.today then 'expired' when s.expires_on = s.today then 'today' else 'soon' end,
           s.today
      from shelf s
      join public.ingredients i on i.org_id = p_org and i.id = s.ingredient_id
     where s.expires_on is not null and s.expires_on - s.today <= 2 and (s.left_qty > 0 or s.rn = 1)
     order by s.expires_on, i.name;
end $$;

-- Orders taken offline while an item was blocked, last 7 days: the owner should check what went out.
create function public.metric_food_safety_sold(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (branch_id uuid, order_id uuid, at timestamptz, ingredients text[])
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[] := private.stock_scope(p_org, p_branch);
begin
  return query
    select a.branch_id, a.entity_id::uuid, a.created_at,
           coalesce((select array_agg(i.name order by i.name) from public.ingredients i
                      where i.org_id = p_org
                        and i.id::text in (select jsonb_array_elements_text(a.after -> 'ingredient_ids'))), '{}')
      from public.audit_log a
     where a.org_id = p_org and a.action = 'food_safety.sold_while_blocked' and a.branch_id = any (v_scope)
       and a.created_at >= p_now - interval '7 days' and a.created_at <= p_now
     order by a.created_at desc
     limit 30;
end $$;

-- ---------------------------------------------------------------------------------------------
-- What people do (every one audited)
-- ---------------------------------------------------------------------------------------------
create function public.set_shelf_life(p_org uuid, p_ingredient uuid, p_days integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old integer;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 3650) then
    raise exception 'shelf life is 1 to 3650 days' using errcode = 'invalid_parameter_value';
  end if;
  select shelf_life_days into v_old from public.ingredients where org_id = p_org and id = p_ingredient for update;
  if not found then
    raise exception 'unknown ingredient' using errcode = 'invalid_parameter_value';
  end if;
  if v_old is not distinct from p_days then
    return;
  end if;
  update public.ingredients set shelf_life_days = p_days where org_id = p_org and id = p_ingredient;
  perform private.write_audit(p_org, null, 'food_safety.shelf_life', 'ingredient', p_ingredient::text,
    jsonb_build_object('shelf_life_days', v_old), jsonb_build_object('shelf_life_days', p_days), null, null, null);
end $$;

-- A lot's safe date. Anyone in the kitchen may bring it forward; only the owner or manager may move it
-- later, and that needs the reason ("checked it, packet says the 20th").
create function public.set_lot_expiry(p_org uuid, p_kind text, p_lot uuid, p_expires date, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid;
  v_old date;
begin
  if p_expires is null then
    raise exception 'pick a date' using errcode = 'invalid_parameter_value';
  end if;
  if p_kind = 'purchase' then
    select pl.branch_id, coalesce(pl.expires_on, p.purchased_on + i.shelf_life_days) into v_branch, v_old
      from public.purchase_lines pl
      join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
      join public.ingredients i on i.org_id = pl.org_id and i.id = pl.ingredient_id
     where pl.org_id = p_org and pl.id = p_lot;
  elsif p_kind = 'transfer' then
    select t.to_branch_id, coalesce(tl.expires_on, t.received_on + i.shelf_life_days) into v_branch, v_old
      from public.transfer_lines tl
      join public.transfers t on t.org_id = tl.org_id and t.id = tl.transfer_id
      join public.ingredients i on i.org_id = tl.org_id and i.id = tl.ingredient_id
     where tl.org_id = p_org and tl.id = p_lot;
  else
    raise exception 'unknown lot' using errcode = 'invalid_parameter_value';
  end if;
  if v_branch is null then
    raise exception 'unknown lot' using errcode = 'invalid_parameter_value';
  end if;
  if not private.can_access_branch_role(p_org, v_branch, array['owner', 'manager', 'kitchen']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_old is null or p_expires > v_old then
    if not private.can_access_branch_role(p_org, v_branch, array['owner', 'manager']::public.app_role[]) then
      raise exception 'not allowed' using errcode = 'insufficient_privilege';
    end if;
    if length(coalesce(btrim(p_note), '')) < 3 then
      raise exception 'food_safety_reason_needed' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_kind = 'purchase' then
    update public.purchase_lines set expires_on = p_expires where org_id = p_org and id = p_lot;
  else
    update public.transfer_lines set expires_on = p_expires where org_id = p_org and id = p_lot;
  end if;
  perform private.write_audit(p_org, v_branch, 'food_safety.lot_expiry', p_kind || '_line', p_lot::text,
    jsonb_build_object('expires_on', v_old), jsonb_build_object('expires_on', p_expires),
    left(nullif(btrim(p_note), ''), 300), null, null);
end $$;

-- Anyone in the kitchen can stop an item; holding one already on hold changes nothing.
create function public.hold_ingredient(p_org uuid, p_branch uuid, p_ingredient uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'kitchen']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if length(coalesce(btrim(p_reason), '')) < 3 or length(p_reason) > 300 then
    raise exception 'food_safety_reason_needed' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.ingredients where org_id = p_org and id = p_ingredient) then
    raise exception 'unknown ingredient' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.ingredient_holds (org_id, branch_id, ingredient_id, reason, held_by)
  values (p_org, p_branch, p_ingredient, btrim(p_reason), (select auth.uid()))
  on conflict (org_id, branch_id, ingredient_id) where released_at is null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.ingredient_holds
     where org_id = p_org and branch_id = p_branch and ingredient_id = p_ingredient and released_at is null;
    return v_id;
  end if;
  perform private.write_audit(p_org, p_branch, 'food_safety.hold', 'ingredient_hold', v_id::text, null,
    jsonb_build_object('ingredient_id', p_ingredient), btrim(p_reason), null, null);
  return v_id;
end $$;

-- Only the owner or manager lifts a hold, and says why.
create function public.release_ingredient_hold(p_org uuid, p_hold uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  h public.ingredient_holds;
begin
  select * into h from public.ingredient_holds where org_id = p_org and id = p_hold for update;
  if not found or not private.can_access_branch_role(p_org, h.branch_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if h.released_at is not null then
    return;
  end if;
  if length(coalesce(btrim(p_note), '')) < 3 or length(p_note) > 300 then
    raise exception 'food_safety_reason_needed' using errcode = 'invalid_parameter_value';
  end if;
  update public.ingredient_holds
     set released_at = now(), released_by = (select auth.uid()), release_note = btrim(p_note)
   where id = h.id;
  perform private.write_audit(p_org, h.branch_id, 'food_safety.release', 'ingredient_hold', h.id::text,
    jsonb_build_object('reason', h.reason), jsonb_build_object('ingredient_id', h.ingredient_id), btrim(p_note), null, null);
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname in ('m_lots', 'm_blocked_ingredients', 'm_blocked_items', 'food_safety_guard', 'guard_lot_expiry')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('food_safety_blocked_items', 'metric_food_safety_blocks', 'metric_food_safety',
                         'metric_food_safety_sold', 'set_shelf_life', 'set_lot_expiry', 'hold_ingredient',
                         'release_ingredient_hold')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

comment on function public.food_safety_blocked_items is 'Till and kitchen: dishes that cannot be sold now and the ingredient behind each. ADR 0043.';
comment on function public.metric_food_safety_blocks is 'food_safety.blocks: blocked ingredients per branch with the dishes they stop (stock roles). ADR 0043.';
comment on function public.metric_food_safety is 'food_safety.lots: lots within 2 days of their date or past it, with what is probably left (stock roles). ADR 0043.';
comment on function public.metric_food_safety_sold is 'Offline orders accepted while an item was blocked, last 7 days (stock roles). ADR 0043.';
comment on function public.set_shelf_life is 'Owner or manager sets an ingredient''s shelf life in days; audited. ADR 0043.';
comment on function public.set_lot_expiry is 'Writes a lot''s safe date; moving it later needs owner/manager and a reason; audited. ADR 0043.';
comment on function public.hold_ingredient is 'Marks an ingredient unsafe at a branch; its dishes leave the till; audited. ADR 0043.';
comment on function public.release_ingredient_hold is 'Owner or manager lifts a hold with a reason; audited. ADR 0043.';
