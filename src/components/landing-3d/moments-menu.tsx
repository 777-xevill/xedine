'use client';

import { ListOrdered, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { memo, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_LOCALE, formatNumber, isLocale, type Locale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { BEATS } from './story';

type Props = {
  /** The moment on screen now (marked in the list). */
  active: number;
  /** Go straight to moment b. */
  onPick: (b: number) => void;
};

/**
 * "Moments" next to "Skip to every feature" (the founder, 2026-11-18): the day's moments as a list, and a tap on
 * one goes straight there. The list opens over everything (in a portal: the button sits in the sticky view,
 * under the moment's card), and closes with a tap outside, Escape or a pick.
 */
export const MomentsMenu = memo(function MomentsMenu({ active, onPick }: Props) {
  const t = useTranslations('landing3d.day');
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    // The moment on screen now, in view in the list.
    panel.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t('moments.button')}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'xedine-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold',
          open && 'border-[var(--brand-yellow)]',
        )}
      >
        <ListOrdered aria-hidden className="size-3.5" />
        <span className="hidden sm:inline">{t('moments.button')}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label={t('moments.title')}
            className="xedine-chip fixed top-14 right-3 left-3 z-50 flex max-h-[min(70dvh,34rem)] flex-col rounded-3xl p-2 sm:left-auto sm:w-80"
          >
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <p className="text-sm font-bold">{t('moments.title')}</p>
              <button
                type="button"
                aria-label={t('moments.close')}
                onClick={() => setOpen(false)}
                className="grid size-7 place-items-center rounded-full hover:bg-[color-mix(in_srgb,var(--brand-silver)_10%,transparent)]"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <ol className="overflow-y-auto overscroll-contain">
              {BEATS.map((beat, b) => (
                <li key={beat.id}>
                  <button
                    type="button"
                    aria-current={b === active}
                    onClick={() => {
                      setOpen(false);
                      onPick(b);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--brand-silver)_8%,transparent)]',
                      b === active && 'bg-[color-mix(in_srgb,var(--brand-yellow)_14%,transparent)]',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums',
                        b === active
                          ? 'bg-[var(--brand-yellow)] text-[var(--brand-grey)]'
                          : 'border border-[color-mix(in_srgb,var(--brand-silver)_22%,transparent)]',
                      )}
                    >
                      {formatNumber(b + 1, locale)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {t(`beats.${beat.id}.title`)}
                      </span>
                      <span className="block truncate text-xs text-[color:var(--text-muted)]">
                        {t(`beats.${beat.id}.place`)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>,
          document.body,
        )}
    </>
  );
});
