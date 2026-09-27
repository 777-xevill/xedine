import 'server-only';
import { createClient } from '@/lib/db/supabase-server';
import { now } from '@/lib/time/clock';
import { businessDate, DEFAULT_CUTOFF_MINUTES } from '@/lib/time/business-date';

/**
 * Typed wrappers over the SQL metrics layer (ARCHITECTURE.md "Metrics layer", ADR 0015). Pages never
 * compute a figure: they call these, and each answer carries its metric id, filters and as-of time so a
 * later assistant can cite it. Access is decided in SQL (branch scope; can_see_money for money).
 */
export interface Metric<T> {
  metric_id: string;
  as_of: string;
  filters: Record<string, unknown>;
  rows: T[];
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as T[];
}

function wrap<T>(metric_id: string, filters: Record<string, unknown>, rows: T[]): Metric<T> {
  return { metric_id, as_of: now().toISOString(), filters, rows };
}

/** The org's current business date (Asia/Dhaka, org cutoff) and the injected "now" behind it. */
export async function businessToday(orgId: string): Promise<{ date: string; nowIso: string }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('org_settings')
    .select('default_cutoff_minutes')
    .eq('org_id', orgId)
    .maybeSingle();
  const at = now();
  return {
    date: businessDate(at, data?.default_cutoff_minutes ?? DEFAULT_CUTOFF_MINUTES),
    nowIso: at.toISOString(),
  };
}

export interface SalesRow {
  branch_id: string | null;
  orders_completed: number;
  orders_cancelled: number;
  gross_poisha: number;
  discounts_poisha: number;
  refunds_poisha: number;
  net_poisha: number;
  vat_poisha: number;
  service_charge_poisha: number;
  total_poisha: number;
  covers: number;
  covers_orders: number;
  aov_poisha: number | null;
}

export async function sales(
  orgId: string,
  branchId: string | null,
  from: string,
  to: string,
): Promise<Metric<SalesRow>> {
  const rows = await rpc<Record<string, unknown>>('metric_sales', {
    p_org: orgId,
    p_branch: branchId,
    p_from: from,
    p_to: to,
  });
  return wrap(
    'sales.net',
    { branch: branchId, from, to },
    rows.map((r) => ({
      branch_id: (r.branch_id as string | null) ?? null,
      orders_completed: num(r.orders_completed),
      orders_cancelled: num(r.orders_cancelled),
      gross_poisha: num(r.gross_poisha),
      discounts_poisha: num(r.discounts_poisha),
      refunds_poisha: num(r.refunds_poisha),
      net_poisha: num(r.net_poisha),
      vat_poisha: num(r.vat_poisha),
      service_charge_poisha: num(r.service_charge_poisha),
      total_poisha: num(r.total_poisha),
      covers: num(r.covers),
      covers_orders: num(r.covers_orders),
      aov_poisha: numOrNull(r.aov_poisha),
    })),
  );
}

export type SplitDimension = 'channel' | 'daypart' | 'payment_method' | 'hour';
export interface SplitRow {
  key: string;
  label: string;
  orders: number;
  net_poisha: number;
}

export async function salesSplit(
  orgId: string,
  branchId: string | null,
  from: string,
  to: string,
  dimension: SplitDimension,
): Promise<Metric<SplitRow>> {
  const rows = await rpc<Record<string, unknown>>('metric_sales_split', {
    p_org: orgId,
    p_branch: branchId,
    p_from: from,
    p_to: to,
    p_dimension: dimension,
  });
  return wrap(
    `sales.by_${dimension}`,
    { branch: branchId, from, to },
    rows.map((r) => ({
      key: String(r.key),
      label: String(r.label),
      orders: num(r.orders),
      net_poisha: num(r.net_poisha),
    })),
  );
}

export const WINDOWS = [
  'last_2h',
  'today',
  'yesterday',
  'last_7d',
  'week_to_date',
  'month_to_date',
  'last_30d',
] as const;
export type VelocityWindow = (typeof WINDOWS)[number];

export interface ItemQtyRow {
  menu_item_id: string | null;
  name: string;
  qty: number;
  net_poisha: number;
}

export async function itemVelocity(
  orgId: string,
  branchId: string | null,
  window: VelocityWindow,
  filters: { channelId?: string | null; daypart?: string | null } = {},
): Promise<Metric<ItemQtyRow> & { from: string | null; to: string | null }> {
  const at = now().toISOString();
  const rows = await rpc<Record<string, unknown>>('metric_item_qty', {
    p_org: orgId,
    p_branch: branchId,
    p_window: window,
    p_now: at,
    p_channel: filters.channelId ?? null,
    p_daypart: filters.daypart ?? null,
  });
  return {
    ...wrap(
      'items.qty_sold',
      { branch: branchId, window, ...filters },
      rows.map((r) => ({
        menu_item_id: (r.menu_item_id as string | null) ?? null,
        name: String(r.name),
        qty: num(r.qty),
        net_poisha: num(r.net_poisha),
      })),
    ),
    from: (rows[0]?.from_date as string | undefined) ?? null,
    to: (rows[0]?.to_date as string | undefined) ?? null,
  };
}

export interface PaceRow {
  branch_id: string;
  today_net_poisha: number;
  typical_net_poisha: number | null;
  pace_bps: number | null;
  rag: 'green' | 'amber' | 'red' | 'none';
}

export async function pace(orgId: string, branchId: string | null): Promise<Metric<PaceRow>> {
  const rows = await rpc<Record<string, unknown>>('metric_pace', {
    p_org: orgId,
    p_branch: branchId,
    p_now: now().toISOString(),
  });
  return wrap(
    'sales.pace',
    { branch: branchId },
    rows.map((r) => ({
      branch_id: r.branch_id as string,
      today_net_poisha: num(r.today_net_poisha),
      typical_net_poisha: numOrNull(r.typical_net_poisha),
      pace_bps: numOrNull(r.pace_bps),
      rag: r.rag as PaceRow['rag'],
    })),
  );
}

export interface FlashPnlRow {
  business_date: string;
  branch_id: string | null;
  net_poisha: number;
  cogs_poisha: number;
  cogs_basis: 'assumed';
  assumed_food_cost_bps: number;
  commission_poisha: number;
  labour_daily_poisha: number;
  fixed_daily_poisha: number;
  estimated_profit_poisha: number;
  variable_ratio_bps: number;
  breakeven_sales_poisha: number;
  breakeven_remaining_poisha: number;
}

/** Owner/accountant only; the SQL refuses anyone else (ADR 0007). */
export async function flashPnl(
  orgId: string,
  branchId: string | null,
): Promise<Metric<FlashPnlRow>> {
  const rows = await rpc<Record<string, unknown>>('metric_flash_pnl', {
    p_org: orgId,
    p_branch: branchId,
    p_now: now().toISOString(),
  });
  return wrap(
    'pnl.flash.estimated_profit',
    { branch: branchId },
    rows.map((r) => ({
      business_date: String(r.business_date),
      branch_id: (r.branch_id as string | null) ?? null,
      net_poisha: num(r.net_poisha),
      cogs_poisha: num(r.cogs_poisha),
      cogs_basis: 'assumed',
      assumed_food_cost_bps: num(r.assumed_food_cost_bps),
      commission_poisha: num(r.commission_poisha),
      labour_daily_poisha: num(r.labour_daily_poisha),
      fixed_daily_poisha: num(r.fixed_daily_poisha),
      estimated_profit_poisha: num(r.estimated_profit_poisha),
      variable_ratio_bps: num(r.variable_ratio_bps),
      breakeven_sales_poisha: num(r.breakeven_sales_poisha),
      breakeven_remaining_poisha: num(r.breakeven_remaining_poisha),
    })),
  );
}

export interface FindingRow {
  id: string;
  branch_id: string | null;
  type: string;
  period_start: string;
  period_end: string;
  impact_poisha: number;
  confidence: 'low' | 'medium' | 'high';
  status: 'new' | 'acknowledged' | 'snoozed' | 'resolved' | 'dismissed';
  reason: string | null;
  snoozed_until: string | null;
  subject: Record<string, unknown>;
  suggested_actions: string[];
  metric_refs: string[];
  evidence: Record<string, unknown>;
  rank: number;
}

const CONFIDENCE_WEIGHT = { low: 0.4, medium: 0.7, high: 1 } as const;

/**
 * "Where am I losing money?" (METRICS.md "Findings"): rank = impact × confidence weight × novelty.
 * Findings are owner/accountant-only rows (RLS); anyone else gets an empty list, never an error.
 */
export async function findings(
  orgId: string,
  opts: { status?: 'open' | 'all'; limit?: number } = {},
): Promise<Metric<FindingRow>> {
  const supabase = await createClient();
  let query = supabase
    .from('findings')
    .select(
      'id, branch_id, type, period_start, period_end, impact_poisha, confidence, status, reason, snoozed_until, subject, suggested_actions, metric_refs, novelty, finding_evidence(summary)',
    )
    .eq('org_id', orgId)
    .order('impact_poisha', { ascending: false })
    .limit(opts.limit ?? 100);
  if ((opts.status ?? 'open') === 'open') query = query.in('status', ['new', 'acknowledged']);
  const { data, error } = await query;
  if (error) throw error;
  const rows: FindingRow[] = (data ?? []).map((r) => {
    const confidence = r.confidence as FindingRow['confidence'];
    const impact = num(r.impact_poisha);
    const evidence =
      (r.finding_evidence as { summary: Record<string, unknown> }[] | null)?.[0]?.summary ?? {};
    return {
      id: r.id as string,
      branch_id: (r.branch_id as string | null) ?? null,
      type: r.type as string,
      period_start: r.period_start as string,
      period_end: r.period_end as string,
      impact_poisha: impact,
      confidence,
      status: r.status as FindingRow['status'],
      reason: (r.reason as string | null) ?? null,
      snoozed_until: (r.snoozed_until as string | null) ?? null,
      subject: (r.subject as Record<string, unknown>) ?? {},
      suggested_actions: (r.suggested_actions as string[]) ?? [],
      metric_refs: (r.metric_refs as string[]) ?? [],
      evidence,
      rank: impact * CONFIDENCE_WEIGHT[confidence] * num(r.novelty ?? 1),
    };
  });
  rows.sort((a, b) => b.rank - a.rank);
  return wrap('findings', { status: opts.status ?? 'open' }, rows);
}
