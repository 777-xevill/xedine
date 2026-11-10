/**
 * Chef Catch (ADR 0046): the host character catches falling dishes on a plate and dodges the burnt ones.
 * Each player plays the round on their own screen; on one phone they take turns. This state only keeps the
 * scores, so the moving part never has to travel between phones.
 */
export interface CatchState {
  game: 'catch';
  players: number;
  local: boolean;
  /** Final score of each player's round, or null until they have played. */
  scores: (number | null)[];
  /** One phone: whose round is next. */
  turn: number;
}

export type CatchAction = { type: 'score'; points: number };

export const CATCH_SECONDS = 45;
export const CATCH_LIVES = 3;
export const CATCH_POINTS = { dish: 10, gold: 30 } as const;

export function initCatch(players: number, local: boolean): CatchState {
  return {
    game: 'catch',
    players,
    local,
    scores: Array.from({ length: players }, () => null),
    turn: 0,
  };
}

export function catchOver(s: CatchState): boolean {
  return s.scores.every((v) => v !== null);
}

export function reduceCatch(s: CatchState, a: CatchAction, by: number): CatchState {
  const who = s.local ? s.turn : by;
  if (who < 0 || who >= s.players || s.scores[who] !== null) return s;
  const points = Math.max(0, Math.min(100_000, Math.round(a.points)));
  const scores = s.scores.map((v, i) => (i === who ? points : v));
  return { ...s, scores, turn: s.local ? Math.min(s.turn + 1, s.players - 1) : s.turn };
}
