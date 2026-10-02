import type { CoverBand, StockRow, VarianceRow } from './queries';

/**
 * Plain-language grouping for the Stock page (ADR 0026). Pure presentation: every figure still comes
 * from the Phase 5 metrics (METRICS.md "Inventory"); these helpers only decide which heading a row
 * sits under, in what order, and how long its comparison bars are drawn. Nothing here calculates a
 * quantity, a cost or a percentage.
 */

export type LevelGroup = 'low' | 'getting' | 'enough' | 'notCounted';

export const LEVEL_GROUPS: readonly LevelGroup[] = ['low', 'getting', 'enough', 'notCounted'];

/** Never counted is unknown, not "enough". Counted but unused lately is no risk, so it is "enough". */
export function levelGroup(row: Pick<StockRow, 'stock_qty' | 'band'>): LevelGroup {
  if (row.stock_qty === null) return 'notCounted';
  const byBand: Record<CoverBand, LevelGroup> = {
    red: 'low',
    yellow: 'getting',
    green: 'enough',
    none: 'enough',
  };
  return byBand[row.band];
}

/** Rows under each heading, the shortest-lasting first, so the top of the page is what to buy first. */
export function groupLevels<
  T extends Pick<StockRow, 'stock_qty' | 'band' | 'days_of_cover' | 'name'>,
>(rows: readonly T[]): Record<LevelGroup, T[]> {
  const groups: Record<LevelGroup, T[]> = { low: [], getting: [], enough: [], notCounted: [] };
  for (const row of rows) groups[levelGroup(row)].push(row);
  const byCover = (a: T, b: T) =>
    (a.days_of_cover ?? Number.POSITIVE_INFINITY) - (b.days_of_cover ?? Number.POSITIVE_INFINITY) ||
    a.name.localeCompare(b.name);
  for (const g of ['low', 'getting', 'enough'] as const) groups[g].sort(byCover);
  groups.notCounted.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}

/** The loss line when an org has not set one (ADR 0027): 1% over the recipe. */
export const DEFAULT_LOSS_LINE_BPS = 100;

/**
 * ADR 0027, METRICS.md usage.over_*: every gram over the recipe is a loss. At or over the org's loss
 * line it is a loss to act on; under it, still a loss, but a small one. Something used that no recipe
 * sold needs (no percentage to give) is a loss. Using less than the recipes is under-usage, never a
 * gain; exactly the recipe amount is on recipe.
 */
export type LossKind = 'loss' | 'small' | 'under' | 'onRecipe';

export function lossKind(
  row: Pick<VarianceRow, 'over_qty' | 'over_bps'>,
  lineBps: number = DEFAULT_LOSS_LINE_BPS,
): LossKind {
  if (row.over_qty === 0) return 'onRecipe';
  if (row.over_qty < 0) return 'under';
  return row.over_bps === null || row.over_bps >= lineBps ? 'loss' : 'small';
}

export type LossGroups = Record<LossKind, VarianceRow[]>;

/** Rows under each heading, the biggest money first (then the biggest share over the recipe). */
export function splitLoss(rows: readonly VarianceRow[], lineBps: number): LossGroups {
  const out: LossGroups = { loss: [], small: [], under: [], onRecipe: [] };
  for (const row of rows) out[lossKind(row, lineBps)].push(row);
  const biggest = (a: VarianceRow, b: VarianceRow) =>
    Math.abs(b.over_poisha ?? 0) - Math.abs(a.over_poisha ?? 0) ||
    Math.abs(b.over_bps ?? Number.POSITIVE_INFINITY) -
      Math.abs(a.over_bps ?? Number.POSITIVE_INFINITY) ||
    a.name.localeCompare(b.name);
  out.loss.sort(biggest);
  out.small.sort(biggest);
  out.under.sort(biggest);
  out.onRecipe.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * METRICS.md stock.loss_value: what the over-usage cost, summed over the items that used more than
 * their recipes. Under-usage is never subtracted (it would hide a loss). An item with no price yet adds
 * nothing (its ৳ is unknown, not zero); the page shows ৳ only to owner and accountant (ADR 0007).
 */
export function lossTotal(rows: readonly VarianceRow[]): number {
  return rows.reduce(
    (sum, r) => (r.over_qty > 0 && r.over_poisha !== null ? sum + r.over_poisha : sum),
    0,
  );
}

/** Days from one business date to another, both included ("2026-10-01" to "2026-10-04" is 4). */
export function daysInclusive(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(Math.round(ms / 86_400_000) + 1, 0) : 0;
}

/** usage.staff_food in ৳ over the rows (ADR 0029): its own line, never added to the loss. */
export function staffFoodTotal(rows: readonly VarianceRow[]): number {
  return rows.reduce(
    (sum, r) =>
      r.staff_food_qty > 0 && r.staff_food_poisha !== null ? sum + r.staff_food_poisha : sum,
    0,
  );
}

/** Bar lengths in percent: the longer of the two fills the track, the other is drawn to scale. */
export function compareBars(
  shouldUse: number,
  reallyUsed: number,
): { should: number; really: number } {
  const longest = Math.max(shouldUse, reallyUsed, 0);
  if (longest === 0) return { should: 0, really: 0 };
  const pct = (v: number) => Math.round((Math.max(v, 0) / longest) * 100);
  return { should: pct(shouldUse), really: pct(reallyUsed) };
}
