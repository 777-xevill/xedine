import { themeFaces, themeOf, PICTURES } from './pictures';
import { rng, shuffle } from './random';

/**
 * Blur Guess (ADR 0047): a big picture starts very blurry and slowly gets clear; pick what it is from four
 * clear pictures before it is sharp. The earlier the right pick, the more points. The phone that runs the
 * game ticks the blur down; the points depend on the step the blur had reached, so the rules stay pure.
 *
 * - Alone and on separate phones: eight rounds, everyone answers at once.
 * - One phone: the phone goes round, three rounds for each player.
 */
export interface GuessRound {
  /** The hidden picture (a number into PICTURES). */
  target: number;
  /** The four clear pictures to pick from, in the order shown (the target is one of them). */
  options: number[];
}

export interface GuessState {
  game: 'guess';
  mode: 'solo' | 'together' | 'turns';
  players: number;
  rounds: GuessRound[];
  index: number;
  phase: 'ask' | 'reveal' | 'done';
  /** How clear the picture is now: 0 (very blurry) to GUESS_STEPS - 1 (almost sharp). */
  step: number;
  /** This round's picks by player (option index), or null. */
  answers: (number | null)[];
  scores: number[];
  /** A counter that changes with every round, so timers can tell a new round apart. */
  n: number;
}

export type GuessAction = { type: 'answer'; option: number } | { type: 'tick' } | { type: 'next' };

export const GUESS_STEPS = 6;
export const GUESS_TICK_MS = 1600;
/** Points for a right pick at each step of the blur. */
export const GUESS_POINTS = [100, 85, 70, 55, 40, 25] as const;

export function initGuess(mode: GuessState['mode'], players: number, seed: number): GuessState {
  const next = rng(seed);
  const count = mode === 'turns' ? 3 * players : 8;
  const targets = shuffle(
    Array.from({ length: PICTURES.length }, (_, i) => i),
    next,
  ).slice(0, count);
  const rounds = targets.map((target): GuessRound => {
    // The wrong pictures come from the same theme, so they look alike when blurry.
    const others = shuffle(
      themeFaces(themeOf(target)).filter((f) => f !== target),
      next,
    ).slice(0, 3);
    return { target, options: shuffle([target, ...others], next) };
  });
  return {
    game: 'guess',
    mode,
    players,
    rounds,
    index: 0,
    phase: 'ask',
    step: 0,
    answers: Array.from({ length: players }, () => null),
    scores: Array.from({ length: players }, () => 0),
    n: 1,
  };
}

/** Whose round it is on one phone (everyone answers in the other modes). */
export function guessTurn(s: GuessState): number | null {
  return s.mode === 'turns' ? s.index % s.players : null;
}

/** Which of the four options is the hidden picture. */
export function rightGuess(r: GuessRound): number {
  return r.options.indexOf(r.target);
}

function allAnswered(s: GuessState): boolean {
  const turn = guessTurn(s);
  return turn === null ? s.answers.every((a) => a !== null) : s.answers[turn] !== null;
}

export function reduceGuess(s: GuessState, a: GuessAction, by: number): GuessState {
  if (s.phase === 'done') return s;
  const round = s.rounds[s.index];
  if (!round) return { ...s, phase: 'done' };
  switch (a.type) {
    case 'answer': {
      const turn = guessTurn(s);
      if (s.phase !== 'ask' || by < 0 || by >= s.players || s.answers[by] !== null) return s;
      if (turn !== null && by !== turn) return s;
      if (a.option < 0 || a.option >= round.options.length) return s;
      const right = a.option === rightGuess(round);
      const answers = s.answers.map((v, i) => (i === by ? a.option : v));
      const scores = s.scores.map((v, i) => (i === by && right ? v + GUESS_POINTS[s.step]! : v));
      const next = { ...s, answers, scores };
      return allAnswered(next) ? { ...next, phase: 'reveal' } : next;
    }
    case 'tick': {
      if (s.phase !== 'ask') return s;
      return s.step < GUESS_STEPS - 1 ? { ...s, step: s.step + 1 } : { ...s, phase: 'reveal' };
    }
    case 'next': {
      if (s.phase !== 'reveal') return s;
      const index = s.index + 1;
      if (index >= s.rounds.length) return { ...s, phase: 'done' };
      return {
        ...s,
        index,
        phase: 'ask',
        step: 0,
        answers: s.answers.map(() => null),
        n: s.n + 1,
      };
    }
  }
}
