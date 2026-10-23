-- Saving a dish must not wait for the whole year of sales (ADR 0037).
-- save_recipe refreshed the cost of every dish's sales of the last 90 days, about three seconds on the demo
-- restaurant, close enough to the API's 8 second limit to fail as "Something went wrong" when busy. A save
-- only changes this one dish, so only its sales need a cost, and a sale that already has its cost snapshot
-- (never overwritten anyway) is not priced again. The all-dishes call keeps working.

-- The same backfill, optionally for one dish only (p_item null = every dish, as before).
create function private.backfill_item_costs(p_org uuid, p_from date, p_to date, p_item uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  with keys as (
    select distinct oi.menu_item_id, oi.variant_id, o.business_date
      from public.order_items oi join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
     where oi.org_id = p_org and o.business_date between p_from and p_to and oi.menu_item_id is not null
       and (p_item is null or oi.menu_item_id = p_item)
       and not exists (select 1 from public.order_item_costs x where x.order_item_id = oi.id)
  ), costs as (
    select k.menu_item_id, k.variant_id, k.business_date, c.recipe_id, c.unit_cost
      from keys k cross join lateral private.item_unit_cost(p_org, k.menu_item_id, k.variant_id, k.business_date) c
     where c.unit_cost is not null
  ), ins as (
    insert into public.order_item_costs (order_item_id, org_id, branch_id, order_id, menu_item_id, business_date,
      recipe_id, unit_cost_poisha, cost_poisha)
    select oi.id, oi.org_id, oi.branch_id, oi.order_id, oi.menu_item_id, o.business_date, c.recipe_id,
           round(c.unit_cost)::bigint, round(c.unit_cost * oi.quantity)::bigint
      from public.order_items oi
      join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
      join costs c on c.menu_item_id = oi.menu_item_id and c.variant_id is not distinct from oi.variant_id
                  and c.business_date = o.business_date
     where oi.org_id = p_org and o.business_date between p_from and p_to
       and (p_item is null or oi.menu_item_id = p_item)
    on conflict (order_item_id) do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end $$;

-- The three-argument form is every dish, as before.
create or replace function private.backfill_item_costs(p_org uuid, p_from date, p_to date) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  return private.backfill_item_costs(p_org, p_from, p_to, null::uuid);
end $$;

-- Save: owner or manager, optionally confirming an AI suggestion; refreshes this dish's costs only.
create or replace function public.save_recipe(
  p_org uuid, p_item uuid, p_variant uuid, p_name text, p_yield numeric, p_lines jsonb,
  p_notes text default null, p_draft uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_status public.draft_status;
  v_draft_item uuid;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_draft is not null then
    select d.status, d.menu_item_id into v_status, v_draft_item from public.recipe_drafts d
     where d.org_id = p_org and d.id = p_draft for update;
    if v_status is distinct from 'pending_review'::public.draft_status or v_draft_item is distinct from p_item then
      raise exception 'this AI suggestion was already used or is for another dish' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  v_id := private.write_recipe(p_org, p_item, p_variant, p_name, p_yield, p_lines,
    case when p_draft is null then 'manual' else 'ai_draft' end::public.recipe_source, p_notes);
  if p_draft is not null then
    -- The draft keeps what the AI proposed; the recipe holds what the person saved.
    update public.recipe_drafts
       set status = 'confirmed', reviewed_by = (select auth.uid()), reviewed_at = now(), recipe_id = v_id
     where id = p_draft;
    perform private.write_audit(p_org, null, 'recipe.approve_draft', 'recipe', v_id::text,
      jsonb_build_object('draft', p_draft), p_lines, null);
  end if;
  -- Past sales of this item get a cost from now on; real snapshots are never overwritten.
  if p_item is not null then
    perform private.backfill_item_costs(p_org, current_date - 90, current_date, p_item);
  end if;
  return v_id;
end $$;
