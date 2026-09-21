import { createHash } from 'node:crypto';
import seedrandom from 'seedrandom';

export const SEED = 'xedine-oracle-v1';

/** Deterministic UUID from a namespace and parts: the same seed always yields the same ids. */
export function detId(...parts: (string | number)[]): string {
  const h = createHash('sha256')
    .update(`${SEED}|${parts.join('|')}`)
    .digest();
  h[6] = (h[6]! & 0x0f) | 0x40;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
}

/** An independent, reproducible stream per key, so a day's data never depends on iteration order. */
export function makeRng(...key: (string | number)[]): Rng {
  const gen = seedrandom(`${SEED}|${key.join('|')}`);
  const next = () => gen();
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    weighted: (items, weight) => {
      let total = 0;
      for (const it of items) total += weight(it);
      let r = next() * total;
      for (const it of items) {
        r -= weight(it);
        if (r < 0) return it;
      }
      return items[items.length - 1]!;
    },
  };
  return rng;
}
