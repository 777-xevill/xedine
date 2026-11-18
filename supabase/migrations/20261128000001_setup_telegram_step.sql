-- Owner briefs by Telegram (ADR 0025): WhatsApp runs on Meta's free test number (5 recipients, unpublished app),
-- so the setup step that was "Owner WhatsApp" is now done when the owner has connected Telegram (or, as before,
-- opted in to WhatsApp). The step key stays 'owner_whatsapp' so existing progress and tests are unchanged.

create or replace function public.metric_setup_progress(p_org uuid, p_now timestamptz)
returns table (step text, done boolean, have bigint, need bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_asof date;
  v_month date;
  v_items bigint;
  v_costed bigint;
  v_ingredients bigint;
  v_priced bigint;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_asof := private.business_date(p_now, private.org_cutoff(p_org));
  v_month := date_trunc('month', v_asof)::date;
  select count(*) into v_items from public.menu_items m where m.org_id = p_org and m.is_active;
  select count(distinct r.menu_item_id) into v_costed from public.recipes r
    join public.menu_items m on m.org_id = r.org_id and m.id = r.menu_item_id and m.is_active
   where r.org_id = p_org and r.status = 'active';
  select count(*) into v_ingredients from public.ingredients i where i.org_id = p_org and i.is_active;
  select count(distinct h.ingredient_id) into v_priced from public.ingredient_price_history h
    join public.ingredients i on i.org_id = h.org_id and i.id = h.ingredient_id and i.is_active
   where h.org_id = p_org;
  return query
    select x.step, x.have >= x.need and x.need > 0, x.have, x.need from (
      select 1 as ord, 'profile'::text as step,
             (select count(*) from public.org_profile p where p.org_id = p_org and p.cuisine is not null and p.city is not null) as have,
             1::bigint as need
      union all select 2, 'menu', v_items, 5
      union all select 3, 'channels', (select count(*) from public.channels c where c.org_id = p_org and c.is_active), 1
      union all select 4, 'staff_pins', (select count(*) from public.staff s join public.staff_pins sp
                                           on sp.org_id = s.org_id and sp.staff_id = s.id
                                          where s.org_id = p_org and s.is_active), 1
      union all select 5, 'pos_device', (select count(*) from public.devices d
                                          where d.org_id = p_org and d.status = 'active'), 1
      union all select 6, 'recipes', v_costed, greatest(ceil(v_items * 0.9)::bigint, 1)
      union all select 7, 'ingredient_prices', v_priced, greatest(v_ingredients, 1)
      union all select 8, 'fixed_costs', (select count(*) from public.fixed_costs f where f.org_id = p_org), 1
      union all select 9, 'salaries', (select count(*) from public.salary_entries s where s.org_id = p_org and s.month = v_month), 1
      union all select 10, 'opening_count', (select count(*) from public.stock_counts c
                                              where c.org_id = p_org and c.status = 'submitted'), 1
      union all select 11, 'owner_whatsapp', (select count(*) from public.chat_links l
                                               join public.memberships m on m.org_id = l.org_id and m.user_id = l.user_id
                                                and m.role = 'owner' and m.status = 'active'
                                              where l.org_id = p_org and l.channel = 'telegram'
                                                and l.external_id is not null and l.revoked_at is null)
                                           + (select count(*) from public.org_profile p
                                               where p.org_id = p_org and p.owner_whatsapp_opt_in_at is not null), 1
      union all select 12, 'first_order', (select count(*) from (select 1 from public.orders o
                                             where o.org_id = p_org and o.order_status = 'completed' limit 1) z), 1
    ) x
    order by x.ord;
end $$;
