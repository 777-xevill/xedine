-- Restaurants in any country (ADR 0062): a customer's mobile number in the restaurant's own country.
-- Bangladesh keeps its exact rule (01X…, +880). Elsewhere a number with its country code (+44 7700 900123,
-- 0044…) is kept as is, and a local one (07700 900123) gets the restaurant's country code, its leading trunk
-- 0 dropped (Italy keeps its 0). Numbers are stored as +<digits>, 8 to 15 digits (E.164). TODO(verify) the
-- mobile prefixes of each market; this only checks the shape.
-- Owner sign-in by phone (the Telegram bot, ADR 0050) stays Bangladeshi: owners abroad use email or Google.

create function private.calling_code(p_country text) returns text
language sql immutable set search_path = '' as $$
  select case p_country
    when 'BD' then '880'
    when 'IN' then '91'
    when 'PK' then '92'
    when 'LK' then '94'
    when 'NP' then '977'
    when 'MY' then '60'
    when 'ID' then '62'
    when 'SG' then '65'
    when 'TH' then '66'
    when 'VN' then '84'
    when 'PH' then '63'
    when 'CN' then '86'
    when 'JP' then '81'
    when 'KR' then '82'
    when 'AE' then '971'
    when 'SA' then '966'
    when 'QA' then '974'
    when 'KW' then '965'
    when 'OM' then '968'
    when 'BH' then '973'
    when 'JO' then '962'
    when 'EG' then '20'
    when 'TR' then '90'
    when 'IR' then '98'
    when 'MA' then '212'
    when 'NG' then '234'
    when 'KE' then '254'
    when 'ZA' then '27'
    when 'GB' then '44'
    when 'IE' then '353'
    when 'FR' then '33'
    when 'DE' then '49'
    when 'ES' then '34'
    when 'IT' then '39'
    when 'NL' then '31'
    when 'SE' then '46'
    when 'RU' then '7'
    when 'US' then '1'
    when 'CA' then '1'
    when 'MX' then '52'
    when 'BR' then '55'
    when 'AR' then '54'
    when 'AU' then '61'
    when 'NZ' then '64'
  end
$$;

create function private.normalize_phone(p_phone text, p_org uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_country text := coalesce((select country from public.org_settings where org_id = p_org), 'BD');
  v_code text;
  v text;
begin
  if v_country = 'BD' then
    return private.normalize_bd_phone(p_phone);
  end if;
  -- "+44 (0)7700 900123": the (0) is the local trunk prefix, written for people dialling at home.
  v := regexp_replace(coalesce(p_phone, ''), '\(0\)', '', 'g');
  v := translate(regexp_replace(v, '[[:space:]().-]', '', 'g'), '০১২৩৪৫৬৭৮৯', '0123456789');
  if v ~ '^00[1-9]' then v := '+' || substr(v, 3); end if;
  if v !~ '^\+' then
    v_code := private.calling_code(v_country);
    if v_code is null or v !~ '^[0-9]+$' then return null; end if;
    if v_country <> 'IT' then v := regexp_replace(v, '^0', ''); end if;
    v := '+' || v_code || v;
  end if;
  if v ~ '^\+[1-9][0-9]{7,14}$' then return v; end if;
  return null;
end $$;
revoke execute on function private.normalize_phone(text, uuid) from public, anon, authenticated;

-- public.attach_customer (from 20261028000001_member_card.sql)
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
  v_phone := private.normalize_phone(p_phone, p_org);
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

-- public.join_member_at_table (from 20261111000001_table_qr.sql)
create or replace function public.join_member_at_table(
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
  v_phone := private.normalize_phone(p_phone, t.org_id);
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

-- public.send_bazar_list (from 20261003000001_forecast_bazar.sql)
create or replace function public.send_bazar_list(p_list uuid, p_messages jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  l public.bazar_lists;
  m jsonb;
  v_n integer := 0;
begin
  select * into l from public.bazar_lists where id = p_list for update;
  if not found or not private.can_access_branch_role(l.org_id, l.branch_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if l.status <> 'approved' then
    raise exception 'approve the list before sending it' using errcode = 'invalid_parameter_value';
  end if;
  for m in select * from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) loop
    if private.normalize_phone(m ->> 'to_phone', l.org_id) is null or nullif(btrim(m ->> 'body'), '') is null then
      continue;
    end if;
    insert into public.message_outbox (org_id, channel, to_phone, template_key, payload, idempotency_key, approved_by, approved_at)
    values (l.org_id, 'whatsapp', private.normalize_phone(m ->> 'to_phone', l.org_id), 'bazar_list',
            jsonb_build_object('body', left(m ->> 'body', 3000), 'language', coalesce(nullif(m ->> 'language', ''), 'bn'),
                               'date', l.for_date),
            'bazar:' || l.id || ':' || private.normalize_phone(m ->> 'to_phone', l.org_id), (select auth.uid()), now())
    on conflict (org_id, idempotency_key) do nothing;
    v_n := v_n + 1;
  end loop;
  update public.bazar_lists set status = 'sent', sent_at = now() where id = p_list;
  perform private.write_audit(l.org_id, l.branch_id, 'bazar.send', 'bazar_list', p_list::text, null,
    jsonb_build_object('messages', v_n), null, null, null);
  return v_n;
end $$;
