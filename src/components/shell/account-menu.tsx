'use client';

import {
  ChevronRight,
  ChevronsUpDown,
  CircleArrowUp,
  CircleHelp,
  FileText,
  Globe,
  Info,
  LogOut,
  Settings,
  Shield,
  Activity,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { setLocaleAction, signOutAction } from '@/modules/tenancy/actions';

const row =
  'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-sm text-foreground transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none';
const icon = 'size-4 shrink-0 text-secondary';
const divider = 'my-1 border-t border-line';

/** Ctrl+Shift+, (⌘⇧, on a Mac) opens Settings from anywhere, like a desktop app. */
function isSettingsShortcut(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'Comma' || e.key === ',');
}

/**
 * The Settings button at the foot of the sidebar: larger than a normal link, with its shortcut, so the
 * owner finds it at a glance. Lit while any settings page is open.
 */
export function SettingsButton({
  href,
  label,
  shortcut,
  alsoActive,
}: {
  href: string;
  label: string;
  shortcut: string;
  alsoActive: string[];
}) {
  const pathname = usePathname();
  const active = [href, ...alsoActive].some((h) => pathname === h || pathname.startsWith(`${h}/`));
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      aria-keyshortcuts="Control+Shift+Comma"
      className={cn(
        'group/set flex min-h-10 items-center gap-2.5 rounded-xl border px-3 text-sm font-semibold shadow-soft transition duration-300 active:scale-[0.98]',
        active
          ? 'border-brand-yellow/60 bg-surface-elevated text-foreground'
          : 'border-edge bg-surface-elevated/70 text-foreground hover:border-brand-yellow/40 hover:bg-surface-hover',
      )}
    >
      <Settings
        aria-hidden
        className="size-[1.125rem] shrink-0 text-brand-yellow transition-transform duration-500 ease-spring group-hover/set:rotate-45"
      />
      <span className="flex-1 truncate">{label}</span>
      <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 font-sans text-[0.6875rem] font-medium text-muted lg:inline">
        {shortcut}
      </kbd>
    </Link>
  );
}

export interface AccountMenuProps {
  email: string;
  name: string;
  initials: string;
  role: string;
  branches: string;
  plan: string | null;
  locale: 'bn' | 'en';
  settingsHref: string | null;
  usageHref: string | null;
  upgradeHref: string | null;
  helpHref: string;
  labels: {
    menu: string;
    settings: string;
    shortcut: string;
    usage: string;
    language: string;
    bangla: string;
    english: string;
    getHelp: string;
    learnMore: string;
    privacy: string;
    terms: string;
    deleteAccount: string;
    upgradePlan: string;
    signOut: string;
  };
}

/**
 * The account button at the foot of the sidebar and the menu it opens above itself (like a desktop app's
 * account menu): email, Settings, Usage, Language, Get help, Learn more, Upgrade plan, Log out. Closes on
 * Escape, an outside click and navigation.
 */
export function AccountMenu(p: AccountMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [seen, setSeen] = useState(pathname);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  if (seen !== pathname) {
    setSeen(pathname);
    setOpen(false);
    setMore(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (p.settingsHref && isSettingsShortcut(e)) {
        e.preventDefault();
        router.push(p.settingsHref);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
        setMore(false);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (open && box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setMore(false);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, p.settingsHref, router]);

  const L = p.labels;
  const lang = (value: 'bn' | 'en', label: string) => (
    <form action={setLocaleAction}>
      <input type="hidden" name="locale" value={value} />
      <button
        type="submit"
        lang={value}
        aria-pressed={p.locale === value}
        className={cn(
          'min-h-7 rounded-full px-2.5 text-xs font-semibold transition',
          p.locale === value
            ? 'bg-surface-hover text-foreground shadow-soft'
            : 'text-secondary hover:text-foreground',
        )}
      >
        {label}
      </button>
    </form>
  );

  return (
    <div ref={box} className="relative">
      {open ? (
        <div
          id="account-menu"
          className="glass-strong absolute inset-x-0 bottom-full z-50 mb-2 origin-bottom animate-[fade-in_0.18s_var(--ease-smooth)_both] rounded-xl p-1.5"
        >
          <p className="truncate px-2.5 pt-1 pb-0.5 text-xs text-muted">{p.email}</p>
          {p.plan ? (
            <p className="truncate px-2.5 pb-1.5 text-xs text-secondary">{p.plan}</p>
          ) : null}
          <div className={divider} />
          {p.settingsHref ? (
            <Link href={p.settingsHref} className={row}>
              <Settings aria-hidden className={icon} />
              <span className="flex-1">{L.settings}</span>
              <kbd className="hidden font-sans text-[0.6875rem] text-muted lg:inline">
                {L.shortcut}
              </kbd>
            </Link>
          ) : null}
          {p.usageHref ? (
            <Link href={p.usageHref} className={row}>
              <Activity aria-hidden className={icon} />
              {L.usage}
            </Link>
          ) : null}
          <div className={cn(row, 'hover:bg-transparent')}>
            <Globe aria-hidden className={icon} />
            <span className="flex-1">{L.language}</span>
            <span role="group" aria-label={L.language} className="flex gap-0.5">
              {lang('bn', L.bangla)}
              {lang('en', L.english)}
            </span>
          </div>
          <a href={p.helpHref} className={row}>
            <CircleHelp aria-hidden className={icon} />
            {L.getHelp}
          </a>
          <div className="relative">
            <button
              type="button"
              aria-expanded={more}
              aria-controls="account-more"
              onClick={() => setMore((m) => !m)}
              className={cn(row, more && 'bg-surface-hover')}
            >
              <Info aria-hidden className={icon} />
              <span className="flex-1">{L.learnMore}</span>
              <ChevronRight
                aria-hidden
                className={cn(
                  'size-4 text-muted transition-transform duration-300 max-lg:rotate-90',
                  more && 'max-lg:-rotate-90',
                )}
              />
            </button>
            {more ? (
              <div
                id="account-more"
                className="ms-6 lg:glass-strong lg:absolute lg:bottom-0 lg:left-full lg:ms-3 lg:w-56 lg:animate-[fade-in_0.18s_var(--ease-smooth)_both] lg:rounded-xl lg:p-1.5"
              >
                <Link href="/privacy" className={row}>
                  <Shield aria-hidden className={icon} />
                  {L.privacy}
                </Link>
                <Link href="/terms" className={row}>
                  <FileText aria-hidden className={icon} />
                  {L.terms}
                </Link>
              </div>
            ) : null}
          </div>
          {p.upgradeHref ? (
            <>
              <div className={divider} />
              <Link href={p.upgradeHref} className={row}>
                <CircleArrowUp aria-hidden className="size-4 shrink-0 text-brand-yellow" />
                {L.upgradePlan}
              </Link>
            </>
          ) : null}
          <div className={divider} />
          {/* Google Play asks for a way to delete the account inside the app, next to the account (ADR 0065). */}
          <Link href="/data-deletion" className={row} data-testid="delete-account">
            <UserX aria-hidden className={icon} />
            {L.deleteAccount}
          </Link>
          <form action={signOutAction}>
            <button type="submit" className={row}>
              <LogOut aria-hidden className={icon} />
              {L.signOut}
            </button>
          </form>
        </div>
      ) : null}

      <button
        ref={button}
        type="button"
        aria-label={L.menu}
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => {
          setOpen((o) => !o);
          setMore(false);
        }}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-start transition-colors hover:bg-surface-hover',
          open && 'bg-surface-hover',
        )}
      >
        <span
          aria-hidden
          className="initials-tile inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        >
          {p.initials || '·'}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold">{p.name}</span>
          <span className="block truncate text-xs text-secondary">
            <span data-testid="role">{p.role}</span>
            {' · '}
            <span data-testid="branches">{p.branches}</span>
          </span>
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted" />
      </button>
    </div>
  );
}
