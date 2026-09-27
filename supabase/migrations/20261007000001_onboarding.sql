-- Phase 10 (2/N) — onboarding (ROADMAP Phase 10, PRODUCT.md M18, ADR 0023): a setup checklist computed
-- from what the org has actually entered, a one-shot menu import, and AI menu-photo drafts that the owner
-- reviews before anything is created (CLAUDE.md #4).

create table public.menu_import_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The model's reading of a menu photo, as CSV lines (category,name,name_bn,price). Nothing is created
  -- from it until the owner edits and imports it.
  csv text not null,
  model text,
  prompt_version text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index menu_import_drafts_org_idx on public.menu_import_drafts (org_id, created_at desc);
select private.apply_policies('menu_import_drafts', 'org', array['owner']::public.app_role[],
                              array['owner']::public.app_role[], true);
comment on table public.menu_import_drafts is 'AI menu-photo readings awaiting the owner''s review. | written by: menu | phase: 10';

-- Import a menu in one go: categories are matched by name (created if new); an item whose name already
-- exists (case-insensitive) is skipped, never overwritten. Owner only; the import is one audit entry.
create function public.import_menu(p_org uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_cat uuid;
  v_name text;
  v_cat_name text;
  v_price bigint;
  v_created integer := 0;
  v_skipped integer := 0;
  v_new_cats integer := 0;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'between 1 and 500 rows' using errcode = 'invalid_parameter_value';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(btrim(r ->> 'name'), '');
    v_cat_name := coalesce(nullif(btrim(r ->> 'category'), ''), 'Menu');
    v_price := (r ->> 'price_poisha')::bigint;
    if v_name is null or v_price is null or v_price < 0 or length(v_name) > 120 or length(v_cat_name) > 80 then
      raise exception 'row % is not valid', r using errcode = 'invalid_parameter_value';
    end if;
    select c.id into v_cat from public.menu_categories c
     where c.org_id = p_org and lower(c.name) = lower(v_cat_name) limit 1;
    if v_cat is null then
      insert into public.menu_categories (org_id, name) values (p_org, v_cat_name) returning id into v_cat;
      v_new_cats := v_new_cats + 1;
    end if;
    if exists (select 1 from public.menu_items m where m.org_id = p_org and lower(m.name) = lower(v_name)) then
      v_skipped := v_skipped + 1;
    else
      insert into public.menu_items (org_id, category_id, name, name_bn, base_price_poisha)
      values (p_org, v_cat, v_name, nullif(btrim(r ->> 'name_bn'), ''), v_price);
      v_created := v_created + 1;
    end if;
    v_cat := null;
  end loop;
  perform private.write_audit(p_org, null, 'menu.import', 'menu', p_org::text, null,
    jsonb_build_object('created', v_created, 'skipped', v_skipped, 'categories', v_new_cats), null);
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'categories', v_new_cats);
end $$;

-- The setup checklist: each step is done when the data behind it exists — nothing is ticked by hand.
create function public.metric_setup_progress(p_org uuid, p_now timestamptz)
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
      union all select 11, 'owner_whatsapp', (select count(*) from public.org_profile p
                                               where p.org_id = p_org and p.owner_whatsapp_opt_in_at is not null), 1
      union all select 12, 'first_order', (select count(*) from (select 1 from public.orders o
                                             where o.org_id = p_org and o.order_status = 'completed' limit 1) z), 1
    ) x
    order by x.ord;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('import_menu', 'metric_setup_progress')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

comment on function public.import_menu is 'One-shot menu import; skips existing names, never overwrites; owner only. Phase 10.';
comment on function public.metric_setup_progress is 'Onboarding checklist computed from the data entered. Phase 10.';
