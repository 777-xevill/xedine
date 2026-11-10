'use client';

import {
  Apple,
  CakeSlice,
  Cherry,
  Coffee,
  Cookie,
  Croissant,
  IceCreamCone,
  Pizza,
  Sandwich,
  Soup,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import type { GameAction, GameState } from '@/modules/games/game';
import type { GameDish, Player } from '@/modules/games/catalog';
import type { Face } from '@/modules/games/memory';
import { HostSays, type Mood } from './mascot';

/** Food pictures used when the menu has too few dish photos (Dish Memory, Tap Race, Dish Duel). */
export const FOOD_ICONS: LucideIcon[] = [
  Pizza,
  Coffee,
  IceCreamCone,
  Soup,
  Sandwich,
  CakeSlice,
  Cookie,
  Apple,
  Cherry,
  Croissant,
];

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
  dishes: GameDish[];
  hostName: string;
  restaurant: string;
  locale: Locale;
  onAgain: () => void;
  onExit: () => void;
}

export function dishName(d: GameDish | undefined, locale: Locale): string {
  if (!d) return '';
  return locale === 'bn' && d.name_bn ? d.name_bn : d.name;
}

/** A dish photo (or its name on a tile) or a food picture, filling its box. */
export function FaceView({
  face,
  dishes,
  locale,
  className,
}: {
  face: Face;
  dishes: GameDish[];
  locale: Locale;
  className?: string;
}) {
  if (face.kind === 'icon') {
    const Icon = FOOD_ICONS[face.i % FOOD_ICONS.length]!;
    return (
      <span
        className={cn(
          'flex size-full items-center justify-center bg-surface-elevated text-purple',
          className,
        )}
      >
        <Icon aria-hidden className="size-1/2" strokeWidth={1.6} />
      </span>
    );
  }
  const d = dishes[face.i];
  if (d?.photo) {
    return (
      <span className={cn('relative block size-full', className)}>
        <Image
          src={d.photo}
          alt={dishName(d, locale)}
          fill
          unoptimized
          sizes="120px"
          draggable={false}
          className="object-cover select-none"
        />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'flex size-full items-center justify-center bg-surface-elevated p-1 text-center text-xs font-bold leading-tight',
        className,
      )}
    >
      {dishName(d, locale)}
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
