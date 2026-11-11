'use client';

import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatNumber } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import {
  GUESS_POINTS,
  GUESS_STEPS,
  GUESS_TICK_MS,
  guessTurn,
  rightGuess,
  type GuessState,
} from '@/modules/games/guess';
import { HostSays } from './mascot';
import { Pic, PLAYER_BG, PlayerChips, Results, useLater, useLine, type GameProps } from './parts';

/** How blurry the hidden picture is at each step (pixels). */
const BLUR_PX = [28, 20, 14, 9, 5, 2];

/** Blur Guess (ADR 0047): a big picture slowly gets clear; pick what it is, the sooner the more points. */
export function GuessView(props: GameProps<GuessState>) {
  const { state: s, dispatch, me, runner, players, locale, hostName } = props;
  const t = useTranslations('games');
  const round = s.rounds[s.index];
  const turn = guessTurn(s);
  useLater(runner && s.phase === 'ask', GUESS_TICK_MS, `${s.n}-${s.step}`, () =>
    dispatch({ type: 'tick' }),
  );
  useLater(runner && s.phase === 'reveal', 2600, s.n, () => dispatch({ type: 'next' }));
  const praise = useLine('lines.right', s.n);
  const comfort = useLine('lines.wrong', s.n);
  const endLine = useLine('lines.end', s.n);

  if (s.phase === 'done' || !round) {
    const best = Math.max(...s.scores);
    const winners = players.filter((_, i) => s.scores[i] === best);
    return (
      <Results
        {...props}
        scores={s.scores}
        line={
          s.players === 1
            ? t('guess.soloDone', { score: formatNumber(s.scores[0]!, locale) })
            : winners.length > 1
              ? t('tie')
              : `${t('wins', { name: winners[0]?.name ?? '' })} ${endLine}`
        }
      />
    );
  }

  const reveal = s.phase === 'reveal';
  const right = rightGuess(round);
  const answerer = me ?? turn ?? 0;
  const mine = s.answers[answerer] ?? null;
  const canAnswer =
    s.phase === 'ask' && mine === null && (turn === null || me === null || me === turn);
  const iWasRight = mine !== null && mine === right;
  const blur = reveal ? 0 : BLUR_PX[s.step]!;

  return (
    <div className="space-y-4">
      {s.players > 1 ? (
        <PlayerChips players={players} scores={s.scores} active={turn} locale={locale} />
      ) : null}
      <div className="flex items-center justify-between text-sm text-secondary">
        <span>
          {t('guess.round', {
            n: formatNumber(s.index + 1, locale),
            total: formatNumber(s.rounds.length, locale),
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
      <div className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: GUESS_STEPS }, (_, k) => (
          <span
            key={k}
            className={cn(
              'h-2 flex-1 rounded-full',
              k >= s.step || reveal ? 'bg-surface-elevated' : 'bg-action',
              !reveal && k === s.step && 'bg-action',
            )}
          />
        ))}
      </div>
      <div
        role="img"
        aria-label={t('guess.hidden')}
        className="relative mx-auto size-48 overflow-hidden rounded-sheet border border-line bg-surface shadow-soft"
      >
        <div
          key={round.target}
          className={cn('size-full', reveal && 'game-pop')}
          style={{
            filter: `blur(${blur}px)`,
            transition: `filter ${GUESS_TICK_MS}ms linear`,
          }}
        >
          <Pic face={round.target} />
        </div>
      </div>
      <HostSays
        name={hostName}
        mood={reveal ? (iWasRight || s.players > 1 ? 'cheer' : 'sad') : 'think'}
      >
        {reveal ? (
          <span className="block">{iWasRight ? praise : comfort}</span>
        ) : (
          <>
            <span className="block text-base font-bold">{t('guess.what')}</span>
            <span className="mt-1 block text-secondary">
              {t('guess.worth', { n: formatNumber(GUESS_POINTS[s.step]!, locale) })}
            </span>
          </>
        )}
      </HostSays>
      <div className="grid grid-cols-2 gap-3">
        {round.options.map((face, i) => {
          const picked = mine === i;
          const who = s.answers.flatMap((a, p) => (a === i ? [p] : []));
          return (
            <button
              key={`${s.n}-${i}`}
              type="button"
              disabled={!canAnswer}
              aria-label={t('guess.option', { n: formatNumber(i + 1, locale) })}
              onClick={() => dispatch({ type: 'answer', option: i }, answerer)}
              className={cn(
                'relative flex h-28 items-center justify-center rounded-card border-2 bg-surface shadow-soft transition',
                'border-line enabled:hover:border-purple enabled:active:scale-95',
                picked && !reveal && 'border-purple',
                reveal && i === right && 'border-success bg-success/15',
                reveal && picked && i !== right && 'game-shake border-danger bg-danger/10',
              )}
            >
              <span className="size-16">
                <Pic face={face} />
              </span>
              {reveal && s.players > 1 ? (
                <span className="absolute start-2 top-2 flex gap-1">
                  {who.map((p) => (
                    <span key={p} className={cn('size-3 rounded-full', PLAYER_BG[p])} />
                  ))}
                </span>
              ) : null}
              {reveal && i === right ? (
                <Check aria-hidden className="absolute end-2 top-2 size-5 text-success" />
              ) : null}
              {reveal && picked && i !== right ? (
                <X aria-hidden className="absolute end-2 top-2 size-5 text-danger" />
              ) : null}
            </button>
          );
        })}
      </div>
      {s.phase === 'ask' && mine !== null && s.players > 1 ? (
        <p className="text-center text-sm text-secondary">{t('guess.waiting')}</p>
      ) : null}
    </div>
  );
}
