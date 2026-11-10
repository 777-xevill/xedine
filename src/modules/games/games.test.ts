import { describe, expect, it } from 'vitest';
import { catchOver, initCatch, reduceCatch } from './catch';
import { parseGameNames } from './catalog';
import { hostMove, initDuel, reduceDuel, winLine, type DuelState } from './duel';
import { isRunnerOnly, parseAction, reduceGame } from './game';
import { initLove, loveAnswering, loveScore, loveTotal, reduceLove } from './love';
import { initMemory, needsHide, reduceMemory } from './memory';
import { buildQuestions, initQuiz, reduceQuiz, rightOption } from './quiz';
import { initRace, nextFace, reduceRace } from './race';

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

describe('Dish Memory', () => {
  it('uses dish photos first, then food pictures, as pairs', () => {
    const s = initMemory(1, [4, 7], 1);
    expect(s.cards).toHaveLength(12);
    expect(s.faces.filter((f) => f.kind === 'dish')).toHaveLength(2);
    for (let f = 0; f < s.faces.length; f++) expect(s.cards.filter((c) => c === f)).toHaveLength(2);
    expect(initMemory(3, [], 1).cards).toHaveLength(16);
  });

  it('a pair is kept and the player goes again; a miss passes the turn after hide', () => {
    let s = initMemory(2, [], 9);
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

describe('Dish Duel', () => {
  const piece = { kind: 'icon', i: 0 } as const;
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
    let s = reduceRace(
      initRace(
        3,
        [
          { kind: 'icon', i: 0 },
          { kind: 'icon', i: 1 },
        ],
        0,
      ),
      { type: 'start' },
      0,
    );
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

describe('Food Quiz', () => {
  const setup = {
    mode: 'together' as const,
    players: 2,
    bankSize: 28,
    prices: [32000, 8000, 6000, 12000, 32000],
    decoys: [0, 1, 2, 3, 4],
    seed: 7,
  };

  it('mixes bank and menu questions with no repeats; price questions use four different prices', () => {
    const qs = buildQuestions(setup, 10);
    expect(qs).toHaveLength(10);
    const bank = qs.flatMap((q) => (q.kind === 'bank' ? [q.i] : []));
    expect(new Set(bank).size).toBe(bank.length);
    expect(qs.some((q) => q.kind !== 'bank')).toBe(true);
    for (const q of qs)
      if (q.kind === 'price') expect(new Set(q.dishes.map((d) => setup.prices[d])).size).toBe(4);
    // No menu questions without enough dishes or made-up names.
    expect(
      buildQuestions({ ...setup, prices: [], decoys: [] }, 10).every((q) => q.kind === 'bank'),
    ).toBe(true);
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
    let s = initLove(true, 12, 5, 3);
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

describe('Chef Catch', () => {
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
