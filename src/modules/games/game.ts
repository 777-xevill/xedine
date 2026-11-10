import { z } from 'zod';
import { reduceCatch, type CatchAction, type CatchState } from './catch';
import { reduceDuel, type DuelAction, type DuelState } from './duel';
import { reduceLove, type LoveAction, type LoveState } from './love';
import { reduceMemory, type MemoryAction, type MemoryState } from './memory';
import { reduceQuiz, type QuizAction, type QuizState } from './quiz';
import { reduceRace, type RaceAction, type RaceState } from './race';

/**
 * One game state for every table game (ADR 0046). The phone that runs a game (the only phone, or the host
 * on separate phones) applies every move with `reduceGame`; the others only show the state it sends. A move
 * from another phone is checked with `parseAction` first, and the player who sent it is decided by the
 * host from who is connected, never taken from the message.
 */
export type GameState = CatchState | MemoryState | QuizState | RaceState | DuelState | LoveState;
export type GameAction =
  CatchAction | MemoryAction | QuizAction | RaceAction | DuelAction | LoveAction;

const small = z.number().int().min(-1).max(100_000);
const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('score'), points: small }),
  z.object({ type: z.literal('flip'), card: small }),
  z.object({ type: z.literal('hide') }),
  z.object({ type: z.literal('answer'), option: small }),
  z.object({ type: z.literal('reveal') }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('show'), face: small }),
  z.object({ type: z.literal('tap') }),
  z.object({ type: z.literal('end') }),
  z.object({ type: z.literal('place'), cell: small }),
  z.object({ type: z.literal('ready') }),
]);

export function parseAction(value: unknown): GameAction | null {
  const parsed = Action.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Moves only the phone running the game may make (timers and the host character), never another phone. */
const RUNNER_ONLY = new Set(['hide', 'reveal', 'show', 'end', 'start', 'next']);

export function isRunnerOnly(a: GameAction): boolean {
  return RUNNER_ONLY.has(a.type);
}

export function reduceGame(s: GameState, a: GameAction, by: number): GameState {
  switch (s.game) {
    case 'catch':
      return a.type === 'score' ? reduceCatch(s, a, by) : s;
    case 'memory':
      return a.type === 'flip' || a.type === 'hide' ? reduceMemory(s, a, by) : s;
    case 'quiz':
      return a.type === 'answer' || a.type === 'reveal' || a.type === 'next'
        ? reduceQuiz(s, a, by)
        : s;
    case 'race':
      return a.type === 'start' || a.type === 'show' || a.type === 'tap' || a.type === 'end'
        ? reduceRace(s, a, by)
        : s;
    case 'duel':
      return a.type === 'place' || a.type === 'next' ? reduceDuel(s, a, by) : s;
    case 'love':
      return a.type === 'answer' || a.type === 'ready' ? reduceLove(s, a, by) : s;
  }
}
