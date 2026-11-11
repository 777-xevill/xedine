import { rng } from './random';

/**
 * Three in a Row (ADR 0046, pictures from ADR 0047): three in a row on a 3×3 board, best of three rounds;
 * each player's piece is a picture.
 * Alone, you play the host character, who plays well but not perfectly, so you can beat it.
 */
export interface DuelState {
  game: 'duel';
  /** True when one person plays the host character (player 1 is the character). */
  vsHost: boolean;
  board: (0 | 1 | null)[];
  turn: 0 | 1;
  starter: 0 | 1;
  wins: [number, number];
  draws: number;
  round: number;
  line: number[] | null;
  roundOver: boolean;
  over: boolean;
  /** Each player's piece: a picture number (into PICTURES). */
  pieces: [number, number];
}

export type DuelAction = { type: 'place'; cell: number } | { type: 'next' };

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export const ROUNDS_TO_WIN = 2;

export function initDuel(vsHost: boolean, pieces: [number, number]): DuelState {
  return {
    game: 'duel',
    vsHost,
    board: Array.from({ length: 9 }, () => null),
    turn: 0,
    starter: 0,
    wins: [0, 0],
    draws: 0,
    round: 1,
    line: null,
    roundOver: false,
    over: false,
    pieces,
  };
}

export function winLine(board: (0 | 1 | null)[]): number[] | null {
  for (const l of LINES) {
    const v = board[l[0]!];
    if (v !== null && v === board[l[1]!] && v === board[l[2]!]) return l;
  }
  return null;
}

export function reduceDuel(s: DuelState, a: DuelAction, by: number): DuelState {
  if (s.over) return s;
  if (a.type === 'next') {
    if (!s.roundOver) return s;
    const starter = (1 - s.starter) as 0 | 1;
    return {
      ...s,
      board: s.board.map(() => null),
      starter,
      turn: starter,
      round: s.round + 1,
      line: null,
      roundOver: false,
    };
  }
  if (s.roundOver || by !== s.turn || s.board[a.cell] !== null || a.cell < 0 || a.cell > 8)
    return s;
  const board = s.board.map((v, i) => (i === a.cell ? s.turn : v));
  const line = winLine(board);
  if (line) {
    const wins: [number, number] = [...s.wins];
    wins[s.turn] += 1;
    return { ...s, board, line, wins, roundOver: true, over: wins[s.turn] >= ROUNDS_TO_WIN };
  }
  if (board.every((v) => v !== null)) {
    // Three draws in a row end the match too, so it never goes on for ever.
    const draws = s.draws + 1;
    return { ...s, board, draws, roundOver: true, over: draws >= 3 };
  }
  return { ...s, board, turn: (1 - s.turn) as 0 | 1 };
}

function score(board: (0 | 1 | null)[], me: 0 | 1, toMove: 0 | 1, depth: number): number {
  const line = winLine(board);
  if (line) return board[line[0]!] === me ? 10 - depth : depth - 10;
  if (board.every((v) => v !== null)) return 0;
  let best = toMove === me ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (board[i] !== null) continue;
    const nextBoard = board.map((v, j) => (j === i ? toMove : v));
    const v = score(nextBoard, me, (1 - toMove) as 0 | 1, depth + 1);
    best = toMove === me ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

/**
 * The host character's move: the best move most of the time, a random one now and then (one in four), so
 * a customer can win. Deterministic for a given seed.
 */
export function hostMove(s: DuelState, seed: number): number {
  const free = s.board.flatMap((v, i) => (v === null ? [i] : []));
  if (free.length === 0) return -1;
  const next = rng(seed);
  if (next() < 0.25) return free[Math.floor(next() * free.length)]!;
  let best = -Infinity;
  let moves: number[] = [];
  for (const i of free) {
    const board = s.board.map((v, j) => (j === i ? 1 : v));
    const v = score(board, 1, 0, 0);
    if (v > best) {
      best = v;
      moves = [i];
    } else if (v === best) moves.push(i);
  }
  return moves[Math.floor(next() * moves.length)]!;
}
