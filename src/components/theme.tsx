'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Light / dark (ADR 0034). Light is the default. A person's choice is kept in this browser
 * (localStorage) and shown by `data-theme="dark"` on <html>, which remaps the colour tokens in
 * globals.css. Only the dashboard layout mounts these, so the sign-in page, the till and the kitchen
 * screen stay light.
 */
const KEY = 'xedine-theme';
const EVENT = 'xedine-theme-change';
type Theme = 'light' | 'dark';

/** Runs before the page paints, so a dark choice never flashes white first. */
const INIT = `try{if(localStorage.getItem('${KEY}')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: INIT }} />;
}

const current = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

function show(theme: Theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  window.dispatchEvent(new Event(EVENT));
}

function saved(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Applies the saved choice while the dashboard is open, and puts light back when it is left. */
export function ThemeApplier() {
  React.useEffect(() => {
    show(saved());
    return () => show('light');
  }, []);
  return null;
}

const subscribe = (notify: () => void) => {
  window.addEventListener(EVENT, notify);
  return () => window.removeEventListener(EVENT, notify);
};

/** Two buttons in a pill, like the language switch: Light | Dark. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const t = useTranslations('common');
  const theme = React.useSyncExternalStore(subscribe, current, () => 'light' as Theme);
  const choose = (next: Theme) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the choice lasts until the page is closed.
    }
    show(next);
  };
  const option = (value: Theme, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={theme === value}
      onClick={() => choose(value)}
      className={cn(
        'inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold transition',
        theme === value
          ? 'bg-surface text-foreground shadow-soft'
          : 'text-secondary hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label={t('theme')}
      className={cn('glass-tile flex items-center gap-0.5 rounded-full p-0.5', className)}
    >
      {option('light', t('themeLight'), <Sun aria-hidden className="size-3.5" />)}
      {option('dark', t('themeDark'), <Moon aria-hidden className="size-3.5" />)}
    </div>
  );
}
