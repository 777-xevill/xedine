/**
 * "How busy will it be?" on a special day (ADR 0066): what the owner or a manager expects, as a share of a
 * usual day. The forecast uses it for those days instead of what such days did before — a new restaurant
 * has no past match days to learn from. TODO(verify): the four steps with the founder after the pilot.
 */
export const BUSY_LEVELS = ['up2', 'up1', 'down1', 'down2'] as const;
export type BusyLevel = (typeof BUSY_LEVELS)[number];

/** Basis points of a usual day: much busier +30%, a bit busier +15%, a bit quieter −15%, much quieter −30%. */
export const BUSY_BPS: Record<BusyLevel, number> = {
  up2: 13000,
  up1: 11500,
  down1: 8500,
  down2: 7000,
};

/** The level a stored expectation is closest to (for words on the page), or null when none was said. */
export function busyLevel(bps: number | null): BusyLevel | null {
  if (bps === null) return null;
  let best: BusyLevel = 'up1';
  for (const level of BUSY_LEVELS)
    if (Math.abs(BUSY_BPS[level] - bps) < Math.abs(BUSY_BPS[best] - bps)) best = level;
  return best;
}
