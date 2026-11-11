import { rng, shuffle } from './random';

/**
 * Brain Quiz (ADR 0046; general questions from ADR 0047). Questions come from a bank in the message files
 * (animals, Bangladesh, sports, space, little puzzles), so every phone shows them in its own language. A
 * question only stores its place in the bank and the order of its four answers.
 *
 * - Alone: ten questions against the clock.
 * - Together (each on their own phone): everyone answers at once; a right answer is 100, the first right
 *   answer gets 50 more and the second 25 more.
 * - Turns (one phone): the phone goes round; each player answers their own questions for 100 each.
 */
export interface QuizQuestion {
  /** The question's place in the bank. */
  i: number;
  /** The shown order of the four answers: item 0 is the right one. */
  order: number[];
}

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
  return q.order.indexOf(0);
}

export function optionCount(q: QuizQuestion): number {
  return q.order.length;
}

export interface QuizSetup {
  mode: QuizState['mode'];
  players: number;
  /** How many questions the bank has; each has one right and three wrong answers. */
  bankSize: number;
  seed: number;
}

/** Questions from the bank, never the same one twice. */
export function buildQuestions(setup: QuizSetup, count: number): QuizQuestion[] {
  const next = rng(setup.seed);
  return shuffle(
    Array.from({ length: setup.bankSize }, (_, i) => i),
    next,
  )
    .slice(0, count)
    .map((i): QuizQuestion => ({ i, order: shuffle([0, 1, 2, 3], next) }));
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
