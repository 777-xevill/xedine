import 'server-only';
import { createClient } from '@/lib/db/supabase-server';
import { now } from '@/lib/time/clock';
import type { BaseUnit } from '@/modules/purchasing/lines';

/**
 * Typed wrappers over the Phase 7 metrics (METRICS.md "Forecasting"; ADR 0020). Pages never compute a
 * forecast: they call these with the injected clock.
 */
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));

async function rpc(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as Record<string, unknown>[];
}

export interface ForecastRow {
  branch_id: string;
  menu_item_id: string;
  name: string;
  name_bn: string | null;
  daypart: string;
  model_qty: number;
  naive_qty: number;
  qty: number;
  model_shown: boolean;
}

export async function forecast(
  orgId: string,
  branchId: string,
  date: string,
): Promise<ForecastRow[]> {
  const rows = await rpc('metric_forecast', {
    p_org: orgId,
    p_branch: branchId,
    p_date: date,
    p_now: now().toISOString(),
  });
  return rows.map((r) => ({
    branch_id: r.branch_id as string,
    menu_item_id: r.menu_item_id as string,
    name: String(r.name),
    name_bn: (r.name_bn as string | null) ?? null,
    daypart: String(r.daypart),
    model_qty: num(r.model_qty),
    naive_qty: num(r.naive_qty),
    qty: num(r.qty),
    model_shown: r.model_shown === true,
  }));
}

export interface AccuracyRow {
  branch_id: string | null;
  days: number;
  wape_bps: number | null;
  naive_wape_bps: number | null;
  improvement_bps: number | null;
  is_shown: boolean;
}

export async function forecastAccuracy(
  orgId: string,
  branchId: string | null,
): Promise<AccuracyRow[]> {
  const rows = await rpc('metric_forecast_accuracy', {
    p_org: orgId,
    p_branch: branchId,
    p_now: now().toISOString(),
  });
  return rows.map((r) => ({
    branch_id: (r.branch_id as string | null) ?? null,
    days: num(r.days),
    wape_bps: numOrNull(r.wape_bps),
    naive_wape_bps: numOrNull(r.naive_wape_bps),
    improvement_bps: numOrNull(r.improvement_bps),
    is_shown: r.is_shown === true,
  }));
}

export interface PrepRow {
  menu_item_id: string;
  name: string;
  name_bn: string | null;
  portions: number;
  batch_portions: number | null;
  batch_unit: string | null;
  batches: number | null;
  key_ingredients: { name: string; name_bn: string | null; base: BaseUnit; qty: number }[];
}

export async function prepPlan(orgId: string, branchId: string, date: string): Promise<PrepRow[]> {
  const rows = await rpc('metric_prep_plan', {
    p_org: orgId,
    p_branch: branchId,
    p_date: date,
    p_now: now().toISOString(),
  });
  return rows.map((r) => ({
    menu_item_id: r.menu_item_id as string,
    name: String(r.name),
    name_bn: (r.name_bn as string | null) ?? null,
    portions: num(r.portions),
    batch_portions: numOrNull(r.batch_portions),
    batch_unit: (r.batch_unit as string | null) ?? null,
    batches: numOrNull(r.batches),
    key_ingredients: (r.key_ingredients as PrepRow['key_ingredients']) ?? [],
  }));
}
