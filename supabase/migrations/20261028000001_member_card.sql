-- ---------------------------------------------------------------------------------------------
-- Member card (ADR 0042). A customer known by phone at the till gets a card link (/m/<token>):
-- their points, their past bills and the menu, read-only. The owner decides the rules:
--
--  * loyalty_settings: one row per restaurant. Card on/off; "N points for every ৳X on the bill";
--    "1 point = ৳Y"; the fewest points that can be used; a member discount (any percent, on/off).
--  * member_cards: the card link of each customer. The link's token is the only thing a customer
--    needs; the owner or a manager can replace a lost one.
--  * loyalty_points: every change to a customer's points, one row each (earn / redeem / adjust).
--    The balance is their sum, minus nothing: a redemption on a cancelled bill does not count.
--
-- Earning is automatic (a trigger when a bill with a customer is completed). Using points is a
-- money-off amount on the bill, on top of a percent discount, recomputed with the bill like every
-- discount. The owner may add or take away points by hand, with a reason, audited.
-- ---------------------------------------------------------------------------------------------

create table public.loyalty_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  is_on boolean not null default false,
  -- earn_points points for every earn_every_poisha on the bill total (default: 1 point per ৳100).
  earn_points integer not null default 1 constraint loyalty_earn_points check (earn_points between 1 and 1000),
  earn_every_poisha bigint not null default 10000
    constraint loyalty_earn_every check (earn_every_poisha between 100 and 10000000),
  -- What one point is worth when used (default ৳1), and the fewest points a customer can use at once.
  point_value_poisha bigint not null default 100
    constraint loyalty_point_value check (point_value_poisha between 1 and 100000),
  min_redeem_points integer not null default 50
    constraint loyalty_min_redeem check (min_redeem_points between 1 and 1000000),
  -- Member discount: taken off a bill as soon as a member is added to it, when switched on.
  discount_on boolean not null default false,
  discount_bps integer not null default 1000 constraint loyalty_discount check (discount_bps between 1 and 10000),
  updated_at timestamptz not null default now()
);
create trigger loyalty_settings_touch before update on public.loyalty_settings
  for each row execute function private.touch_updated_at();

create table public.member_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  -- 18 random bytes, URL-safe base64: 24 characters, never guessed.
  token text not null unique constraint member_cards_token check (token ~ '^[A-Za-z0-9_-]{24}$'),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, customer_id),
  foreign key (org_id, customer_id) references public.customers (org_id, id) on delete cascade
);

create type public.loyalty_kind as enum ('earn', 'redeem', 'adjust');

create table public.loyalty_points (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  kind public.loyalty_kind not null,
  -- Signed: earn and a hand-added adjust are positive, redeem and a taken-away adjust negative.
  points integer not null constraint loyalty_points_nonzero check (points <> 0),
  order_id uuid,
  branch_id uuid,
  -- Redeem only: the money taken off the bill for these points, fixed when they were used.
  value_poisha bigint constraint loyalty_points_value check (value_poisha is null or value_poisha > 0),
  note text constraint loyalty_points_note check (note is null or length(note) <= 200),
  staff_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, customer_id) references public.customers (org_id, id) on delete cascade,
  foreign key (org_id, order_id) references public.orders (org_id, id) on delete cascade,
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete set null (branch_id),
  foreign key (org_id, staff_id) references public.staff (org_id, id) on delete set null (staff_id)
);
create index loyalty_points_customer_idx on public.loyalty_points (org_id, customer_id, created_at desc);
create index loyalty_points_branch_idx on public.loyalty_points (org_id, branch_id);
create index loyalty_points_order_idx on public.loyalty_points (org_id, order_id) where order_id is not null;
-- One earn row and at most one redeem row per bill.
create unique index loyalty_points_earn_once on public.loyalty_points (org_id, order_id) where kind = 'earn';
create unique index loyalty_points_redeem_once on public.loyalty_points (org_id, order_id) where kind = 'redeem';

do $$
declare
  v_staff public.app_role[] := array['owner', 'manager', 'cashier']::public.app_role[];
  v_leads public.app_role[] := array['owner', 'manager']::public.app_role[];
begin
  perform private.apply_policies('loyalty_settings', 'org', v_staff, array['owner']::public.app_role[], false,
    'the owner sets the member-card rules; the till reads the discount and point value');
  perform private.apply_policies('member_cards', 'org', v_staff, '{}', false,
    'card links are made by member_card_link / reset_member_card');
  perform private.apply_policies('loyalty_points', 'org', v_leads, '{}', false,
    'written by the earn trigger, redeem_points and adjust_points only');
end $$;

comment on table public.loyalty_settings is 'Member-card rules per restaurant: points earned and their worth, member discount. | written by: customers | phase: 11';
comment on table public.member_cards is 'Each customer''s member-card link token (read-only page for the customer). | written by: customers | phase: 11';
comment on table public.loyalty_points is 'Every change to a customer''s points: earned on a bill, used on a bill, or set by the owner. | written by: customers | phase: 11';

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- A customer's points now. A redemption on a cancelled bill gives its points back.
create function private.points_balance(p_org uuid, p_customer uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(lp.points), 0)::bigint
    from public.loyalty_points lp
    left join public.orders o on o.org_id = lp.org_id and o.id = lp.order_id
   where lp.org_id = p_org and lp.customer_id = p_customer
     and not (lp.kind = 'redeem' and o.order_status = 'cancelled')
$$;

-- The card link token of a customer, made the first time it is asked for.
create function private.ensure_member_card(p_org uuid, p_customer uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
begin
  select token into v_token from public.member_cards where org_id = p_org and customer_id = p_customer;
  if v_token is null then
    insert into public.member_cards (org_id, customer_id, token)
    values (p_org, p_customer, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'))
    on conflict (org_id, customer_id) do nothing;
    select token into v_token from public.member_cards where org_id = p_org and customer_id = p_customer;
  end if;
  return v_token;
end $$;

-- What using points is worth on a bill (0 when none were used).
create function private.order_points_value(p_org uuid, p_order uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(value_poisha), 0)::bigint from public.loyalty_points
   where org_id = p_org and order_id = p_order and kind = 'redeem'
$$;

-- The most points a customer can use on an open bill (points already used on it count as theirs
-- again, since using points replaces what was used before): never more than the bill has left after
-- its percent discount, in whole points; 0 when that is below the owner's minimum.
create function private.usable_points(p_org uuid, p_order uuid, p_customer uuid, p_s public.loyalty_settings)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  v_o public.orders;
  v_pct integer;
  v_balance bigint;
  v_left bigint;
  v_most bigint;
begin
  select * into v_o from public.orders where org_id = p_org and id = p_order;
  if not found or v_o.order_status = 'cancelled' or v_o.payment_status <> 'unpaid' then return 0; end if;
  v_balance := private.points_balance(p_org, p_customer)
    - coalesce((select sum(points) from public.loyalty_points
                 where org_id = p_org and order_id = p_order and kind = 'redeem' and customer_id = p_customer), 0);
  select d.percent_bps into v_pct from public.discounts d
   where d.org_id = p_org and d.order_id = p_order and d.order_item_id is null and d.percent_bps is not null
   order by d.created_at desc, d.id desc limit 1;
  v_left := v_o.gross_poisha - coalesce(round(v_o.gross_poisha * v_pct / 10000.0), 0)::bigint;
  v_most := least(greatest(v_balance, 0), greatest(v_left, 0) / p_s.point_value_poisha);
  return case when v_most >= p_s.min_redeem_points then v_most else 0 end;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Totals now include points used: the bill's discount is the latest percent discount plus the money
-- value of the points, never more than the bill. Same body as before otherwise.
-- ---------------------------------------------------------------------------------------------
create or replace function private.recompute_order_totals(p_org uuid, p_order uuid) returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  v_o public.orders;
  v_sum record;
  v_pct integer;
  v_points bigint;
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
  v_points := private.order_points_value(p_org, p_order);

  if v_pct is null and v_points = 0 then
    update public.orders set
      gross_poisha = v_sum.gross, discount_poisha = 0, net_before_discount_poisha = v_sum.net_before,
      discount_net_poisha = 0, net_poisha = v_sum.net, vat_poisha = v_sum.vat,
      service_charge_poisha = v_sum.service, total_poisha = v_sum.total
    where id = p_order returning * into v_o;
  else
    v_disc := least(v_sum.gross, coalesce(round(v_sum.gross * v_pct / 10000.0), 0)::bigint + v_points);
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

-- ---------------------------------------------------------------------------------------------
-- Member discount: when a member is added to an open bill that has no discount yet, and the owner has
-- switched it on, the bill gets the owner's percent off. A bill that already has a discount (a code,
-- a manager's) keeps it: the cashier can still change it in Apply discount.
-- ---------------------------------------------------------------------------------------------
create function private.member_discount_on_attach(
  p_org uuid, p_branch uuid, p_order uuid, p_device uuid, p_staff uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s public.loyalty_settings;
  v_o public.orders;
  v_amount bigint;
begin
  select * into v_s from public.loyalty_settings where org_id = p_org;
  if not found or not v_s.is_on or not v_s.discount_on then return; end if;
  select * into v_o from public.orders where org_id = p_org and id = p_order for update;
  if v_o.order_status = 'cancelled' or v_o.payment_status <> 'unpaid' then return; end if;
  if exists (select 1 from public.discounts where org_id = p_org and order_id = p_order and order_item_id is null) then
    return;
  end if;
  v_amount := round(v_o.gross_poisha * v_s.discount_bps / 10000.0);
  if v_amount <= 0 then return; end if;
  insert into public.discounts (org_id, branch_id, order_id, amount_poisha, percent_bps, reason_note, applied_by_staff_id)
  values (p_org, p_branch, p_order, v_amount, v_s.discount_bps, 'Member discount', p_staff);
  v_o := private.recompute_order_totals(p_org, p_order);
  perform private.write_audit(p_org, p_branch, 'order.discount', 'order', p_order::text, null,
    jsonb_build_object('percent_bps', v_s.discount_bps, 'discount_poisha', v_o.discount_poisha, 'member', true),
    'Member discount', p_device, p_staff);
end $$;

-- When the customer on a bill changes, points another customer used on it are given back.
create function private.clear_other_redemptions(p_org uuid, p_order uuid, p_customer uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.loyalty_points
   where org_id = p_org and order_id = p_order and kind = 'redeem' and customer_id <> p_customer
$$;

-- ---------------------------------------------------------------------------------------------
-- A customer at the till by phone: as before, plus the member discount and the card link.
-- ---------------------------------------------------------------------------------------------
create or replace function public.attach_customer(
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

  perform private.clear_other_redemptions(p_org, p_order, v_customer);
  perform private.recompute_order_totals(p_org, p_order);
  perform private.member_discount_on_attach(p_org, p_branch, p_order, p_device, p_staff);
  if exists (select 1 from public.loyalty_settings where org_id = p_org and is_on) then
    perform private.ensure_member_card(p_org, v_customer);
  end if;
  return v_customer;
end $$;

-- ---------------------------------------------------------------------------------------------
-- A customer shows their card at the till: the cashier scans its QR (the link carries the token).
-- ---------------------------------------------------------------------------------------------
create function public.attach_member_card(
  p_org uuid, p_branch uuid, p_order uuid, p_token text, p_device uuid, p_staff uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  select customer_id into v_customer from public.member_cards where org_id = p_org and token = coalesce(p_token, '');
  if v_customer is null then
    raise exception 'card_not_found' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.orders where org_id = p_org and id = p_order and branch_id = p_branch) then
    raise exception 'order not found' using errcode = 'no_data_found';
  end if;

  update public.orders set customer_id = v_customer where id = p_order;
  insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id)
  values (p_org, p_branch, p_order, 'customer_attached', p_staff, p_device);
  perform private.write_audit(p_org, p_branch, 'order.customer', 'order', p_order::text, null,
    jsonb_build_object('member_card', true), null, p_device, p_staff);

  perform private.clear_other_redemptions(p_org, p_order, v_customer);
  perform private.recompute_order_totals(p_org, p_order);
  perform private.member_discount_on_attach(p_org, p_branch, p_order, p_device, p_staff);
  return v_customer;
end $$;

-- ---------------------------------------------------------------------------------------------
-- What the till shows about the member on a bill: name, points, what they are worth, the card link.
-- ---------------------------------------------------------------------------------------------
create function public.member_for_till(p_org uuid, p_branch uuid, p_order uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.loyalty_settings;
  v_c public.customers;
  v_customer uuid;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select customer_id into v_customer from public.orders where org_id = p_org and id = p_order and branch_id = p_branch;
  if v_customer is null then return null; end if;
  select * into v_c from public.customers where org_id = p_org and id = v_customer;
  select * into v_s from public.loyalty_settings where org_id = p_org;
  if not found or not v_s.is_on then
    return jsonb_build_object('is_on', false, 'name', v_c.name);
  end if;
  return jsonb_build_object(
    'is_on', true,
    'name', v_c.name,
    'points', private.points_balance(p_org, v_customer),
    'used_here', coalesce((select -sum(points) from public.loyalty_points
                            where org_id = p_org and order_id = p_order and kind = 'redeem'), 0),
    -- Points that could still go on this bill: the balance (plus any already used here), never more
    -- than the bill has left after its percent discount, and none below the owner's minimum.
    'usable', private.usable_points(p_org, p_order, v_customer, v_s),
    'usable_worth_poisha', private.usable_points(p_org, p_order, v_customer, v_s) * v_s.point_value_poisha,
    'used_worth_poisha', private.order_points_value(p_org, p_order),
    'point_value_poisha', v_s.point_value_poisha,
    'min_redeem_points', v_s.min_redeem_points,
    'discount_on', v_s.discount_on,
    'discount_bps', v_s.discount_bps,
    'token', private.ensure_member_card(p_org, v_customer));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Using points on an open bill. p_points = 0 takes back points used on it. The money off is fixed
-- now (points × the owner's point value) and may not be more than what is left of the bill.
-- ---------------------------------------------------------------------------------------------
create function public.redeem_points(
  p_org uuid, p_branch uuid, p_order uuid, p_points integer, p_device uuid, p_staff uuid
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  v_s public.loyalty_settings;
  v_o public.orders;
  v_balance bigint;
  v_value bigint;
  v_pct integer;
  v_left bigint;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  select * into v_s from public.loyalty_settings where org_id = p_org;
  if not found or not v_s.is_on then
    raise exception 'points_off' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_o from public.orders where org_id = p_org and id = p_order and branch_id = p_branch for update;
  if not found then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  if v_o.order_status = 'cancelled' or v_o.payment_status <> 'unpaid' then
    raise exception 'cannot use points on a paid or closed order' using errcode = 'invalid_parameter_value';
  end if;
  if v_o.customer_id is null then
    raise exception 'no_member' using errcode = 'invalid_parameter_value';
  end if;
  if p_points is null or p_points < 0 then
    raise exception 'points_too_few' using errcode = 'invalid_parameter_value';
  end if;
  -- One customer's points are used one bill at a time.
  perform 1 from public.customers where org_id = p_org and id = v_o.customer_id for update;

  delete from public.loyalty_points where org_id = p_org and order_id = p_order and kind = 'redeem';
  if p_points > 0 then
    if p_points < v_s.min_redeem_points then
      raise exception 'points_too_few' using errcode = 'invalid_parameter_value';
    end if;
    v_balance := private.points_balance(p_org, v_o.customer_id);
    if p_points > v_balance then
      raise exception 'points_not_enough' using errcode = 'invalid_parameter_value';
    end if;
    v_value := p_points::bigint * v_s.point_value_poisha;
    select d.percent_bps into v_pct from public.discounts d
     where d.org_id = p_org and d.order_id = p_order and d.order_item_id is null and d.percent_bps is not null
     order by d.created_at desc, d.id desc limit 1;
    v_left := v_o.gross_poisha - coalesce(round(v_o.gross_poisha * v_pct / 10000.0), 0)::bigint;
    if v_value > v_left then
      raise exception 'points_more_than_bill' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.loyalty_points (org_id, customer_id, kind, points, order_id, branch_id, value_poisha, staff_id)
    values (p_org, v_o.customer_id, 'redeem', -p_points, p_order, p_branch, v_value, p_staff);
  end if;

  v_o := private.recompute_order_totals(p_org, p_order);
  perform private.write_audit(p_org, p_branch, 'order.points', 'order', p_order::text, null,
    jsonb_build_object('points', p_points, 'value_poisha', coalesce(v_value, 0), 'discount_poisha', v_o.discount_poisha),
    null, p_device, p_staff);
  return v_o;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Earning: a completed bill with a customer gives earn_points for every earn_every_poisha of its total.
-- Runs when the bill is completed and when a customer is added to an already completed bill.
-- ---------------------------------------------------------------------------------------------
create function private.award_points() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.loyalty_settings;
  v_points bigint;
begin
  select * into v_s from public.loyalty_settings where org_id = new.org_id;
  if not found or not v_s.is_on then return null; end if;
  delete from public.loyalty_points
   where org_id = new.org_id and order_id = new.id and kind = 'earn' and customer_id <> new.customer_id;
  v_points := (new.total_poisha / v_s.earn_every_poisha) * v_s.earn_points;
  if v_points > 0 then
    insert into public.loyalty_points (org_id, customer_id, kind, points, order_id, branch_id)
    values (new.org_id, new.customer_id, 'earn', least(v_points, 2147483647)::integer, new.id, new.branch_id)
    on conflict (org_id, order_id) where kind = 'earn' do nothing;
  end if;
  return null;
end $$;

create trigger orders_award_points
  after update of order_status, customer_id on public.orders
  for each row
  when (new.order_status = 'completed' and new.customer_id is not null
        and (old.order_status is distinct from new.order_status or old.customer_id is distinct from new.customer_id))
  execute function private.award_points();

-- ---------------------------------------------------------------------------------------------
-- The owner gives or takes away points by hand, with a reason. The balance never goes below zero.
-- ---------------------------------------------------------------------------------------------
create function public.adjust_points(p_org uuid, p_customer uuid, p_points integer, p_note text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_before bigint;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 200);
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_points is null or p_points = 0 or abs(p_points) > 1000000 then
    raise exception 'points_bad' using errcode = 'invalid_parameter_value';
  end if;
  if v_note is null then
    raise exception 'reason_needed' using errcode = 'invalid_parameter_value';
  end if;
  perform 1 from public.customers where org_id = p_org and id = p_customer for update;
  if not found then raise exception 'customer not found' using errcode = 'no_data_found'; end if;
  v_before := private.points_balance(p_org, p_customer);
  if v_before + p_points < 0 then
    raise exception 'points_below_zero' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.loyalty_points (org_id, customer_id, kind, points, note, created_by)
  values (p_org, p_customer, 'adjust', p_points, v_note, auth.uid());
  perform private.write_audit(p_org, null, 'customer.points', 'customer', p_customer::text,
    jsonb_build_object('points', v_before), jsonb_build_object('points', v_before + p_points), v_note);
  return v_before + p_points;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The owner's members list: points, last visit and card link, optionally found by phone digits.
-- ---------------------------------------------------------------------------------------------
create function public.member_points(p_org uuid, p_search text default null, p_limit integer default 50)
returns table (customer_id uuid, phone text, name text, points bigint, last_visit date, token text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_digits text := regexp_replace(translate(coalesce(p_search, ''), '০১২৩৪৫৬৭৮৯', '0123456789'), '[^0-9]', '', 'g');
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.id, c.phone, c.name, private.points_balance(p_org, c.id),
           (select max(o.business_date) from public.orders o
             where o.org_id = p_org and o.customer_id = c.id and o.order_status = 'completed'),
           (select m.token from public.member_cards m where m.org_id = p_org and m.customer_id = c.id)
      from public.customers c
     where c.org_id = p_org
       and (v_digits = '' or c.phone like '%' || v_digits || '%')
     order by 4 desc, c.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

-- A card link for a customer (made if missing), and a new one when the old link was shared by mistake.
create function public.member_card_link(p_org uuid, p_customer uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.customers where org_id = p_org and id = p_customer) then
    raise exception 'customer not found' using errcode = 'no_data_found';
  end if;
  return private.ensure_member_card(p_org, p_customer);
end $$;

create function public.reset_member_card(p_org uuid, p_customer uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  delete from public.member_cards where org_id = p_org and customer_id = p_customer;
  perform private.write_audit(p_org, null, 'customer.card_reset', 'customer', p_customer::text, null, null, null);
  return private.ensure_member_card(p_org, p_customer);
end $$;

-- ---------------------------------------------------------------------------------------------
-- The customer's own card page (/m/<token>): read-only, for the holder of the link. Only the server
-- calls it (service role); the token is the only credential. Null when the link is unknown or the
-- restaurant has switched the card off. Phone masked; no costs, no other customers.
-- ---------------------------------------------------------------------------------------------
create function public.member_card_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_card public.member_cards;
  v_s public.loyalty_settings;
  v_c public.customers;
begin
  if coalesce(p_token, '') !~ '^[A-Za-z0-9_-]{24}$' then return null; end if;
  select * into v_card from public.member_cards where token = p_token;
  if not found then return null; end if;
  select * into v_s from public.loyalty_settings where org_id = v_card.org_id;
  if not found or not v_s.is_on then return null; end if;
  select * into v_c from public.customers where org_id = v_card.org_id and id = v_card.customer_id;

  return jsonb_build_object(
    'restaurant', (select name from public.organizations where id = v_card.org_id),
    'name', v_c.name,
    'phone', private.mask_phone(v_c.phone),
    'member_since', (v_c.first_seen_at at time zone 'Asia/Dhaka')::date,
    'points', private.points_balance(v_card.org_id, v_c.id),
    'points_worth_poisha', private.points_balance(v_card.org_id, v_c.id) * v_s.point_value_poisha,
    'point_value_poisha', v_s.point_value_poisha,
    'min_redeem_points', v_s.min_redeem_points,
    'earn_points', v_s.earn_points,
    'earn_every_poisha', v_s.earn_every_poisha,
    'discount_bps', case when v_s.discount_on then v_s.discount_bps end,
    'orders', coalesce((
      select jsonb_agg(x order by x.placed_at desc) from (
        select o.placed_at, o.business_date, b.name as branch, o.total_poisha,
               (select coalesce(sum(lp.points), 0) from public.loyalty_points lp
                 where lp.org_id = o.org_id and lp.order_id = o.id and lp.kind = 'earn') as points,
               (select coalesce(jsonb_agg(jsonb_build_object('name', oi.name_snapshot, 'quantity', oi.quantity)
                                          order by oi.created_at), '[]'::jsonb)
                  from public.order_items oi
                 where oi.org_id = o.org_id and oi.order_id = o.id and oi.status = 'active') as items
          from public.orders o
          join public.branches b on b.org_id = o.org_id and b.id = o.branch_id
         where o.org_id = v_card.org_id and o.customer_id = v_c.id and o.order_status = 'completed'
         order by o.placed_at desc limit 20) x), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h order by h.created_at desc) from (
        select lp.kind, lp.points, lp.created_at from public.loyalty_points lp
          left join public.orders o on o.org_id = lp.org_id and o.id = lp.order_id
         where lp.org_id = v_card.org_id and lp.customer_id = v_c.id
           and not (lp.kind = 'redeem' and o.order_status = 'cancelled')
         order by lp.created_at desc limit 20) h), '[]'::jsonb),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object('name', b.name, 'address', b.address, 'area', b.area) order by b.name)
        from public.branches b where b.org_id = v_card.org_id and b.is_active), '[]'::jsonb),
    'menu', coalesce((
      select jsonb_agg(m order by m.cat_sort, m.cat, m.sort_order, m.name) from (
        select mi.name, mi.name_bn, mi.description, mi.base_price_poisha as price_poisha, mi.photo_path,
               mi.sort_order, coalesce(mc.sort_order, 1000000) as cat_sort,
               coalesce(mc.name, '') as cat, mc.name_bn as cat_bn
          from public.menu_items mi
          left join public.menu_categories mc on mc.org_id = mi.org_id and mc.id = mi.category_id
         where mi.org_id = v_card.org_id and mi.is_active and (mc.id is null or mc.is_active)
         limit 300) m), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Who may call what.
-- ---------------------------------------------------------------------------------------------
revoke execute on function private.points_balance(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.ensure_member_card(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.order_points_value(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.usable_points(uuid, uuid, uuid, public.loyalty_settings) from public, anon, authenticated;
revoke execute on function private.member_discount_on_attach(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.clear_other_redemptions(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.award_points() from public, anon, authenticated;

revoke execute on function public.attach_member_card(uuid, uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.attach_member_card(uuid, uuid, uuid, text, uuid, uuid) to authenticated, service_role;
revoke execute on function public.member_for_till(uuid, uuid, uuid) from public, anon;
grant execute on function public.member_for_till(uuid, uuid, uuid) to authenticated, service_role;
revoke execute on function public.redeem_points(uuid, uuid, uuid, integer, uuid, uuid) from public, anon;
grant execute on function public.redeem_points(uuid, uuid, uuid, integer, uuid, uuid) to authenticated, service_role;
revoke execute on function public.adjust_points(uuid, uuid, integer, text) from public, anon;
grant execute on function public.adjust_points(uuid, uuid, integer, text) to authenticated, service_role;
revoke execute on function public.member_points(uuid, text, integer) from public, anon;
grant execute on function public.member_points(uuid, text, integer) to authenticated, service_role;
revoke execute on function public.member_card_link(uuid, uuid) from public, anon;
grant execute on function public.member_card_link(uuid, uuid) to authenticated, service_role;
revoke execute on function public.reset_member_card(uuid, uuid) from public, anon;
grant execute on function public.reset_member_card(uuid, uuid) to authenticated, service_role;
-- The card page reads through the server only.
revoke execute on function public.member_card_view(text) from public, anon, authenticated;
grant execute on function public.member_card_view(text) to service_role;

comment on function public.attach_member_card is 'The cashier scans a customer''s member-card QR: the customer is put on the bill, member discount if on (ADR 0042).';
comment on function public.member_for_till is 'The member on a bill for the till: name, points, point value, card link (ADR 0042).';
comment on function public.redeem_points is 'Use a member''s points as money off an open bill; 0 takes them back (ADR 0042).';
comment on function public.adjust_points is 'The owner adds or takes away a customer''s points by hand, with a reason; audited (ADR 0042).';
comment on function public.member_points is 'The owner''s list of members with points, last visit and card link (ADR 0042).';
comment on function public.member_card_link is 'A customer''s member-card link token, made if missing (ADR 0042).';
comment on function public.reset_member_card is 'Replace a customer''s member-card link; the old one stops working (ADR 0042).';
comment on function public.member_card_view is 'The customer''s read-only card page data, by link token; service role only (ADR 0042).';
