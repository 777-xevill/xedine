-- Phase 6 (ADR 0019): Leak Detector v2 — explain the food-cost gap in ৳, by cause, branch and item.
--
-- Built on Phase 5's stock maths (private.m_variance). Every detector here is SQL, like Phase 2's, so the
-- day-close job and the CI golden check against the seed run the same code. Findings are money (ADR 0007).

-- ---------------------------------------------------------------------------------------------
-- Thresholds (merged over per-org overrides, as before)
-- ---------------------------------------------------------------------------------------------
create or replace function private.detector_defaults() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'peer_min_ratio_x100', 200,
    'peer_min_z_x100', 300,
    'peer_min_count', 5,
    'min_impact_poisha', 50000,
    'cash_share_min_orders', 60,
    'cash_share_min_gap_bps', 1500,
    'cash_share_min_z_x100', 400,
    'over_short_min_shortage_poisha', 100000,
    'over_short_min_short_shifts', 3,
    'commission_min_bps', 1500,
    'margin_min_qty', 10,
    -- Phase 6. Unexplained usage is a problem above 5% of what recipes say (METRICS.md bands).
    'usage_min_rate_bps', 500,
    -- Allowance when no other branch gives a normal baseline (the "healthy" band's top).
    'usage_allowance_bps', 200,
    -- A count is trusted to ±1% of the counted value (the bridge's count-uncertainty band).
    'count_uncertainty_bps', 100,
    -- An over-use in one branch and an under-use in another pair up when the smaller is ≥ 50% of the larger.
    'transfer_pair_min_ratio_x100', 50,
    -- A purchase is flagged above 8% over both the branch's own 28-day median and the market (METRICS.md).
    'price_drift_min_bps', 800,
    'price_min_history', 3
  )
$$;

-- A detector may name the exact period it looked at (count to count); save_findings uses it so that
-- re-running a scan on another day updates the same finding instead of adding a new one.
create or replace function private.save_findings(p_org uuid, p_from date, p_to date, p_kinds text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  f record;
  v_id uuid;
  v_n integer := 0;
  v_from date;
  v_to date;
begin
  for f in select * from private.detect_all(p_org, p_from, p_to, p_kinds) loop
    v_from := coalesce((f.evidence ->> 'period_start')::date, p_from);
    v_to := coalesce((f.evidence ->> 'period_end')::date, p_to);
    insert into public.findings (org_id, branch_id, type, period_start, period_end, impact_poisha, confidence,
      detector_version, metric_refs, suggested_actions, subject_key, subject)
    values (p_org, f.branch_id, f.type, v_from, v_to, f.impact_poisha, f.confidence, 'p6.1',
      f.metric_refs, f.suggested_actions, f.subject_key, f.subject)
    on conflict (org_id, type, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), subject_key, period_start, period_end)
    do update set impact_poisha = excluded.impact_poisha, confidence = excluded.confidence,
                  detector_version = excluded.detector_version, metric_refs = excluded.metric_refs,
                  suggested_actions = excluded.suggested_actions, subject = excluded.subject
    returning id into v_id;
    delete from public.finding_evidence where org_id = p_org and finding_id = v_id;
    insert into public.finding_evidence (org_id, finding_id, evidence_type, summary)
    values (p_org, v_id, f.type, f.evidence);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The variance bridge (METRICS.md): between two counts, per branch,
--   cogs.actual − TFC = logged-waste value + price effect + unexplained-usage value  (exactly)
-- with, per ingredient, s = the unit cost the period started with (standard) and p = what was actually
-- paid in the period (weighted; s when nothing was bought):
--   TFC (at standard)   = usage.theoretical × s
--   logged waste value  = waste.logged × s
--   unexplained value   = variance.qty × s         (variance.qty = actual − theoretical − waste)
--   price effect        = usage.actual × (p − s)
--   cogs.actual         = usage.actual × p
-- The count-uncertainty band (±count_uncertainty_bps of the counted value) is reported beside it.
-- Components are rounded once per branch; cogs.actual is their sum, so the bridge always adds up.
-- ---------------------------------------------------------------------------------------------
create function private.m_variance_bridge(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (
  branch_id uuid, opening_date date, closing_date date, ingredients integer, uncosted_ingredients integer,
  net_sales_poisha bigint, tfc_standard_poisha bigint, waste_poisha bigint, price_effect_poisha bigint,
  unexplained_poisha bigint, cogs_actual_poisha bigint, uncertainty_poisha bigint,
  unexplained_pct_of_sales_bps integer, cogs_pct_of_sales_bps integer
) language sql stable security definer set search_path = '' as $$
  with cfg as (select (private.detector_config(p_org) ->> 'count_uncertainty_bps')::numeric as band_bps),
  v as (
    select m.*, private.ingredient_unit_cost(p_org, m.ingredient_id, m.opening_date) as s
      from private.m_variance(p_org, p_branches, p_from, p_to) m
  ), c as (
    select v.*, case when v.purchases_qty > 0 then v.purchases_poisha::numeric / v.purchases_qty else v.s end as p
      from v where v.s is not null
  ), g as (
    select c.branch_id, min(c.opening_date) as open_on, max(c.closing_date) as close_on, count(*)::integer as n,
           round(sum(c.usage_theoretical_qty * c.s))::bigint as tfc,
           round(sum(c.waste_qty * c.s))::bigint as waste,
           round(sum(c.usage_actual_qty * (c.p - c.s)))::bigint as price,
           round(sum(c.variance_qty * c.s))::bigint as unexplained,
           round(sum((c.opening_qty + c.closing_qty) * c.s) * (select band_bps from cfg) / 10000)::bigint as band
      from c group by grouping sets ((c.branch_id), ())
  ), missing as (
    select v.branch_id, count(*)::integer as n from v where v.s is null group by grouping sets ((v.branch_id), ())
  )
  select g.branch_id, g.open_on, g.close_on, g.n, coalesce(mi.n, 0), coalesce(ns.net, 0)::bigint,
         g.tfc, g.waste, g.price, g.unexplained, g.tfc + g.waste + g.price + g.unexplained, g.band,
         case when coalesce(ns.net, 0) > 0 then round(g.unexplained * 10000.0 / ns.net)::integer end,
         case when coalesce(ns.net, 0) > 0 then round((g.tfc + g.waste + g.price + g.unexplained) * 10000.0 / ns.net)::integer end
    from g
    left join missing mi on mi.branch_id is not distinct from g.branch_id
    left join lateral (
      select sum(s.net_poisha) as net
        from private.m_sales(p_org, case when g.branch_id is null then p_branches else array[g.branch_id] end,
                             g.open_on + 1, g.close_on) s
       where s.branch_id is not null
    ) ns on true
  where g.n > 0
   order by g.branch_id nulls last
$$;

-- ---------------------------------------------------------------------------------------------
-- Stock detectors (count to count, per branch and ingredient):
--   usage.unexplained  — more went than recipes and logged waste explain, beyond what the org's other
--                        branches lose on the same ingredient (their pooled rate, if normal; else the
--                        healthy allowance). Evidence names the dishes that use it (over-portioning
--                        suspects), what went into dishes voided after the KOT, and POS exceptions at
--                        the branch in the same period (theft hints). Covers S7 and S9.
--   transfer.suspected — an over-use in one branch mirrored by an under-use in another (goods moved
--                        without a transfer, S6). Reported once, on the branch that lost the goods.
-- ---------------------------------------------------------------------------------------------
create function private.detect_stock(p_org uuid, p_from date, p_to date)
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  with cfg as (
    select (c ->> 'usage_min_rate_bps')::numeric as min_rate, (c ->> 'usage_allowance_bps')::numeric as allowance,
           (c ->> 'count_uncertainty_bps')::numeric as band_bps, (c ->> 'min_impact_poisha')::bigint as min_impact,
           (c ->> 'transfer_pair_min_ratio_x100')::numeric / 100 as pair_ratio
      from (select private.detector_config(p_org) as c) x
  ), br as (
    select coalesce(array_agg(b.id), '{}') as ids from public.branches b where b.org_id = p_org
  ), v as (
    select m.*, private.ingredient_unit_cost(p_org, m.ingredient_id, m.opening_date) as s,
           m.variance_qty * 10000 / m.usage_theoretical_qty as rate_bps
      from private.m_variance(p_org, (select ids from br), p_from, p_to) m
     where m.usage_theoretical_qty > 0
  ), based as (
    -- The baseline: what the other branches, where their own rate is normal, lose on this ingredient.
    select v.*,
           least(greatest(coalesce(
             (select sum(p.variance_qty) / nullif(sum(p.usage_theoretical_qty), 0)
                from v p cross join cfg
               where p.ingredient_id = v.ingredient_id and p.branch_id <> v.branch_id
                 and abs(p.rate_bps) < cfg.min_rate),
             (select allowance from cfg) / 10000), 0), (select min_rate from cfg) / 10000) as baseline,
           (v.opening_qty + v.closing_qty) * coalesce(v.s, 0) * (select band_bps from cfg) / 10000 as band
      from v
  ), scored as (
    select b.*, b.variance_qty - b.usage_theoretical_qty * b.baseline as excess_qty
      from based b
  ), pos as (
    select s.* from scored s cross join cfg
     where s.s is not null and s.rate_bps >= cfg.min_rate and abs(s.variance_qty * s.s) > s.band
  ), neg as (
    select s.* from scored s cross join cfg
     where s.s is not null and s.rate_bps <= -cfg.min_rate and abs(s.variance_qty * s.s) > s.band
  ), pairs as (
    select distinct on (p.branch_id, p.ingredient_id)
           p.branch_id as from_branch, n.branch_id as to_branch, p.ingredient_id, p.s,
           p.excess_qty as from_excess, -n.excess_qty as to_deficit, p.variance_qty as from_var,
           n.variance_qty as to_var, p.usage_theoretical_qty as from_used, n.usage_theoretical_qty as to_used,
           p.rate_bps as from_rate, n.rate_bps as to_rate, greatest(p.opening_date, n.opening_date) as open_on,
           least(p.closing_date, n.closing_date) as close_on,
           least(abs(p.variance_qty), abs(n.variance_qty)) / greatest(abs(p.variance_qty), abs(n.variance_qty)) as ratio
      from pos p join neg n on n.ingredient_id = p.ingredient_id and n.branch_id <> p.branch_id
     cross join cfg
     where least(abs(p.variance_qty), abs(n.variance_qty)) >= cfg.pair_ratio * greatest(abs(p.variance_qty), abs(n.variance_qty))
     order by p.branch_id, p.ingredient_id, abs(abs(p.variance_qty) - abs(n.variance_qty))
  ), lone as (
    select p.* from pos p
     where not exists (select 1 from pairs x where x.from_branch = p.branch_id and x.ingredient_id = p.ingredient_id)
  )
  select 'transfer.suspected'::text, x.from_branch, x.ingredient_id::text || ':' || x.to_branch::text,
         jsonb_build_object('ingredient_id', x.ingredient_id, 'ingredient_name', i.name,
                            'from_branch_id', x.from_branch, 'to_branch_id', x.to_branch, 'to_branch_name', tb.name),
         round((x.from_excess + x.to_deficit) / 2 * x.s)::bigint,
         (case when x.ratio >= 0.8 then 'high' else 'medium' end)::public.confidence_level,
         '["variance.usage_qty", "usage.actual"]'::jsonb,
         jsonb_build_object('period_start', x.open_on, 'period_end', x.close_on, 'base', i.base,
           'estimated_qty', round((x.from_excess + x.to_deficit) / 2, 1), 'unit_cost_x1000', round(x.s * 1000),
           'from_variance_qty', x.from_var, 'from_used_qty', x.from_used, 'from_rate_bps', round(x.from_rate),
           'to_variance_qty', x.to_var, 'to_used_qty', x.to_used, 'to_rate_bps', round(x.to_rate),
           'match_pct', round(x.ratio * 100)),
         '["record_transfers", "count_both_branches", "check_store_keys"]'::jsonb
    from pairs x cross join cfg
    join public.ingredients i on i.org_id = p_org and i.id = x.ingredient_id
    join public.branches tb on tb.org_id = p_org and tb.id = x.to_branch
   where round((x.from_excess + x.to_deficit) / 2 * x.s) >= cfg.min_impact
  union all
  select 'usage.unexplained', l.branch_id, l.ingredient_id::text,
         jsonb_build_object('ingredient_id', l.ingredient_id, 'ingredient_name', i.name),
         round(l.excess_qty * l.s)::bigint,
         (case when l.rate_bps >= 2 * cfg.min_rate then 'high' else 'medium' end)::public.confidence_level,
         '["variance.usage_qty", "usage.actual", "usage.theoretical"]'::jsonb,
         jsonb_build_object('period_start', l.opening_date, 'period_end', l.closing_date, 'base', i.base,
           'used_theoretical_qty', l.usage_theoretical_qty, 'used_actual_qty', l.usage_actual_qty,
           'waste_qty', l.waste_qty, 'variance_qty', l.variance_qty, 'rate_bps', round(l.rate_bps),
           'baseline_bps', round(l.baseline * 10000), 'excess_qty', round(l.excess_qty, 1),
           'unit_cost_x1000', round(l.s * 1000), 'band_poisha', round(l.band),
           'purchases_qty', l.purchases_qty, 'opening_qty', l.opening_qty, 'closing_qty', l.closing_qty,
           'suspects', sus.list, 'voided_dish_qty', coalesce(vd.qty, 0), 'pos_exceptions', coalesce(px.n, 0)),
         '["check_portions", "log_all_waste", "lock_the_store", "recount"]'::jsonb
    from lone l cross join cfg
    join public.ingredients i on i.org_id = p_org and i.id = l.ingredient_id
    -- The dishes that use this ingredient here, by their share of what recipes say was used.
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('menu_item_id', d.menu_item_id, 'name', d.name,
                                                   'share_bps', d.share) order by d.share desc), '[]'::jsonb) as list
        from (
          select g.menu_item_id, mi.name, round(sum(g.qty * e.qty) * 10000 / l.usage_theoretical_qty)::integer as share
            from (
              select oi.menu_item_id, oi.variant_id, sum(oi.quantity) as qty
                from public.order_items oi
                join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
               where oi.org_id = p_org and oi.branch_id = l.branch_id and oi.status = 'active'
                 and o.order_status = 'completed' and o.business_date > l.opening_date
                 and o.business_date <= l.closing_date and oi.menu_item_id is not null
               group by oi.menu_item_id, oi.variant_id
            ) g
            cross join lateral private.recipe_explode(p_org, private.active_recipe(p_org, g.menu_item_id, g.variant_id)) e
            join public.menu_items mi on mi.org_id = p_org and mi.id = g.menu_item_id
           where e.ingredient_id = l.ingredient_id
           group by g.menu_item_id, mi.name
           order by 3 desc
           limit 3
        ) d
    ) sus
    -- Cooked, then voided after the kitchen ticket: the ingredient still went.
    left join lateral (
      select sum(g.qty * e.qty) as qty
        from (
          select oi.menu_item_id, oi.variant_id, sum(oi.quantity) as qty
            from public.voids x
            join public.order_items oi on oi.org_id = x.org_id and oi.id = x.order_item_id
            join public.orders o on o.org_id = x.org_id and o.id = x.order_id
           where x.org_id = p_org and o.branch_id = l.branch_id and x.after_kot
             and o.business_date > l.opening_date and o.business_date <= l.closing_date
           group by oi.menu_item_id, oi.variant_id
        ) g
        cross join lateral private.recipe_explode(p_org, private.active_recipe(p_org, g.menu_item_id, g.variant_id)) e
       where e.ingredient_id = l.ingredient_id
    ) vd on true
    -- POS exceptions already found at this branch in an overlapping period.
    left join lateral (
      select count(*)::integer as n from public.findings f
       where f.org_id = p_org and f.branch_id = l.branch_id and f.status <> 'dismissed'
         and f.type in ('void.after_kot', 'discount.rate', 'refund.rate', 'cash.share', 'cash.over_short')
         and f.period_start <= l.closing_date and f.period_end >= l.opening_date
    ) px on true
   where round(l.excess_qty * l.s) >= cfg.min_impact
$$;

-- ---------------------------------------------------------------------------------------------
-- Purchase Price Watch (METRICS.md "Purchasing"): a line is flagged when its unit price is more than
-- price_drift_min_bps over BOTH the branch's own median of the 28 days before (price.reference) AND
-- the market that day — the other branches' median for the same ingredient on the same date
-- (price.cross_branch_gap), or else an imported reference price from the week before
-- (price.external_gap). Requiring both keeps a market-wide rise (every branch pays more) quiet
-- (METRICS.md open question 7). A lone branch with no reference is never flagged. Impact = what was
-- paid above the market price.
-- ---------------------------------------------------------------------------------------------
create function private.detect_price(p_org uuid, p_from date, p_to date)
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  with cfg as (
    select (c ->> 'price_drift_min_bps')::numeric as drift, (c ->> 'price_min_history')::integer as min_hist,
           (c ->> 'min_impact_poisha')::bigint as min_impact
      from (select private.detector_config(p_org) as c) x
  ), lines as (
    select p.branch_id, p.purchased_on, pl.ingredient_id, pl.qty_base, pl.line_total_poisha,
           pl.line_total_poisha::numeric / pl.qty_base as unit
      from public.purchase_lines pl
      join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
     where pl.org_id = p_org and p.status = 'confirmed' and pl.qty_base > 0
       and p.purchased_on > p_from - 28 and p.purchased_on <= p_to
  ), judged as (
    select l.*,
           (select percentile_cont(0.5) within group (order by h.unit)::numeric from lines h
             where h.branch_id = l.branch_id and h.ingredient_id = l.ingredient_id
               and h.purchased_on between l.purchased_on - 28 and l.purchased_on - 1) as own_ref,
           (select count(*) from lines h
             where h.branch_id = l.branch_id and h.ingredient_id = l.ingredient_id
               and h.purchased_on between l.purchased_on - 28 and l.purchased_on - 1) as own_n,
           (select percentile_cont(0.5) within group (order by x.unit)::numeric from lines x
             where x.ingredient_id = l.ingredient_id and x.branch_id <> l.branch_id
               and x.purchased_on = l.purchased_on) as cross_ref,
           (select r.price_poisha::numeric / r.per_base_qty from public.reference_prices r
             where r.org_id = p_org and r.ingredient_id = l.ingredient_id
               and r.observed_on between l.purchased_on - 7 and l.purchased_on
             order by r.observed_on desc limit 1) as ext_ref
      from lines l
     where l.purchased_on > p_from
  ), flagged as (
    select j.*, coalesce(j.cross_ref, j.ext_ref) as market,
           case when j.cross_ref is not null then 'cross_branch' else 'external' end as basis
      from judged j cross join cfg
     where j.own_n >= cfg.min_hist
       and j.unit * 10000 > j.own_ref * (10000 + cfg.drift)
       and coalesce(j.cross_ref, j.ext_ref) is not null
       and j.unit * 10000 > coalesce(j.cross_ref, j.ext_ref) * (10000 + cfg.drift)
  )
  select 'price.drift'::text, f.branch_id, f.ingredient_id::text,
         jsonb_build_object('ingredient_id', f.ingredient_id, 'ingredient_name', i.name),
         round(sum((f.unit - f.market) * f.qty_base))::bigint,
         (case when count(*) >= 3 then 'high' when count(*) = 2 then 'medium' else 'low' end)::public.confidence_level,
         '["price.drift", "price.reference", "price.cross_branch_gap"]'::jsonb,
         jsonb_build_object('period_start', p_from, 'period_end', p_to, 'base', i.base, 'lines_flagged', count(*),
           'paid_poisha', sum(f.line_total_poisha), 'qty', sum(f.qty_base),
           'overpay_bps', round(sum((f.unit - f.market) * f.qty_base) * 10000 / nullif(sum(f.market * f.qty_base), 0)),
           'lines', jsonb_agg(jsonb_build_object('date', f.purchased_on, 'qty', f.qty_base,
             'paid_poisha', f.line_total_poisha, 'unit_x1000', round(f.unit * 1000),
             'own_ref_x1000', round(f.own_ref * 1000), 'market_x1000', round(f.market * 1000), 'basis', f.basis)
             order by f.purchased_on)),
         '["compare_suppliers", "ask_for_receipts", "set_price_limits"]'::jsonb
    from flagged f cross join cfg
    join public.ingredients i on i.org_id = p_org and i.id = f.ingredient_id
   group by f.branch_id, f.ingredient_id, i.name, i.base, cfg.min_impact
  having round(sum((f.unit - f.market) * f.qty_base)) >= cfg.min_impact
$$;

-- Transfers nobody confirmed (sent more than a day before the period's end) and transfers that
-- arrived short. Reported on the receiving branch, whose job the confirmation is.
create function private.detect_transfers(p_org uuid, p_from date, p_to date)
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  with cfg as (select (private.detector_config(p_org) ->> 'min_impact_poisha')::bigint as min_impact),
  t as (
    select t.id, t.status, t.from_branch_id, t.to_branch_id, t.sent_on, t.received_on,
           round(sum(case when t.status = 'sent' then tl.qty_base_sent
                          else greatest(tl.qty_base_sent - coalesce(tl.qty_base_received, 0), 0) end
                     * coalesce(private.ingredient_unit_cost(p_org, tl.ingredient_id, t.sent_on), 0)))::bigint as value,
           jsonb_agg(jsonb_build_object('ingredient_name', i.name, 'base', i.base, 'sent_qty', tl.qty_base_sent,
                                        'received_qty', tl.qty_base_received)) as lines
      from public.transfers t
      join public.transfer_lines tl on tl.org_id = t.org_id and tl.transfer_id = t.id
      join public.ingredients i on i.org_id = t.org_id and i.id = tl.ingredient_id
     where t.org_id = p_org
       and ((t.status = 'sent' and t.sent_on <= p_to - 1 and t.sent_on > p_to - 60)
         or (t.status = 'disputed' and t.received_on > p_from and t.received_on <= p_to))
     group by t.id
  )
  select case when t.status = 'sent' then 'transfer.unconfirmed' else 'transfer.disputed' end,
         t.to_branch_id, t.id::text,
         jsonb_build_object('transfer_id', t.id, 'from_branch_id', t.from_branch_id, 'from_branch_name', fb.name),
         t.value, 'medium'::public.confidence_level, '["transfers"]'::jsonb,
         jsonb_build_object('period_start', coalesce(t.received_on, t.sent_on), 'period_end', coalesce(t.received_on, t.sent_on),
                            'sent_on', t.sent_on, 'received_on', t.received_on, 'lines', t.lines),
         case when t.status = 'sent' then '["confirm_receipt", "call_sending_branch"]'::jsonb
              else '["check_transport", "call_sending_branch"]'::jsonb end
    from t cross join cfg
    join public.branches fb on fb.org_id = p_org and fb.id = t.from_branch_id
   where t.value >= cfg.min_impact
$$;

create or replace function private.detect_all(p_org uuid, p_from date, p_to date, p_kinds text[])
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  select * from private.detect_staff_anomalies(p_org, p_from, p_to) where 'staff' = any (p_kinds)
  union all
  select * from private.detect_cash_share(p_org, p_from, p_to) where 'cash_share' = any (p_kinds)
  union all
  select * from private.detect_over_short(p_org, p_from, p_to) where 'over_short' = any (p_kinds)
  union all
  select * from private.detect_commission_drag(p_org, p_from, p_to) where 'commission' = any (p_kinds)
  union all
  select * from private.detect_margin(p_org, p_from, p_to) where 'margin' = any (p_kinds)
  union all
  select * from private.detect_stock(p_org, p_from, p_to) where 'stock' = any (p_kinds)
  union all
  select * from private.detect_price(p_org, p_from, p_to) where 'price' = any (p_kinds)
  union all
  select * from private.detect_transfers(p_org, p_from, p_to) where 'transfer' = any (p_kinds)
$$;

-- The four weeks up to the org's latest count (or up to today when nothing was counted yet). Aligning to
-- the count keeps every scan in the same week on the same period.
create function private.stock_period(p_org uuid, p_today date, out from_date date, out to_date date)
language sql stable security definer set search_path = '' as $$
  select coalesce(max(c.counted_on), p_today) - 28, coalesce(max(c.counted_on), p_today)
    from public.stock_counts c
   where c.org_id = p_org and c.status = 'submitted' and c.counted_on <= p_today and c.counted_on > p_today - 14
$$;

-- The day close also runs the stock, price and transfer detectors on the org's count day.
create or replace function private.close_business_day(p_org uuid, p_date date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_completed integer;
  v_week_start integer := coalesce((select week_start from public.org_settings where org_id = p_org), 6);
  v_count_day integer := coalesce((select count_weekday from public.org_settings where org_id = p_org), 0);
  v_weekly integer := 0;
  v_monthly integer := 0;
  v_stock integer := 0;
  v_period record;
begin
  with done as (
    update public.orders set order_status = 'completed'
     where org_id = p_org and business_date = p_date
       and order_status in ('sent_to_kitchen', 'preparing', 'ready', 'served', 'open')
       and payment_status = 'paid'
    returning id, org_id, branch_id
  ), ev as (
    insert into public.order_events (org_id, branch_id, order_id, event_type, meta)
    select org_id, branch_id, id, 'completed', '{"by": "day_close"}'::jsonb from done
    returning 1
  )
  select count(*) into v_completed from ev;

  if extract(dow from p_date + 1)::integer = v_week_start then
    v_weekly := private.save_findings(p_org, p_date - 6, p_date, array['staff', 'cash_share', 'over_short']);
  end if;
  if extract(day from p_date + 1) = 1 then
    v_monthly := private.save_findings(p_org, date_trunc('month', p_date)::date, p_date, array['commission', 'margin']);
  end if;
  if extract(dow from p_date)::integer = v_count_day then
    select * into v_period from private.stock_period(p_org, p_date);
    v_stock := private.save_findings(p_org, v_period.from_date, v_period.to_date, array['stock', 'price', 'transfer']);
  end if;
  return jsonb_build_object('completed_orders', v_completed, 'weekly_findings', v_weekly,
                            'monthly_findings', v_monthly, 'stock_findings', v_stock);
end $$;

create or replace function public.scan_findings(p_org uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.business_date(p_now, private.org_cutoff(p_org));
  v_week_start integer := coalesce((select week_start from public.org_settings where org_id = p_org), 6);
  v_this_week date;
  v_month date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_period record;
  v_n integer := 0;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_this_week := v_today - ((extract(dow from v_today)::integer - v_week_start + 7) % 7);
  for k in 1..4 loop
    v_n := v_n + private.save_findings(p_org, v_this_week - 7 * k, v_this_week - 7 * k + 6,
                                       array['staff', 'cash_share', 'over_short']);
  end loop;
  v_n := v_n + private.save_findings(p_org, v_month, (v_month + interval '1 month - 1 day')::date,
                                     array['commission', 'margin']);
  select * into v_period from private.stock_period(p_org, v_today);
  v_n := v_n + private.save_findings(p_org, v_period.from_date, v_period.to_date, array['stock', 'price', 'transfer']);
  perform private.refresh_insights(p_org, v_today);
  perform private.write_audit(p_org, null, 'findings.scan', 'finding', null, null,
    jsonb_build_object('findings', v_n), null, null, null);
  return v_n;
end $$;

-- Evidence rows for the Phase 6 types: the purchases, waste and counts of the ingredient behind a stock
-- finding; the flagged purchase lines of a price finding; the lines of a transfer.
create or replace function public.finding_events(p_finding uuid)
returns table (occurred_at timestamptz, business_date date, order_id uuid, order_number integer,
               kind text, value_poisha bigint, detail text)
language plpgsql stable security definer set search_path = '' as $$
declare
  f public.findings;
  v_staff uuid;
  v_item uuid;
  v_channel uuid;
  v_ing uuid;
begin
  select * into f from public.findings where id = p_finding;
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  perform private.require_money(f.org_id);
  v_staff := nullif(f.subject ->> 'staff_id', '')::uuid;
  v_item := nullif(f.subject ->> 'menu_item_id', '')::uuid;
  v_channel := nullif(f.subject ->> 'channel_id', '')::uuid;
  v_ing := nullif(f.subject ->> 'ingredient_id', '')::uuid;

  if f.type = 'void.after_kot' then
    return query
      select v.voided_at, o.business_date, o.id, o.order_number, 'void'::text, v.value_poisha,
             coalesce(rc.label, v.reason_note, '')
        from public.voids v join public.orders o on o.org_id = v.org_id and o.id = v.order_id
        left join public.reason_codes rc on rc.org_id = v.org_id and rc.id = v.reason_code_id
       where v.org_id = f.org_id and o.branch_id = f.branch_id and v.voided_by_staff_id = v_staff and v.after_kot
         and o.business_date between f.period_start and f.period_end
       order by v.voided_at;
  elsif f.type = 'discount.rate' then
    return query
      select d.created_at, o.business_date, o.id, o.order_number, 'discount'::text, d.amount_poisha,
             coalesce(rc.label, d.reason_note, '')
        from public.discounts d join public.orders o on o.org_id = d.org_id and o.id = d.order_id
        left join public.reason_codes rc on rc.org_id = d.org_id and rc.id = d.reason_code_id
       where d.org_id = f.org_id and o.branch_id = f.branch_id and d.applied_by_staff_id = v_staff
         and o.business_date between f.period_start and f.period_end
       order by d.created_at;
  elsif f.type = 'refund.rate' then
    return query
      select r.created_at, o.business_date, o.id, o.order_number, 'refund'::text, r.amount_poisha,
             coalesce(rc.label, r.reason_note, '')
        from public.refunds r join public.orders o on o.org_id = r.org_id and o.id = r.order_id
        left join public.reason_codes rc on rc.org_id = r.org_id and rc.id = r.reason_code_id
       where r.org_id = f.org_id and o.branch_id = f.branch_id and r.refunded_by_staff_id = v_staff
         and o.business_date between f.period_start and f.period_end
       order by r.created_at;
  elsif f.type = 'cash.over_short' then
    return query
      select sh.closed_at, sh.business_date, null::uuid, null::integer, 'shift'::text, sh.over_short_poisha, ''::text
        from public.shifts sh
       where sh.org_id = f.org_id and sh.branch_id = f.branch_id and sh.closed_by_staff_id = v_staff
         and sh.status = 'closed'
         and coalesce(sh.business_date, private.business_date(sh.opened_at, private.org_cutoff(f.org_id)))
             between f.period_start and f.period_end
       order by sh.closed_at;
  elsif f.type = 'commission.drag' then
    return query
      select min(o.placed_at), o.business_date, null::uuid, count(*)::integer, 'channel_day'::text,
             sum(o.net_poisha)::bigint, ''::text
        from public.orders o
       where o.org_id = f.org_id and o.branch_id = f.branch_id and o.channel_id = nullif(f.subject_key, '')::uuid
         and o.order_status = 'completed' and o.business_date between f.period_start and f.period_end
       group by o.business_date order by o.business_date;
  elsif f.type = 'cash.share' then
    return query
      select min(o.placed_at), o.business_date, null::uuid, count(*)::integer, 'staff_day'::text,
             coalesce(sum(o.total_poisha) filter (where exists (
               select 1 from public.payments p where p.org_id = o.org_id and p.order_id = o.id and p.method = 'cash')), 0)::bigint,
             ''::text
        from public.orders o
       where o.org_id = f.org_id and o.branch_id = f.branch_id and o.staff_id = v_staff
         and o.order_status = 'completed' and o.business_date between f.period_start and f.period_end
       group by o.business_date order by o.business_date;
  elsif f.type in ('margin.below_target', 'channel.negative_margin') then
    return query
      select min(o.placed_at), o.business_date, null::uuid, sum(oi.quantity)::integer, 'item_day'::text,
             sum(c.cost_poisha)::bigint, sum(oi.net_poisha)::text
        from public.order_items oi
        join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
        join public.order_item_costs c on c.order_item_id = oi.id
       where oi.org_id = f.org_id and o.branch_id = f.branch_id and oi.menu_item_id = v_item
         and oi.status = 'active' and o.order_status = 'completed'
         and (v_channel is null or o.channel_id = v_channel)
         and o.business_date between f.period_start and f.period_end
       group by o.business_date order by o.business_date;
  elsif f.type in ('usage.unexplained', 'transfer.suspected', 'price.drift') then
    -- Every purchase of the ingredient at the branch in the period (value paid; detail = quantity).
    return query
      select p.confirmed_at, p.purchased_on, null::uuid, null::integer, 'purchase'::text,
             pl.line_total_poisha, pl.qty_base::text
        from public.purchase_lines pl
        join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
       where pl.org_id = f.org_id and p.branch_id = f.branch_id and pl.ingredient_id = v_ing
         and p.status = 'confirmed' and p.purchased_on > f.period_start and p.purchased_on <= f.period_end
       order by p.purchased_on;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Reference prices (CSV import, owner): the market line Price Watch uses when no other branch bought
-- the same thing that day. Rows: [{ingredient_id | ingredient (name), label?, price_poisha, per_base_qty?,
-- source?, observed_on}]. Unknown ingredient names are skipped and counted.
-- ---------------------------------------------------------------------------------------------
create function public.import_reference_prices(p_org uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_ing uuid;
  v_ok integer := 0;
  v_skipped integer := 0;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'send at most 2,000 rows' using errcode = 'invalid_parameter_value';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_ing := nullif(r ->> 'ingredient_id', '')::uuid;
    if v_ing is null then
      select id into v_ing from public.ingredients
       where org_id = p_org and (lower(name) = lower(btrim(r ->> 'ingredient')) or lower(name_bn) = lower(btrim(r ->> 'ingredient')));
    elsif not exists (select 1 from public.ingredients where org_id = p_org and id = v_ing) then
      v_ing := null;
    end if;
    if v_ing is null or (r ->> 'price_poisha')::bigint is null or (r ->> 'price_poisha')::bigint < 0
       or nullif(r ->> 'observed_on', '') is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.reference_prices (org_id, ingredient_id, label, price_poisha, per_base_qty, source, observed_on)
    values (p_org, v_ing, left(coalesce(nullif(btrim(r ->> 'label'), ''), btrim(r ->> 'ingredient'), ''), 120),
            (r ->> 'price_poisha')::bigint, coalesce((r ->> 'per_base_qty')::numeric, 1000),
            left(nullif(btrim(r ->> 'source'), ''), 120), (r ->> 'observed_on')::date);
    v_ok := v_ok + 1;
  end loop;
  perform private.write_audit(p_org, null, 'reference_prices.import', 'reference_price', null, null,
    jsonb_build_object('imported', v_ok, 'skipped', v_skipped), null, null, null);
  return jsonb_build_object('imported', v_ok, 'skipped', v_skipped);
end $$;

create function public.metric_variance_bridge(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (
  branch_id uuid, opening_date date, closing_date date, ingredients integer, uncosted_ingredients integer,
  net_sales_poisha bigint, tfc_standard_poisha bigint, waste_poisha bigint, price_effect_poisha bigint,
  unexplained_poisha bigint, cogs_actual_poisha bigint, uncertainty_poisha bigint,
  unexplained_pct_of_sales_bps integer, cogs_pct_of_sales_bps integer
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_money(p_org);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 366 then
    raise exception 'pick two count dates, at most a year apart' using errcode = 'invalid_parameter_value';
  end if;
  return query select * from private.m_variance_bridge(p_org, private.stock_scope(p_org, p_branch), p_from, p_to);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Flash P&L, now on recipe costs (METRICS.md: COGS = TFC when no counts): sold lines with a cost
-- snapshot are costed from their recipe, the rest at the assumed food-cost %. The basis says which.
-- With no recipes at all this is exactly Phase 2's figure.
-- ---------------------------------------------------------------------------------------------
create or replace function private.m_flash_pnl(p_org uuid, p_branches uuid[], p_date date)
returns table (
  branch_id uuid, net_poisha bigint, cogs_poisha bigint, cogs_basis text, assumed_food_cost_bps integer,
  commission_poisha bigint, labour_daily_poisha bigint, fixed_daily_poisha bigint,
  estimated_profit_poisha bigint, variable_ratio_bps integer, breakeven_sales_poisha bigint,
  breakeven_remaining_poisha bigint
) language sql stable security definer set search_path = '' as $$
  with cfg as (
    select coalesce((select assumed_food_cost_bps from public.org_cost_settings where org_id = p_org), 0) as food_bps
  ), today as (
    select s.branch_id, s.net_poisha as net from private.m_sales(p_org, p_branches, p_date, p_date) s
  ), fc as (
    select f.branch_id, f.net_poisha as net, f.costed_net_poisha as costed, f.tfc_poisha as tfc
      from private.m_food_cost(p_org, p_branches, p_date, p_date) f
  ), comm as (
    select c.branch_id, sum(c.total_poisha)::bigint as total
      from private.m_commission(p_org, p_branches, p_date, p_date) c group by grouping sets ((c.branch_id), ())
  ), trail_fc as (
    select f.branch_id, f.net_poisha as net, f.costed_net_poisha as costed, f.tfc_poisha as tfc
      from private.m_food_cost(p_org, p_branches, p_date - 28, p_date - 1) f
  ), trail_comm as (
    select c.branch_id, sum(c.total_poisha)::bigint as total
      from private.m_commission(p_org, p_branches, p_date - 28, p_date - 1) c group by grouping sets ((c.branch_id), ())
  ), ovh as (
    select o.branch_id, o.labour_daily_poisha as labour, o.fixed_daily_poisha as fixed
      from private.m_daily_overheads(p_org, p_branches, p_date) o
  ), ovh_total as (
    select null::uuid as branch_id, sum(labour)::bigint as labour, sum(fixed)::bigint as fixed from ovh
  ), ovh_all as (
    select * from ovh where branch_id is not null union all select * from ovh_total
  ), rows_ as (
    select t.branch_id, t.net,
           coalesce(f.tfc, 0) + private.mul_bps(t.net - coalesce(f.costed, 0), cfg.food_bps) as cogs,
           case when coalesce(f.costed, 0) = 0 then 'assumed'
                when f.costed >= t.net then 'recipes' else 'mixed' end as basis,
           coalesce(cm.total, 0) as commission,
           coalesce(ov.labour, 0) as labour, coalesce(ov.fixed, 0) as fixed,
           -- Variable costs as a share of sales over the last 28 days: recipe cost where known, the
           -- assumed % for the rest, plus commission.
           case when coalesce(tf.net, 0) > 0
                then least(9999, round(
                       (coalesce(tf.tfc, 0) + coalesce(tc.total, 0)) * 10000.0 / tf.net
                       + cfg.food_bps * (tf.net - coalesce(tf.costed, 0))::numeric / tf.net)::integer)
                else cfg.food_bps end as var_bps,
           cfg.food_bps
      from today t cross join cfg
      left join fc f on f.branch_id is not distinct from t.branch_id
      left join comm cm on cm.branch_id is not distinct from t.branch_id
      left join trail_fc tf on tf.branch_id is not distinct from t.branch_id
      left join trail_comm tc on tc.branch_id is not distinct from t.branch_id
      left join ovh_all ov on ov.branch_id is not distinct from t.branch_id
  )
  select r.branch_id, r.net, r.cogs, r.basis, r.food_bps, r.commission, r.labour, r.fixed,
         r.net - r.cogs - r.commission - r.labour - r.fixed,
         r.var_bps,
         round((r.labour + r.fixed) * 10000.0 / (10000 - r.var_bps))::bigint,
         greatest(0, round((r.labour + r.fixed) * 10000.0 / (10000 - r.var_bps))::bigint - r.net)
    from rows_ r
   order by r.branch_id nulls last
$$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'private' and p.proname in ('m_variance_bridge', 'detect_stock', 'detect_price',
              'detect_transfers', 'stock_period'))
        or (n.nspname = 'public' and p.proname in ('import_reference_prices', 'metric_variance_bridge'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

comment on function public.metric_variance_bridge is 'Food-cost gap between counts: waste, price effect, unexplained usage (money-gated). Phase 6.';
comment on function public.import_reference_prices is 'Owner imports external reference prices (CSV) for Price Watch. Phase 6.';
