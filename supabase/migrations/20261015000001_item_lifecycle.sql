-- ADR 0028: items that come and go, without losing a taka.
--
-- 1. Nicknames. When the bot is not sure which item a purchaser means ("murgi"), it shows the closest
--    items as buttons; the purchaser's tap is enough, and on ✅ that spelling is remembered for the
--    item (ingredient_aliases), so next time it matches by itself and duplicates stop at the source.
-- 2. Every item is an asset. An item can be hidden (is_active = false) from the bazar list, count
--    sheets and the bot's buttons, but never while the records say some is still on the shelf or on
--    the way, and never silently: only through set_ingredient_hidden, owner only, audited. When the
--    records cannot say (never counted), the owner must state "none left", which is audited too.
--    Buying a hidden item again brings it straight back.
-- 3. Stock Guard (metric_stock_guard): plain rules over the stock records that list what needs a
--    person's eye — new items from the chat, impossible (below-zero) stock, a price that looks like a
--    typo, stock sitting unused, and items nobody buys any more. Rules, not AI: same input, same list.

-- ---------------------------------------------------------------------------------------------
-- Where an item came from (the Stock Guard shows items purchasers added from the chat)
-- ---------------------------------------------------------------------------------------------
alter table public.ingredients
  add column added_via text not null default 'app' constraint ingredients_added_via check (added_via in ('app', 'chat'));
comment on column public.ingredients.added_via is
  'app = made on the web or seeded; chat = a purchaser''s new item, created by the ✅ on a bazar list (ADR 0025, 0028).';

-- ---------------------------------------------------------------------------------------------
-- Nicknames
-- ---------------------------------------------------------------------------------------------
create table public.ingredient_aliases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  ingredient_id uuid not null,
  alias text not null constraint ingredient_aliases_alias_len check (char_length(btrim(alias)) between 1 and 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete cascade
);
-- One spelling means one item in an org.
create unique index ingredient_aliases_org_alias on public.ingredient_aliases (org_id, lower(btrim(alias)));
create index ingredient_aliases_ingredient_idx on public.ingredient_aliases (org_id, ingredient_id);

do $$
begin
  perform private.apply_policies('ingredient_aliases', 'org',
    array['owner', 'manager', 'kitchen', 'purchaser', 'accountant']::public.app_role[],
    array['owner']::public.app_role[], true,
    'names only, no cost; the chat adds them on ✅ (chat_confirm_purchase_draft), the owner may edit');
end $$;
comment on table public.ingredient_aliases is
  'Other spellings of an ingredient ("murgi" → Chicken) learnt from purchasers'' picks in the chat. | written by: purchasing | phase: 11';

-- ---------------------------------------------------------------------------------------------
-- Hiding an item: never with stock on the shelf, never silently
-- ---------------------------------------------------------------------------------------------
-- The only way an item stops being active is set_ingredient_hidden, which checks the shelf first.
create function private.ingredients_hide_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.is_active and not new.is_active
     and coalesce(current_setting('xedine.ingredient_hide', true), '') <> 'on' then
    raise exception 'hide an item with set_ingredient_hidden' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger ingredients_hide_guard before update of is_active on public.ingredients
  for each row execute function private.ingredients_hide_guard();

-- What the records say is on the shelf, per branch, for one item: stock_qty null = never counted there.
create function private.ingredient_shelf(p_org uuid, p_ingredient uuid, p_date date)
returns table (branch_id uuid, stock_qty numeric, in_transit_qty numeric, ever_bought boolean)
language sql stable security definer set search_path = '' as $$
  with br as (select b.id from public.branches b where b.org_id = p_org),
  s as (
    select m.branch_id, m.stock_qty, m.in_transit_qty
      from private.m_stock(p_org, (select coalesce(array_agg(id), '{}') from br), p_date) m
     where m.ingredient_id = p_ingredient
  )
  select br.id, s.stock_qty, coalesce(s.in_transit_qty, 0),
         exists (select 1 from public.purchase_lines pl
                   join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
                  where pl.org_id = p_org and pl.ingredient_id = p_ingredient and p.branch_id = br.id
                    and p.status = 'confirmed')
    from br left join s on s.branch_id = br.id
$$;
revoke execute on function private.ingredient_shelf(uuid, uuid, date) from public, anon, authenticated;

-- p_hidden = true hides, false brings it back. p_none_left is the owner saying the shelf is empty,
-- needed only where the records cannot tell (bought, never counted). Raises:
--   'still in stock'   — the records say some is on a shelf or on the way (count it or log waste first)
--   'stock unknown'    — never counted where it was bought, and p_none_left was not given
create function public.set_ingredient_hidden(
  p_org uuid, p_ingredient uuid, p_hidden boolean, p_now timestamptz, p_none_left boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare
  i public.ingredients;
  v_date date := private.business_date(p_now, private.org_cutoff(p_org));
  v_shelf jsonb;
  v_unknown boolean;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into i from public.ingredients where org_id = p_org and id = p_ingredient for update;
  if not found then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if i.is_active = not p_hidden then return; end if;

  if not p_hidden then
    update public.ingredients set is_active = true where org_id = p_org and id = p_ingredient;
    perform private.write_audit(p_org, null, 'ingredient.unhide', 'ingredient', p_ingredient::text,
      jsonb_build_object('is_active', false), jsonb_build_object('is_active', true), null, null, null);
    return;
  end if;

  select jsonb_agg(jsonb_build_object('branch_id', s.branch_id, 'stock_qty', s.stock_qty,
                                      'in_transit_qty', s.in_transit_qty)),
         bool_or(s.stock_qty is null and s.ever_bought)
    into v_shelf, v_unknown
    from private.ingredient_shelf(p_org, p_ingredient, v_date) s;
  if exists (select 1 from private.ingredient_shelf(p_org, p_ingredient, v_date) s
              where s.stock_qty > 0 or s.in_transit_qty > 0) then
    raise exception 'still in stock' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(v_unknown, false) and not coalesce(p_none_left, false) then
    raise exception 'stock unknown' using errcode = 'invalid_parameter_value';
  end if;

  perform set_config('xedine.ingredient_hide', 'on', true);
  update public.ingredients set is_active = false where org_id = p_org and id = p_ingredient;
  perform set_config('xedine.ingredient_hide', '', true);
  perform private.write_audit(p_org, null, 'ingredient.hide', 'ingredient', p_ingredient::text,
    jsonb_build_object('is_active', true),
    jsonb_build_object('is_active', false, 'shelf', coalesce(v_shelf, '[]'::jsonb),
                       'owner_said_none_left', coalesce(v_unknown, false)),
    case when coalesce(v_unknown, false) then 'never counted; the owner said none is left' end, null, null);
end $$;
comment on function public.set_ingredient_hidden is
  'Owner hides an item (never while the records say some is in stock or on the way; "none left" must be stated when never counted) or brings it back. Audited. ADR 0028.';

-- Buying a hidden item again brings it back, whoever records the purchase and however.
create function private.purchase_line_unhide() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.ingredients where org_id = new.org_id and id = new.ingredient_id and not is_active) then
    update public.ingredients set is_active = true where org_id = new.org_id and id = new.ingredient_id;
    perform private.write_audit(new.org_id, new.branch_id, 'ingredient.unhide', 'ingredient', new.ingredient_id::text,
      jsonb_build_object('is_active', false), jsonb_build_object('is_active', true), 'bought again', null, null);
  end if;
  return new;
end $$;
create trigger purchase_lines_unhide after insert on public.purchase_lines
  for each row execute function private.purchase_line_unhide();

-- ---------------------------------------------------------------------------------------------
-- The chat: the purchaser's pick fills a line; ✅ remembers the spelling
-- ---------------------------------------------------------------------------------------------
-- The bot rewrites the lines of the chat's own pending draft after a pick (the lines come from the
-- bot's own matching code, as when the draft was made; the ✅ still checks every line).
create function public.chat_update_purchase_draft(
  p_channel public.chat_channel, p_external_id text, p_draft uuid, p_lines jsonb, p_confidence jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.chat_links;
  d public.purchase_drafts;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  l := private.chat_link_for(p_channel, p_external_id);
  d := private.chat_own_draft(l, p_draft);
  perform private.act_as(l.user_id);
  if not private.can_access_branch_role(l.org_id, l.branch_id, array['owner', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if d.status <> 'pending_review' then
    raise exception 'this draft was already reviewed' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) <> jsonb_array_length(d.extracted -> 'lines') then
    raise exception 'this draft needs fixing before it can be confirmed' using errcode = 'invalid_parameter_value';
  end if;
  update public.purchase_drafts
     set extracted = jsonb_set(extracted, '{lines}', p_lines), confidence = coalesce(p_confidence, confidence)
   where id = p_draft;
end $$;
revoke execute on function public.chat_update_purchase_draft(public.chat_channel, text, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.chat_update_purchase_draft(public.chat_channel, text, uuid, jsonb, jsonb) to service_role;
comment on function public.chat_update_purchase_draft is 'Bot (service role): saves the purchaser''s pick on a line of the chat''s own pending draft. ADR 0028.';

-- ✅: as before (ADR 0025 amendment), plus: a new item is marked as added from the chat, a hidden item
-- of the same name is reused (the purchase brings it back), and a line the purchaser picked teaches
-- the item that spelling.
create or replace function public.chat_confirm_purchase_draft(
  p_channel public.chat_channel, p_external_id text, p_draft uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l public.chat_links;
  d public.purchase_drafts;
  x jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_ing uuid;
  v_name text;
  v_alias text;
  v_base public.base_unit;
  v_existing public.ingredients;
  v_id uuid;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  l := private.chat_link_for(p_channel, p_external_id);
  d := private.chat_own_draft(l, p_draft);
  if jsonb_typeof(d.extracted -> 'lines') <> 'array' or jsonb_array_length(d.extracted -> 'lines') = 0
     or exists (
       select 1 from jsonb_array_elements(d.extracted -> 'lines') y
        where coalesce(jsonb_array_length(y -> 'flags'), 0) > 0
           or (nullif(y ->> 'ingredient_id', '') is null and jsonb_typeof(y -> 'new_ingredient') <> 'object')
           or (y ->> 'qty_base') is null or (y ->> 'line_total_poisha') is null)
  then
    raise exception 'this draft needs fixing before it can be confirmed' using errcode = 'invalid_parameter_value';
  end if;
  perform private.act_as(l.user_id);
  if not private.can_access_branch_role(l.org_id, l.branch_id, array['owner', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;

  for x in select * from jsonb_array_elements(d.extracted -> 'lines') loop
    v_ing := nullif(x ->> 'ingredient_id', '')::uuid;
    if v_ing is null then
      v_name := left(btrim(x -> 'new_ingredient' ->> 'name'), 120);
      v_base := (x -> 'new_ingredient' ->> 'base')::public.base_unit;
      if coalesce(v_name, '') = '' or v_base is null then
        raise exception 'this draft needs fixing before it can be confirmed' using errcode = 'invalid_parameter_value';
      end if;
      select * into v_existing from public.ingredients
       where org_id = l.org_id and (lower(name) = lower(v_name) or lower(coalesce(name_bn, '')) = lower(v_name))
       limit 1;
      if found then
        -- Someone added it since the list was read (or it was hidden): use it, never against another unit.
        if v_existing.base <> v_base then
          raise exception 'this draft needs fixing before it can be confirmed' using errcode = 'invalid_parameter_value';
        end if;
        v_ing := v_existing.id;
      else
        insert into public.ingredients (org_id, name, name_bn, base, added_via)
        values (l.org_id, v_name, case when v_name ~ '[ঀ-৿]' then v_name end, v_base, 'chat')
        returning id into v_ing;
        perform private.write_audit(l.org_id, l.branch_id, 'ingredient.create_from_chat', 'ingredient', v_ing::text,
          null, jsonb_build_object('name', v_name, 'base', v_base), 'new item on a bazar list, confirmed in the chat',
          null, null);
      end if;
    elsif coalesce((x ->> 'picked')::boolean, false) then
      -- The purchaser said "this is that item": remember how they wrote it, unless the spelling is the
      -- item's own name or already means something.
      v_alias := left(btrim(x ->> 'name'), 120);
      if coalesce(v_alias, '') <> ''
         and exists (select 1 from public.ingredients where org_id = l.org_id and id = v_ing)
         and not exists (select 1 from public.ingredients
                          where org_id = l.org_id and (lower(name) = lower(v_alias) or lower(coalesce(name_bn, '')) = lower(v_alias)))
      then
        insert into public.ingredient_aliases (org_id, ingredient_id, alias, created_by)
        values (l.org_id, v_ing, v_alias, l.user_id)
        on conflict do nothing
        returning id into v_id;
        if v_id is not null then
          perform private.write_audit(l.org_id, l.branch_id, 'ingredient.alias_from_chat', 'ingredient', v_ing::text,
            null, jsonb_build_object('alias', v_alias), 'picked in the chat', null, null);
        end if;
        v_id := null;
      end if;
    end if;
    v_lines := v_lines || jsonb_build_object('ingredient_id', v_ing,
                                             'qty_base', (x ->> 'qty_base')::numeric,
                                             'line_total_poisha', (x ->> 'line_total_poisha')::bigint);
  end loop;
  return public.confirm_purchase_draft(p_draft, null, nullif(btrim(d.extracted ->> 'supplier'), ''),
    private.business_date(d.created_at, private.branch_cutoff(d.org_id, d.branch_id)), v_lines);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Stock Guard (METRICS.md "Stock Guard")
-- ---------------------------------------------------------------------------------------------
-- One row per thing to check. kind:
--   new_item      — added by a purchaser from the chat in the last 14 days (who, when)
--   below_zero    — the records say less than nothing is left (a purchase not recorded, or a bad count)
--   price_typo    — the latest price per unit is ≥ 2× or ≤ ½ the median of the 5 before it (≥ 3 needed);
--                   owner and accountant only (ADR 0007)
--   idle_stock    — some is on the shelf but none was bought, used by a recipe or wasted in 60 days
--   unused        — not bought or used in 60 days and nothing is on the shelf: the owner may hide it
--   unused_unknown— the same, but never counted where it was bought: the owner must say if any is left
create function public.metric_stock_guard(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (
  kind text, ingredient_id uuid, name text, name_bn text, base text, branch_id uuid,
  qty numeric, since date, actor text, last_total_poisha bigint, usual_total_poisha bigint, as_of date
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := private.business_date(p_now, private.org_cutoff(p_org));
  v_scope uuid[] := private.stock_scope(p_org, p_branch);
  v_money boolean := private.can_see_money(p_org);
begin
  if coalesce(cardinality(v_scope), 0) = 0 then return; end if;
  return query
  with st as (
    select * from private.m_stock(p_org, v_scope, v_date)
  ), moves60 as (
    select m.ingredient_id, m.kind, sum(m.qty) as qty
      from private.m_stock_moves(p_org, v_scope, v_date - 59, v_date) m
     group by 1, 2
  ), bought as (
    select pl.ingredient_id, max(p.purchased_on) as last_on
      from public.purchase_lines pl
      join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
     where pl.org_id = p_org and p.branch_id = any (v_scope) and p.status = 'confirmed' and p.purchased_on <= v_date
     group by 1
  ), lines as (
    select pl.ingredient_id, p.branch_id, p.purchased_on, pl.qty_base, pl.line_total_poisha,
           pl.line_total_poisha::numeric / pl.qty_base as unit_price,
           row_number() over (partition by pl.ingredient_id order by p.purchased_on desc, p.confirmed_at desc, pl.id desc) as rn
      from public.purchase_lines pl
      join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
     where pl.org_id = p_org and p.branch_id = any (v_scope) and p.status = 'confirmed' and p.purchased_on <= v_date
       and pl.qty_base > 0 and pl.line_total_poisha > 0
  ), typo as (
    select la.ingredient_id, la.branch_id, la.purchased_on, la.qty_base, la.line_total_poisha,
           la.unit_price, h.med
      from lines la
      join lateral (
        select percentile_cont(0.5) within group (order by p.unit_price::float8)::numeric as med, count(*) as n
          from lines p where p.ingredient_id = la.ingredient_id and p.rn between 2 and 6
      ) h on h.n >= 3
     where la.rn = 1 and v_money and h.med > 0
       and (la.unit_price >= 2 * h.med or la.unit_price * 2 <= h.med)
  ), quiet as (
    -- Bought at some time, but nothing bought, used or wasted in the last 60 days.
    select i.id
      from public.ingredients i
      join bought b on b.ingredient_id = i.id
     where i.org_id = p_org and i.is_active and b.last_on <= v_date - 60
       and not exists (select 1 from moves60 m where m.ingredient_id = i.id and m.kind in ('usage', 'waste', 'purchase') and m.qty > 0)
  ), quiet_shelf as (
    select q.id,
           (select sum(s.stock_qty) from st s where s.ingredient_id = q.id and s.stock_qty > 0) as on_shelf,
           exists (select 1 from st s where s.ingredient_id = q.id and s.in_transit_qty > 0) as in_transit,
           -- Unknown when a branch that bought it has never counted it (the same rule as set_ingredient_hidden).
           exists (select 1 from (select distinct l.branch_id from lines l where l.ingredient_id = q.id) lb
                    where not exists (select 1 from st s where s.ingredient_id = q.id and s.branch_id = lb.branch_id
                                                          and s.stock_qty is not null)) as unknown
      from quiet q
  )
  select r.kind, r.ingredient_id, i.name, i.name_bn, i.base::text, r.branch_id, r.qty, r.since, r.actor,
         r.last_total, r.usual_total, v_date
    from (
      select 'new_item'::text as kind, i2.id as ingredient_id, a.branch_id, null::numeric as qty,
             private.business_date(i2.created_at, private.org_cutoff(p_org)) as since,
             coalesce(nullif(btrim(pr.full_name), ''), '') as actor, null::bigint as last_total, null::bigint as usual_total
        from public.ingredients i2
        left join lateral (
          select al.actor_user_id, al.branch_id from public.audit_log al
           where al.org_id = p_org and al.entity = 'ingredient' and al.entity_id = i2.id::text
             and al.action = 'ingredient.create_from_chat'
           order by al.created_at limit 1
        ) a on true
        left join public.profiles pr on pr.user_id = a.actor_user_id
       where i2.org_id = p_org and i2.is_active and i2.added_via = 'chat'
         and private.business_date(i2.created_at, private.org_cutoff(p_org)) > v_date - 14
         and (a.branch_id is null or a.branch_id = any (v_scope))
      union all
      select 'below_zero', s.ingredient_id, s.branch_id, s.stock_qty, s.last_count_date, null, null, null
        from st s where s.stock_qty < 0
      union all
      select 'price_typo', t.ingredient_id, t.branch_id, t.qty_base, t.purchased_on, null,
             t.line_total_poisha, round(t.med * t.qty_base)::bigint
        from typo t
      union all
      select case when qs.on_shelf > 0 or qs.in_transit then 'idle_stock'
                  when qs.unknown then 'unused_unknown' else 'unused' end,
             qs.id, null, qs.on_shelf, b.last_on, null, null, null
        from quiet_shelf qs join bought b on b.ingredient_id = qs.id
    ) r
    join public.ingredients i on i.org_id = p_org and i.id = r.ingredient_id
   order by case r.kind when 'price_typo' then 0 when 'below_zero' then 1 when 'idle_stock' then 2
                        when 'new_item' then 3 else 4 end, i.name, r.branch_id nulls first;
end $$;
comment on function public.metric_stock_guard is
  'Stock Guard: rule-based list of stock records that need a person (METRICS.md). Stock roles; price_typo only for owner/accountant. ADR 0028.';

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('set_ingredient_hidden', 'metric_stock_guard')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
revoke execute on function private.ingredients_hide_guard() from public, anon, authenticated;
revoke execute on function private.purchase_line_unhide() from public, anon, authenticated;
