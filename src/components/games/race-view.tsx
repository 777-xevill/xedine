'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { nextFace, RACE_TARGETS, type RaceState } from '@/modules/games/race';
import { HostSays } from './mascot';
import {
  Pic,
  PLAYER_BG,
  PLAYER_SOFT,
  PlayerChips,
  Results,
  useLater,
  type GameProps,
} from './parts';

/**
 * Tap Race (ADR 0046). One phone: lay it flat in the middle; each player has a corner (the top players see
 * theirs the right way up). Separate phones: each phone is a big buzzer.
 */
export function RaceView(props: GameProps<RaceState>) {
  const { state: s, dispatch, me, runner, players, locale, hostName } = props;
  const t = useTranslations('games');
  // The next show comes after a short, varied wait; the last target gets a moment before the end.
  const shown = s.showing?.n ?? 0;
  const wait = 650 + ((shown * 397) % 550);
  const lastTarget = s.targetsShown >= RACE_TARGETS && s.showing?.face === s.target;
  useLater(runner && s.phase === 'play' && !lastTarget, wait, shown, () =>
    dispatch({ type: 'show', face: nextFace(s, Math.random(), Math.random()) }),
  );
  useLater(runner && s.phase === 'play' && lastTarget, 1600, s.showing?.n ?? 0, () =>
    dispatch({ type: 'end' }),
  );

  if (s.phase === 'done') {
    const best = Math.max(...s.scores);
    const winners = players.filter((_, i) => s.scores[i] === best);
    return (
      <Results
        {...props}
        scores={s.scores}
        line={winners.length > 1 ? t('tie') : t('wins', { name: winners[0]?.name ?? '' })}
      />
    );
  }

  const target = s.faces[s.target]!;
  if (s.phase === 'ready') {
    return (
      <div className="space-y-4 text-center">
        <HostSays name={hostName} mood="wow">
          {t('race.rules', { n: formatNumber(RACE_TARGETS, locale) })}
        </HostSays>
        <div className="mx-auto size-40 overflow-hidden rounded-card border-4 border-purple shadow-soft">
          <Pic face={target} />
        </div>
        <p className="text-sm font-semibold">{t('race.target')}</p>
        {runner ? (
          <Button size="lg" className="w-full" onClick={() => dispatch({ type: 'start' })}>
            {t('start')}
          </Button>
        ) : (
          <p className="text-sm text-secondary">{t('waitHostStart')}</p>
        )}
      </div>
    );
  }

  const center = s.showing ? (
    <div
      key={s.showing.n}
      className={cn(
        'game-pop size-32 overflow-hidden rounded-card border-4 bg-surface shadow-soft sm:size-40',
        s.claimed ? 'border-success' : 'border-line',
      )}
    >
      <Pic face={s.faces[s.showing.face]!} />
    </div>
  ) : (
    <div className="size-32 rounded-card border-4 border-dashed border-line sm:size-40" />
  );
  const hint = (
    <div className="flex items-center gap-2 text-xs font-semibold">
      <span className="size-8 overflow-hidden rounded-input">
        <Pic face={target} />
      </span>
      {t('race.only')}
    </div>
  );

  if (me !== null) {
    const flash = s.last && s.last.n === s.showing?.n && s.last.by === me ? s.last.good : null;
    return (
      <div className="space-y-4">
        <PlayerChips players={players} scores={s.scores} locale={locale} />
        <div className="flex flex-col items-center gap-3">
          {hint}
          {center}
        </div>
        <button
          type="button"
          onPointerDown={() => dispatch({ type: 'tap' }, me)}
          className={cn(
            'flex h-40 w-full touch-manipulation items-center justify-center rounded-sheet text-3xl font-black text-on-action shadow-soft select-none active:scale-[0.98]',
            PLAYER_BG[me],
            flash === false && 'game-shake',
          )}
        >
          {flash === true ? t('race.got') : flash === false ? t('race.oops') : t('race.tap')}
        </button>
      </div>
    );
  }

  // One phone: a corner (or half) for each player.
  const n = s.players;
  return (
    <div
      className={cn(
        'relative grid h-[72dvh] touch-manipulation gap-1 overflow-hidden rounded-sheet select-none',
        n === 2 ? 'grid-rows-2' : 'grid-cols-2 grid-rows-2',
      )}
    >
      {players.map((p, i) => {
        const top = n === 2 ? i === 0 : i < 2;
        const flash = s.last && s.last.n === s.showing?.n && s.last.by === i ? s.last.good : null;
        return (
          <button
            key={p.id}
            type="button"
            onPointerDown={() => dispatch({ type: 'tap' }, i)}
            className={cn(
              'flex flex-col items-center justify-center gap-1 p-3 text-center',
              PLAYER_SOFT[i],
              flash === true && PLAYER_BG[i],
              flash === false && 'game-shake',
            )}
          >
            <span className={cn('flex flex-col items-center', top && 'rotate-180')}>
              <span className="text-sm font-bold">{p.name}</span>
              <span className="text-4xl font-black tabular-nums">
                {formatNumber(s.scores[i] ?? 0, locale)}
              </span>
              <span className="text-xs font-semibold">
                {flash === true ? t('race.got') : flash === false ? t('race.oops') : t('race.tap')}
              </span>
            </span>
          </button>
        );
      })}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
        {center}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
        {hint}
      </div>
    </div>
  );
}
