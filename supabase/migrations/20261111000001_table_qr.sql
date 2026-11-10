-- ADR 0045: Table QR. Every table gets its own QR code. A customer scans it with the phone camera (no app,
-- no account) and gets one page: become a member (ADR 0042 card), the menu at this branch's prices, a
-- review on Google, and the private complaint box (ADR 0043).
--
-- The table's link token is the only credential, as on the complaint and member card pages, so only the
-- service role can use these functions. Joining never shows anything about a phone number the restaurant
-- already knows: anyone at a table can type any number, so a known number is told to ask at the counter.

-- Every table has a link; a new table gets one by itself.
update public.dining_tables set qr_token = replace(gen_random_uuid()::text, '-', '') where qr_token is null;
alter table public.dining_tables
  alter column qr_token set default replace(gen_random_uuid()::text, '-', ''),
  alter column qr_token set not null,
  add constraint dining_tables_qr_token_format check (qr_token ~ '^[0-9a-f]{32}$');

-- The branch's "write a review" link on Google, set by the owner. Everyone sees it (Google does not allow
-- asking only happy customers).
alter table public.branches add column google_review_url text
  constraint branches_google_review_url check (
    google_review_url is null or (length(google_review_url) <= 500 and google_review_url ~ '^https://[^\s]+$'));

-- Which table a customer joined from: counts how many join an hour and shows the owner where members come from.
alter table public.member_cards add column joined_table_id uuid;
alter table public.member_cards add constraint member_cards_joined_table_fk
  foreign key (org_id, joined_table_id) references public.dining_tables (org_id, id) on delete set null (joined_table_id);
create index member_cards_joined_table_idx on public.member_cards (org_id, joined_table_id, created_at)
  where joined_table_id is not null;

-- ---------------------------------------------------------------------------------------------
-- What the customer's table page shows. Null for an unknown link, a removed table or a closed branch.
-- The menu uses this branch's prices and leaves out what is off today (86 or stopped for food safety).
-- ---------------------------------------------------------------------------------------------
create function public.table_page(p_token text, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.dining_tables;
  b public.branches;
  s public.loyalty_settings;
  v_today date;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{32}$' then return null; end if;
  select * into t from public.dining_tables where qr_token = p_token and is_active;
  if not found then return null; end if;
  select * into b from public.branches where org_id = t.org_id and id = t.branch_id and is_active;
  if not found then return null; end if;
  select * into s from public.loyalty_settings where org_id = t.org_id;
  v_today := private.business_date(p_now, private.branch_cutoff(t.org_id, t.branch_id));

  return jsonb_build_object(
    'org_id', t.org_id,
    'restaurant', (select name from public.organizations where id = t.org_id),
    'branch', b.name,
    'address', concat_ws(', ', nullif(b.address, ''), nullif(b.area, '')),
    'table', t.name,
    'member_on', coalesce(s.is_on, false),
    'earn_points', s.earn_points,
    'earn_every_poisha', s.earn_every_poisha,
    'point_value_poisha', s.point_value_poisha,
    'discount_bps', case when s.is_on and s.discount_on then s.discount_bps end,
    'google_review_url', b.google_review_url,
    'complaint_token', b.complaint_token,
    'menu', coalesce((
      select jsonb_agg(m order by m.cat_sort, m.cat, m.sort_order, m.name) from (
        select mi.name, mi.name_bn, mi.description,
               coalesce(case when p.has_price_override then p.price_poisha end, mi.base_price_poisha) as price_poisha,
               mi.photo_path, mi.sort_order, coalesce(mc.sort_order, 1000000) as cat_sort,
               coalesce(mc.name, '') as cat, mc.name_bn as cat_bn
          from public.menu_items mi
          left join public.menu_categories mc on mc.org_id = mi.org_id and mc.id = mi.category_id
          left join public.branch_item_prices p
            on p.org_id = mi.org_id and p.branch_id = t.branch_id and p.menu_item_id = mi.id and p.variant_id is null
         where mi.org_id = t.org_id and mi.is_active and (mc.id is null or mc.is_active)
           and coalesce(p.is_available, true)
           and not exists (select 1 from private.m_blocked_items(t.org_id, t.branch_id, v_today) x
                            where x.menu_item_id = mi.id and x.variant_id is null)
         limit 300) m), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Become a member from the table. Returns {status}: 'new' (with the card token), 'known' (the restaurant
-- already has this number: ask at the counter), 'off' (no member card), 'gone', 'busy' or 'invalid'.
-- A branch takes at most 30 new members an hour through its tables.
-- ---------------------------------------------------------------------------------------------
create function public.join_member_at_table(
  p_token text, p_phone text, p_name text, p_offers boolean, p_now timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.dining_tables;
  s public.loyalty_settings;
  v_phone text;
  v_customer uuid;
  v_token text;
  v_channel public.consent_channel;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{32}$' then return jsonb_build_object('status', 'gone'); end if;
  select * into t from public.dining_tables where qr_token = p_token and is_active;
  if not found or not exists (select 1 from public.branches b
                               where b.org_id = t.org_id and b.id = t.branch_id and b.is_active) then
    return jsonb_build_object('status', 'gone');
  end if;
  select * into s from public.loyalty_settings where org_id = t.org_id;
  if not found or not s.is_on then return jsonb_build_object('status', 'off'); end if;
  v_phone := private.normalize_bd_phone(p_phone);
  if v_phone is null then return jsonb_build_object('status', 'invalid'); end if;

  -- One join at a time per branch, so the hourly limit and a double tap are both exact.
  perform pg_advisory_xact_lock(hashtextextended(t.branch_id::text, 45));
  if exists (select 1 from public.customers where org_id = t.org_id and phone = v_phone) then
    return jsonb_build_object('status', 'known');
  end if;
  if (select count(*) from public.member_cards mc
        join public.dining_tables d on d.org_id = mc.org_id and d.id = mc.joined_table_id
       where mc.org_id = t.org_id and d.branch_id = t.branch_id
         and mc.created_at >= p_now - interval '1 hour') >= 30 then
    return jsonb_build_object('status', 'busy');
  end if;

  insert into public.customers (org_id, phone, name, first_seen_at)
  values (t.org_id, v_phone, left(nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), ''), 120), p_now)
  returning id into v_customer;
  -- Offers only when the customer ticked the box; the card itself needs no consent to marketing.
  if coalesce(p_offers, false) then
    foreach v_channel in array array['whatsapp', 'sms']::public.consent_channel[] loop
      insert into public.consents (org_id, customer_id, channel, purpose, granted, source, recorded_at)
      values (t.org_id, v_customer, v_channel, 'marketing', true, 'table_qr', p_now);
    end loop;
  end if;
  insert into public.member_cards (org_id, customer_id, token, joined_table_id, created_at)
  values (t.org_id, v_customer, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'), t.id, p_now)
  returning token into v_token;
  return jsonb_build_object('status', 'new', 'token', v_token, 'org_id', t.org_id);
end $$;

-- The owner or manager gives a table a new link (an old printed QR stops working).
create function public.reset_table_link(p_org uuid, p_table uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from public.dining_tables where org_id = p_org and id = p_table;
  if v_branch is null
     or not private.can_access_branch_role(p_org, v_branch, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.dining_tables set qr_token = replace(gen_random_uuid()::text, '-', '')
   where org_id = p_org and id = p_table;
  perform private.write_audit(p_org, v_branch, 'table.link_reset', 'dining_table', p_table::text, null, null, null, null, null);
end $$;

-- The owner or manager sets the branch's Google review link (owner-only branch updates otherwise).
create function public.set_google_review_url(p_org uuid, p_branch uuid, p_url text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.branches set google_review_url = nullif(btrim(coalesce(p_url, '')), '')
   where org_id = p_org and id = p_branch;
  if not found then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
end $$;

revoke execute on function public.table_page(text, timestamptz) from public, anon, authenticated;
grant execute on function public.table_page(text, timestamptz) to service_role;
revoke execute on function public.join_member_at_table(text, text, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.join_member_at_table(text, text, text, boolean, timestamptz) to service_role;
revoke execute on function public.reset_table_link(uuid, uuid) from public, anon;
grant execute on function public.reset_table_link(uuid, uuid) to authenticated, service_role;
revoke execute on function public.set_google_review_url(uuid, uuid, text) from public, anon;
grant execute on function public.set_google_review_url(uuid, uuid, text) to authenticated, service_role;

comment on column public.dining_tables.qr_token is
  'The link printed as this table''s QR code (ADR 0045). Not a secret from staff; a new one stops the old link.';
comment on column public.branches.google_review_url is 'The branch''s Google "write a review" link, shown on every table page (ADR 0045).';
comment on column public.member_cards.joined_table_id is 'The table a customer joined from by its QR code; null when the till made the card (ADR 0045).';
comment on function public.table_page is 'The customer''s table page: names, member card rules, Google link and branch menu (service role only). ADR 0045.';
comment on function public.join_member_at_table is 'A new customer becomes a member from the table QR (service role only; 30 an hour per branch). ADR 0045.';
comment on function public.reset_table_link is 'Owner or manager replaces a table''s QR link. ADR 0045.';
comment on function public.set_google_review_url is 'Owner or manager sets the branch''s Google review link. ADR 0045.';
