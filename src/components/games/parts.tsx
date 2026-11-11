'use client';

import { Trophy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import type { GameAction, GameState } from '@/modules/games/game';
import type { Player } from '@/modules/games/catalog';
import { PICTURES } from '@/modules/games/pictures';
import { HostSays, type Mood } from './mascot';

/** Each player's colour, from the brand's bright accents. */
export const PLAYER_BG = [
  'bg-pink-bright',
  'bg-cyan-bright',
  'bg-success-bright',
  'bg-warning-bright',
];
export const PLAYER_RING = ['ring-pink', 'ring-cyan', 'ring-success', 'ring-warning'];
export const PLAYER_TEXT = ['text-pink', 'text-cyan', 'text-success', 'text-warning'];
export const PLAYER_SOFT = ['bg-pink/15', 'bg-cyan/15', 'bg-success/15', 'bg-warning/15'];

/** What every game screen gets from the games shell. */
export interface GameProps<S extends GameState> {
  state: S;
  /** `by` is the player making the move; on separate phones it is always this phone's player. */
  dispatch: (action: GameAction, by?: number) => void;
  /** This phone's player on separate phones; null when everyone shares this phone. */
  me: number | null;
  /** This phone runs the game (timers, the host character's moves). */
  runner: boolean;
  players: Player[];
  hostName: string;
  locale: Locale;
  onAgain: () => void;
  onExit: () => void;
}

/**
 * A picture (an emoji from the game's picture sets) sized to its box: the box is a size container, so the
 * picture grows and shrinks with it.
 */
export function Pic({ face, className }: { face: number; className?: string }) {
  return (
    <span aria-hidden className={cn('block size-full [container-type:size]', className)}>
      <span className="flex size-full items-center justify-center leading-none select-none text-[length:62cqmin]">
        {PICTURES[face] ?? ''}
      </span>
    </span>
  );
}

/** Runs `fn` after `ms` while `when` is true; a new `key` starts the wait again. Runner phone only. */
export function useLater(when: boolean, ms: number, key: unknown, fn: () => void) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!when) return;
    const id = setTimeout(() => ref.current(), ms);
    return () => clearTimeout(id);
  }, [when, ms, key]);
}

export function PlayerChips({
  players,
  scores,
  active,
  locale,
}: {
  players: Player[];
  scores: (number | null)[];
  active?: number | null;
  locale: Locale;
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {players.map((p, i) => (
        <li
          key={p.id}
          className={cn(
            'flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm',
            active === i && 'ring-2 ring-offset-1',
            active === i && PLAYER_RING[i],
          )}
        >
          <span aria-hidden className={cn('size-2.5 rounded-full', PLAYER_BG[i])} />
          <span className="max-w-24 truncate font-medium">{p.name}</span>
          <span className="font-bold tabular-nums">
            {scores[i] === null || scores[i] === undefined ? '–' : formatNumber(scores[i], locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The end of a game: who won, the host character cheering, play again. */
export function Results({
  players,
  scores,
  hostName,
  runner,
  onAgain,
  onExit,
  line,
  mood = 'cheer',
  children,
  locale,
}: {
  locale: Locale;
  players: Player[];
  scores: number[];
  hostName: string;
  runner: boolean;
  onAgain: () => void;
  onExit: () => void;
  line: string;
  mood?: Mood;
  children?: React.ReactNode;
}) {
  const t = useTranslations('games');
  const order = players.map((p, i) => ({ p, i, s: scores[i] ?? 0 })).sort((a, b) => b.s - a.s);
  return (
    <div className="game-pop space-y-4">
      <HostSays mood={mood} name={hostName}>
        {line}
      </HostSays>
      {children}
      {players.length > 1 ? (
        <ol className="space-y-2">
          {order.map(({ p, i, s }, place) => (
            <li
              key={p.id}
              className={cn(
                'flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3',
                place === 0 && 'ring-2',
                place === 0 && PLAYER_RING[i],
              )}
            >
              <span className="w-6 text-lg font-extrabold tabular-nums">
                {formatNumber(place + 1, locale)}
              </span>
              <span aria-hidden className={cn('size-3 rounded-full', PLAYER_BG[i])} />
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              {place === 0 ? <Trophy aria-hidden className="size-5 text-warning" /> : null}
              <span className="text-lg font-extrabold tabular-nums">{formatNumber(s, locale)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {runner ? (
          <Button onClick={onAgain}>{t('again')}</Button>
        ) : (
          <p className="self-center text-sm text-secondary">{t('waitHostAgain')}</p>
        )}
        <Button variant="secondary" onClick={onExit}>
          {t('otherGames')}
        </Button>
      </div>
    </div>
  );
}

/** Pick a line from a list in the message files, the same each render for the same `seed`. */
export function useLine(list: string, seed: number): string {
  const t = useTranslations('games');
  const lines = Object.values(t.raw(list) as Record<string, string>);
  return lines[Math.abs(seed) % lines.length] ?? '';
}
