-- ADR 0027: every gram over the recipe is a loss. The founder's rule, replacing the Phase 5 per-item
-- bands (which borrowed METRICS.md's whole-restaurant "% of sales" bands of 2% / 5%):
--
--   over-usage  = what really left the shelf − what the recipes of the dishes sold needed
--                 (= logged waste + unexplained usage). > 0 is a loss in ৳, < 0 is under-usage, 0 is
--                 on recipe. Under-usage is never netted against a loss.
--   loss line   = per org, default 1% of the recipe amount: at or above it an item is flagged as a loss
--                 to act on, on the Stock page and on Money leaks (the usage.unexplained detector).

alter table public.org_settings
  add column loss_line_bps integer not null default 100
    constraint org_settings_loss_line_range check (loss_line_bps between 10 and 2000);

comment on column public.org_settings.loss_line_bps is
  'Flag an ingredient as a loss when it uses this much over its recipe (bps of the recipe amount; default 1%). ADR 0027.';

-- Money leaks follows the owner's loss line. It wins over any older per-org detector override, so the
-- Stock page and Money leaks can never disagree about what counts as a loss.
create or replace function private.detector_config(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.detector_defaults()
         || coalesce((select s.detector_config from public.org_settings s where s.org_id = p_org), '{}'::jsonb)
         || coalesce((select jsonb_build_object('usage_min_rate_bps', s.loss_line_bps)
                        from public.org_settings s where s.org_id = p_org), '{}'::jsonb)
$$;

-- The same rows as before, plus the total over-usage, its share of the recipe amount and its value.
drop function public.metric_stock_variance(uuid, uuid, date, date);
create function public.metric_stock_variance(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (
  branch_id uuid, ingredient_id uuid, name text, name_bn text, base text, opening_date date,
  opening_qty numeric, closing_date date, closing_qty numeric, purchases_qty numeric, purchases_poisha bigint,
  transfers_in_qty numeric, transfers_out_qty numeric, usage_theoretical_qty numeric, waste_qty numeric,
  usage_actual_qty numeric, variance_qty numeric, variance_bps integer, usage_theoretical_poisha bigint,
  waste_poisha bigint, variance_poisha bigint, over_qty numeric, over_bps integer, over_poisha bigint
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_money boolean := private.is_service_role() or private.can_see_money(p_org);
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 366 then
    raise exception 'pick two count dates, at most a year apart' using errcode = 'invalid_parameter_value';
  end if;
  return query
    select v.branch_id, v.ingredient_id, i.name, i.name_bn, i.base::text, v.opening_date, v.opening_qty,
           v.closing_date, v.closing_qty, v.purchases_qty, case when v_money then v.purchases_poisha end,
           v.transfers_in_qty, v.transfers_out_qty, v.usage_theoretical_qty, v.waste_qty, v.usage_actual_qty,
           v.variance_qty,
           case when v.usage_theoretical_qty > 0 then round(v.variance_qty * 10000 / v.usage_theoretical_qty)::integer end,
           case when v_money then v.usage_theoretical_poisha end, case when v_money then v.waste_poisha end,
           case when v_money then v.variance_poisha end,
           v.usage_actual_qty - v.usage_theoretical_qty,
           case when v.usage_theoretical_qty > 0
                then round((v.usage_actual_qty - v.usage_theoretical_qty) * 10000 / v.usage_theoretical_qty)::integer end,
           case when v_money then round((v.usage_actual_qty - v.usage_theoretical_qty) * v.unit_cost)::bigint end
      from private.m_variance(p_org, private.stock_scope(p_org, p_branch), p_from, p_to) v
      join public.ingredients i on i.org_id = p_org and i.id = v.ingredient_id
     order by abs(coalesce(round((v.usage_actual_qty - v.usage_theoretical_qty) * v.unit_cost), 0)) desc,
              abs(v.usage_actual_qty - v.usage_theoretical_qty) desc;
end $$;

revoke execute on function public.metric_stock_variance(uuid, uuid, date, date) from public, anon;
grant execute on function public.metric_stock_variance(uuid, uuid, date, date) to authenticated, service_role;
comment on function public.metric_stock_variance is
  'usage.actual, over-usage (usage.over_*) and unexplained variance between two counts; money columns only for owner/accountant. Phase 5, ADR 0027.';
