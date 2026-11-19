'use client';

import { ArrowRight, CheckCircle2, Circle, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { BrandMark } from '@/components/brand-mark';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export type WelcomeStep = { key: string; title: string; body: string; href: string | null };
export type WelcomeTip = WelcomeStep & { done: boolean };

/** Browser storage can be missing (private window, blocked site data): every read and write is guarded. */
function read(store: 'local' | 'session', key: string): string | null {
  try {
    return (store === 'local' ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
const noSubscribe = () => () => {};

function write(store: 'local' | 'session', key: string) {
  try {
    (store === 'local' ? localStorage : sessionStorage).setItem(key, '1');
  } catch {
    /* nothing to keep; the message simply shows again next time */
  }
}

/**
 * First steps on the home page, the way a new app greets someone on its first run.
 * - Setup not finished (owner): a welcome message opens with the next steps and "Start setup"; it comes
 *   back once per browser session until every required step is ticked.
 * - Setup finished (or someone invited to the team): a "You're ready" message opens once, then a "Tips for
 *   getting started" card stays on the home page, each tip ticked from the data, until it is hidden.
 * The ticks and the percentage come from metric_setup_health on the server; nothing here counts.
 */
export function WelcomeGuide({
  orgId,
  mode,
  name,
  restaurant,
  health,
  left,
  steps,
  tips,
  setupHref,
}: {
  orgId: string;
  mode: 'setup' | 'ready';
  name: string;
  restaurant: string;
  health: number;
  left: number;
  steps: WelcomeStep[];
  tips: WelcomeTip[];
  setupHref: string;
}) {
  const t = useTranslations('welcome');
  const tc = useTranslations('common');
  const popKey = `xedine:welcome:${orgId}:${mode}`;
  const tipsKey = `xedine:tips:${orgId}`;
  const popStore = mode === 'setup' ? 'session' : 'local';
  // Storage exists only in the browser: on the server both count as "seen", so nothing flashes.
  const popSeen = React.useSyncExternalStore(
    noSubscribe,
    () => read(popStore, popKey) !== null,
    () => true,
  );
  const tipsHidden = React.useSyncExternalStore(
    noSubscribe,
    () => read('local', tipsKey) !== null,
    () => true,
  );
  const [closed, setClosed] = React.useState(false);
  const [hid, setHid] = React.useState(false);
  const open = !popSeen && !closed;
  const showTips = mode === 'ready' && !tipsHidden && !hid;

  const close = () => {
    write(popStore, popKey);
    setClosed(true);
  };
  const hideTips = () => {
    write('local', tipsKey);
    setHid(true);
  };
  const tipsDone = tips.filter((x) => x.done).length;

  return (
    <>
      {open ? (
        <Dialog
          title={mode === 'setup' ? t('setupTitle', { name }) : t('readyTitle')}
          onClose={close}
          closeLabel={t('close')}
          size="md"
          testId="welcome-dialog"
          footer={
            mode === 'setup' ? (
              <>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-input border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-hover"
                >
                  {t('later')}
                </button>
                <Link
                  href={setupHref}
                  onClick={close}
                  className="inline-flex items-center gap-2 rounded-input bg-warning-bright px-4 py-2 text-sm font-semibold text-on-action motion-safe:transition-transform motion-safe:active:scale-95"
                >
                  {t('startSetup')}
                  <ArrowRight aria-hidden className="size-4 rtl:rotate-180" />
                </Link>
              </>
            ) : (
              <button
                type="button"
                onClick={close}
                className="inline-flex items-center gap-2 rounded-input bg-warning-bright px-4 py-2 text-sm font-semibold text-on-action motion-safe:transition-transform motion-safe:active:scale-95"
              >
                {t('letsGo')}
              </button>
            )
          }
        >
          <div className="flex items-center gap-3">
            <BrandMark name={tc('appName')} size="lg" />
          </div>
          {mode === 'setup' ? (
            <>
              <p className="mt-4 text-[0.9375rem] text-secondary">
                {t('setupBody', { restaurant, left })}
              </p>
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-secondary">
                  <span>{t('progress')}</span>
                  <span className="font-semibold tabular-nums text-foreground">{`${health}%`}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-elevated">
                  <div
                    className="h-full rounded-full bg-warning-bright motion-safe:transition-[width] motion-safe:duration-700"
                    style={{ width: `${Math.max(health, 3)}%` }}
                  />
                </div>
              </div>
              {steps.length > 0 ? (
                <>
                  <p className="mt-5 text-sm font-semibold">{t('firstSteps')}</p>
                  <ol className="mt-2 space-y-2">
                    {steps.map((s, i) => (
                      <li
                        key={s.key}
                        className="flex gap-3 rounded-2xl border border-edge bg-surface-elevated/40 p-3"
                      >
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-warning-bright text-xs font-bold text-on-action">
                          {i + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{s.title}</span>
                          <span className="block text-xs text-secondary">{s.body}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
              <p className="mt-4 text-xs text-secondary">{t('setupHint')}</p>
            </>
          ) : (
            <>
              <p className="mt-4 text-[0.9375rem] text-secondary">
                {t('readyBody', { restaurant })}
              </p>
              <TipList tips={tips} className="mt-4" />
              <p className="mt-4 text-xs text-secondary">{t('helpLine')}</p>
            </>
          )}
        </Dialog>
      ) : null}

      {showTips ? (
        <section
          aria-labelledby="tips-heading"
          className="card-glass relative overflow-hidden rounded-card border p-5 sm:p-6"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-brand-yellow">
                <Sparkles aria-hidden className="size-4" />
                {t('tipsKicker')}
              </p>
              <h2 id="tips-heading" className="mt-1 text-base font-semibold">
                {t('tipsTitle')}
              </h2>
              <p className="mt-0.5 text-xs text-secondary">
                {t('tipsProgress', { done: tipsDone, total: tips.length })}
              </p>
            </div>
            <button
              type="button"
              onClick={hideTips}
              aria-label={t('hideTips')}
              title={t('hideTips')}
              className="glass-tile inline-flex size-9 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-surface-hover hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
          <TipList tips={tips} className="mt-4 sm:grid-cols-2" />
          <p className="mt-4 text-xs text-secondary">{t('helpLine')}</p>
        </section>
      ) : null}
    </>
  );
}

function TipList({ tips, className }: { tips: WelcomeTip[]; className?: string }) {
  return (
    <ol className={cn('grid gap-2', className)}>
      {tips.map((tip, i) => {
        const inner = (
          <>
            {tip.done ? (
              <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-yellow" />
            ) : (
              <Circle aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
            )}
            <span className="min-w-0">
              <span
                className={cn(
                  'block text-sm font-semibold',
                  tip.done && 'text-secondary line-through decoration-1',
                )}
              >
                {`${i + 1}. ${tip.title}`}
              </span>
              <span className="block text-xs text-secondary">{tip.body}</span>
            </span>
          </>
        );
        const box =
          'flex h-full gap-3 rounded-2xl border border-edge bg-surface-elevated/40 p-3 transition duration-300';
        return (
          <li key={tip.key}>
            {tip.href ? (
              <Link
                href={tip.href}
                className={cn(box, 'hover:border-brand-yellow/40 hover:bg-surface-elevated/80')}
              >
                {inner}
              </Link>
            ) : (
              <div className={box}>{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
