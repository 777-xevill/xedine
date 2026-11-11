'use client';

import { Triangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { wheelAngle, type WheelState } from '@/modules/games/wheel';
import { HostSays } from './mascot';
import { PLAYER_BG, useLater, type GameProps } from './parts';

const SLICE_FILL = [
  'fill-pink-bright',
  'fill-cyan-bright',
  'fill-success-bright',
  'fill-warning-bright',
];
const SPIN_MS = 4200;
const R = 100;

interface Topic {
  q: string;
  r: string;
}

/** The point on the wheel `deg` degrees clockwise from the top, `radius` from the middle. */
function at(deg: number, radius: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [R + radius * Math.sin(a), R - radius * Math.cos(a)];
}

/** Spin the Wheel (ADR 0047): a wheel with a slice for each person decides something for fun. */
export function WheelView(props: GameProps<WheelState>) {
  const { state: s, dispatch, players, hostName, onExit } = props;
  const t = useTranslations('games');
  const topics = Object.values(t.raw('wheel.topics') as Record<string, Topic>);
  // Which spin the result has been shown for: the answer waits until the wheel has stopped turning.
  const [shown, setShown] = useState(s.spins);
  const spinning = s.result !== null && shown !== s.spins;
  useLater(spinning, SPIN_MS + 150, s.spins, () => setShown(s.spins));

  const n = s.players;
  const slice = 360 / n;
  const angle = wheelAngle(s.spins, s.result, n);
  const winner = !spinning && s.result !== null ? players[s.result] : null;
  const topic = topics[s.topic] ?? { q: '', r: '' };

  return (
    <div className="space-y-4">
      <fieldset disabled={spinning}>
        <legend className="mb-2 text-sm font-semibold">{t('wheel.decide')}</legend>
        <div className="flex flex-wrap gap-2">
          {topics.map((tp, i) => (
            <button
              key={i}
              type="button"
              onClick={() => dispatch({ type: 'topic', option: i })}
              className={cn(
                'rounded-full border-2 px-3 py-1.5 text-sm font-semibold transition disabled:opacity-60',
                s.topic === i ? 'border-purple bg-purple/10' : 'border-line bg-surface',
              )}
            >
              {tp.q}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="relative mx-auto aspect-square w-full max-w-72">
        <Triangle
          aria-hidden
          className="absolute start-1/2 -top-1 z-10 size-8 -translate-x-1/2 rotate-180 fill-foreground text-foreground drop-shadow"
        />
        <div
          className="size-full rounded-full shadow-soft"
          style={{
            transform: `rotate(${angle}deg)`,
            transition:
              s.spins > 0 ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.7, 0.1, 1)` : 'none',
          }}
        >
          <svg
            viewBox="0 0 200 200"
            role="img"
            aria-label={t('wheel.label', { names: players.map((p) => p.name).join(', ') })}
            className="size-full"
          >
            {players.map((p, i) => {
              const [x0, y0] = at(i * slice, R - 2);
              const [x1, y1] = at((i + 1) * slice, R - 2);
              const mid = (i + 0.5) * slice;
              const [tx, ty] = at(mid, R * 0.62);
              return (
                <g key={p.id}>
                  <path
                    d={`M ${R} ${R} L ${x0} ${y0} A ${R - 2} ${R - 2} 0 0 1 ${x1} ${y1} Z`}
                    className={cn(SLICE_FILL[i], 'stroke-surface')}
                    strokeWidth={2}
                  />
                  <text
                    x={tx}
                    y={ty}
                    transform={`rotate(${mid} ${tx} ${ty})`}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-on-action text-[13px] font-extrabold"
                  >
                    {p.name.length > 9 ? `${p.name.slice(0, 8)}…` : p.name}
                  </text>
                </g>
              );
            })}
            <circle cx={R} cy={R} r={9} className="fill-surface stroke-line" strokeWidth={2} />
          </svg>
        </div>
      </div>
      <HostSays name={hostName} mood={winner ? 'cheer' : spinning ? 'wow' : 'happy'}>
        {winner ? (
          <span className="flex items-center gap-2 text-base font-bold">
            <span
              aria-hidden
              className={cn('size-3 shrink-0 rounded-full', PLAYER_BG[s.result ?? 0])}
            />
            {topic.r.replace('{name}', winner.name)}
          </span>
        ) : spinning ? (
          t('wheel.spinning')
        ) : (
          t('wheel.fun')
        )}
      </HostSays>
      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" disabled={spinning} onClick={() => dispatch({ type: 'spin' }, 0)}>
          {s.spins === 0 ? t('wheel.spin') : t('wheel.again')}
        </Button>
        <Button size="lg" variant="secondary" onClick={onExit}>
          {t('otherGames')}
        </Button>
      </div>
    </div>
  );
}
