'use client';

import { ArrowRight, ChevronDown, SendHorizontal, Sparkles } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  type FormEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CountryPin } from './city';
import { FEATURE_GROUPS, FEATURES, type FeatureId } from './features';
import { PricingSection } from './pricing-section';
import { MomentsMenu } from './moments-menu';
import { BEAT_SCROLL_VH, BEATS, cardAt, momentP, pToScroll, scrollToP, STORY_VH } from './story';
import { type DemoCurrency } from './story-ledger';
import { useAnswers, useCityText, useScreenText } from './story-text';

// Memoised (like the cards and lists below): the moment's card changing must not re-render the whole 3D scene,
// which froze a slow phone for ~0.2 s at each change (the founder, 2026-11-18).
const DayStage = memo(dynamic(() => import('./day-stage'), { ssr: false }));
// The 3D code starts downloading as soon as this page's script runs, not after the page has hydrated.
if (typeof window !== 'undefined') void import('./day-stage');

type Props = {
  /** The language switch (a server component, passed in by the page). */
  corner?: ReactNode;
  /** After the A–Z list: the site's footer (the privacy and terms links) when this is the home page. */
  footer?: ReactNode;
  /** The first view as a picture, shown before the 3D is ready (and instead of it without WebGL). */
  backdrop?: ReactNode;
  currency: DemoCurrency;
  taxName: string;
  home: CountryPin;
  countries: CountryPin[];
};

let webgl: boolean | undefined;
/** Can this browser draw 3D? Asked once; the server says "not yet" (null) so the first paint matches. */
function webglOk() {
  if (webgl === undefined) {
    try {
      const c = document.createElement('canvas');
      webgl = Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}
const noSubscribe = () => () => {};

/** The first beat each feature appears in (the A–Z list links back to it). */
function firstBeat(id: FeatureId) {
  return BEATS.find((b) => b.features.includes(id))?.id ?? BEATS[0]!.id;
}

/**
 * One day in a café with Xedine (ADR 0064, approval 3): the 3D café stays on screen while the story's
 * moments scroll over it. Every feature Xedine has appears in at least one moment (features.test.ts), and the
 * A–Z list after the story names them all.
 */
export function DayStory({ corner, footer, backdrop, currency, taxName, home, countries }: Props) {
  const t = useTranslations('landing3d.day');
  const tc = useTranslations('common');
  const ctx = useMemo(() => ({ currency, taxName }), [currency, taxName]);
  const text = useScreenText(ctx);
  const cityText = useCityText(ctx);
  const story = useRef<HTMLDivElement>(null);
  const targetRef = useRef(0);
  const still = useRef(false);
  const easedRef = useRef(0);
  const [active, setActive] = useState(0);
  const [showCity, setShowCity] = useState(false);
  const [inStory, setInStory] = useState(true);
  const can3d = useSyncExternalStore(noSubscribe, webglOk, () => null);
  const bar = useRef<HTMLDivElement>(null);
  // The loading chip shows until the street is drawn; the other rooms arrive while the visitor reads.
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  // The first view's picture matches the 3D exactly, so it needs no loading chip, unless someone scrolls
  // before the 3D is in (the picture cannot move with them).
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    still.current = query.matches;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = story.current;
        if (!el) return;
        // A long way between two rooms has more scroll (story.ts BEAT_SCROLL_VH), so it never rushes.
        const scrolledVh = (-el.getBoundingClientRect().top / window.innerHeight) * 100;
        const p = Math.min(BEATS.length - 0.001, scrollToP(scrolledVh));
        // Reduced motion: no flight between moments; each one is shown at its settled view.
        targetRef.current = still.current ? Math.floor(p) + 0.62 : p;
        // The card changes halfway between two moments, as the next room comes into view.
        setActive(cardAt(p));
        if (p > 0.05) setMoved(true);
        setShowCity(p > 14.6 && p < 17.6);
        // The moment's card shows while the 3D day fills the screen, not over the A–Z list after it.
        setInStory(el.getBoundingClientRect().bottom > window.innerHeight * 0.55);
        if (bar.current) bar.current.style.transform = `scaleX(${p / BEATS.length})`;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // The moment picker: straight to the moment, a cut rather than a flight through every room on the way.
  const goToMoment = useCallback((b: number) => {
    const el = story.current;
    if (!el) return;
    const p = momentP(b);
    easedRef.current = still.current ? Math.floor(p) + 0.62 : p;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + (pToScroll(p) / 100) * window.innerHeight, behavior: 'instant' });
  }, []);

  const city = useMemo(
    () => ({
      branches: cityText.branches,
      waiting: cityText.waiting,
      peers: cityText.peers,
      home,
      countries,
    }),
    [cityText, home, countries],
  );

  return (
    <div className="landing-3d-day relative">
      {/* The progress of the day, and a way past it. */}
      <div className="fixed inset-x-0 top-0 z-40 h-1 bg-[color-mix(in_srgb,var(--brand-silver)_18%,transparent)]">
        <div
          ref={bar}
          className="h-full origin-left bg-[var(--brand-yellow)]"
          style={{ transform: 'scaleX(0)' }}
        />
      </div>
      <div ref={story} className="relative" style={{ height: `${STORY_VH}vh` }}>
        <div className="sticky top-0 h-dvh w-full overflow-hidden">
          {/* The first view as a picture, there at once; the live 3D fades in over it when ready. */}
          <div className="xedine-stage-bg absolute inset-0">{backdrop}</div>
          {can3d && (
            <div
              className={cn(
                'absolute inset-0 transition-opacity motion-reduce:transition-none',
                // A slow fade over the matching picture; a quick one if the visitor already scrolled away
                // from it (the picture shows the first view, the 3D where they are now).
                moved ? 'duration-150' : 'duration-700',
                ready ? 'opacity-100' : 'opacity-0',
              )}
            >
              <DayStage
                targetRef={targetRef}
                easedRef={easedRef}
                text={text}
                showCity={showCity}
                onReady={onReady}
                city={city}
              />
            </div>
          )}
          {can3d && !ready && moved && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
              <p className="xedine-chip rounded-full px-4 py-1.5 text-xs">{t('intro.loading')}</p>
            </div>
          )}
          {corner && <div className="absolute top-3 left-3 z-30">{corner}</div>}
          <div className="absolute top-4 right-3 z-30 flex items-center gap-1 sm:right-4 sm:gap-2">
            {/* Someone who already has an account signs in from here, without scrolling the day. */}
            <Link
              href="/sign-in"
              className="xedine-chip rounded-full px-2.5 py-1.5 sm:px-3 text-xs font-semibold"
            >
              {tc('signIn')}
            </Link>
            <Link
              href="/sign-up"
              className="hidden rounded-full bg-[var(--brand-yellow)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-grey)] sm:inline-flex"
            >
              {tc('signUp')}
            </Link>
            <MomentsMenu active={active} onPick={goToMoment} />
            <a
              href="#everything"
              className="xedine-chip rounded-full px-2.5 py-1.5 sm:px-3 text-xs font-semibold"
            >
              {/* Short on a phone, so the row stays clear of the language switch. */}
              <span className="sm:hidden">{t('intro.skipShort')}</span>
              <span className="hidden sm:inline">{t('intro.skip')}</span>
            </a>
          </div>
        </div>
        {/* The scroll itself: one invisible stretch per moment, with its words for search and screen readers.
            It lies over the sticky view, so taps go through it to the buttons and the language switch. */}
        <div className="pointer-events-none absolute inset-x-0 top-0">
          {BEATS.map((beat, b) => (
            <section
              key={beat.id}
              id={`beat-${beat.id}`}
              className="relative"
              style={{ height: `${BEAT_SCROLL_VH[b]}vh` }}
            >
              <div className="sr-only">
                <h2>{t(`beats.${beat.id}.title`)}</h2>
                <p>{t(`beats.${beat.id}.body`)}</p>
              </div>
            </section>
          ))}
        </div>
      </div>
      {/* The moment's card: one layer over the day, at the bottom on a phone, on the left on a wide screen. */}
      <div
        className={cn(
          'pointer-events-none fixed inset-x-3 bottom-3 z-20 transition-opacity duration-300 sm:inset-x-auto sm:top-[16vh] sm:bottom-auto sm:left-8',
          inStory ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="relative w-full sm:w-[28rem]">
          {BEATS.map((beat, i) => (
            <div
              key={beat.id}
              aria-hidden={active !== i}
              className={cn(
                'transition-[opacity,transform] duration-500',
                i === 0 ? 'relative' : 'absolute inset-x-0 bottom-0 sm:top-0 sm:bottom-auto',
                active === i && inStory
                  ? 'pointer-events-auto translate-y-0 opacity-100'
                  : 'pointer-events-none translate-y-2 opacity-0',
                i === 0 && active !== 0 && 'invisible',
              )}
            >
              {beat.id === 'ask' ? (
                <AskPanel ctx={ctx} />
              ) : beat.id === 'start' ? (
                <StartCard />
              ) : (
                <BeatCard id={beat.id} n={i + 1} features={beat.features} />
              )}
            </div>
          ))}
        </div>
      </div>
      {active === 0 && (
        <p className="xedine-chip pointer-events-none fixed bottom-6 left-1/2 z-20 hidden -translate-x-1/2 items-center gap-1 rounded-full px-3 py-1 text-xs sm:flex">
          {t('intro.scroll')} <ChevronDown aria-hidden className="size-3.5" />
        </p>
      )}
      <PricingSection />
      <Everything />
      {footer}
    </div>
  );
}

const BeatCard = memo(function BeatCard({
  id,
  n,
  features,
}: {
  id: string;
  n: number;
  features: FeatureId[];
}) {
  const t = useTranslations('landing3d.day');
  return (
    <article className="xedine-chip w-full rounded-3xl p-4 sm:p-6">
      <p className="flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span className="rounded-full bg-[var(--brand-yellow)] px-2.5 py-0.5 text-[var(--brand-grey)]">
          {t(`beats.${id}.time`)}
        </span>
        <span className="text-[color:var(--text-muted)]">{t(`beats.${id}.place`)}</span>
        <span className="ml-auto hidden text-[color:var(--text-muted)] sm:inline">
          {t('intro.chapter', { n, total: BEATS.length })}
        </span>
      </p>
      <h2 className="mt-2 text-lg leading-snug font-bold tracking-[-0.02em] text-balance sm:mt-3 sm:text-2xl">
        {t(`beats.${id}.title`)}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed sm:mt-2 sm:text-[0.95rem]">
        {t(`beats.${id}.body`)}
      </p>
      <ul className="mt-3 hidden flex-wrap gap-1.5 sm:flex">
        {features.map((f) => (
          <li
            key={f}
            className="rounded-full border border-[color-mix(in_srgb,var(--brand-silver)_30%,transparent)] px-2.5 py-0.5 text-[11px]"
          >
            {t(`features.${f}.name`)}
          </li>
        ))}
      </ul>
    </article>
  );
});

type Msg = { from: 'you' | 'xedine'; text: string };
const QUESTIONS = ['money', 'waste', 'buy', 'profit', 'week'] as const;

/** The ending: ask Xedine like ChatGPT. Ready questions answer from the café's day; anything else invites you in. */
const AskPanel = memo(function AskPanel({
  ctx,
}: {
  ctx: { currency: DemoCurrency; taxName: string };
}) {
  const t = useTranslations('landing3d.day');
  const answers = useAnswers(ctx);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, typing]);

  const ask = (question: string, answer: string) => {
    if (typing) return;
    setMsgs((m) => [...m, { from: 'you', text: question }]);
    setTyping(true);
    timer.current = window.setTimeout(() => {
      setTyping(false);
      setMsgs((m) => [...m, { from: 'xedine', text: answer }]);
    }, 900);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q) return;
    setDraft('');
    ask(q, t('ask.yourOwn'));
  };

  return (
    <article className="xedine-chip flex max-h-[62vh] w-full flex-col rounded-3xl p-4 sm:max-h-[70vh] sm:p-5">
      <p className="flex items-center gap-2 text-xs font-semibold">
        <span className="rounded-full bg-[var(--brand-yellow)] px-2.5 py-0.5 text-[var(--brand-grey)]">
          {t('beats.ask.time')}
        </span>
        <Sparkles aria-hidden className="size-3.5" />
      </p>
      <h2 className="mt-2 text-xl font-bold tracking-[-0.02em]">{t('ask.title')}</h2>
      <p className="mt-1 text-sm text-[color:var(--text-muted)]">{t('beats.ask.body')}</p>
      <div
        ref={list}
        className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
        aria-live="polite"
      >
        {msgs.map((m, i) => (
          <p
            key={i}
            className={cn(
              'max-w-[92%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line',
              m.from === 'you'
                ? 'ml-auto bg-[var(--brand-yellow)] text-[var(--brand-grey)]'
                : 'bg-[color-mix(in_srgb,var(--brand-silver)_14%,transparent)]',
            )}
          >
            {m.text}
          </p>
        ))}
        {typing && (
          <p className="w-fit rounded-2xl bg-[color-mix(in_srgb,var(--brand-silver)_14%,transparent)] px-3 py-2 text-sm">
            {t('ask.typing')} <span className="inline-block animate-pulse">{'•••'}</span>
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => ask(t(`ask.q.${q}`), answers[q])}
            className="rounded-full border border-[color-mix(in_srgb,var(--brand-silver)_35%,transparent)] px-3 py-1.5 text-xs font-semibold hover:border-[var(--brand-yellow)]"
          >
            {t(`ask.q.${q}`)}
          </button>
        ))}
      </div>
      <form onSubmit={onSubmit} className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('ask.placeholder')}
          aria-label={t('ask.placeholder')}
          className="min-w-0 flex-1 rounded-full border border-[color-mix(in_srgb,var(--brand-silver)_30%,transparent)] bg-transparent px-4 py-2 text-sm outline-none focus:border-[var(--brand-yellow)]"
        />
        <button
          type="submit"
          className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'gap-1.5')}
        >
          <SendHorizontal aria-hidden className="size-4" />
          {t('ask.send')}
        </button>
      </form>
    </article>
  );
});

const StartCard = memo(function StartCard() {
  const t = useTranslations('landing3d.day');
  return (
    <article className="xedine-chip w-full rounded-3xl p-5 text-center sm:p-8">
      <h2 className="text-2xl font-bold tracking-[-0.02em] text-balance">{t('start.title')}</h2>
      <p className="mt-2 text-sm">{t('beats.start.body')}</p>
      <p className="mt-1 text-xs text-[color:var(--text-muted)]">{t('start.body')}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link
          href="/sign-up"
          className={cn(buttonVariants({ variant: 'primary', size: 'lg' }), 'gap-2')}
        >
          {t('start.signUp')}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
        <Link href="/sign-in" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
          {t('start.signIn')}
        </Link>
      </div>
      <p className="mt-3 text-xs text-[color:var(--text-muted)]">{t('start.ways')}</p>
    </article>
  );
});

/** Everything Xedine does, A to Z, each with a link back to where the story showed it. */
const Everything = memo(function Everything() {
  const t = useTranslations('landing3d.day');
  return (
    <section id="everything" className="relative bg-background px-4 py-16 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-3xl font-bold tracking-[-0.02em] text-balance">{t('az.title')}</h2>
        <p className="mt-2 text-[color:var(--text-muted)]">{t('az.body')}</p>
        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          {FEATURE_GROUPS.map((g) => (
            <div key={g}>
              <h3 className="text-sm font-bold tracking-wide text-[var(--brand-yellow)] uppercase">
                {t(`groups.${g}`)}
              </h3>
              <ul className="mt-3 divide-y divide-[color-mix(in_srgb,var(--brand-silver)_14%,transparent)]">
                {FEATURES.filter((f) => f.group === g).map((f) => (
                  <li key={f.id} className="flex items-start justify-between gap-4 py-3">
                    <div>
                      <p className="font-semibold">{t(`features.${f.id}.name`)}</p>
                      <p className="text-sm text-[color:var(--text-muted)]">
                        {t(`features.${f.id}.line`)}
                      </p>
                    </div>
                    <a
                      href={`#beat-${firstBeat(f.id)}`}
                      className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--brand-silver)_30%,transparent)] px-3 py-1 text-xs font-semibold hover:border-[var(--brand-yellow)]"
                    >
                      {t('az.seeIt')}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
});
