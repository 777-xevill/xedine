import 'server-only';
import { createClient } from '@/lib/db/supabase-server';
import { now } from '@/lib/time/clock';
import type { BaseUnit } from '@/modules/purchasing/lines';

/**
 * Typed wrappers over the Phase 5 stock metrics (METRICS.md "Inventory", "Discipline score"; ADR 0018).
 * Pages never compute a quantity: they call these. Access is decided in SQL — stock roles for
 * quantities, can_see_money for anything in ৳ (those fields come back null otherwise).
 */

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));

async function rpc(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as Record<string, unknown>[];
}

export type CoverBand = 'green' | 'yellow' | 'red' | 'none';

export interface StockRow {
  branch_id: string;
  ingredient_id: string;
  name: string;
  name_bn: string | null;
  base: BaseUnit;
  last_count_date: string | null;
  stock_qty: number | null;
  in_transit_qty: number;
  usage_14d_qty: number;
  days_of_cover: number | null;
  band: CoverBand;
  as_of: string;
}

/** metric: stock.theoretical + stock.days_of_cover, as of the injected now. */
export async function stockStatus(orgId: string, branchId: string | null): Promise<StockRow[]> {
  const rows = await rpc('metric_stock_status', {
    p_org: orgId,
    p_branch: branchId,
    p_now: now().toISOString(),
  });
  return rows.map((r) => ({
    branch_id: r.branch_id as string,
    ingredient_id: r.ingredient_id as string,
    name: String(r.name),
    name_bn: (r.name_bn as string | null) ?? null,
    base: r.base as BaseUnit,
    last_count_date: (r.last_count_date as string | null) ?? null,
    stock_qty: numOrNull(r.stock_qty),
    in_transit_qty: num(r.in_transit_qty),
    usage_14d_qty: num(r.usage_14d_qty),
    days_of_cover: numOrNull(r.days_of_cover),
    band: r.band as CoverBand,
    as_of: String(r.as_of),
  }));
}

export interface VarianceRow {
  branch_id: string;
  ingredient_id: string;
  name: string;
  name_bn: string | null;
  base: BaseUnit;
  opening_date: string;
  opening_qty: number;
  closing_date: string;
  closing_qty: number;
  purchases_qty: number;
  purchases_poisha: number | null;
  transfers_in_qty: number;
  transfers_out_qty: number;
  usage_theoretical_qty: number;
  waste_qty: number;
  usage_actual_qty: number;
  variance_qty: number;
  variance_bps: number | null;
  variance_poisha: number | null;
}

/** metric: usage.actual and variance.usage_qty / value between two counts. */
export async function stockVariance(
  orgId: string,
  branchId: string | null,
  from: string,
  to: string,
): Promise<VarianceRow[]> {
  const rows = await rpc('metric_stock_variance', {
    p_org: orgId,
    p_branch: branchId,
    p_from: from,
    p_to: to,
  });
  return rows.map((r) => ({
    branch_id: r.branch_id as string,
    ingredient_id: r.ingredient_id as string,
    name: String(r.name),
    name_bn: (r.name_bn as string | null) ?? null,
    base: r.base as BaseUnit,
    opening_date: String(r.opening_date),
    opening_qty: num(r.opening_qty),
    closing_date: String(r.closing_date),
    closing_qty: num(r.closing_qty),
    purchases_qty: num(r.purchases_qty),
    purchases_poisha: numOrNull(r.purchases_poisha),
    transfers_in_qty: num(r.transfers_in_qty),
    transfers_out_qty: num(r.transfers_out_qty),
    usage_theoretical_qty: num(r.usage_theoretical_qty),
    waste_qty: num(r.waste_qty),
    usage_actual_qty: num(r.usage_actual_qty),
    variance_qty: num(r.variance_qty),
    variance_bps: numOrNull(r.variance_bps),
    variance_poisha: numOrNull(r.variance_poisha),
  }));
}

/** METRICS.md bands for variance.pct: < 2% healthy · 2–5% watch · > 5% problem. */
export function varianceBand(bps: number | null): 'healthy' | 'watch' | 'problem' | 'none' {
  if (bps === null) return 'none';
  const a = Math.abs(bps);
  return a < 200 ? 'healthy' : a <= 500 ? 'watch' : 'problem';
}

export interface DisciplineRow {
  branch_id: string;
  business_date: string;
  open_day: boolean;
  count_due: boolean;
  bazar: number | null;
  waste: number | null;
  cash_close: number | null;
  count: number | null;
  coverage: number | null;
  score: number | null;
}

/** metric: discipline score per branch per business day. */
export async function discipline(
  orgId: string,
  branchId: string | null,
  from: string,
  to: string,
): Promise<DisciplineRow[]> {
  const rows = await rpc('metric_discipline', {
    p_org: orgId,
    p_branch: branchId,
    p_from: from,
    p_to: to,
  });
  return rows.map((r) => ({
    branch_id: r.branch_id as string,
    business_date: String(r.business_date),
    open_day: r.open_day === true,
    count_due: r.count_due === true,
    bazar: numOrNull(r.bazar),
    waste: numOrNull(r.waste),
    cash_close: numOrNull(r.cash_close),
    count: numOrNull(r.count),
    coverage: numOrNull(r.coverage),
    score: numOrNull(r.score),
  }));
}

export interface WasteRow {
  branch_id: string;
  reason_label: string | null;
  reason_label_bn: string | null;
  ingredient_id: string | null;
  menu_item_id: string | null;
  name: string;
  name_bn: string | null;
  base: BaseUnit | null;
  entries: number;
  qty_base: number | null;
  qty_portions: number | null;
  value_poisha: number | null;
}

/** metric: waste.logged by reason and item/ingredient; value only for money roles. */
export async function wasteBoard(
  orgId: string,
  branchId: string | null,
  from: string,
  to: string,
): Promise<WasteRow[]> {
  const rows = await rpc('metric_waste_board', {
    p_org: orgId,
    p_branch: branchId,
    p_from: from,
    p_to: to,
  });
  return rows.map((r) => ({
    branch_id: r.branch_id as string,
    reason_label: (r.reason_label as string | null) ?? null,
    reason_label_bn: (r.reason_label_bn as string | null) ?? null,
    ingredient_id: (r.ingredient_id as string | null) ?? null,
    menu_item_id: (r.menu_item_id as string | null) ?? null,
    name: String(r.name),
    name_bn: (r.name_bn as string | null) ?? null,
    base: (r.base as BaseUnit | null) ?? null,
    entries: num(r.entries),
    qty_base: numOrNull(r.qty_base),
    qty_portions: numOrNull(r.qty_portions),
    value_poisha: numOrNull(r.value_poisha),
  }));
}

export interface BridgeRow {
  branch_id: string | null;
  opening_date: string;
  closing_date: string;
  ingredients: number;
  uncosted_ingredients: number;
  net_sales_poisha: number;
  tfc_standard_poisha: number;
  waste_poisha: number;
  price_effect_poisha: number;
  unexplained_poisha: number;
  cogs_actual_poisha: number;
  uncertainty_poisha: number;
  unexplained_pct_of_sales_bps: number | null;
  cogs_pct_of_sales_bps: number | null;
}

/** metric: the variance bridge between two counts (money: owner and accountant; SQL refuses others). */
export async function varianceBridge(
  orgId: string,
  branchId: string | null,
  from: string,
  to: string,
): Promise<BridgeRow[]> {
  const rows = await rpc('metric_variance_bridge', {
    p_org: orgId,
    p_branch: branchId,
    p_from: from,
    p_to: to,
  });
  return rows.map((r) => ({
    branch_id: (r.branch_id as string | null) ?? null,
    opening_date: String(r.opening_date),
    closing_date: String(r.closing_date),
    ingredients: num(r.ingredients),
    uncosted_ingredients: num(r.uncosted_ingredients),
    net_sales_poisha: num(r.net_sales_poisha),
    tfc_standard_poisha: num(r.tfc_standard_poisha),
    waste_poisha: num(r.waste_poisha),
    price_effect_poisha: num(r.price_effect_poisha),
    unexplained_poisha: num(r.unexplained_poisha),
    cogs_actual_poisha: num(r.cogs_actual_poisha),
    uncertainty_poisha: num(r.uncertainty_poisha),
    unexplained_pct_of_sales_bps: numOrNull(r.unexplained_pct_of_sales_bps),
    cogs_pct_of_sales_bps: numOrNull(r.cogs_pct_of_sales_bps),
  }));
}
