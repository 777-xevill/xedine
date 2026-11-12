import 'server-only';
import { createClient } from '@/lib/db/supabase-server';
import { addDays, DEFAULT_CUTOFF_MINUTES } from '@/lib/time/business-date';
import { now } from '@/lib/time/clock';
import {
  dailyWeather,
  nextHours,
  rainWindow,
  type DayWeather,
  type RainWindow,
  type WeatherPoint,
} from '@/modules/forecasting/outlook';
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

// ---- The outlook (ADR 0051) ------------------------------------------------------------------------------

export interface OutlookEvent {
  name: string;
  kind: string;
  starts_on: string;
  ends_on: string;
  auto: boolean;
}

export interface BranchOutlook {
  days: DayWeather[];
  hours: WeatherPoint[];
  rainSoon: RainWindow | null;
  updatedAt: string | null;
  events: OutlookEvent[];
  /** The owner set the branch's own location (else its area or city is used). */
  exactLocation: boolean;
}

/** Weather and calendar for one branch, today and the next seven days (reads what the weather job stored). */
export async function branchOutlook(
  orgId: string,
  branchId: string,
  today: string,
): Promise<BranchOutlook> {
  const supabase = await createClient();
  const last = addDays(today, 7);
  const at = now();
  const [{ data: branch }, { data: pts }, { data: events }] = await Promise.all([
    supabase
      .from('branches')
      .select('cutoff_minutes, latitude, longitude')
      .eq('org_id', orgId)
      .eq('id', branchId)
      .maybeSingle(),
    supabase
      .from('weather_hours')
      .select('at, period_hours, temp_c, rain_mm, symbol, fetched_at')
      .eq('org_id', orgId)
      .eq('branch_id', branchId)
      .gte('at', new Date(at.getTime() - 30 * 3_600_000).toISOString())
      .lte('at', new Date(at.getTime() + 9 * 86_400_000).toISOString())
      .order('at'),
    supabase
      .from('calendar_events')
      .select('name, kind, starts_on, ends_on, source')
      .eq('org_id', orgId)
      .lte('starts_on', last)
      .gte('ends_on', today)
      .order('starts_on'),
  ]);
  const points: WeatherPoint[] = (pts ?? []).map((p) => ({
    at: p.at as string,
    periodHours: Number(p.period_hours),
    tempC: p.temp_c === null ? null : Number(p.temp_c),
    rainMm: Number(p.rain_mm),
    symbol: (p.symbol as string | null) ?? null,
  }));
  const cutoff = (branch?.cutoff_minutes as number | null) ?? DEFAULT_CUTOFF_MINUTES;
  const nowIso = at.toISOString();
  const fetched = (pts ?? []).map((p) => p.fetched_at as string).sort();
  return {
    days: dailyWeather(points, today, last, cutoff),
    hours: nextHours(points, nowIso, 12),
    rainSoon: rainWindow(points, nowIso, 12),
    updatedAt: fetched.at(-1) ?? null,
    events: (events ?? []).map((e) => ({
      name: String(e.name),
      kind: String(e.kind),
      starts_on: e.starts_on as string,
      ends_on: e.ends_on as string,
      auto: e.source === 'weather forecast',
    })),
    exactLocation: branch?.latitude !== null && branch?.latitude !== undefined,
  };
}
