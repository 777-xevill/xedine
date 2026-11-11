-- ADR 0049: food facts on the menu. Each dish can carry calories, protein, carbs, fat and the allergens
-- it contains. The AI makes a first guess (the founder's choice: a guess, not a sum of ingredients), the
-- owner or a manager checks it and taps Approve; only approved facts reach the customer's table page.
-- Writes go through two functions so every approval is audited and a guess never overwrites an approval.

create table public.dish_nutrition (
  org_id uuid not null references public.organizations (id) on delete cascade,
  menu_item_id uuid not null,
  kcal integer not null check (kcal between 0 and 5000),
  protein_g numeric(5,1) not null check (protein_g between 0 and 500),
  carbs_g numeric(5,1) not null check (carbs_g between 0 and 1000),
  fat_g numeric(5,1) not null check (fat_g between 0 and 500),
  allergens text[] not null default '{}'
    check (allergens <@ array['nuts', 'milk', 'egg', 'gluten', 'fish', 'shellfish', 'soy', 'sesame', 'beef']::text[]),
  status text not null default 'ai_guess' check (status in ('ai_guess', 'approved')),
  model text,
  prompt_version integer,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (org_id, menu_item_id),
  foreign key (org_id, menu_item_id) references public.menu_items (org_id, id) on delete cascade,
  check (status <> 'approved' or approved_at is not null)
);

comment on table public.dish_nutrition is
  'Calories, protein, carbs, fat and allergens per plate; AI guess until the owner or a manager approves | written by: menu (via functions) | phase: 11';

-- Read by the people who run the menu and the kitchen; written only through the functions below.
select private.apply_policies('dish_nutrition', 'org',
  array['owner', 'manager', 'kitchen', 'accountant']::public.app_role[], array[]::public.app_role[], false,
  'writes only via put_nutrition_guesses / approve_dish_nutrition / clear_dish_nutrition (audited)');

-- The AI's guesses for some dishes, saved for checking. A dish already approved keeps its approved facts.
create function public.put_nutrition_guesses(p_org uuid, p_rows jsonb, p_model text, p_prompt_version integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  n integer := 0;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 50 then
    raise exception 'bad rows' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.dish_nutrition as d
      (org_id, menu_item_id, kcal, protein_g, carbs_g, fat_g, allergens, status, model, prompt_version, updated_at)
    select p_org, mi.id, (r->>'kcal')::integer, (r->>'protein_g')::numeric, (r->>'carbs_g')::numeric,
           (r->>'fat_g')::numeric,
           coalesce((select array_agg(distinct a) from jsonb_array_elements_text(r->'allergens') a), '{}'),
           'ai_guess', left(p_model, 120), p_prompt_version, now()
      from public.menu_items mi
     where mi.org_id = p_org and mi.id = (r->>'menu_item_id')::uuid
    on conflict (org_id, menu_item_id) do update
      set kcal = excluded.kcal, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
          fat_g = excluded.fat_g, allergens = excluded.allergens, model = excluded.model,
          prompt_version = excluded.prompt_version, updated_at = excluded.updated_at
      where d.status = 'ai_guess';
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- A person's check: the facts as they typed or kept them become what customers see.
create function public.approve_dish_nutrition(
  p_org uuid, p_item uuid, p_kcal integer, p_protein numeric, p_carbs numeric, p_fat numeric, p_allergens text[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.menu_items where org_id = p_org and id = p_item) then
    raise exception 'unknown dish' using errcode = 'P0002';
  end if;
  select to_jsonb(d) - 'org_id' into v_before from public.dish_nutrition d
   where d.org_id = p_org and d.menu_item_id = p_item;
  insert into public.dish_nutrition as d
    (org_id, menu_item_id, kcal, protein_g, carbs_g, fat_g, allergens, status, approved_by, approved_at, updated_at)
  values (p_org, p_item, p_kcal, round(p_protein, 1), round(p_carbs, 1), round(p_fat, 1),
          coalesce((select array_agg(distinct a) from unnest(p_allergens) a), '{}'),
          'approved', auth.uid(), now(), now())
  on conflict (org_id, menu_item_id) do update
    set kcal = excluded.kcal, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g, fat_g = excluded.fat_g,
        allergens = excluded.allergens, status = 'approved', approved_by = excluded.approved_by,
        approved_at = excluded.approved_at, updated_at = excluded.updated_at;
  select to_jsonb(d) - 'org_id' into v_after from public.dish_nutrition d
   where d.org_id = p_org and d.menu_item_id = p_item;
  perform private.write_audit(p_org, null, 'menu.nutrition_approve', 'menu_item', p_item::text,
                              v_before, v_after, null);
end $$;

-- Take a dish's facts off (the customer sees nothing for it until a new guess is approved).
create function public.clear_dish_nutrition(p_org uuid, p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.dish_nutrition d where d.org_id = p_org and d.menu_item_id = p_item
  returning to_jsonb(d) - 'org_id' into v_before;
  if v_before is not null then
    perform private.write_audit(p_org, null, 'menu.nutrition_clear', 'menu_item', p_item::text,
                                v_before, null, null);
  end if;
end $$;

revoke execute on function public.put_nutrition_guesses(uuid, jsonb, text, integer) from public, anon;
grant execute on function public.put_nutrition_guesses(uuid, jsonb, text, integer) to authenticated, service_role;
revoke execute on function public.approve_dish_nutrition(uuid, uuid, integer, numeric, numeric, numeric, text[]) from public, anon;
grant execute on function public.approve_dish_nutrition(uuid, uuid, integer, numeric, numeric, numeric, text[]) to authenticated, service_role;
revoke execute on function public.clear_dish_nutrition(uuid, uuid) from public, anon;
grant execute on function public.clear_dish_nutrition(uuid, uuid) to authenticated, service_role;

comment on function public.put_nutrition_guesses is 'Saves the AI''s nutrition guesses for checking; never overwrites approved facts (ADR 0049).';
comment on function public.approve_dish_nutrition is 'The owner or a manager approves a dish''s food facts; customers see only approved ones; audited (ADR 0049).';
comment on function public.clear_dish_nutrition is 'Removes a dish''s food facts; audited (ADR 0049).';

-- The table page's menu now carries each dish's approved food facts (null when none are approved).
create or replace function public.table_page(p_token text, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.dining_tables;
  b public.branches;
  s public.loyalty_settings;
  g public.org_settings;
  v_today date;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{32}$' then return null; end if;
  select * into t from public.dining_tables where qr_token = p_token and is_active;
  if not found then return null; end if;
  select * into b from public.branches where org_id = t.org_id and id = t.branch_id and is_active;
  if not found then return null; end if;
  select * into s from public.loyalty_settings where org_id = t.org_id;
  select * into g from public.org_settings where org_id = t.org_id;
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
    'games_on', coalesce(g.games_on, true),
    'game_names', coalesce(g.game_names, '{}'::jsonb),
    'menu', coalesce((
      select jsonb_agg(m order by m.cat_sort, m.cat, m.sort_order, m.name) from (
        select mi.name, mi.name_bn, mi.description,
               coalesce(case when p.has_price_override then p.price_poisha end, mi.base_price_poisha) as price_poisha,
               mi.photo_path, mi.sort_order, coalesce(mc.sort_order, 1000000) as cat_sort,
               coalesce(mc.name, '') as cat, mc.name_bn as cat_bn,
               n.kcal, n.protein_g, n.carbs_g, n.fat_g, n.allergens
          from public.menu_items mi
          left join public.menu_categories mc on mc.org_id = mi.org_id and mc.id = mi.category_id
          left join public.branch_item_prices p
            on p.org_id = mi.org_id and p.branch_id = t.branch_id and p.menu_item_id = mi.id and p.variant_id is null
          left join public.dish_nutrition n
            on n.org_id = mi.org_id and n.menu_item_id = mi.id and n.status = 'approved'
         where mi.org_id = t.org_id and mi.is_active and (mc.id is null or mc.is_active)
           and coalesce(p.is_available, true)
           and not exists (select 1 from private.m_blocked_items(t.org_id, t.branch_id, v_today) x
                            where x.menu_item_id = mi.id and x.variant_id is null)
         limit 300) m), '[]'::jsonb));
end $$;

revoke execute on function public.table_page(text, timestamptz) from public, anon, authenticated;
grant execute on function public.table_page(text, timestamptz) to service_role;
