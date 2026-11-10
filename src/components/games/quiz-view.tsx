'use client';

import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatBDT, formatNumber } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import {
  QUESTION_SECONDS,
  quizTurn,
  rightOption,
  type QuizQuestion,
  type QuizState,
} from '@/modules/games/quiz';
import { HostSays } from './mascot';
import {
  dishName,
  PLAYER_BG,
  PlayerChips,
  Results,
  useLater,
  useLine,
  type GameProps,
} from './parts';

interface BankQuestion {
  q: string;
  a: string;
  w: Record<string, string>;
}

/** Food Quiz (ADR 0046): food questions and questions about this restaurant's own menu. */
export function QuizView(props: GameProps<QuizState>) {
  const { state: s, dispatch, me, runner, players, dishes, locale, hostName, restaurant } = props;
  const t = useTranslations('games');
  const bank = Object.values(t.raw('quiz.bank') as Record<string, BankQuestion>);
  const decoys = Object.values(t.raw('quiz.decoys') as Record<string, string>);
  const q = s.questions[s.index];
  const turn = quizTurn(s);
  useLater(runner && s.phase === 'ask', QUESTION_SECONDS * 1000, s.n, () =>
    dispatch({ type: 'reveal' }),
  );
  useLater(runner && s.phase === 'reveal', 2600, s.n, () => dispatch({ type: 'next' }));
  const praise = useLine('lines.right', s.n);
  const comfort = useLine('lines.wrong', s.n);
  const endLine = useLine('lines.end', s.n);

  if (s.phase === 'done' || !q) {
    const best = Math.max(...s.scores);
    const winners = players.filter((_, i) => s.scores[i] === best);
    return (
      <Results
        {...props}
        scores={s.scores}
        line={
          s.players === 1
            ? t('quiz.soloDone', {
                right: formatNumber(s.scores[0]! / 100, locale),
                total: formatNumber(s.questions.length, locale),
              })
            : winners.length > 1
              ? t('tie')
              : `${t('wins', { name: winners[0]?.name ?? '' })} ${endLine}`
        }
      />
    );
  }

  const { text, options } = render(q, {
    bank,
    decoys,
    dishes,
    locale,
    onMenu: t('quiz.onMenu', { restaurant }),
    priceText: (price) => t('quiz.price', { price }),
  });
  const right = rightOption(q);
  const answerer = me ?? turn ?? 0;
  const mine = s.answers[answerer];
  const canAnswer =
    s.phase === 'ask' && mine === null && (turn === null || me === null || me === turn);
  const iWasRight = mine !== null && mine === right;

  return (
    <div className="space-y-4">
      {s.players > 1 ? (
        <PlayerChips players={players} scores={s.scores} active={turn} locale={locale} />
      ) : null}
      <div className="flex items-center justify-between text-sm text-secondary">
        <span>
          {t('quiz.question', {
            n: formatNumber(s.index + 1, locale),
            total: formatNumber(s.questions.length, locale),
          })}
        </span>
        {turn !== null ? (
          <span className="font-semibold text-foreground">
            {me === null || me !== turn
              ? t('turnOf', { name: players[turn]?.name ?? '' })
              : t('yourTurn')}
          </span>
        ) : null}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-elevated">
        {s.phase === 'ask' ? (
          <div
            key={s.n}
            className="game-clock h-full bg-action"
            style={{ animationDuration: `${QUESTION_SECONDS}s` }}
          />
        ) : null}
      </div>
      <HostSays
        name={hostName}
        mood={s.phase === 'reveal' ? (iWasRight || s.rightOrder.length ? 'cheer' : 'sad') : 'think'}
      >
        <span className="text-base font-bold">{text}</span>
        {s.phase === 'reveal' ? (
          <span className="mt-1 block text-secondary">{iWasRight ? praise : comfort}</span>
        ) : null}
      </HostSays>
      <div className="grid gap-2">
        {options.map((label, i) => {
          const reveal = s.phase === 'reveal';
          const picked = mine === i;
          const who = s.answers.flatMap((a, p) => (a === i ? [p] : []));
          return (
            <button
              key={i}
              type="button"
              disabled={!canAnswer}
              onClick={() => dispatch({ type: 'answer', option: i }, answerer)}
              className={cn(
                'flex min-h-14 items-center gap-3 rounded-card border-2 px-4 py-3 text-start font-semibold transition',
                'border-line bg-surface enabled:hover:border-purple enabled:active:scale-[0.98]',
                picked && !reveal && 'border-purple',
                reveal && i === right && 'border-success bg-success/15',
                reveal && picked && i !== right && 'game-shake border-danger bg-danger/10',
              )}
            >
              <span className="min-w-0 flex-1">{label}</span>
              {reveal && s.players > 1 ? (
                <span className="flex gap-1">
                  {who.map((p) => (
                    <span key={p} className={cn('size-3 rounded-full', PLAYER_BG[p])} />
                  ))}
                </span>
              ) : null}
              {reveal && i === right ? <Check aria-hidden className="size-5 text-success" /> : null}
              {reveal && picked && i !== right ? (
                <X aria-hidden className="size-5 text-danger" />
              ) : null}
            </button>
          );
        })}
      </div>
      {s.phase === 'ask' && mine !== null && s.players > 1 ? (
        <p className="text-center text-sm text-secondary">{t('quiz.waiting')}</p>
      ) : null}
    </div>
  );
}

function render(
  q: QuizQuestion,
  ctx: {
    bank: BankQuestion[];
    decoys: string[];
    dishes: GameProps<QuizState>['dishes'];
    locale: GameProps<QuizState>['locale'];
    onMenu: string;
    priceText: (price: string) => string;
  },
): { text: string; options: string[] } {
  const { bank, decoys, dishes, locale, onMenu, priceText } = ctx;
  if (q.kind === 'bank') {
    const b = bank[q.i] ?? { q: '', a: '', w: {} };
    const items = [b.a, ...Object.values(b.w)];
    return { text: b.q, options: q.order.map((k) => items[k] ?? '') };
  }
  if (q.kind === 'menu') {
    const items = [dishName(dishes[q.dish], locale), ...q.decoys.map((d) => decoys[d] ?? '')];
    return { text: onMenu, options: q.order.map((k) => items[k] ?? '') };
  }
  const price = dishes[q.dishes[q.answer]!]?.price_poisha ?? 0;
  return {
    text: priceText(formatBDT(price, locale)),
    options: q.dishes.map((d) => dishName(dishes[d], locale)),
  };
}
