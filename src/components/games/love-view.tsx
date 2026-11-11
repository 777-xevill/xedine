'use client';

import { Check, Heart, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import {
  loveAnswering,
  loveMatches,
  loveScore,
  loveTotal,
  type LoveState,
} from '@/modules/games/love';
import { HostSays } from './mascot';
import { Results, type GameProps } from './parts';

interface LoveQuestion {
  q: string;
  o: Record<string, string>;
}

/** Love Match (ADR 0046): a couple answers the same questions; how many match is the love score. */
export function LoveView(props: GameProps<LoveState>) {
  const { state: s, dispatch, me, players, locale, hostName } = props;
  const t = useTranslations('games');
  const bank = Object.values(t.raw('love.bank') as Record<string, LoveQuestion>);
  const total = loveTotal(s);
  const question = (k: number): { q: string; options: string[] } => {
    const b = bank[s.questions[k]!] ?? { q: '', o: {} };
    return { q: b.q, options: Object.values(b.o) };
  };

  if (s.revealed) {
    const score = loveScore(s);
    const tier = score >= 80 ? 'top' : score >= 50 ? 'mid' : 'low';
    return (
      <Results {...props} scores={[0, 0]} players={[]} line={t(`love.tier.${tier}`)}>
        <div className="flex flex-col items-center gap-1 py-2">
          <span className="game-beat relative flex size-36 items-center justify-center">
            <Heart aria-hidden className="absolute size-full fill-pink-bright text-pink" />
            <span className="relative text-3xl font-black text-on-action tabular-nums">
              {t('love.score', { n: formatNumber(score, locale) })}
            </span>
          </span>
          <p className="text-sm font-semibold">
            {players[0]?.name} + {players[1]?.name}
          </p>
          <p className="text-xs text-secondary">
            {t('love.matches', {
              n: formatNumber(loveMatches(s), locale),
              total: formatNumber(total, locale),
            })}
          </p>
        </div>
        <ul className="space-y-2">
          {Array.from({ length: total }, (_, k) => {
            const q = question(k);
            const a = s.answers[0][k]!;
            const b = s.answers[1][k]!;
            const same = a === b;
            return (
              <li key={k} className="rounded-card border border-line bg-surface px-4 py-2 text-sm">
                <p className="font-semibold">{q.q}</p>
                <p className="mt-1 flex items-center gap-2 text-secondary">
                  {same ? (
                    <Check aria-hidden className="size-4 text-success" />
                  ) : (
                    <X aria-hidden className="size-4 text-danger" />
                  )}
                  <span>
                    {t('love.answered', {
                      a: players[0]?.name ?? '',
                      x: q.options[a] ?? '',
                      b: players[1]?.name ?? '',
                      y: q.options[b] ?? '',
                    })}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      </Results>
    );
  }

  const who = s.local ? loveAnswering(s) : me;
  if (s.handoff) {
    return (
      <div className="space-y-4 text-center">
        <HostSays name={hostName} mood="wow">
          {t('love.pass', { name: players[1]?.name ?? '' })}
        </HostSays>
        <Button size="lg" className="w-full" onClick={() => dispatch({ type: 'ready' }, 1)}>
          {t('love.ready', { name: players[1]?.name ?? '' })}
        </Button>
      </div>
    );
  }
  if (who !== 0 && who !== 1) return null;
  const done = s.answers[who].length;
  if (done >= total) {
    return (
      <HostSays name={hostName} mood="think">
        {t('love.waitPartner', { name: players[1 - who]?.name ?? '' })}
      </HostSays>
    );
  }
  const q = question(done);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{players[who]?.name}</span>
        <span className="flex gap-1">
          {Array.from({ length: total }, (_, k) => (
            <Heart
              key={k}
              aria-hidden
              className={cn('size-4', k < done ? 'fill-pink-bright text-pink' : 'text-line-strong')}
            />
          ))}
        </span>
      </div>
      <HostSays name={hostName} mood="happy">
        <span className="text-base font-bold">{q.q}</span>
        <span className="mt-1 block text-xs text-secondary">{t('love.secret')}</span>
      </HostSays>
      <div className={cn('grid gap-2', q.options.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
        {q.options.map((o, i) => (
          <button
            key={`${done}-${i}`}
            type="button"
            onClick={() => dispatch({ type: 'answer', option: i }, who)}
            className="game-pop flex min-h-24 flex-col items-center justify-center gap-2 rounded-card border-2 border-line bg-surface p-3 text-center font-bold shadow-soft hover:border-pink active:scale-95"
          >
            <span>{o}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
