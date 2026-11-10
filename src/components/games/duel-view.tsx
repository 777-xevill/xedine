'use client';

import { useTranslations } from 'next-intl';
import { formatNumber } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { hostMove, ROUNDS_TO_WIN, type DuelState } from '@/modules/games/duel';
import { HostSays } from './mascot';
import {
  FaceView,
  PLAYER_BG,
  PLAYER_RING,
  Results,
  useLater,
  useLine,
  type GameProps,
} from './parts';

/** Dish Duel (ADR 0046): three in a row with two dishes as pieces; alone, against the host character. */
export function DuelView(props: GameProps<DuelState>) {
  const { state: s, dispatch, me, runner, players, dishes, locale, hostName } = props;
  const t = useTranslations('games');
  const moves = s.board.filter((v) => v !== null).length;
  const hostTurn = s.vsHost && s.turn === 1 && !s.roundOver;
  useLater(runner && hostTurn, 700, `${s.round}-${moves}`, () =>
    dispatch({ type: 'place', cell: hostMove(s, s.round * 31 + moves) }, 1),
  );
  useLater(runner && s.roundOver && !s.over, 2200, s.round, () => dispatch({ type: 'next' }));
  const taunt = useLine('lines.duel', s.round + moves);

  if (s.over) {
    const winner = s.wins[0] === s.wins[1] ? null : s.wins[0] > s.wins[1] ? 0 : 1;
    return (
      <Results
        {...props}
        scores={s.wins}
        mood={s.vsHost && winner === 1 ? 'happy' : 'cheer'}
        line={
          winner === null
            ? t('tie')
            : s.vsHost
              ? winner === 0
                ? t('duel.youBeatHost')
                : t('duel.hostWon')
              : t('wins', { name: players[winner]?.name ?? '' })
        }
      />
    );
  }

  const canPlay = !s.roundOver && !hostTurn && (me === null || me === s.turn);
  const roundWinner = s.line ? s.board[s.line[0]!]! : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {players.slice(0, 2).map((p, i) => (
          <div
            key={p.id}
            className={cn(
              'flex items-center gap-2 rounded-card border border-line bg-surface p-2',
              s.turn === i && !s.roundOver && 'ring-2',
              s.turn === i && !s.roundOver && PLAYER_RING[i],
            )}
          >
            <span className="size-10 shrink-0 overflow-hidden rounded-full">
              <FaceView face={s.pieces[i]!} dishes={dishes} locale={locale} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{p.name}</span>
              <span className="flex gap-1">
                {Array.from({ length: ROUNDS_TO_WIN }, (_, k) => (
                  <span
                    key={k}
                    className={cn(
                      'size-2.5 rounded-full',
                      k < s.wins[i]! ? PLAYER_BG[i] : 'bg-surface-elevated',
                    )}
                  />
                ))}
              </span>
            </span>
          </div>
        ))}
      </div>
      <HostSays
        name={hostName}
        mood={
          s.roundOver
            ? roundWinner === null
              ? 'think'
              : s.vsHost && roundWinner === 1
                ? 'cheer'
                : 'wow'
            : hostTurn
              ? 'think'
              : 'happy'
        }
      >
        {s.roundOver
          ? roundWinner === null
            ? t('duel.draw')
            : t('duel.roundTo', { name: players[roundWinner]?.name ?? '' })
          : s.vsHost
            ? hostTurn
              ? t('duel.hostThinking')
              : taunt
            : t('duel.round', {
                n: formatNumber(s.round, locale),
                name: players[s.turn]?.name ?? '',
              })}
      </HostSays>
      <div className="mx-auto grid aspect-square max-w-sm grid-cols-3 gap-2">
        {s.board.map((v, i) => (
          <button
            key={i}
            type="button"
            disabled={!canPlay || v !== null}
            aria-label={t('duel.cell', { n: formatNumber(i + 1, locale) })}
            onClick={() => dispatch({ type: 'place', cell: i }, me ?? s.turn)}
            className={cn(
              'overflow-hidden rounded-card border-2 border-line bg-surface p-1.5 shadow-soft enabled:active:scale-95',
              s.line?.includes(i) && 'border-success bg-success/15',
            )}
          >
            {v !== null ? (
              <span className="game-pop block size-full overflow-hidden rounded-full">
                <FaceView face={s.pieces[v]!} dishes={dishes} locale={locale} />
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
