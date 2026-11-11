'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { ratherCount, type RatherState } from '@/modules/games/rather';
import { HostSays } from './mascot';
import { PLAYER_BG, PlayerChips, Results, useLater, type GameProps } from './parts';

interface RatherQuestion {
  a: string;
  b: string;
}

/**
 * Would You Rather (ADR 0047): everyone picks one of two choices; those who picked what most of the table
 * picked score. Separate phones: two big buttons each. One phone: each player taps their own row.
 */
export function RatherView(props: GameProps<RatherState>) {
  const { state: s, dispatch, me, runner, players, locale, hostName } = props;
  const t = useTranslations('games');
  const bank = Object.values(t.raw('rather.bank') as Record<string, RatherQuestion>);
  const letters = Object.values(t.raw('rather.letters') as Record<string, string>);
  useLater(runner && s.phase === 'reveal', 9000, s.n, () => dispatch({ type: 'next' }));

  if (s.phase === 'done') {
    const best = Math.max(...s.scores);
    const winners = players.filter((_, i) => s.scores[i] === best);
    return (
      <Results
        {...props}
        scores={s.scores}
        line={
          best === 0
            ? t('rather.noOne')
            : winners.length > 1
              ? t('tie')
              : t('rather.winner', { name: winners[0]?.name ?? '' })
        }
      />
    );
  }

  const q = bank[s.questions[s.index]!] ?? { a: '', b: '' };
  const choices = [q.a, q.b];
  const reveal = s.phase === 'reveal';
  const { counts, majority } = ratherCount(s.answers);
  const everyone = reveal && counts.some((c) => c === s.players);

  return (
    <div className="space-y-4">
      <PlayerChips players={players} scores={s.scores} locale={locale} />
      <p className="text-sm text-secondary">
        {t('rather.question', {
          n: formatNumber(s.index + 1, locale),
          total: formatNumber(s.questions.length, locale),
        })}
      </p>
      <HostSays name={hostName} mood={reveal ? (majority === null ? 'think' : 'cheer') : 'happy'}>
        {reveal ? (
          everyone ? (
            t('rather.alike')
          ) : majority === null ? (
            t('rather.split')
          ) : (
            t('rather.most')
          )
        ) : (
          <span className="text-base font-bold">{t('rather.title')}</span>
        )}
      </HostSays>

      {!reveal && me !== null ? (
        s.answers[me] === null ? (
          <div className="grid gap-3">
            {choices.map((c, i) => (
              <button
                key={`${s.n}-${i}`}
                type="button"
                onClick={() => dispatch({ type: 'answer', option: i }, me)}
                className={cn(
                  'game-pop flex min-h-24 items-center gap-3 rounded-card p-4 text-start text-lg font-bold text-on-action shadow-soft active:scale-[0.98]',
                  i === 0 ? 'bg-pink-bright' : 'bg-cyan-bright',
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-lg font-black text-foreground">
                  {letters[i]}
                </span>
                {c}
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-card border border-line bg-surface px-4 py-6 text-center font-semibold">
            {t('rather.waiting')}
          </p>
        )
      ) : null}

      {!reveal && me === null ? (
        <>
          <ul className="space-y-2">
            {choices.map((c, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 font-semibold"
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-black text-on-action',
                    i === 0 ? 'bg-pink-bright' : 'bg-cyan-bright',
                  )}
                >
                  {letters[i]}
                </span>
                {c}
              </li>
            ))}
          </ul>
          <ul className="space-y-2">
            {players.map((p, pi) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-card border border-line bg-surface p-2 ps-4"
              >
                <span aria-hidden className={cn('size-3 shrink-0 rounded-full', PLAYER_BG[pi])} />
                <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                {s.answers[pi] === null ? (
                  <span className="flex gap-2">
                    {choices.map((_, i) => (
                      <Button
                        key={`${s.n}-${i}`}
                        size="icon"
                        variant="secondary"
                        aria-label={t('rather.pickFor', { name: p.name, choice: letters[i] ?? '' })}
                        onClick={() => dispatch({ type: 'answer', option: i }, pi)}
                      >
                        {letters[i]}
                      </Button>
                    ))}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 pe-2 text-sm font-semibold text-success">
                    <Check aria-hidden className="size-4" />
                    {t('rather.picked')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {reveal ? (
        <>
          <div className="grid gap-3">
            {choices.map((c, i) => (
              <div
                key={i}
                className={cn(
                  'game-pop rounded-card border-2 bg-surface p-4',
                  majority === i ? 'border-success bg-success/10' : 'border-line',
                )}
              >
                <p className="flex items-center gap-3 font-bold">
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-black text-on-action',
                      i === 0 ? 'bg-pink-bright' : 'bg-cyan-bright',
                    )}
                  >
                    {letters[i]}
                  </span>
                  <span className="min-w-0 flex-1">{c}</span>
                  <span className="text-2xl font-black tabular-nums">
                    {formatNumber(counts[i]!, locale)}
                  </span>
                </p>
                <p className="mt-2 flex flex-wrap gap-2">
                  {players.flatMap((p, pi) =>
                    s.answers[pi] === i
                      ? [
                          <span
                            key={p.id}
                            className="flex items-center gap-1.5 rounded-full bg-surface-elevated px-2.5 py-1 text-sm font-medium"
                          >
                            <span
                              aria-hidden
                              className={cn('size-2.5 rounded-full', PLAYER_BG[pi])}
                            />
                            {p.name}
                          </span>,
                        ]
                      : [],
                  )}
                </p>
              </div>
            ))}
          </div>
          {runner ? (
            <Button size="lg" className="w-full" onClick={() => dispatch({ type: 'next' })}>
              {t('rather.next')}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
