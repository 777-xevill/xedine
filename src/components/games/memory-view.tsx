'use client';

import { ChefHat } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatNumber } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { needsHide, type MemoryState } from '@/modules/games/memory';
import { HostSays } from './mascot';
import { FaceView, PLAYER_RING, PlayerChips, Results, useLater, type GameProps } from './parts';

/** Dish Memory (ADR 0046): find the pairs of the restaurant's own dishes. */
export function MemoryView(props: GameProps<MemoryState>) {
  const { state: s, dispatch, me, runner, players, dishes, locale, hostName } = props;
  const t = useTranslations('games');
  const solo = s.players === 1;
  const myTurn = me === null || me === s.turn;
  useLater(runner && needsHide(s), 900, s.moves, () => dispatch({ type: 'hide' }));

  if (s.over) {
    const best = Math.max(...s.scores);
    const winners = players.filter((_, i) => s.scores[i] === best);
    const perfect = s.moves <= s.faces.length + 2;
    return (
      <Results
        {...props}
        scores={s.scores}
        line={
          solo
            ? t(perfect ? 'memory.soloGreat' : 'memory.soloDone', {
                moves: formatNumber(s.moves, locale),
              })
            : winners.length > 1
              ? t('tie')
              : t('wins', { name: winners[0]?.name ?? '' })
        }
      />
    );
  }

  const cols = s.cards.length > 12 ? 'grid-cols-4' : 'grid-cols-3 sm:grid-cols-4';
  return (
    <div className="space-y-4">
      {solo ? (
        <HostSays name={hostName} mood="think">
          {t('memory.soloHint', { moves: formatNumber(s.moves, locale) })}
        </HostSays>
      ) : (
        <>
          <PlayerChips players={players} scores={s.scores} active={s.turn} locale={locale} />
          <p className="text-center text-lg font-bold">
            {me !== null && me === s.turn
              ? t('yourTurn')
              : t('turnOf', { name: players[s.turn]?.name ?? '' })}
          </p>
        </>
      )}
      <div className={cn('grid gap-2', cols)}>
        {s.cards.map((face, i) => {
          const open = s.open.includes(i) || s.owner[i] !== null;
          const owner = s.owner[i] ?? null;
          return (
            <button
              key={i}
              type="button"
              aria-label={
                open ? t('memory.cardOpen') : t('memory.card', { n: formatNumber(i + 1, locale) })
              }
              disabled={!myTurn || open || s.open.length >= 2}
              onClick={() => dispatch({ type: 'flip', card: i }, me ?? s.turn)}
              className="aspect-square [perspective:600px]"
            >
              <span
                data-open={open}
                className={cn(
                  'game-card relative block size-full rounded-input',
                  owner !== null && !solo && 'ring-3',
                  owner !== null && !solo && PLAYER_RING[owner],
                )}
              >
                <span className="absolute inset-0 flex items-center justify-center rounded-input bg-action text-on-action shadow-soft">
                  <ChefHat aria-hidden className="size-1/2 opacity-80" strokeWidth={1.6} />
                </span>
                <span className="game-card-front absolute inset-0 overflow-hidden rounded-input border border-line bg-surface">
                  <FaceView face={s.faces[face]!} dishes={dishes} locale={locale} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
