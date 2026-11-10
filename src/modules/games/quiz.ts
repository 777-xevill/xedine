import { pick, rng, shuffle } from './random';

/**
 * Food Quiz (ADR 0046). Questions come from a food question bank (in the message files, so every phone
 * shows them in its own language) and from the restaurant's real menu: "which of these is on our menu?"
 * and "which dish costs ৳320 here?" (the price is the menu price, never made up). A question only stores
 * indexes, so each phone writes the words itself.
 *
 * - Alone: ten questions against the clock.
 * - Together (each on their own phone): everyone answers at once; a right answer is 100, the first right
 *   answer gets 50 more and the second 25 more.
 * - Turns (one phone): the phone goes round; each player answers their own questions for 100 each.
 */
export type QuizQuestion =
  | { kind: 'bank'; i: number; order: number[] }
  | { kind: 'menu'; dish: number; decoys: number[]; order: number[] }
  | { kind: 'price'; dishes: number[]; answer: number };

export interface QuizState {
  game: 'quiz';
  mode: 'solo' | 'together' | 'turns';
  players: number;
  questions: QuizQuestion[];
  index: number;
  phase: 'ask' | 'reveal' | 'done';
  /** This question's answers by player (option index), or null. */
  answers: (number | null)[];
  /** Players who answered right, in the order they answered. */
  rightOrder: number[];
  scores: number[];
  /** A counter that changes with every question, so timers can tell a new question apart. */
  n: number;
}

export type QuizAction = { type: 'answer'; option: number } | { type: 'reveal' } | { type: 'next' };

export const QUESTION_SECONDS = 15;

/** Which shown option is the right one. */
export function rightOption(q: QuizQuestion): number {
  if (q.kind === 'price') return q.answer;
  // In bank and menu questions, the right answer is item 0 before shuffling.
  return q.order.indexOf(0);
}

export function optionCount(q: QuizQuestion): number {
  return q.kind === 'price' ? q.dishes.length : q.order.length;
}

export interface QuizSetup {
  mode: QuizState['mode'];
  players: number;
  /** How many questions the bank has; each has one right and three wrong answers. */
  bankSize: number;
  /** Dish prices in poisha, by menu index. */
  prices: number[];
  /**
   * Which made-up dishes (by index into the full decoy list in the message files) may be used as wrong
   * answers to "which is on our menu?": the ones whose name is not on this menu.
   */
  decoys: number[];
  seed: number;
}

/** Questions: at most three from the menu, the rest from the bank; never the same question twice. */
export function buildQuestions(setup: QuizSetup, count: number): QuizQuestion[] {
  const next = rng(setup.seed);
  const out: QuizQuestion[] = [];
  const dishCount = setup.prices.length;
  const menu: QuizQuestion[] = [];
  if (dishCount >= 1 && setup.decoys.length >= 3) {
    const dish = pick(dishCount, next);
    const decoys = shuffle(setup.decoys, next).slice(0, 3);
    menu.push({ kind: 'menu', dish, decoys, order: shuffle([0, 1, 2, 3], next) });
  }
  // Price questions need four dishes with four different prices.
  const byPrice = new Map<number, number>();
  for (const i of shuffle(
    Array.from({ length: dishCount }, (_, i) => i),
    next,
  ))
    if (!byPrice.has(setup.prices[i]!)) byPrice.set(setup.prices[i]!, i);
  const distinct = [...byPrice.values()];
  for (let k = 0; k < 2 && distinct.length >= 4; k++) {
    const dishes = shuffle(distinct, next).slice(0, 4);
    menu.push({ kind: 'price', dishes, answer: pick(4, next) });
  }
  const bank = shuffle(
    Array.from({ length: setup.bankSize }, (_, i) => i),
    next,
  )
    .slice(0, Math.max(0, count - menu.length))
    .map((i): QuizQuestion => ({ kind: 'bank', i, order: shuffle([0, 1, 2, 3], next) }));
  out.push(...bank, ...menu.slice(0, Math.min(menu.length, count)));
  return shuffle(out, next).slice(0, count);
}

export function initQuiz(setup: QuizSetup): QuizState {
  const count = setup.mode === 'turns' ? 4 * setup.players : 10;
  return {
    game: 'quiz',
    mode: setup.mode,
    players: setup.players,
    questions: buildQuestions(setup, count),
    index: 0,
    phase: 'ask',
    answers: Array.from({ length: setup.players }, () => null),
    rightOrder: [],
    scores: Array.from({ length: setup.players }, () => 0),
    n: 1,
  };
}

/** Whose turn it is in turns mode (everyone answers in the other modes). */
export function quizTurn(s: QuizState): number | null {
  return s.mode === 'turns' ? s.index % s.players : null;
}

/** Everyone who has to answer this question has answered. */
export function allAnswered(s: QuizState): boolean {
  const turn = quizTurn(s);
  return turn === null ? s.answers.every((a) => a !== null) : s.answers[turn] !== null;
}

export function reduceQuiz(s: QuizState, a: QuizAction, by: number): QuizState {
  if (s.phase === 'done') return s;
  const q = s.questions[s.index];
  if (!q) return { ...s, phase: 'done' };
  switch (a.type) {
    case 'answer': {
      const turn = quizTurn(s);
      if (s.phase !== 'ask' || by < 0 || by >= s.players || s.answers[by] !== null) return s;
      if (turn !== null && by !== turn) return s;
      if (a.option < 0 || a.option >= optionCount(q)) return s;
      const answers = s.answers.map((v, i) => (i === by ? a.option : v));
      const right = a.option === rightOption(q);
      const rightOrder = right ? [...s.rightOrder, by] : s.rightOrder;
      const next = { ...s, answers, rightOrder };
      return allAnswered(next) ? reduceQuiz(next, { type: 'reveal' }, by) : next;
    }
    case 'reveal': {
      if (s.phase !== 'ask') return s;
      const bonus = s.mode === 'together' ? [50, 25] : [];
      const scores = s.scores.map((v, i) => {
        const place = s.rightOrder.indexOf(i);
        return place < 0 ? v : v + 100 + (bonus[place] ?? 0);
      });
      return { ...s, phase: 'reveal', scores };
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
        rightOrder: [],
        n: s.n + 1,
      };
    }
  }
}
