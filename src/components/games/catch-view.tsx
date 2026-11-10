'use client';

import { Flame, Heart, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import {
  CATCH_LIVES,
  CATCH_POINTS,
  CATCH_SECONDS,
  catchOver,
  type CatchState,
} from '@/modules/games/catch';
import type { GameDish } from '@/modules/games/catalog';
import type { Face } from '@/modules/games/memory';
import { HostSays, Mascot, type Mood } from './mascot';
import { FaceView, PlayerChips, Results, useLine, type GameProps } from './parts';

/** Chef Catch (ADR 0046): move the host character to catch the dishes; dodge the burnt ones. */
export function CatchView(props: GameProps<CatchState>) {
  const { state: s, dispatch, me, players, dishes, locale, hostName } = props;
  const t = useTranslations('games');
  const [playing, setPlaying] = useState(false);
  const endLine = useLine(
    'lines.end',
    s.scores.reduce<number>((a, v) => a + (v ?? 0), 0),
  );

  if (catchOver(s)) {
    const scores = s.scores.map((v) => v ?? 0);
    const best = Math.max(...scores);
    const winners = players.filter((_, i) => scores[i] === best);
    return (
      <Results
        {...props}
        scores={scores}
        line={
          s.players === 1
            ? t('catch.soloDone', { score: formatNumber(scores[0]!, locale) })
            : winners.length > 1
              ? t('tie')
              : `${t('wins', { name: winners[0]?.name ?? '' })} ${endLine}`
        }
      />
    );
  }

  const who = s.local ? s.turn : (me ?? 0);
  const done = s.scores[who] !== null;
  if (playing && !done) {
    return (
      <CatchRound
        dishes={dishes}
        locale={locale}
        onDone={(points) => {
          setPlaying(false);
          dispatch({ type: 'score', points }, who);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {s.players > 1 ? <PlayerChips players={players} scores={s.scores} locale={locale} /> : null}
      {done ? (
        <HostSays name={hostName} mood="think">
          {t('catch.waitOthers')}
        </HostSays>
      ) : (
        <>
          <HostSays name={hostName} mood="wow">
            {s.players > 1 && s.local
              ? t('catch.turn', { name: players[who]?.name ?? '' })
              : t('catch.rules', {
                  seconds: formatNumber(CATCH_SECONDS, locale),
                  lives: formatNumber(CATCH_LIVES, locale),
                })}
          </HostSays>
          <ul className="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
            <li className="rounded-card border border-line bg-surface p-2">
              <span className="mx-auto mb-1 block size-8 overflow-hidden rounded-full bg-surface-elevated" />
              {t('catch.dish', { n: formatNumber(CATCH_POINTS.dish, locale) })}
            </li>
            <li className="rounded-card border border-line bg-surface p-2">
              <Star aria-hidden className="mx-auto mb-1 size-8 fill-warning-bright text-warning" />
              {t('catch.gold', { n: formatNumber(CATCH_POINTS.gold, locale) })}
            </li>
            <li className="rounded-card border border-line bg-surface p-2">
              <Flame aria-hidden className="mx-auto mb-1 size-8 fill-danger-bright text-danger" />
              {t('catch.burnt')}
            </li>
          </ul>
          <Button size="lg" className="w-full" onClick={() => setPlaying(true)}>
            {t('start')}
          </Button>
        </>
      )}
    </div>
  );
}

interface Drop {
  id: number;
  x: number;
  y: number;
  speed: number;
  kind: 'dish' | 'gold' | 'bad';
  face: Face;
}

interface Pop {
  id: number;
  x: number;
  y: number;
  text: string;
  good: boolean;
  until: number;
}

const PLATE_Y = 0.86;
const REACH = 0.13;

function CatchRound({
  dishes,
  locale,
  onDone,
}: {
  dishes: GameDish[];
  locale: Locale;
  onDone: (points: number) => void;
}) {
  const t = useTranslations('games');
  const area = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  const target = useRef(0.5);
  const [view, setView] = useState<{
    drops: Drop[];
    pops: Pop[];
    x: number;
    score: number;
    lives: number;
    left: number;
    mood: Mood;
  }>({
    drops: [],
    pops: [],
    x: 0.5,
    score: 0,
    lives: CATCH_LIVES,
    left: CATCH_SECONDS,
    mood: 'happy',
  });

  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    const photos = dishes.flatMap((d, i) => (d.photo ? [i] : [])).slice(0, 10);
    const faces: Face[] = photos.length
      ? photos.map((i) => ({ kind: 'dish', i }))
      : Array.from({ length: 6 }, (_, i) => ({ kind: 'icon', i }));
    let drops: Drop[] = [];
    let pops: Pop[] = [];
    let x = 0.5;
    let score = 0;
    let lives = CATCH_LIVES;
    let id = 0;
    let mood: Mood = 'happy';
    let moodUntil = 0;
    const start = performance.now();
    let last = start;
    let nextSpawn = start + 600;
    let raf = 0;
    let finished = false;

    const frame = (nowMs: number) => {
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      const elapsed = (nowMs - start) / 1000;
      // The character glides towards the finger, quickly but not instantly.
      x += (target.current - x) * Math.min(1, dt * 14);
      if (nowMs >= nextSpawn) {
        const r = Math.random();
        const badShare = 0.2 + Math.min(0.15, elapsed * 0.004);
        const kind: Drop['kind'] = r < 0.07 ? 'gold' : r < 0.07 + badShare ? 'bad' : 'dish';
        drops.push({
          id: ++id,
          x: 0.08 + Math.random() * 0.84,
          y: -0.08,
          speed: 0.26 + elapsed * 0.009 + Math.random() * 0.08,
          kind,
          face: faces[Math.floor(Math.random() * faces.length)]!,
        });
        nextSpawn = nowMs + Math.max(330, 900 - elapsed * 14) * (0.7 + Math.random() * 0.6);
      }
      const kept: Drop[] = [];
      for (const d of drops) {
        d.y += d.speed * dt;
        const caught = d.y >= PLATE_Y - 0.05 && d.y <= PLATE_Y + 0.04 && Math.abs(d.x - x) < REACH;
        if (caught) {
          if (d.kind === 'bad') {
            lives -= 1;
            mood = 'sad';
            moodUntil = nowMs + 700;
            pops.push({
              id: d.id,
              x: d.x,
              y: PLATE_Y - 0.1,
              text: '−♥',
              good: false,
              until: nowMs + 700,
            });
            navigator.vibrate?.(80);
          } else {
            const points = d.kind === 'gold' ? CATCH_POINTS.gold : CATCH_POINTS.dish;
            score += points;
            mood = d.kind === 'gold' ? 'wow' : 'cheer';
            moodUntil = nowMs + 450;
            pops.push({
              id: d.id,
              x: d.x,
              y: PLATE_Y - 0.1,
              text: `+${formatNumber(points, locale)}`,
              good: true,
              until: nowMs + 600,
            });
          }
        } else if (d.y < 1.08) kept.push(d);
      }
      drops = kept;
      pops = pops.filter((p) => p.until > nowMs).map((p) => ({ ...p, y: p.y - dt * 0.15 }));
      if (nowMs > moodUntil) mood = 'happy';
      const left = Math.max(0, CATCH_SECONDS - elapsed);
      setView({ drops: [...drops], pops, x, score, lives, left, mood });
      if ((lives <= 0 || left <= 0) && !finished) {
        finished = true;
        setTimeout(() => done.current(score), 900);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [dishes, locale]);

  const move = (clientX: number) => {
    const r = area.current?.getBoundingClientRect();
    if (r && r.width > 0)
      target.current = Math.max(0.06, Math.min(0.94, (clientX - r.left) / r.width));
  };
  const over = view.lives <= 0 || view.left <= 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm font-bold">
        <span className="flex gap-0.5">
          {Array.from({ length: CATCH_LIVES }, (_, i) => (
            <Heart
              key={i}
              aria-hidden
              className={cn(
                'size-5',
                i < view.lives ? 'fill-pink-bright text-pink' : 'text-line-strong',
              )}
            />
          ))}
        </span>
        <span className="text-2xl font-black tabular-nums">{formatNumber(view.score, locale)}</span>
        <span className="tabular-nums">
          {t('catch.secondsLeft', { n: formatNumber(Math.ceil(view.left), locale) })}
        </span>
      </div>
      <div
        ref={area}
        role="application"
        aria-label={t('catch.area')}
        tabIndex={0}
        onPointerDown={(e) => move(e.clientX)}
        onPointerMove={(e) => move(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') target.current = Math.max(0.06, target.current - 0.12);
          if (e.key === 'ArrowRight') target.current = Math.min(0.94, target.current + 0.12);
        }}
        className="relative h-[64dvh] touch-none overflow-hidden rounded-sheet border border-line bg-surface-elevated select-none"
      >
        {view.drops.map((d) => (
          <span
            key={d.id}
            className="absolute size-12 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%` }}
          >
            {d.kind === 'bad' ? (
              <span className="flex size-full items-center justify-center rounded-full bg-foreground/80">
                <Flame aria-hidden className="size-7 fill-danger-bright text-danger" />
              </span>
            ) : d.kind === 'gold' ? (
              <Star
                aria-hidden
                className="size-full fill-warning-bright text-warning drop-shadow"
              />
            ) : (
              <span className="block size-full overflow-hidden rounded-full border-2 border-surface shadow-soft">
                <FaceView face={d.face} dishes={dishes} locale={locale} />
              </span>
            )}
          </span>
        ))}
        {view.pops.map((p) => (
          <span
            key={`p${p.id}`}
            className={cn(
              'absolute -translate-x-1/2 text-xl font-black',
              p.good ? 'text-success' : 'text-danger',
            )}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          >
            {p.text}
          </span>
        ))}
        <span
          className="absolute bottom-0 w-24 -translate-x-1/2"
          style={{ left: `${view.x * 100}%` }}
        >
          <Mascot mood={view.mood} bob={false} className="w-full" />
          <span className="absolute top-[30%] left-1/2 h-2 w-28 -translate-x-1/2 rounded-full bg-white shadow-soft ring-1 ring-line-strong" />
        </span>
        {over ? (
          <span className="game-pop absolute inset-0 flex items-center justify-center text-3xl font-black">
            {view.lives <= 0 ? t('catch.burntOut') : t('catch.timeUp')}
          </span>
        ) : null}
      </div>
      <p className="text-center text-xs text-secondary">{t('catch.how')}</p>
    </div>
  );
}
