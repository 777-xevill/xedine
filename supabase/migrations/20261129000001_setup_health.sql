-- Setup centre (Setup → health): every setting a restaurant needs, in plain groups, each ticked by the data
-- itself so the page can never claim more than is true. The twelve onboarding steps keep their rules
-- (metric_setup_progress, unchanged); this adds the rest of the restaurant's configuration, and marks each
-- step required (the numbers or the till are wrong without it) or optional (a feature worth switching on).
-- "Not needed" steps (no delivery-app channel → no commission to enter) count as done.

create function public.metric_setup_health(p_org uuid, p_now timestamptz)
returns table (category text, step text, required boolean, done boolean, have bigint, need bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_items bigint;
  v_branches bigint;
  v_ingredients bigint;
  v_apps bigint;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select count(*) into v_items from public.menu_items m where m.org_id = p_org and m.is_active;
  select count(*) into v_branches from public.branches b where b.org_id = p_org and b.is_active;
  select count(*) into v_ingredients from public.ingredients i where i.org_id = p_org and i.is_active;
  select count(*) into v_apps from public.channels c
   where c.org_id = p_org and c.is_active and c.kind in ('foodpanda', 'pathao_food');

  return query
  with base as (
    select p.step, p.have, p.need, p.done from public.metric_setup_progress(p_org, p_now) p
  ),
  all_steps as (
    -- 1. The restaurant itself
    select 10 as ord, 'basics'::text as cat, 'profile'::text as st, true as req,
           b.have, b.need, b.done from base b where b.step = 'profile'
    union all
    select 11, 'basics', 'place', true, x.n, 1::bigint, x.n >= 1
      from (select count(*) as n from public.org_settings s
             where s.org_id = p_org and s.country is not null and s.timezone is not null
               and s.currency is not null) x
    union all
    select 12, 'basics', 'tax', true, x.n, 1::bigint, x.n >= 1
      from (select count(*) as n from public.org_settings s where s.org_id = p_org) x
    union all
    select 13, 'basics', 'receipt', true, x.n, 1::bigint, x.n >= 1
      from (select count(*) as n from public.org_receipt_settings r
             where r.org_id = p_org and nullif(btrim(r.legal_name), '') is not null
               and nullif(btrim(r.phone), '') is not null) x
    union all
    select 14, 'basics', 'branch_location', false, x.n, v_branches, v_branches > 0 and x.n >= v_branches
      from (select count(*) as n from public.branches b
             where b.org_id = p_org and b.is_active and b.latitude is not null and b.longitude is not null) x

    -- 2. Menu
    union all
    select 20, 'menu', b.step, true, b.have, b.need, b.done from base b where b.step = 'menu'
    union all
    select 21, 'menu', 'dish_photos', false, x.n, v_items, v_items > 0 and x.n >= v_items
      from (select count(*) as n from public.menu_items m
             where m.org_id = p_org and m.is_active and m.photo_path is not null) x
    union all
    select 22, 'menu', 'food_facts', false, x.n, v_items, v_items > 0 and x.n >= v_items
      from (select count(*) as n from public.dish_nutrition d
              join public.menu_items m on m.org_id = d.org_id and m.id = d.menu_item_id and m.is_active
             where d.org_id = p_org and d.status = 'approved') x
    union all
    select 23, 'menu', 'discount_codes', false, x.n, 1::bigint, x.n >= 1
      from (select count(*) as n from public.discount_codes d where d.org_id = p_org) x

    -- 3. Selling: the till
    union all
    select 30, 'selling', b.step, true, b.have, b.need, b.done from base b where b.step = 'channels'
    union all
    select 31, 'selling', 'commissions', false, x.n, v_apps, x.n >= v_apps
      from (select count(distinct c.id) as n from public.channels c
              join public.channel_commissions k on k.org_id = c.org_id and k.channel_id = c.id
             where c.org_id = p_org and c.is_active and c.kind in ('foodpanda', 'pathao_food')) x
    union all
    select 32, 'selling', b.step, true, b.have, b.need, b.done from base b where b.step = 'staff_pins'
    union all
    select 33, 'selling', b.step, true, b.have, b.need, b.done from base b where b.step = 'pos_device'
    union all
    select 34, 'selling', 'tables', false, x.n, 1::bigint, x.n >= 1
      from (select count(*) as n from public.dining_tables t where t.org_id = p_org and t.is_active) x

    -- 4. Costs and profit
    union all
    select 40 + o.k, 'costs', b.step, true, b.have, b.need, b.done
      from base b join (values ('recipes', 0), ('ingredient_prices', 1), ('fixed_costs', 2), ('salaries', 3))
        as o(s, k) on o.s = b.step

    -- 5. Stock and food safety
    union all
    select 50, 'stock', b.step, true, b.have, b.need, b.done from base b where b.step = 'opening_count'
    union all
    select 51, 'stock', 'suppliers', false, x.n, 1::bigint, x.n >= 1
      from (select count(*) as n from public.suppliers s where s.org_id = p_org and s.is_active) x
    union all
    select 52, 'stock', 'shelf_life', false, x.n, v_ingredients, v_ingredients > 0 and x.n >= v_ingredients
      from (select count(*) as n from public.ingredients i
             where i.org_id = p_org and i.is_active and i.shelf_life_days is not null) x
    union all
    select 53, 'stock', 'daily_checks', false, x.n, 1::bigint, x.n >= 1
      from (select count(*) as n from public.compliance_checks c where c.org_id = p_org and c.is_active) x

    -- 6. Team
    union all
    select 60, 'team', 'managers', false, x.n, 1::bigint, x.n >= 1
      from (select (select count(*) from public.memberships m
                     where m.org_id = p_org and m.status = 'active' and m.role <> 'owner')
                 + (select count(*) from public.invitations i
                     where i.org_id = p_org and i.status = 'pending' and i.expires_at > p_now) as n) x
    union all
    select 61, 'team', 'purchaser_telegram', false, x.n, 1::bigint, x.n >= 1
      from (select count(*) as n from public.chat_links l
             where l.org_id = p_org and l.channel = 'telegram' and l.external_id is not null
               and l.revoked_at is null
               and not exists (select 1 from public.memberships m
                                where m.org_id = l.org_id and m.user_id = l.user_id
                                  and m.role = 'owner' and m.status = 'active')) x

    -- 7. The owner's briefs
    union all
    select 70, 'alerts', b.step, true, b.have, b.need, b.done from base b where b.step = 'owner_whatsapp'

    -- 8. Customers and growth
    union all
    select 80, 'customers', 'google_review', false, x.n, v_branches, v_branches > 0 and x.n >= v_branches
      from (select count(*) as n from public.branches b
             where b.org_id = p_org and b.is_active and nullif(btrim(b.google_review_url), '') is not null) x
    union all
    select 81, 'customers', 'member_card', false, x.n, 1::bigint, x.n >= 1
      from (select count(*) as n from public.loyalty_settings l where l.org_id = p_org and l.is_on) x
    union all
    select 82, 'customers', 'social', false, x.n, 1::bigint, x.n >= 1
      from (select count(*) as n from public.social_accounts a where a.org_id = p_org) x

    -- 9. Go live
    union all
    select 90, 'golive', b.step, true, b.have, b.need, b.done from base b where b.step = 'first_order'
  )
  select r.cat, r.st, r.req, r.done, r.have::bigint, r.need::bigint from all_steps r order by r.ord;
end $$;

revoke execute on function public.metric_setup_health(uuid, timestamptz) from public, anon;
grant execute on function public.metric_setup_health(uuid, timestamptz) to authenticated, service_role;
comment on function public.metric_setup_health is
  'Setup centre: every configuration step by group, required or optional, ticked from the data. Owner only.';
