import 'server-only';
import { createClient } from '@/lib/db/supabase-server';
import { now } from '@/lib/time/clock';
import type { BaseUnit } from '@/modules/purchasing/lines';

/**
 * Stock Guard (METRICS.md "Stock Guard", ADR 0028): the stock records that need a person's eye, by
 * fixed rules in SQL. Rules, not AI — the same records always give the same list. Price checks come
 * back only for owner and accountant (can_see_money, ADR 0007).
 */
export type GuardKind =
  'price_typo' | 'below_zero' | 'idle_stock' | 'new_item' | 'unused' | 'unused_unknown';

export interface GuardRow {
  kind: GuardKind;
  ingredient_id: string;
  name: string;
  name_bn: string | null;
  base: BaseUnit;
  branch_id: string | null;
  qty: number | null;
  since: string | null;
  actor: string;
  last_total_poisha: number | null;
  usual_total_poisha: number | null;
}

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** metric: stock.guard, as of the injected now. */
export async function stockGuard(orgId: string, branchId: string | null): Promise<GuardRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('metric_stock_guard', {
    p_org: orgId,
    p_branch: branchId,
    p_now: now().toISOString(),
  });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    kind: r.kind as GuardKind,
    ingredient_id: r.ingredient_id as string,
    name: String(r.name),
    name_bn: (r.name_bn as string | null) ?? null,
    base: r.base as BaseUnit,
    branch_id: (r.branch_id as string | null) ?? null,
    qty: numOrNull(r.qty),
    since: (r.since as string | null) ?? null,
    actor: String(r.actor ?? ''),
    last_total_poisha: numOrNull(r.last_total_poisha),
    usual_total_poisha: numOrNull(r.usual_total_poisha),
  }));
}
