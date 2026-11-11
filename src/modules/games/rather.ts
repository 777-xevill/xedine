import { rng, shuffle } from './random';

/**
 * Would You Rather (ADR 0047): everyone at the table picks one of two choices; then the picks are shown.
 * Pick what most of the table picked and you score a point, so the winner is the one who thinks most like
 * the group. A split table scores nobody. On separate phones the picks stay hidden until all are in; on one
 * phone each player taps their own row.
 */
export interface RatherState {
  game: 'rather';
  players: number;
  /** Question bank indexes. */
  questions: number[];
  index: number;
  phase: 'ask' | 'reveal' | 'done';
  /** This question's picks by player (0 or 1), or null. */
  answers: (0 | 1 | null)[];
  scores: number[];
  /** A counter that changes with every question, so timers can tell a new question apart. */
  n: number;
}

export type RatherAction = { type: 'answer'; option: number } | { type: 'next' };

export const RATHER_QUESTIONS = 8;

export function initRather(players: number, bankSize: number, seed: number): RatherState {
  const next = rng(seed);
  return {
    game: 'rather',
    players,
    questions: shuffle(
      Array.from({ length: bankSize }, (_, i) => i),
      next,
    ).slice(0, RATHER_QUESTIONS),
    index: 0,
    phase: 'ask',
    answers: Array.from({ length: players }, () => null),
    scores: Array.from({ length: players }, () => 0),
    n: 1,
  };
}

/** How many picked each choice, and which choice most picked (null on a split). */
export function ratherCount(answers: (0 | 1 | null)[]): {
  counts: [number, number];
  majority: 0 | 1 | null;
} {
  const counts: [number, number] = [0, 0];
  for (const a of answers) if (a !== null) counts[a] += 1;
  return { counts, majority: counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1 };
}

export function reduceRather(s: RatherState, a: RatherAction, by: number): RatherState {
  if (s.phase === 'done') return s;
  switch (a.type) {
    case 'answer': {
      if (s.phase !== 'ask' || by < 0 || by >= s.players || s.answers[by] !== null) return s;
      if (a.option !== 0 && a.option !== 1) return s;
      const answers = s.answers.map((v, i) => (i === by ? (a.option as 0 | 1) : v));
      if (answers.some((v) => v === null)) return { ...s, answers };
      const { majority } = ratherCount(answers);
      const scores = s.scores.map((v, i) =>
        majority !== null && answers[i] === majority ? v + 1 : v,
      );
      return { ...s, answers, scores, phase: 'reveal' };
    }
    case 'next': {
      if (s.phase !== 'reveal') return s;
      const index = s.index + 1;
      if (index >= s.questions.length) return { ...s, phase: 'done' };
      return {
        ...s,
        index,
        phase: 'ask',
        answers: s.answers.map(() => null),
        n: s.n + 1,
      };
    }
  }
}
