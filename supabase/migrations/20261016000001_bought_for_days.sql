-- ADR 0029: bought for N days, then a check.
--
-- 1. A purchase line says how many days the lot is for (purchase_lines.for_days, 1–30). The purchaser
--    types it in the chat ("murgi 10 kg 3200 3 din"), taps it, or the item's last value is used.
-- 2. metric_stock_lots: per branch and item, the latest lot — bought on, for how many days, days left,
--    and whether the shelf was checked after it ended (stock.lot in METRICS.md). The Stock page shows
--    it as a countdown.
-- 3. A check is one question to the person who bought the lot: "how much is left?". Asked by the bot
--    the morning after the lot ends, or at once when the item is bought again before it ends. The
--    answer is a one-item stock count (closing stock of the day before the question), so the existing
--    usage maths and the Loss tab use it with no change. Questions are rows in stock_checks; the
--    answer goes through chat_answer_stock_check, as the person, audited like any count.
-- 4. Staff food is a waste reason of its own. It is shown on its own line on the Loss tab and is not
--    part of over-usage or the loss total (usage.staff_food); everything else is unchanged.

-- ---------------------------------------------------------------------------------------------
-- 1. Days per purchase line
-- ---------------------------------------------------------------------------------------------
alter table public.purchase_lines
  add column for_days smallint constraint purchase_lines_for_days check (for_days between 1 and 30);
comment on column public.purchase_lines.for_days is
  'How many business days this lot is meant to last (1–30), as the purchaser said; null = not said. ADR 0029.';
create index purchase_lines_branch_ingredient_idx on public.purchase_lines (org_id, branch_id, ingredient_id);

-- p_lines: [{ingredient_id, qty_base > 0, line_total_poisha >= 0, for_days? 1–30, note?}]
create or replace function private.write_purchase(
  p_org uuid, p_branch uuid, p_supplier uuid, p_purchased_on date, p_lines jsonb,
  p_source public.purchase_source, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_today date := private.business_date(now(), private.branch_cutoff(p_org, p_branch));
  v_line jsonb;
  v_ing uuid;
  v_qty numeric;
  v_total bigint;
  v_days integer;
  v_sum bigint := 0;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_purchased_on is null or p_purchased_on > v_today or p_purchased_on < v_today - 90 then
    raise exception 'the purchase date must be within the last 90 days' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'a purchase needs 1–100 lines' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.purchases (org_id, branch_id, supplier_id, purchased_on, source, status, total_poisha, notes,
    entered_by, confirmed_by, confirmed_at)
  values (p_org, p_branch, p_supplier, p_purchased_on, p_source, 'confirmed', 0, left(nullif(btrim(p_notes), ''), 1000),
    (select auth.uid()), (select auth.uid()), now())
  returning id into v_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing := nullif(v_line ->> 'ingredient_id', '')::uuid;
    v_qty := (v_line ->> 'qty_base')::numeric;
    v_total := (v_line ->> 'line_total_poisha')::bigint;
    v_days := nullif(v_line ->> 'for_days', '')::integer;
    if v_ing is null or not exists (select 1 from public.ingredients where org_id = p_org and id = v_ing) then
      raise exception 'each line needs a known ingredient' using errcode = 'invalid_parameter_value';
    end if;
    if v_qty is null or v_qty <= 0 or v_total is null or v_total < 0 then
      raise exception 'each line needs a positive quantity and a price' using errcode = 'invalid_parameter_value';
    end if;
    if v_days is not null and (v_days < 1 or v_days > 30) then
      raise exception 'a lot is for 1–30 days' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.purchase_lines (org_id, branch_id, purchase_id, ingredient_id, qty_base, line_total_poisha,
      for_days, note)
    values (p_org, p_branch, v_id, v_ing, v_qty, v_total, v_days::smallint,
      left(nullif(btrim(v_line ->> 'note'), ''), 300));
    v_sum := v_sum + v_total;
  end loop;
  update public.purchases set total_poisha = v_sum where id = v_id;
  perform private.refresh_ingredient_cost(p_org, x.ingredient_id, p_purchased_on)
     from (select distinct ingredient_id from public.purchase_lines where org_id = p_org and purchase_id = v_id) x;
  perform private.write_audit(p_org, p_branch, 'purchase.record', 'purchase', v_id::text, null,
    jsonb_build_object('purchased_on', p_purchased_on, 'source', p_source, 'total_poisha', v_sum,
                       'lines', jsonb_array_length(p_lines), 'supplier_id', p_supplier), null, null, null);
  return v_id;
end $$;

-- ✅ in the chat: as in ADR 0028, and each line's days go with it.
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
                                             'line_total_poisha', (x ->> 'line_total_poisha')::bigint,
                                             'for_days', nullif(x ->> 'for_days', '')::integer);
  end loop;
  return public.confirm_purchase_draft(p_draft, null, nullif(btrim(d.extracted ->> 'supplier'), ''),
    private.business_date(d.created_at, private.branch_cutoff(d.org_id, d.branch_id)), v_lines);
end $$;

-- The days each item was last bought for at the chat's branch, so a list only needs days for new items.
create function public.chat_usual_days(p_channel public.chat_channel, p_external_id text)
returns table (ingredient_id uuid, for_days smallint)
language plpgsql stable security definer set search_path = '' as $$
declare
  l public.chat_links;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  l := private.chat_link_for(p_channel, p_external_id);
  return query
    select distinct on (pl.ingredient_id) pl.ingredient_id, pl.for_days
      from public.purchase_lines pl
      join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
     where pl.org_id = l.org_id and pl.branch_id = l.branch_id and p.status = 'confirmed' and pl.for_days is not null
     order by pl.ingredient_id, p.purchased_on desc, p.confirmed_at desc nulls last, pl.id desc;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Lots (stock.lot)
-- ---------------------------------------------------------------------------------------------
-- Per branch and active item: the latest day it was bought (all lines that day are the lot), the days
-- the latest of those lines was for, when the lot ends (its last day), days left including today,
-- and its state: running (today ≤ last day) · checked (a submitted count on or after the last day) ·
-- due (ended, not checked; shown for 7 days). The lot before it: its days and how many days it really
-- lasted before this one was bought. Lots with no days said are not listed.
create function private.m_stock_lots(p_org uuid, p_branches uuid[], p_now timestamptz)
returns table (
  branch_id uuid, ingredient_id uuid, bought_on date, qty numeric, for_days smallint, ends_on date,
  days_left integer, status text, checked_on date, checked_qty numeric, prev_for_days smallint,
  prev_lasted_days integer, as_of date
) language sql stable security definer set search_path = '' as $$
  with days as (
    -- One row per branch, item and day bought: the day's quantity and the days its latest line said.
    select pl.branch_id, pl.ingredient_id, p.purchased_on, sum(pl.qty_base) as qty,
           (array_agg(pl.for_days order by p.confirmed_at desc nulls last, pl.id desc)
              filter (where pl.for_days is not null))[1] as for_days
      from public.purchase_lines pl
      join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
     where pl.org_id = p_org and pl.branch_id = any (p_branches) and p.status = 'confirmed'
     group by 1, 2, 3
  ), ranked as (
    select d.*, row_number() over (partition by d.branch_id, d.ingredient_id order by d.purchased_on desc) as rn,
           lead(d.purchased_on) over (partition by d.branch_id, d.ingredient_id order by d.purchased_on desc) as prev_on,
           lead(d.for_days) over (partition by d.branch_id, d.ingredient_id order by d.purchased_on desc) as prev_days
      from days d
  ), lots as (
    select r.branch_id, r.ingredient_id, r.purchased_on, r.qty, r.for_days, r.prev_on, r.prev_days,
           private.business_date(p_now, private.branch_cutoff(p_org, r.branch_id)) as today
      from ranked r
     where r.rn = 1 and r.for_days is not null
  ), checked as (
    select distinct on (l.branch_id, l.ingredient_id) l.branch_id, l.ingredient_id, sc.counted_on, cl.counted_qty_base
      from lots l
      join public.stock_counts sc on sc.org_id = p_org and sc.branch_id = l.branch_id and sc.status = 'submitted'
       and sc.counted_on >= l.purchased_on + l.for_days - 1 and sc.counted_on <= l.today
      join public.stock_count_lines cl on cl.org_id = p_org and cl.stock_count_id = sc.id
       and cl.ingredient_id = l.ingredient_id
     order by l.branch_id, l.ingredient_id, sc.counted_on, sc.submitted_at desc nulls last
  )
  select l.branch_id, l.ingredient_id, l.purchased_on, l.qty, l.for_days,
         l.purchased_on + l.for_days - 1,
         greatest(l.purchased_on + l.for_days - l.today, 0),
         case when l.today <= l.purchased_on + l.for_days - 1 then 'running'
              when c.counted_on is not null then 'checked' else 'due' end,
         c.counted_on, c.counted_qty_base, l.prev_days,
         case when l.prev_days is not null then l.purchased_on - l.prev_on end,
         l.today
    from lots l
    join public.ingredients i on i.org_id = p_org and i.id = l.ingredient_id and i.is_active
    left join checked c on c.branch_id = l.branch_id and c.ingredient_id = l.ingredient_id
   where l.purchased_on <= l.today
     and (l.today <= l.purchased_on + l.for_days - 1 + 7)
$$;
revoke execute on function private.m_stock_lots(uuid, uuid[], timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Checks: "how much is left?"
-- ---------------------------------------------------------------------------------------------
-- Tenant-to-tenant keys are composite (CLAUDE.md); chat_links gets the key it needs for that.
alter table public.chat_links add constraint chat_links_org_id_id_key unique (org_id, id);

create table public.stock_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  ingredient_id uuid not null,
  -- The lot asked about: the purchase it came in, the day bought and the days it was for.
  purchase_id uuid not null,
  bought_on date not null,
  bought_qty numeric not null check (bought_qty > 0),
  for_days smallint not null check (for_days between 1 and 30),
  -- The answer is the closing stock of this business day.
  count_on date not null,
  reason text not null constraint stock_checks_reason check (reason in ('ended', 'bought_again')),
  status text not null default 'open' constraint stock_checks_status check (status in ('open', 'answered', 'expired')),
  chat_link_id uuid not null,
  message_id bigint,
  asked_at timestamptz,
  -- Set when the person tapped "some left": their next message with a quantity answers this check.
  awaiting_since timestamptz,
  answered_qty numeric check (answered_qty >= 0),
  stock_count_id uuid,
  answered_by uuid references auth.users (id) on delete set null,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, branch_id, ingredient_id, count_on),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete cascade,
  foreign key (org_id, purchase_id) references public.purchases (org_id, id) on delete cascade,
  foreign key (org_id, chat_link_id) references public.chat_links (org_id, id) on delete cascade,
  foreign key (org_id, stock_count_id) references public.stock_counts (org_id, id) on delete set null (stock_count_id)
);
create index stock_checks_chat_idx on public.stock_checks (chat_link_id, status);

do $$
begin
  perform private.apply_policies('stock_checks', 'branch',
    array['owner', 'manager', 'kitchen', 'purchaser', 'accountant']::public.app_role[],
    '{}'::public.app_role[], false,
    'quantities only; written only by the job and the chat_* check RPCs (ADR 0029)');
end $$;
revoke insert, update, delete, truncate on table public.stock_checks from authenticated;
comment on table public.stock_checks is
  'One "how much is left?" question to the person who bought a lot, and its answer (a one-item count). | written by: inventory | phase: 11';

-- The lots, with whether the bot already asked about the one that ended.
create function public.metric_stock_lots(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (
  branch_id uuid, ingredient_id uuid, name text, name_bn text, base text, bought_on date, qty numeric,
  for_days smallint, ends_on date, days_left integer, status text, checked_on date, checked_qty numeric,
  prev_for_days smallint, prev_lasted_days integer, asked boolean, as_of date
) language sql stable security definer set search_path = '' as $$
  select m.branch_id, m.ingredient_id, i.name, i.name_bn, i.base::text, m.bought_on, m.qty, m.for_days,
         m.ends_on, m.days_left, m.status, m.checked_on, m.checked_qty, m.prev_for_days, m.prev_lasted_days,
         exists (select 1 from public.stock_checks k
                  where k.org_id = p_org and k.branch_id = m.branch_id and k.ingredient_id = m.ingredient_id
                    and k.count_on = m.ends_on and k.message_id is not null),
         m.as_of
    from private.m_stock_lots(p_org, private.stock_scope(p_org, p_branch), p_now) m
    join public.ingredients i on i.org_id = p_org and i.id = m.ingredient_id
   order by case m.status when 'due' then 0 when 'running' then 1 else 2 end, m.ends_on, i.name
$$;

-- A check for one lot, asked in one chat; null when it already exists (one per item, branch and day).
create function private.open_stock_check(
  p_org uuid, p_branch uuid, p_ingredient uuid, p_purchase uuid, p_bought_on date, p_bought_qty numeric,
  p_for_days smallint, p_count_on date, p_reason text, p_link uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.stock_checks (org_id, branch_id, ingredient_id, purchase_id, bought_on, bought_qty, for_days,
    count_on, reason, chat_link_id)
  values (p_org, p_branch, p_ingredient, p_purchase, p_bought_on, p_bought_qty, p_for_days, p_count_on, p_reason,
    p_link)
  on conflict (org_id, branch_id, ingredient_id, count_on) do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function private.open_stock_check(uuid, uuid, uuid, uuid, date, numeric, smallint, date, text, uuid)
  from public, anon, authenticated;

-- The morning job (service role, one org): lots that ended yesterday and were not counted since are
-- asked, in the chat of the person who recorded the purchase (if their chat is linked to that branch).
-- Older unanswered questions expire. Returns every open question not yet sent, for the bot to send.
create function public.job_stock_checks(p_org uuid, p_now timestamptz)
returns table (
  check_id uuid, chat_external_id text, locale text, branch_id uuid, ingredient_id uuid, name text,
  name_bn text, base text, bought_on date, qty numeric, for_days smallint, count_on date, reason text
) language plpgsql security definer set search_path = '' as $$
declare
  v_branches uuid[];
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(array_agg(b.id), '{}') into v_branches from public.branches b where b.org_id = p_org;

  update public.stock_checks k set status = 'expired', awaiting_since = null
   where k.org_id = p_org and k.status = 'open'
     and k.count_on < private.business_date(p_now, private.branch_cutoff(p_org, k.branch_id)) - 2;

  perform private.open_stock_check(p_org, m.branch_id, m.ingredient_id, lot.purchase_id, m.bought_on, m.qty,
                                   m.for_days, m.ends_on, 'ended', cl.id)
     from private.m_stock_lots(p_org, v_branches, p_now) m
     join lateral (
       select p.id as purchase_id, p.entered_by
         from public.purchase_lines pl
         join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
        where pl.org_id = p_org and pl.branch_id = m.branch_id and pl.ingredient_id = m.ingredient_id
          and p.status = 'confirmed' and p.purchased_on = m.bought_on and pl.for_days is not null
        order by p.confirmed_at desc nulls last, pl.id desc
        limit 1
     ) lot on true
     join public.chat_links cl on cl.org_id = p_org and cl.branch_id = m.branch_id and cl.user_id = lot.entered_by
      and cl.channel = 'telegram' and cl.external_id is not null and cl.revoked_at is null
    where m.status = 'due' and m.ends_on = m.as_of - 1;

  return query
    select k.id, cl.external_id, coalesce(pr.locale::text, 'bn'), k.branch_id, k.ingredient_id, i.name, i.name_bn,
           i.base::text, k.bought_on, k.bought_qty, k.for_days, k.count_on, k.reason
      from public.stock_checks k
      join public.chat_links cl on cl.id = k.chat_link_id and cl.revoked_at is null and cl.external_id is not null
      join public.ingredients i on i.org_id = p_org and i.id = k.ingredient_id
      left join public.profiles pr on pr.user_id = cl.user_id
     where k.org_id = p_org and k.status = 'open' and k.message_id is null
     order by cl.external_id, k.count_on, i.name;
end $$;

-- After ✅ in the chat: for each item on the new purchase whose previous lot at this branch was still
-- meant to last today, ask now how much of it was left (closing stock of yesterday). Returns the new
-- questions, for the bot to send.
create function public.chat_stock_checks_after_purchase(
  p_channel public.chat_channel, p_external_id text, p_purchase uuid
) returns table (
  check_id uuid, ingredient_id uuid, name text, name_bn text, base text, bought_on date, qty numeric,
  for_days smallint, count_on date, reason text
) language plpgsql security definer set search_path = '' as $$
declare
  l public.chat_links;
  p public.purchases;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  l := private.chat_link_for(p_channel, p_external_id);
  select * into p from public.purchases x
   where x.org_id = l.org_id and x.id = p_purchase and x.branch_id = l.branch_id and x.entered_by = l.user_id
     and x.status = 'confirmed';
  if not found then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    with items as (
      select distinct pl.ingredient_id from public.purchase_lines pl
       where pl.org_id = l.org_id and pl.purchase_id = p.id
    ), prev as (
      -- The previous lot: the latest earlier day this item was bought here, and the days it was for.
      select it.ingredient_id, x.purchase_id, x.purchased_on, x.for_days, x.qty
        from items it
        join lateral (
          select pr.id as purchase_id, pr.purchased_on, pl.for_days,
                 sum(pl.qty_base) over (partition by pr.purchased_on) as qty
            from public.purchase_lines pl
            join public.purchases pr on pr.org_id = pl.org_id and pr.id = pl.purchase_id
           where pl.org_id = l.org_id and pl.branch_id = l.branch_id and pl.ingredient_id = it.ingredient_id
             and pr.status = 'confirmed' and pr.purchased_on < p.purchased_on
           order by pr.purchased_on desc, pr.confirmed_at desc nulls last, pl.id desc
           limit 1
        ) x on true
       where x.for_days is not null and x.purchased_on + x.for_days - 1 >= p.purchased_on
         and not exists (
           select 1 from public.stock_counts sc
             join public.stock_count_lines cl on cl.org_id = sc.org_id and cl.stock_count_id = sc.id
            where sc.org_id = l.org_id and sc.branch_id = l.branch_id and sc.status = 'submitted'
              and cl.ingredient_id = it.ingredient_id and sc.counted_on >= p.purchased_on - 1)
    ), made as (
      select private.open_stock_check(l.org_id, l.branch_id, pv.ingredient_id, pv.purchase_id, pv.purchased_on,
                                      pv.qty, pv.for_days, p.purchased_on - 1, 'bought_again', l.id) as id,
             pv.ingredient_id, pv.purchased_on, pv.for_days, pv.qty
        from prev pv
    )
    select m.id, m.ingredient_id, i.name, i.name_bn, i.base::text, m.purchased_on, m.qty, m.for_days,
           p.purchased_on - 1, 'bought_again'::text
      from made m
      join public.ingredients i on i.org_id = l.org_id and i.id = m.ingredient_id
     where m.id is not null
     order by i.name;
end $$;

-- An open question asked in this chat, if it is still this chat's to answer.
create function private.chat_own_check(l public.chat_links, p_check uuid)
returns public.stock_checks language plpgsql stable security definer set search_path = '' as $$
declare
  k public.stock_checks;
begin
  select * into k from public.stock_checks where id = p_check and org_id = l.org_id and chat_link_id = l.id;
  if not found then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if k.status <> 'open' then
    raise exception 'this check was already answered' using errcode = 'invalid_parameter_value';
  end if;
  return k;
end $$;
revoke execute on function private.chat_own_check(public.chat_links, uuid) from public, anon, authenticated;

-- The bot sent the question: remember the message, so its buttons and the replies find it.
create function public.chat_stock_check_sent(
  p_channel public.chat_channel, p_external_id text, p_checks uuid[], p_message_id bigint
) returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.chat_links;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  l := private.chat_link_for(p_channel, p_external_id);
  update public.stock_checks set message_id = p_message_id, asked_at = now()
   where org_id = l.org_id and chat_link_id = l.id and id = any (p_checks) and status = 'open';
end $$;

-- "Some left": the person's next message with a quantity answers this check (and no other).
create function public.chat_await_stock_check(p_channel public.chat_channel, p_external_id text, p_check uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.chat_links;
  k public.stock_checks;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  l := private.chat_link_for(p_channel, p_external_id);
  k := private.chat_own_check(l, p_check);
  update public.stock_checks set awaiting_since = null
   where org_id = l.org_id and chat_link_id = l.id and awaiting_since is not null;
  update public.stock_checks set awaiting_since = now() where id = k.id;
end $$;

-- The answer: a one-item spot count of what was left at the close of count_on, by the linked person
-- (a stock role at the branch), audited like any submitted count. Too late once count_on is more than
-- two business days back — the shelf has moved on by then.
create function public.chat_answer_stock_check(
  p_channel public.chat_channel, p_external_id text, p_check uuid, p_qty numeric
) returns date language plpgsql security definer set search_path = '' as $$
declare
  l public.chat_links;
  k public.stock_checks;
  v_count uuid;
  v_today date;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  l := private.chat_link_for(p_channel, p_external_id);
  k := private.chat_own_check(l, p_check);
  perform private.act_as(l.user_id);
  if not private.can_access_branch_role(k.org_id, k.branch_id,
       array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_qty is null or p_qty < 0 or p_qty >= 1000000000 then
    raise exception 'the quantity must be zero or more' using errcode = 'invalid_parameter_value';
  end if;
  v_today := private.business_date(now(), private.branch_cutoff(k.org_id, k.branch_id));
  if k.count_on < v_today - 2 or k.count_on > v_today then
    raise exception 'this check is too old to answer' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.stock_counts (org_id, branch_id, counted_on, kind, status, counted_by, submitted_at)
  values (k.org_id, k.branch_id, k.count_on, 'spot', 'submitted', l.user_id, now())
  returning id into v_count;
  insert into public.stock_count_lines (org_id, branch_id, stock_count_id, ingredient_id, counted_qty_base, note)
  values (k.org_id, k.branch_id, v_count, k.ingredient_id, p_qty, 'answered in the chat');
  update public.stock_checks
     set status = 'answered', answered_qty = p_qty, stock_count_id = v_count, answered_by = l.user_id,
         answered_at = now(), awaiting_since = null
   where id = k.id;
  perform private.write_audit(k.org_id, k.branch_id, 'stock.count_submit', 'stock_count', v_count::text, null,
    jsonb_build_object('counted_on', k.count_on, 'kind', 'spot', 'lines', 1, 'ingredient_id', k.ingredient_id,
                       'qty', p_qty, 'check', k.id, 'reason', k.reason),
    'answered in the chat', null, null);
  return k.count_on;
end $$;

insert into public.job_schedules (job, cron_expr, expected_every)
values ('stock_checks', '0 1 * * *', interval '1 day')
on conflict do nothing;

-- 07:00 Dhaka, before the morning bazar.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('xedine-stock-checks', '0 1 * * *', $cmd$select private.dispatch_job('stock_checks')$cmd$);
    exception when others then
      raise notice 'could not create the pg_cron schedule: %', sqlerrm;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Staff food
-- ---------------------------------------------------------------------------------------------
create or replace function private.add_waste_reasons(p_org uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.reason_codes (org_id, kind, code, label, label_bn)
  values
    (p_org, 'waste', 'spoiled', 'Spoiled / expired', 'নষ্ট / মেয়াদোত্তীর্ণ'),
    (p_org, 'waste', 'overcooked', 'Overcooked or burnt', 'বেশি রান্না বা পুড়ে গেছে'),
    (p_org, 'waste', 'dropped', 'Dropped or spilled', 'পড়ে গেছে বা ছড়িয়ে গেছে'),
    (p_org, 'waste', 'leftover', 'Cooked but not sold', 'রান্না হয়েছে কিন্তু বিক্রি হয়নি'),
    (p_org, 'waste', 'returned', 'Returned by customer', 'গ্রাহক ফেরত দিয়েছেন'),
    (p_org, 'waste', 'staff_food', 'Staff food', 'স্টাফের খাবার')
  on conflict (org_id, kind, code) do nothing
$$;
select private.add_waste_reasons(o.id) from public.organizations o;

-- usage.staff_food: what was written down as staff food, by branch, day and item (ingredients as
-- entered; dishes through their recipe, as m_stock_moves does for waste).
create function private.m_staff_food(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (branch_id uuid, business_date date, ingredient_id uuid, qty numeric)
language sql stable security definer set search_path = '' as $$
  with logs as (
    select w.* from public.waste_logs w
      join public.reason_codes r on r.org_id = w.org_id and r.id = w.reason_code_id
     where w.org_id = p_org and w.branch_id = any (p_branches) and w.business_date between p_from and p_to
       and r.kind = 'waste' and r.code = 'staff_food'
  )
  select w.branch_id, w.business_date, w.ingredient_id, sum(w.qty_base)
    from logs w where w.ingredient_id is not null and w.qty_base is not null
   group by 1, 2, 3
  union all
  select w.branch_id, w.business_date, e.ingredient_id, sum(w.qty_portions * e.qty)
    from logs w
    cross join lateral private.recipe_explode(p_org, private.active_recipe(p_org, w.menu_item_id, null)) e
   where w.ingredient_id is null and w.menu_item_id is not null and w.qty_portions is not null
   group by 1, 2, 3
$$;
revoke execute on function private.m_staff_food(uuid, uuid[], date, date) from public, anon, authenticated;

-- ADR 0027's columns, with staff food taken out of over-usage and shown on its own:
--   over_qty = usage.actual − usage.theoretical − usage.staff_food
drop function public.metric_stock_variance(uuid, uuid, date, date);
create function public.metric_stock_variance(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (
  branch_id uuid, ingredient_id uuid, name text, name_bn text, base text, opening_date date,
  opening_qty numeric, closing_date date, closing_qty numeric, purchases_qty numeric, purchases_poisha bigint,
  transfers_in_qty numeric, transfers_out_qty numeric, usage_theoretical_qty numeric, waste_qty numeric,
  usage_actual_qty numeric, variance_qty numeric, variance_bps integer, usage_theoretical_poisha bigint,
  waste_poisha bigint, variance_poisha bigint, over_qty numeric, over_bps integer, over_poisha bigint,
  staff_food_qty numeric, staff_food_poisha bigint
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_money boolean := private.is_service_role() or private.can_see_money(p_org);
  v_scope uuid[];
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 366 then
    raise exception 'pick two count dates, at most a year apart' using errcode = 'invalid_parameter_value';
  end if;
  v_scope := private.stock_scope(p_org, p_branch);
  return query
    with v as (
      select * from private.m_variance(p_org, v_scope, p_from, p_to)
    ), sf as (
      select s.branch_id, s.business_date, s.ingredient_id, s.qty
        from private.m_staff_food(p_org, v_scope, coalesce((select min(x.opening_date) from v x), p_to) + 1, p_to) s
    ), w as (
      select v.*,
             coalesce((select sum(s.qty) from sf s
                        where s.branch_id = v.branch_id and s.ingredient_id = v.ingredient_id
                          and s.business_date > v.opening_date and s.business_date <= v.closing_date), 0) as staff
        from v
    )
    select w.branch_id, w.ingredient_id, i.name, i.name_bn, i.base::text, w.opening_date, w.opening_qty,
           w.closing_date, w.closing_qty, w.purchases_qty, case when v_money then w.purchases_poisha end,
           w.transfers_in_qty, w.transfers_out_qty, w.usage_theoretical_qty, w.waste_qty, w.usage_actual_qty,
           w.variance_qty,
           case when w.usage_theoretical_qty > 0 then round(w.variance_qty * 10000 / w.usage_theoretical_qty)::integer end,
           case when v_money then w.usage_theoretical_poisha end, case when v_money then w.waste_poisha end,
           case when v_money then w.variance_poisha end,
           w.usage_actual_qty - w.usage_theoretical_qty - w.staff,
           case when w.usage_theoretical_qty > 0
                then round((w.usage_actual_qty - w.usage_theoretical_qty - w.staff) * 10000 / w.usage_theoretical_qty)::integer end,
           case when v_money then round((w.usage_actual_qty - w.usage_theoretical_qty - w.staff) * w.unit_cost)::bigint end,
           w.staff,
           case when v_money then round(w.staff * w.unit_cost)::bigint end
      from w
      join public.ingredients i on i.org_id = p_org and i.id = w.ingredient_id
     order by abs(coalesce(round((w.usage_actual_qty - w.usage_theoretical_qty - w.staff) * w.unit_cost), 0)) desc,
              abs(w.usage_actual_qty - w.usage_theoretical_qty - w.staff) desc;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('metric_stock_lots', 'metric_stock_variance')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('chat_usual_days', 'job_stock_checks', 'chat_stock_checks_after_purchase',
                         'chat_stock_check_sent', 'chat_await_stock_check', 'chat_answer_stock_check')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

comment on function public.metric_stock_lots is
  'stock.lot: per item, the latest lot bought, the days it was for, days left and whether it was checked (quantities; stock roles). ADR 0029.';
comment on function public.metric_stock_variance is
  'usage.actual, over-usage (usage.over_*, staff food excluded) and unexplained variance between two counts; usage.staff_food on its own; money columns only for owner/accountant. Phase 5, ADR 0027, ADR 0029.';
comment on function public.chat_usual_days is 'Bot (service role): the days each item was last bought for at the chat''s branch. ADR 0029.';
comment on function public.job_stock_checks is 'Job (service role): opens "how much is left?" questions for lots that ended yesterday; returns the unsent ones. ADR 0029.';
comment on function public.chat_stock_checks_after_purchase is 'Bot (service role): after ✅, asks about lots bought again before they were meant to end. ADR 0029.';
comment on function public.chat_stock_check_sent is 'Bot (service role): records the message a question was sent in. ADR 0029.';
comment on function public.chat_await_stock_check is 'Bot (service role): the chat''s next quantity answers this question. ADR 0029.';
comment on function public.chat_answer_stock_check is 'Bot (service role): answers a question with a one-item count, as the linked person; audited. ADR 0029.';
