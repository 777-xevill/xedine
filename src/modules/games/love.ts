import { rng, shuffle } from './random';

/**
 * Love Match (ADR 0046), for a couple: both answer the same little questions about themselves ("tea or
 * coffee?") without seeing the other's answers, then the phone shows how many match. On one phone the first
 * answers, hands the phone over (the answers are hidden), then the second answers. The last question is
 * which dish from this menu they would share tonight.
 */
export interface LoveState {
  game: 'love';
  /** Question bank indexes; a last "which dish to share" question is added when the menu has 3 dishes. */
  questions: number[];
  shareDishes: number[];
  answers: [number[], number[]];
  /** One phone: true after the first partner finishes, until the second says they are ready. */
  handoff: boolean;
  local: boolean;
  revealed: boolean;
}

export type LoveAction = { type: 'answer'; option: number } | { type: 'ready' };

export const LOVE_QUESTIONS = 6;

export function initLove(
  local: boolean,
  bankSize: number,
  dishCount: number,
  seed: number,
): LoveState {
  const next = rng(seed);
  return {
    game: 'love',
    questions: shuffle(
      Array.from({ length: bankSize }, (_, i) => i),
      next,
    ).slice(0, LOVE_QUESTIONS),
    shareDishes:
      dishCount >= 3
        ? shuffle(
            Array.from({ length: dishCount }, (_, i) => i),
            next,
          ).slice(0, 3)
        : [],
    answers: [[], []],
    handoff: false,
    local,
    revealed: false,
  };
}

export function loveTotal(s: LoveState): number {
  return s.questions.length + (s.shareDishes.length ? 1 : 0);
}

/** Whose answers the one phone is taking now (0, then 1), or null when both are done. */
export function loveAnswering(s: LoveState): 0 | 1 | null {
  if (s.answers[0].length < loveTotal(s)) return 0;
  if (s.answers[1].length < loveTotal(s)) return 1;
  return null;
}

export function loveMatches(s: LoveState): number {
  return s.answers[0].filter((a, i) => a === s.answers[1][i]).length;
}

/** The love score in percent: matching answers out of all, rounded. */
export function loveScore(s: LoveState): number {
  const total = loveTotal(s);
  return total === 0 ? 0 : Math.round((loveMatches(s) / total) * 100);
}

export function reduceLove(s: LoveState, a: LoveAction, by: number): LoveState {
  if (s.revealed) return s;
  if (a.type === 'ready') return s.handoff ? { ...s, handoff: false } : s;
  if (s.handoff) return s;
  const who = s.local ? loveAnswering(s) : by;
  if (who !== 0 && who !== 1) return s;
  if (s.answers[who].length >= loveTotal(s) || a.option < 0 || a.option > 2) return s;
  const answers: [number[], number[]] = [[...s.answers[0]], [...s.answers[1]]];
  answers[who].push(a.option);
  const both = answers.every((list) => list.length >= loveTotal(s));
  const handoff = s.local && who === 0 && answers[0].length >= loveTotal(s);
  return { ...s, answers, handoff, revealed: both };
}
