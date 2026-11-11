import { rng } from './random';

/**
 * Spin the Wheel (ADR 0047): a wheel with one slice for each person at the table decides something for fun:
 * who pays the bill, who orders next, who sings. No money moves. The result comes from the seed and the
 * spin number, so every phone shows the same wheel stopping on the same person.
 */
export interface WheelState {
  game: 'wheel';
  players: number;
  /** What the wheel decides (a place in the topics in the message files). */
  topic: number;
  topics: number;
  seed: number;
  /** How many spins so far; each one turns the wheel several times round. */
  spins: number;
  /** The player the last spin stopped on, or null before the first spin. */
  result: number | null;
}

export type WheelAction = { type: 'spin' } | { type: 'topic'; option: number };

export function initWheel(players: number, topics: number, seed: number): WheelState {
  return { game: 'wheel', players, topic: 0, topics, seed, spins: 0, result: null };
}

/** Who spin number `spin` stops on. */
export function spinResult(seed: number, spin: number, players: number): number {
  const next = rng(seed + spin * 7919);
  next();
  return Math.floor(next() * players);
}

export function reduceWheel(s: WheelState, a: WheelAction): WheelState {
  switch (a.type) {
    case 'spin': {
      const spins = s.spins + 1;
      return { ...s, spins, result: spinResult(s.seed, spins, s.players) };
    }
    case 'topic':
      if (a.option < 0 || a.option >= s.topics) return s;
      return { ...s, topic: a.option, result: null };
  }
}

/** How far the wheel has turned (degrees) after `spins` spins stopping on `result`: the slice's middle is at the top. */
export function wheelAngle(spins: number, result: number | null, players: number): number {
  if (spins === 0 || result === null) return 0;
  const slice = 360 / players;
  return spins * 1800 + 360 - (result + 0.5) * slice;
}
