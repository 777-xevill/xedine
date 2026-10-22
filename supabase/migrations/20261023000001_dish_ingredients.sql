-- ADR 0037: Dish ingredients — what goes into one plate of each dish, written by the owner or the
-- manager (who writes down what the chef says; the chef gets no new screen), and stock that goes
-- down as soon as an order is placed at the till.
--
-- 1. save_recipe: owner or manager. It can confirm an AI suggestion for the dish (a recipe_drafts
--    row): the person's Save is the approval (CLAUDE.md #4), audited as recipe.approve_draft.
-- 2. write_recipe: lines keep the order they were written in (recipe_lines.line_no); an ingredient
--    typed by name matches its English or Bangla name, a new one typed in Bangla keeps it as its
--    Bangla name, and a name that matches an item kept in another unit is refused (no grams of eggs);
--    a new version keeps the dish's deg / pot size (batch_portions, batch_unit — Phase 7 prep plan).
-- 3. usage.theoretical counts every active line of an order that was placed and not cancelled, paid
--    or not yet: the food leaves the shelf when the kitchen cooks it, not when the bill is paid.
-- 4. metric_stock_used: what the dishes sold took from stock, per ingredient and dish, and the dishes
--    sold that have nothing written for them yet (so took nothing).
-- 5. dish_recipe_lines: each active dish recipe line as the amount taken from stock, for the editor.

alter table public.recipe_lines add column line_no smallint;
comment on column public.recipe_lines.line_no is
  'Order the line was written in (ADR 0037); lines written before have none.';

-- ---------------------------------------------------------------------------------------------
-- 2. Writing a recipe
-- ---------------------------------------------------------------------------------------------
-- p_lines: [{ingredient_id? | ingredient?: name, base?: g|ml|pcs, sub_recipe_id?, qty_base, yield_pct?}]
create or replace function private.write_recipe(
  p_org uuid, p_item uuid, p_variant uuid, p_name text, p_yield numeric, p_lines jsonb,
  p_source public.recipe_source, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_recipe uuid;
  v_version integer;
  v_batch_portions numeric;
  v_batch_unit text;
  v_line jsonb;
  v_pos integer := 0;
  v_ingredient uuid;
  v_base public.base_unit;
  v_name text;
  v_qty numeric;
  v_yield_pct numeric;
begin
  if p_yield is null or p_yield <= 0 then
    raise exception 'yield must be positive' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'a recipe needs at least one line' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_lines) > 60 then
    raise exception 'a recipe has at most 60 lines' using errcode = 'invalid_parameter_value';
  end if;
  if p_item is not null and not exists (select 1 from public.menu_items where org_id = p_org and id = p_item) then
    raise exception 'unknown menu item' using errcode = 'invalid_parameter_value';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.recipes
   where org_id = p_org and menu_item_id is not distinct from p_item and variant_id is not distinct from p_variant;
  -- The deg or pot a dish is cooked in belongs to the dish, not to one version of its recipe.
  select r.batch_portions, r.batch_unit into v_batch_portions, v_batch_unit from public.recipes r
   where r.org_id = p_org and r.menu_item_id = p_item and r.variant_id is not distinct from p_variant
     and r.status = 'active';
  update public.recipes set status = 'archived'
   where org_id = p_org and menu_item_id is not distinct from p_item and variant_id is not distinct from p_variant
     and status = 'active' and p_item is not null;
  insert into public.recipes (org_id, menu_item_id, variant_id, name, yield_portions, status, source, version,
    created_by, approved_by, approved_at, notes, batch_portions, batch_unit)
  values (p_org, p_item, p_variant, p_name, p_yield, 'active', p_source, v_version,
    (select auth.uid()), (select auth.uid()), now(), left(nullif(btrim(p_notes), ''), 1000),
    v_batch_portions, v_batch_unit)
  returning id into v_recipe;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    v_qty := (v_line ->> 'qty_base')::numeric;
    v_yield_pct := coalesce((v_line ->> 'yield_pct')::numeric, 100);
    if v_qty is null or v_qty <= 0 or v_yield_pct <= 0 or v_yield_pct > 100 then
      raise exception 'each line needs a positive quantity and a yield of 1–100%%' using errcode = 'invalid_parameter_value';
    end if;
    if nullif(v_line ->> 'sub_recipe_id', '') is not null then
      insert into public.recipe_lines (org_id, recipe_id, sub_recipe_id, qty_base, yield_pct, line_no)
      values (p_org, v_recipe, (v_line ->> 'sub_recipe_id')::uuid, v_qty, v_yield_pct, v_pos);
      continue;
    end if;
    v_ingredient := nullif(v_line ->> 'ingredient_id', '')::uuid;
    if v_ingredient is null then
      -- An ingredient written by name is matched (English or Bangla name), or created without a price:
      -- costing stays "incomplete" until a price is entered or the bazar records one, never guessed.
      v_name := left(btrim(coalesce(v_line ->> 'ingredient', '')), 120);
      if v_name = '' then
        raise exception 'each line needs an ingredient' using errcode = 'invalid_parameter_value';
      end if;
      v_base := coalesce(nullif(v_line ->> 'base', ''), 'g')::public.base_unit;
      select i.id into v_ingredient from public.ingredients i
       where i.org_id = p_org and (lower(i.name) = lower(v_name) or lower(coalesce(i.name_bn, '')) = lower(v_name))
       order by (lower(i.name) = lower(v_name)) desc
       limit 1;
      if v_ingredient is null then
        insert into public.ingredients (org_id, name, name_bn, base)
        values (p_org, v_name, case when v_name ~ '[ঀ-৿]' then v_name end, v_base)
        returning id into v_ingredient;
      elsif nullif(v_line ->> 'base', '') is not null
            and (select i.base from public.ingredients i where i.org_id = p_org and i.id = v_ingredient) <> v_base then
        raise exception 'ingredient "%" is kept in another unit', v_name using errcode = 'invalid_parameter_value';
      end if;
    end if;
    insert into public.recipe_lines (org_id, recipe_id, ingredient_id, qty_base, yield_pct, line_no)
    values (p_org, v_recipe, v_ingredient, v_qty, v_yield_pct, v_pos);
  end loop;

  -- A sub-recipe loop would never cost; refuse it now rather than at the first sale.
  perform private.recipe_unit_cost(p_org, v_recipe, current_date);
  return v_recipe;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 1. Saving: owner or manager; optionally the AI suggestion this list started from
-- ---------------------------------------------------------------------------------------------
drop function public.save_recipe(uuid, uuid, uuid, text, numeric, jsonb, text);
create function public.save_recipe(
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
    perform private.backfill_item_costs(p_org, current_date - 90, current_date);
  end if;
  return v_id;
end $$;
revoke execute on function public.save_recipe(uuid, uuid, uuid, text, numeric, jsonb, text, uuid) from public, anon;
grant execute on function public.save_recipe(uuid, uuid, uuid, text, numeric, jsonb, text, uuid)
  to authenticated, service_role;
comment on function public.save_recipe is
  'Owner or manager saves a dish''s ingredients as a new active version (audited by trigger), optionally confirming an AI suggestion. ADR 0037.';

-- The manager asks the AI for a suggestion too (the draft is only a suggestion until Save).
drop policy recipe_drafts_select on public.recipe_drafts;
drop policy recipe_drafts_insert on public.recipe_drafts;
drop policy recipe_drafts_update on public.recipe_drafts;
drop policy recipe_drafts_delete on public.recipe_drafts;
select private.apply_policies('recipe_drafts', 'org', array['owner', 'manager', 'kitchen']::public.app_role[],
  array['owner', 'manager', 'kitchen']::public.app_role[], true,
  'AI suggestions only; a person''s Save (save_recipe) or the owner''s approval turns one into a recipe');

-- ---------------------------------------------------------------------------------------------
-- 3. usage.theoretical from the moment an order is placed
-- ---------------------------------------------------------------------------------------------
-- The dishes that went out of the kitchen, for stock: every active line of an order that was placed and
-- not cancelled (paid or not yet), with the recipe it is costed with — the sale-time snapshot's, else
-- the item's active recipe; null when the dish has nothing written.
create function private.m_sold_for_stock(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (branch_id uuid, business_date date, menu_item_id uuid, recipe_id uuid, qty numeric)
language sql stable security definer set search_path = '' as $$
  select s.branch_id, s.business_date, s.menu_item_id,
         coalesce(s.snap, private.active_recipe(p_org, s.menu_item_id, s.variant_id)), s.qty
    from (
      select oi.branch_id, o.business_date, oi.menu_item_id, oi.variant_id, c.recipe_id as snap,
             sum(oi.quantity)::numeric as qty
        from public.order_items oi
        join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
        left join public.order_item_costs c on c.order_item_id = oi.id
       where oi.org_id = p_org and oi.branch_id = any (p_branches) and oi.status = 'active'
         and o.order_status <> 'cancelled' and o.business_date between p_from and p_to
         and oi.menu_item_id is not null
       group by 1, 2, 3, 4, 5
    ) s
$$;
revoke execute on function private.m_sold_for_stock(uuid, uuid[], date, date) from public, anon, authenticated;

create or replace function private.m_stock_moves(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (branch_id uuid, business_date date, ingredient_id uuid, kind text, qty numeric, value_poisha bigint)
language sql stable security definer set search_path = '' as $$
  with sold_r as (
    select s.branch_id, s.business_date, s.recipe_id, sum(s.qty) as qty
      from private.m_sold_for_stock(p_org, p_branches, p_from, p_to) s
     group by 1, 2, 3
  ), item_waste as (
    select w.branch_id, w.business_date, sum(w.qty_portions) as qty,
           private.active_recipe(p_org, w.menu_item_id, null) as recipe_id
      from public.waste_logs w
     where w.org_id = p_org and w.branch_id = any (p_branches) and w.business_date between p_from and p_to
       and w.ingredient_id is null and w.menu_item_id is not null and w.qty_portions is not null
     group by w.branch_id, w.business_date, w.menu_item_id
  )
  select r.branch_id, r.business_date, e.ingredient_id, 'usage'::text, sum(r.qty * e.qty), null::bigint
    from sold_r r cross join lateral private.recipe_explode(p_org, r.recipe_id) e
   where r.recipe_id is not null
   group by 1, 2, 3
  union all
  select w.branch_id, w.business_date, w.ingredient_id, 'waste', sum(w.qty_base), null
    from public.waste_logs w
   where w.org_id = p_org and w.branch_id = any (p_branches) and w.business_date between p_from and p_to
     and w.ingredient_id is not null and w.qty_base is not null
   group by 1, 2, 3
  union all
  select r.branch_id, r.business_date, e.ingredient_id, 'waste', sum(r.qty * e.qty), null
    from item_waste r cross join lateral private.recipe_explode(p_org, r.recipe_id) e
   where r.recipe_id is not null
   group by 1, 2, 3
  union all
  select p.branch_id, p.purchased_on, pl.ingredient_id, 'purchase', sum(pl.qty_base), sum(pl.line_total_poisha)::bigint
    from public.purchases p
    join public.purchase_lines pl on pl.org_id = p.org_id and pl.purchase_id = p.id
   where p.org_id = p_org and p.branch_id = any (p_branches) and p.status = 'confirmed'
     and p.purchased_on between p_from and p_to
   group by 1, 2, 3
  union all
  select t.from_branch_id, t.sent_on, tl.ingredient_id, 'transfer_out', sum(tl.qty_base_sent), null
    from public.transfers t
    join public.transfer_lines tl on tl.org_id = t.org_id and tl.transfer_id = t.id
   where t.org_id = p_org and t.from_branch_id = any (p_branches)
     and t.status in ('sent', 'received', 'disputed') and t.sent_on between p_from and p_to
   group by 1, 2, 3
  union all
  select t.to_branch_id, t.received_on, tl.ingredient_id, 'transfer_in', sum(coalesce(tl.qty_base_received, 0)), null
    from public.transfers t
    join public.transfer_lines tl on tl.org_id = t.org_id and tl.transfer_id = t.id
   where t.org_id = p_org and t.to_branch_id = any (p_branches)
     and t.status in ('received', 'disputed') and t.received_on between p_from and p_to
   group by 1, 2, 3
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. stock.used_by_dish (METRICS.md): what the dishes sold took from stock in a period
-- ---------------------------------------------------------------------------------------------
-- Rows, in this order: per ingredient its total (menu_item_id null), then per ingredient and dish
-- (dishes = plates that took it), then the dishes sold with nothing written (ingredient_id null, qty
-- null). Quantities in the ingredient's base unit. Stock roles and their branches (stock_scope).
create function public.metric_stock_used(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (ingredient_id uuid, name text, name_bn text, base text, menu_item_id uuid, item_name text,
               item_name_bn text, dishes numeric, qty numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[] := private.stock_scope(p_org, p_branch);
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'pick a period of at most 93 days' using errcode = 'invalid_parameter_value';
  end if;
  return query
    with sold as (
      select s.menu_item_id, s.recipe_id, sum(s.qty) as dishes
        from private.m_sold_for_stock(p_org, v_scope, p_from, p_to) s
       group by 1, 2
    ), used as (
      select s.menu_item_id, e.ingredient_id, sum(s.dishes) as dishes, sum(s.dishes * e.qty) as qty
        from sold s cross join lateral private.recipe_explode(p_org, s.recipe_id) e
       where s.recipe_id is not null
       group by 1, 2
    ), out_rows as (
      select u.ingredient_id, null::uuid as menu_item_id, null::numeric as dishes, sum(u.qty) as qty, 0 as k
        from used u group by u.ingredient_id
      union all
      select u.ingredient_id, u.menu_item_id, u.dishes, u.qty, 1 from used u
      union all
      select null::uuid, s.menu_item_id, sum(s.dishes), null::numeric, 2
        from sold s where s.recipe_id is null group by s.menu_item_id
    )
    select o.ingredient_id, i.name, i.name_bn, i.base::text, o.menu_item_id, mi.name, mi.name_bn,
           o.dishes, o.qty
      from out_rows o
      left join public.ingredients i on i.org_id = p_org and i.id = o.ingredient_id
      left join public.menu_items mi on mi.org_id = p_org and mi.id = o.menu_item_id
     order by (o.ingredient_id is null), i.name, o.ingredient_id, o.k, o.qty desc nulls last,
              o.dishes desc nulls last, mi.name;
end $$;
revoke execute on function public.metric_stock_used(uuid, uuid, date, date) from public, anon;
grant execute on function public.metric_stock_used(uuid, uuid, date, date) to authenticated, service_role;
comment on function public.metric_stock_used is
  'stock.used_by_dish: what the dishes sold took from stock, per ingredient and dish, and dishes sold with nothing written (quantities; stock roles). ADR 0037.';

-- ---------------------------------------------------------------------------------------------
-- 5. The editor's view of a dish: each line as the amount taken from stock
-- ---------------------------------------------------------------------------------------------
-- qty = qty_base ÷ yield, exactly what private.recipe_explode takes from stock for the whole recipe
-- (plates = yield_portions). Item-level recipes only (a variant's own recipe is not edited here). Read
-- with the caller's own rights: recipe readers (RLS on recipes, recipe_lines and ingredients).
create function public.dish_recipe_lines(p_org uuid)
returns table (menu_item_id uuid, recipe_id uuid, version integer, source text, plates numeric,
               ingredient_id uuid, name text, name_bn text, base text, qty numeric)
language sql stable security invoker set search_path = '' as $$
  select r.menu_item_id, r.id, r.version, r.source::text, r.yield_portions,
         i.id, i.name, i.name_bn, i.base::text, round(rl.qty_base * 100 / rl.yield_pct, 3)
    from public.recipes r
    join public.recipe_lines rl on rl.org_id = r.org_id and rl.recipe_id = r.id
    join public.ingredients i on i.org_id = rl.org_id and i.id = rl.ingredient_id
   where r.org_id = p_org and r.status = 'active' and r.menu_item_id is not null and r.variant_id is null
   order by r.menu_item_id, rl.line_no nulls last, i.name
$$;
revoke execute on function public.dish_recipe_lines(uuid) from public, anon;
grant execute on function public.dish_recipe_lines(uuid) to authenticated, service_role;
comment on function public.dish_recipe_lines is
  'Each active dish recipe line as the amount taken from stock, in written order (recipe readers, RLS). ADR 0037.';

-- ---------------------------------------------------------------------------------------------
-- 6. Today's price of each ingredient, as costing uses it (money-gated)
-- ---------------------------------------------------------------------------------------------
-- The same rule as private.ingredient_unit_cost: the latest price history on or before today (the bazar
-- or a typed price), else the typed price. Per kg / litre (1,000 g or ml) or per piece, whole poisha.
create function public.metric_ingredient_prices(p_org uuid, p_now timestamptz)
returns table (ingredient_id uuid, price_poisha bigint, source text, since date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := private.business_date(p_now, private.org_cutoff(p_org));
begin
  perform private.require_money(p_org);
  return query
    select i.id,
           round(coalesce(h.unit, c.unit) * case when i.base = 'pcs' then 1 else 1000 end)::bigint,
           coalesce(h.source, 'manual'), h.effective_from
      from public.ingredients i
      left join lateral (
        select x.cost_poisha::numeric / x.per_base_qty as unit, x.source, x.effective_from
          from public.ingredient_price_history x
         where x.org_id = p_org and x.ingredient_id = i.id and x.effective_from <= v_date
         order by x.effective_from desc limit 1
      ) h on true
      left join public.ingredient_costs c0 on c0.org_id = p_org and c0.ingredient_id = i.id
      cross join lateral (select c0.manual_cost_poisha::numeric / c0.per_base_qty as unit) c
     where i.org_id = p_org and coalesce(h.unit, c.unit) is not null;
end $$;
revoke execute on function public.metric_ingredient_prices(uuid, timestamptz) from public, anon;
grant execute on function public.metric_ingredient_prices(uuid, timestamptz) to authenticated, service_role;
comment on function public.metric_ingredient_prices is
  'ingredient.unit_cost today per kg / litre / piece, from the bazar or a typed price (money-gated). ADR 0037.';
