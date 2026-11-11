import { describe, expect, it } from 'vitest';
import { catchOver, initCatch, reduceCatch } from './catch';
import { parseGameNames } from './catalog';
import { hostMove, initDuel, reduceDuel, winLine, type DuelState } from './duel';
import { isRunnerOnly, parseAction, reduceGame } from './game';
import { initLove, loveAnswering, loveScore, loveTotal, reduceLove } from './love';
import { GUESS_POINTS, GUESS_STEPS, guessTurn, initGuess, reduceGuess, rightGuess } from './guess';
import { initMemory, needsHide, reduceMemory } from './memory';
import { PICTURES, THEMES, THEME_SIZE, themeFaces, themeOf } from './pictures';
import { buildQuestions, initQuiz, reduceQuiz, rightOption } from './quiz';
import { initRace, nextFace, reduceRace } from './race';
import { initRather, ratherCount, reduceRather } from './rather';
import { initWheel, reduceWheel, spinResult, wheelAngle } from './wheel';

describe('owner game names', () => {
  it('keeps known keys with a short name, tidied', () => {
    expect(
      parseGameNames({
        quiz: '  Kacchi   Bhai Quiz ',
        host: 'Kacchi Bhai',
        bad: 'x',
        race: '',
        duel: 5,
      }),
    ).toEqual({ quiz: 'Kacchi Bhai Quiz', host: 'Kacchi Bhai' });
    expect(parseGameNames({ quiz: 'x'.repeat(41) })).toEqual({});
    expect(parseGameNames(null)).toEqual({});
    expect(parseGameNames(['quiz'])).toEqual({});
  });
});

describe('moves from another phone', () => {
  it('only well-formed moves pass; timers are the running phone’s alone', () => {
    expect(parseAction({ type: 'flip', card: 3 })).toEqual({ type: 'flip', card: 3 });
    expect(parseAction({ type: 'flip', card: 'x' })).toBeNull();
    expect(parseAction({ type: 'steal' })).toBeNull();
    expect(parseAction(null)).toBeNull();
    expect(isRunnerOnly({ type: 'reveal' })).toBe(true);
    expect(isRunnerOnly({ type: 'next' })).toBe(true);
    expect(isRunnerOnly({ type: 'answer', option: 1 })).toBe(false);
  });

  it('a move for another game changes nothing', () => {
    const s = initCatch(2, false);
    expect(reduceGame(s, { type: 'flip', card: 0 }, 0)).toBe(s);
  });
});

describe('pictures', () => {
  it('five themes of twelve different pictures, none on the menu', () => {
    expect(THEMES).toHaveLength(5);
    for (const t of THEMES) expect(t.pics).toHaveLength(THEME_SIZE);
    expect(new Set(PICTURES).size).toBe(PICTURES.length);
    expect(themeFaces(2).every((f) => themeOf(f) === 2)).toBe(true);
  });
});

describe('Match Pairs', () => {
  it('uses pictures of one theme, as pairs', () => {
    const s = initMemory(1, 1);
    expect(s.cards).toHaveLength(12);
    expect(s.faces.every((f) => themeOf(f) === s.theme)).toBe(true);
    for (let f = 0; f < s.faces.length; f++) expect(s.cards.filter((c) => c === f)).toHaveLength(2);
    expect(initMemory(3, 1).cards).toHaveLength(16);
  });

  it('a pair is kept and the player goes again; a miss passes the turn after hide', () => {
    let s = initMemory(2, 9);
    const a = 0;
    const pair = s.cards.findIndex((c, i) => i !== a && c === s.cards[a]);
    const miss = s.cards.findIndex((c, i) => i !== a && c !== s.cards[a]);
    // Player 1 cannot play on player 0's turn.
    expect(reduceMemory(s, { type: 'flip', card: a }, 1)).toBe(s);
    s = reduceMemory(
      reduceMemory(s, { type: 'flip', card: a }, 0),
      { type: 'flip', card: pair },
      0,
    );
    expect(s.scores).toEqual([1, 0]);
    expect(s.turn).toBe(0);
    expect(s.owner[a]).toBe(0);
    const b = s.cards.findIndex((_, i) => s.owner[i] === null && i !== miss);
    const other = s.cards.findIndex((c, i) => s.owner[i] === null && c !== s.cards[b] && i !== b);
    s = reduceMemory(
      reduceMemory(s, { type: 'flip', card: b }, 0),
      { type: 'flip', card: other },
      0,
    );
    expect(needsHide(s)).toBe(true);
    // A third card cannot be opened while two are up.
    expect(reduceMemory(s, { type: 'flip', card: miss }, 0)).toBe(s);
    s = reduceMemory(s, { type: 'hide' }, 0);
    expect(s.open).toEqual([]);
    expect(s.turn).toBe(1);
  });
});

describe('Three in a Row', () => {
  const piece = 0;
  it('three in a row wins the round; two rounds win the match', () => {
    let s = initDuel(false, [piece, piece]);
    for (const [cell, by] of [
      [0, 0],
      [3, 1],
      [1, 0],
      [4, 1],
      [2, 0],
    ] as const)
      s = reduceDuel(s, { type: 'place', cell }, by);
    expect(s.line).toEqual([0, 1, 2]);
    expect(s.wins).toEqual([1, 0]);
    expect(s.roundOver).toBe(true);
    s = reduceDuel(s, { type: 'next' }, 0);
    expect(s.turn).toBe(1);
    expect(s.board.every((v) => v === null)).toBe(true);
  });

  it('the host character blocks an obvious win most of the time and never plays a taken square', () => {
    const s: DuelState = {
      ...initDuel(true, [piece, piece]),
      board: [0, 0, null, null, 1, null, null, null, null],
      turn: 1,
    };
    let blocks = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const m = hostMove(s, seed);
      expect(s.board[m]).toBeNull();
      if (m === 2) blocks++;
    }
    expect(blocks).toBeGreaterThan(25);
    expect(winLine([1, 1, 1, null, null, null, null, null, null])).toEqual([0, 1, 2]);
  });
});

describe('Tap Race', () => {
  it('first right tap scores, a wrong tap costs one (never below zero), then the show is closed', () => {
    let s = reduceRace(initRace(3, [0, 1], 0), { type: 'start' }, 0);
    s = reduceRace(s, { type: 'show', face: 1 }, 0);
    s = reduceRace(s, { type: 'tap' }, 2);
    expect(s.scores).toEqual([0, 0, 0]);
    s = reduceRace(s, { type: 'show', face: 0 }, 0);
    s = reduceRace(s, { type: 'tap' }, 1);
    s = reduceRace(s, { type: 'tap' }, 0);
    expect(s.scores).toEqual([0, 1, 0]);
    expect(s.targetsShown).toBe(1);
    expect(nextFace(s, 0.1, 0.5)).toBe(0);
    expect(nextFace(s, 0.9, 0.5)).toBe(1);
  });
});

describe('Brain Quiz', () => {
  const setup = {
    mode: 'together' as const,
    players: 2,
    bankSize: 34,
    seed: 7,
  };

  it('asks ten different questions, each with four answers in a mixed order', () => {
    const qs = buildQuestions(setup, 10);
    expect(qs).toHaveLength(10);
    expect(new Set(qs.map((q) => q.i)).size).toBe(10);
    for (const q of qs) expect([...q.order].sort()).toEqual([0, 1, 2, 3]);
    // A small bank gives fewer questions, never a repeat.
    expect(buildQuestions({ ...setup, bankSize: 3 }, 10)).toHaveLength(3);
  });

  it('together: right answers score 100, the first gets 50 more and the second 25 more', () => {
    let s = initQuiz(setup);
    const right = rightOption(s.questions[0]!);
    s = reduceQuiz(s, { type: 'answer', option: right }, 1);
    // A second answer from the same player is ignored.
    s = reduceQuiz(s, { type: 'answer', option: (right + 1) % 4 }, 1);
    s = reduceQuiz(s, { type: 'answer', option: right }, 0);
    expect(s.phase).toBe('reveal');
    expect(s.scores).toEqual([125, 150]);
    s = reduceQuiz(s, { type: 'next' }, 0);
    expect(s.index).toBe(1);
    expect(s.answers).toEqual([null, null]);
  });

  it('turns on one phone: only the player whose turn it is answers', () => {
    let s = initQuiz({ ...setup, mode: 'turns' });
    expect(s.questions).toHaveLength(8);
    expect(reduceQuiz(s, { type: 'answer', option: 0 }, 1)).toBe(s);
    s = reduceQuiz(s, { type: 'answer', option: rightOption(s.questions[0]!) }, 0);
    expect(s.phase).toBe('reveal');
    expect(s.scores).toEqual([100, 0]);
  });
});

describe('Love Match', () => {
  it('one phone: partner one answers, hands over, partner two answers, then the score', () => {
    let s = initLove(true, 14, 3);
    const total = loveTotal(s);
    expect(total).toBe(7);
    for (let k = 0; k < total; k++) s = reduceLove(s, { type: 'answer', option: k % 2 }, 0);
    expect(s.handoff).toBe(true);
    expect(reduceLove(s, { type: 'answer', option: 0 }, 1)).toBe(s);
    s = reduceLove(s, { type: 'ready' }, 1);
    expect(loveAnswering(s)).toBe(1);
    for (let k = 0; k < total; k++)
      s = reduceLove(s, { type: 'answer', option: k < 4 ? k % 2 : 2 }, 1);
    expect(s.revealed).toBe(true);
    // The first four match out of seven.
    expect(loveScore(s)).toBe(57);
  });
});

describe('Catch It!', () => {
  it('one phone takes turns; separate phones each send their own score once', () => {
    let local = initCatch(2, true);
    local = reduceCatch(local, { type: 'score', points: 120 }, 0);
    local = reduceCatch(local, { type: 'score', points: 90.4 }, 0);
    expect(local.scores).toEqual([120, 90]);
    expect(catchOver(local)).toBe(true);
    let net = initCatch(2, false);
    net = reduceCatch(net, { type: 'score', points: 50 }, 1);
    net = reduceCatch(net, { type: 'score', points: 999 }, 1);
    expect(net.scores).toEqual([null, 50]);
  });
});

describe('Blur Guess', () => {
  it('eight rounds, the hidden picture is one of four from its own theme', () => {
    const s = initGuess('together', 2, 11);
    expect(s.rounds).toHaveLength(8);
    expect(new Set(s.rounds.map((r) => r.target)).size).toBe(8);
    for (const r of s.rounds) {
      expect(r.options).toHaveLength(4);
      expect(new Set(r.options).size).toBe(4);
      expect(r.options.every((o) => themeOf(o) === themeOf(r.target))).toBe(true);
      expect(r.options[rightGuess(r)]).toBe(r.target);
    }
    expect(initGuess('turns', 3, 11).rounds).toHaveLength(9);
  });

  it('a right pick scores more the earlier it is; the round shows when all have picked', () => {
    let s = initGuess('together', 2, 4);
    const right = rightGuess(s.rounds[0]!);
    const wrong = (right + 1) % 4;
    s = reduceGuess(s, { type: 'tick' }, 0);
    s = reduceGuess(s, { type: 'tick' }, 0);
    s = reduceGuess(s, { type: 'answer', option: right }, 1);
    // A second pick from the same player is ignored.
    s = reduceGuess(s, { type: 'answer', option: wrong }, 1);
    expect(s.phase).toBe('ask');
    s = reduceGuess(s, { type: 'answer', option: wrong }, 0);
    expect(s.phase).toBe('reveal');
    expect(s.scores).toEqual([0, GUESS_POINTS[2]]);
    s = reduceGuess(s, { type: 'next' }, 0);
    expect(s.index).toBe(1);
    expect(s.step).toBe(0);
    expect(s.answers).toEqual([null, null]);
  });

  it('with nobody answering, the blur clears step by step and the round is shown at the end', () => {
    let s = initGuess('solo', 1, 2);
    for (let k = 0; k < GUESS_STEPS - 1; k++) s = reduceGuess(s, { type: 'tick' }, 0);
    expect(s.step).toBe(GUESS_STEPS - 1);
    expect(s.phase).toBe('ask');
    s = reduceGuess(s, { type: 'tick' }, 0);
    expect(s.phase).toBe('reveal');
    expect(s.scores).toEqual([0]);
  });

  it('one phone: only the player whose round it is can pick', () => {
    const s = initGuess('turns', 2, 6);
    expect(guessTurn(s)).toBe(0);
    expect(reduceGuess(s, { type: 'answer', option: 0 }, 1)).toBe(s);
  });
});

describe('Spin the Wheel', () => {
  it('every spin stops on one of the players, the same on every phone, and the angle puts them at the top', () => {
    let s = initWheel(3, 6, 99);
    expect(s.result).toBeNull();
    expect(wheelAngle(s.spins, s.result, 3)).toBe(0);
    const seen = new Set<number>();
    for (let k = 0; k < 60; k++) {
      s = reduceWheel(s, { type: 'spin' });
      expect(s.result).toBe(spinResult(99, s.spins, 3));
      expect(s.result).toBeGreaterThanOrEqual(0);
      expect(s.result).toBeLessThan(3);
      seen.add(s.result!);
    }
    expect(seen.size).toBe(3);
    // The wheel only ever turns forwards from one spin to the next.
    const a = wheelAngle(1, 2, 4);
    const b = wheelAngle(2, 0, 4);
    expect(b).toBeGreaterThan(a + 1000);
    // Player 1 of 4 (slice 90 to 180 degrees) ends with its middle (135) at the top.
    expect((wheelAngle(1, 1, 4) + 135) % 360).toBe(0);
  });

  it('changing what the wheel decides clears the last result; an unknown topic is ignored', () => {
    let s = reduceWheel(initWheel(2, 6, 5), { type: 'spin' });
    expect(s.result).not.toBeNull();
    expect(reduceWheel(s, { type: 'topic', option: 6 })).toBe(s);
    s = reduceWheel(s, { type: 'topic', option: 3 });
    expect(s.topic).toBe(3);
    expect(s.result).toBeNull();
  });
});

describe('Would You Rather', () => {
  it('everyone who picked what most picked scores; a split table scores nobody', () => {
    let s = initRather(3, 20, 8);
    expect(s.questions).toHaveLength(8);
    s = reduceRather(s, { type: 'answer', option: 0 }, 0);
    s = reduceRather(s, { type: 'answer', option: 1 }, 2);
    // A second pick or a pick that is not one of two choices changes nothing.
    expect(reduceRather(s, { type: 'answer', option: 0 }, 0)).toBe(s);
    expect(reduceRather(s, { type: 'answer', option: 2 }, 1)).toBe(s);
    s = reduceRather(s, { type: 'answer', option: 0 }, 1);
    expect(s.phase).toBe('reveal');
    expect(s.scores).toEqual([1, 1, 0]);
    expect(ratherCount(s.answers)).toEqual({ counts: [2, 1], majority: 0 });
    s = reduceRather(s, { type: 'next' }, 0);
    expect(s.index).toBe(1);
    expect(s.answers).toEqual([null, null, null]);
    let split = initRather(2, 20, 8);
    split = reduceRather(split, { type: 'answer', option: 0 }, 0);
    split = reduceRather(split, { type: 'answer', option: 1 }, 1);
    expect(split.scores).toEqual([0, 0]);
    expect(ratherCount(split.answers).majority).toBeNull();
  });

  it('after the last question the game is done', () => {
    let s = initRather(2, 20, 3);
    for (let k = 0; k < 8; k++) {
      s = reduceRather(s, { type: 'answer', option: 1 }, 0);
      s = reduceRather(s, { type: 'answer', option: 1 }, 1);
      s = reduceRather(s, { type: 'next' }, 0);
    }
    expect(s.phase).toBe('done');
    expect(s.scores).toEqual([8, 8]);
  });
});

describe('new moves from another phone', () => {
  it('spin and topic pass; the timer tick is the running phone’s alone', () => {
    expect(parseAction({ type: 'spin' })).toEqual({ type: 'spin' });
    expect(parseAction({ type: 'topic', option: 2 })).toEqual({ type: 'topic', option: 2 });
    expect(isRunnerOnly({ type: 'tick' })).toBe(true);
    expect(isRunnerOnly({ type: 'spin' })).toBe(false);
    const wheel = initWheel(2, 6, 1);
    expect(reduceGame(wheel, { type: 'answer', option: 0 }, 0)).toBe(wheel);
  });
});
