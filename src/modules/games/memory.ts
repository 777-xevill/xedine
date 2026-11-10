import { rng, shuffle } from './random';

/**
 * Dish Memory (ADR 0046): turn over two cards; a pair of the same dish is yours and you go again. With more
 * than one player the turn passes on a miss; the most pairs wins. A face is a dish (by its place in the
 * menu list) or one of the built-in food pictures when the menu has too few photos.
 */
export type Face = { kind: 'dish'; i: number } | { kind: 'icon'; i: number };

export interface MemoryState {
  game: 'memory';
  players: number;
  faces: Face[];
  /** Each card's face, by index into `faces`. */
  cards: number[];
  open: number[];
  /** Who matched each card (player index), or null. */
  owner: (number | null)[];
  turn: number;
  scores: number[];
  moves: number;
  over: boolean;
}

export type MemoryAction = { type: 'flip'; card: number } | { type: 'hide' };

export const ICON_FACES = 8;

/** Six pairs alone, eight with friends. Dishes with photos first, then food pictures. */
export function initMemory(players: number, photoDishes: number[], seed: number): MemoryState {
  const next = rng(seed);
  const pairs = players > 1 ? 8 : 6;
  const dishes = shuffle(photoDishes, next).slice(0, pairs);
  const faces: Face[] = [
    ...dishes.map((i): Face => ({ kind: 'dish', i })),
    ...shuffle(
      Array.from({ length: ICON_FACES }, (_, i) => i),
      next,
    )
      .slice(0, pairs - dishes.length)
      .map((i): Face => ({ kind: 'icon', i })),
  ];
  const cards = shuffle(
    faces.flatMap((_, f) => [f, f]),
    next,
  );
  return {
    game: 'memory',
    players,
    faces,
    cards,
    open: [],
    owner: cards.map(() => null),
    turn: 0,
    scores: Array.from({ length: players }, () => 0),
    moves: 0,
    over: false,
  };
}

/** Two open cards that do not match wait for `hide` (sent by the phone that runs the game after a moment). */
export function needsHide(s: MemoryState): boolean {
  return s.open.length === 2 && s.cards[s.open[0]!] !== s.cards[s.open[1]!];
}

export function reduceMemory(s: MemoryState, a: MemoryAction, by: number): MemoryState {
  if (s.over) return s;
  if (a.type === 'hide') {
    if (!needsHide(s)) return s;
    return { ...s, open: [], turn: (s.turn + 1) % s.players };
  }
  const { card } = a;
  if (by !== s.turn || card < 0 || card >= s.cards.length) return s;
  if (s.owner[card] !== null || s.open.includes(card) || s.open.length >= 2) return s;
  const open = [...s.open, card];
  if (open.length < 2) return { ...s, open };
  const moves = s.moves + 1;
  if (s.cards[open[0]!] !== s.cards[open[1]!]) return { ...s, open, moves };
  const owner = s.owner.map((o, i) => (open.includes(i) ? s.turn : o));
  const scores = s.scores.map((v, i) => (i === s.turn ? v + 1 : v));
  return { ...s, open: [], owner, scores, moves, over: owner.every((o) => o !== null) };
}
