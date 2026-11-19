'use client';

import {
  BookmarkPlus,
  CalendarDays,
  CheckCircle2,
  Circle,
  CircleSlash,
  Eye,
  EyeOff,
  FolderPlus,
  Globe,
  LoaderCircle,
  PartyPopper,
  Percent,
  Receipt,
  ShoppingBasket,
  Sparkles,
  Tag,
  Trash2,
  Truck,
  TriangleAlert,
  UtensilsCrossed,
  Zap,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { formatDay, formatMoney, formatNumber, type Locale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import type { ActionKind } from '@/modules/assistant/action-kinds';
import {
  dismissAiActionsAction,
  runAiActionsAction,
  type ActionItem,
  type AskReply,
} from '@/modules/assistant/actions';

/**
 * What sits under an answer (ADR 0067): which model wrote it, whether its figures are general knowledge, the
 * web pages it leaned on, and the changes it prepared with "Do these changes". Shared by the chat and the
 * page helper.
 */

type Extras = Pick<AskReply, 'model' | 'x7Note' | 'general' | 'webSources' | 'actions'>;

export function AnswerBadges({
  model,
  x7Note,
  general,
}: Pick<Extras, 'model' | 'x7Note' | 'general'>) {
  const t = useTranslations('assistantPage');
  return (
    <>
      {model === 'x7' ? (
        <Badge tone="warning" icon={<Zap />}>
          {t('x7.badge')}
        </Badge>
      ) : null}
      {general ? (
        <Badge tone="info" icon={<Globe />}>
          {t('generalKnowledge')}
        </Badge>
      ) : null}
      {x7Note ? <span className="text-xs text-muted">{t(`x7.note.${x7Note}`)}</span> : null}
    </>
  );
}

export function WebSources({ sources }: { sources: Extras['webSources'] }) {
  const t = useTranslations('assistantPage');
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 text-xs text-muted">
      <span>{t('webSources')}</span>{' '}
      {sources.map((s, i) => (
        <React.Fragment key={s.url}>
          {i > 0 ? ' · ' : null}
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline decoration-edge underline-offset-2 hover:text-foreground"
          >
            {s.title}
          </a>
        </React.Fragment>
      ))}
    </div>
  );
}

const ICONS: Record<ActionKind, React.ComponentType<{ className?: string }>> = {
  add_category: FolderPlus,
  add_dish: UtensilsCrossed,
  change_price: Tag,
  set_dish_on_menu: Eye,
  add_special_day: CalendarDays,
  add_party_order: PartyPopper,
  record_purchase: ShoppingBasket,
  log_waste: Trash2,
  add_supplier: Truck,
  add_fixed_cost: Receipt,
  set_food_cost: Percent,
  remember_rule: BookmarkPlus,
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0));
const day = (d: unknown, locale: Locale) =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? formatDay(new Date(`${d}T12:00:00Z`), locale, 'UTC')
    : '';

/** One prepared change in words: a title and, when there is more to say, a detail line. */
function useDescribe(currency: string) {
  const t = useTranslations('assistantPage.actions');
  const locale = useLocale() as Locale;
  const money = (minor: unknown) => formatMoney(num(minor), locale, currency);
  return (a: ActionItem): { title: string; detail?: string } => {
    const v = a.view;
    switch (a.kind) {
      case 'add_category':
        return { title: t('kinds.add_category', { name: str(v.name) }) };
      case 'add_dish':
        return {
          title: t('kinds.add_dish', { name: str(v.name), price: money(v.price_minor) }),
          ...(str(v.category)
            ? {
                detail: v.new_category
                  ? t('detail.categoryNew', { category: str(v.category) })
                  : t('detail.category', { category: str(v.category) }),
              }
            : {}),
        };
      case 'change_price':
        return {
          title: t('kinds.change_price', {
            dish: str(v.dish),
            from: money(v.old_minor),
            to: money(v.new_minor),
          }),
        };
      case 'set_dish_on_menu':
        return {
          title: v.on
            ? t('kinds.dish_on', { dish: str(v.dish) })
            : t('kinds.dish_off', { dish: str(v.dish) }),
        };
      case 'add_special_day': {
        const dates =
          v.to && v.to !== v.from
            ? t('detail.dates', { from: day(v.from, locale), to: day(v.to, locale) })
            : day(v.from, locale);
        return {
          title: t('kinds.add_special_day', { name: str(v.name), dates }),
          ...(str(v.busy) ? { detail: t(`busy.${str(v.busy)}`) } : {}),
        };
      }
      case 'add_party_order': {
        const lines = Array.isArray(v.lines) ? (v.lines as { dish: string; plates: number }[]) : [];
        const parts = lines.map((l) =>
          t('detail.plates', { dish: l.dish, count: formatNumber(l.plates, locale) }),
        );
        if (str(v.ready_at)) parts.push(t('detail.readyAt', { time: str(v.ready_at) }));
        return {
          title: t('kinds.add_party_order', { title: str(v.title), date: day(v.date, locale) }),
          detail: parts.join(' · '),
        };
      }
      case 'record_purchase': {
        const lines = Array.isArray(v.lines)
          ? (v.lines as { item: string; qty: string; total_minor: number; is_new: boolean }[])
          : [];
        return {
          title: t('kinds.record_purchase', {
            date: day(v.date, locale),
            total: money(v.total_minor),
          }),
          detail: lines
            .map(
              (l) =>
                `${l.qty} ${l.item} · ${money(l.total_minor)}${l.is_new ? ` (${t('detail.newItem')})` : ''}`,
            )
            .join(', '),
        };
      }
      case 'log_waste':
        return {
          title: t('kinds.log_waste', { qty: str(v.qty), item: str(v.item) }),
          detail: locale === 'bn' ? str(v.reason_bn) : str(v.reason),
        };
      case 'add_supplier':
        return { title: t('kinds.add_supplier', { name: str(v.name) }) };
      case 'add_fixed_cost':
        return {
          title: t('kinds.add_fixed_cost', {
            name: str(v.label) || t(`fixedKinds.${str(v.kind) || 'other'}`),
            amount: money(v.monthly_minor),
          }),
        };
      case 'set_food_cost':
        return { title: t('kinds.set_food_cost', { pct: formatNumber(num(v.pct), locale) }) };
      case 'remember_rule':
        return { title: t('kinds.remember_rule', { text: str(v.text) }) };
    }
  };
}

/** The changes the assistant prepared, with "Do these changes" and "Not now" (nothing changes before). */
export function ActionList({
  orgId,
  orgSlug,
  currency,
  actions: initial,
}: {
  orgId: string;
  orgSlug: string;
  currency: string;
  actions: ActionItem[];
}) {
  const t = useTranslations('assistantPage.actions');
  const te = useTranslations('errors');
  const locale = useLocale() as Locale;
  const describe = useDescribe(currency);
  const [actions, setActions] = React.useState(initial);
  const [picked, setPicked] = React.useState<Set<string>>(
    () => new Set(initial.filter((a) => a.status === 'proposed').map((a) => a.id)),
  );
  const [error, setError] = React.useState('');
  const [pending, start] = React.useTransition();
  if (actions.length === 0) return null;

  const open = actions.filter((a) => a.status === 'proposed');
  const chosen = open.filter((a) => picked.has(a.id)).map((a) => a.id);
  const apply = (res: Awaited<ReturnType<typeof runAiActionsAction>>) => {
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setActions((list) =>
      list.map((a) => {
        const r = res.results.find((x) => x.id === a.id);
        return r ? { ...a, status: r.status, error: r.error } : a;
      }),
    );
  };
  const run = (fn: typeof runAiActionsAction, ids: string[]) => {
    setError('');
    setActions((list) =>
      list.map((a) =>
        ids.includes(a.id) && fn === runAiActionsAction ? { ...a, status: 'running' } : a,
      ),
    );
    start(async () => apply(await fn({ orgId, orgSlug, ids })));
  };

  return (
    <section className="glass mt-3 rounded-card p-3 sm:p-4" aria-label={t('title')}>
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-yellow" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t('title')}</h3>
          <p className="text-xs text-secondary">{open.length > 0 ? t('body') : t('bodyDone')}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {actions.map((a) => {
          const Icon = a.kind === 'set_dish_on_menu' && !a.view.on ? EyeOff : ICONS[a.kind];
          const d = describe(a);
          const proposed = a.status === 'proposed';
          return (
            <li
              key={a.id}
              className={cn(
                'flex items-start gap-3 rounded-2xl border border-edge bg-surface/60 px-3 py-2.5',
                a.status === 'dismissed' && 'opacity-60',
              )}
            >
              {proposed ? (
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-[var(--brand-yellow)]"
                  checked={picked.has(a.id)}
                  disabled={pending}
                  aria-label={d.title}
                  onChange={(e) =>
                    setPicked((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(a.id);
                      else next.delete(a.id);
                      return next;
                    })
                  }
                />
              ) : null}
              <Icon className="mt-0.5 size-4 shrink-0 text-secondary" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-5 font-medium">{d.title}</p>
                {d.detail ? <p className="mt-0.5 text-xs text-secondary">{d.detail}</p> : null}
                {a.status === 'failed' && a.error ? (
                  <p className="mt-1 text-xs text-warning">{te(a.error)}</p>
                ) : null}
                {proposed && a.error ? (
                  <p className="mt-1 text-xs text-warning">{te(a.error)}</p>
                ) : null}
              </div>
              {a.status === 'done' ? (
                <Badge tone="success" icon={<CheckCircle2 />}>
                  {t('status.done')}
                </Badge>
              ) : a.status === 'failed' ? (
                <Badge tone="warning" icon={<TriangleAlert />}>
                  {t('status.failed')}
                </Badge>
              ) : a.status === 'dismissed' ? (
                <Badge tone="neutral" icon={<CircleSlash />}>
                  {t('status.dismissed')}
                </Badge>
              ) : a.status === 'running' ? (
                <Badge tone="neutral" icon={<LoaderCircle className="animate-spin" />}>
                  {t('status.running')}
                </Badge>
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              )}
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-2 text-xs text-warning">{te(error)}</p> : null}
      {open.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending || chosen.length === 0}
            onClick={() => run(runAiActionsAction, chosen)}
            className="inline-flex items-center gap-2 rounded-full bg-action px-4 py-2 text-sm font-semibold text-on-action glow-action transition hover:brightness-110 disabled:bg-none disabled:bg-surface-elevated disabled:text-muted disabled:shadow-none"
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t('doThese', { count: formatNumber(chosen.length, locale) })}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                dismissAiActionsAction,
                open.map((a) => a.id),
              )
            }
            className="rounded-full px-4 py-2 text-sm text-secondary transition hover:bg-surface-elevated hover:text-foreground"
          >
            {t('notNow')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** X7 this week, as the composer's switch shows it. Null when X7 is not set up for this restaurant. */
export interface X7State {
  perWeek: number;
  left: number;
  /** YYYY-MM-DD, the Monday it resets. */
  resetsOn: string;
}

const MODEL_KEY = 'xedine-chat-model';
const MODEL_EVENT = 'xedine-chat-model';

function subscribeModel(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(MODEL_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(MODEL_EVENT, onChange);
  };
}
function storedModel(): string | null {
  try {
    return window.localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

/**
 * The model switch's choice, remembered on this device (a convenience: without storage it lasts until the
 * page is left). X7 only while this week's allowance has one left.
 */
export function useModelChoice(x7: X7State | null) {
  const stored = React.useSyncExternalStore(subscribeModel, storedModel, () => null);
  const [picked, setPicked] = React.useState<'xedine' | 'x7' | null>(null);
  const choose = (m: 'xedine' | 'x7') => {
    setPicked(m);
    try {
      window.localStorage.setItem(MODEL_KEY, m);
      window.dispatchEvent(new Event(MODEL_EVENT));
    } catch {
      // Not remembered; still used while the page is open.
    }
  };
  const wanted = picked ?? (stored === 'x7' ? 'x7' : 'xedine');
  return { model: x7 && x7.left > 0 ? wanted : ('xedine' as const), choose };
}

export function ModelPicker({
  x7,
  model,
  onChange,
}: {
  x7: X7State | null;
  model: 'xedine' | 'x7';
  onChange: (m: 'xedine' | 'x7') => void;
}) {
  const t = useTranslations('assistantPage.x7');
  const locale = useLocale() as Locale;
  if (!x7 || x7.perWeek <= 0) return null;
  const usedUp = x7.left <= 0;
  const option = (value: 'xedine' | 'x7', label: string, hint: string, icon: React.ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={model === value}
      disabled={value === 'x7' && usedUp}
      onClick={() => onChange(value)}
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-start text-xs transition',
        model === value
          ? 'bg-surface text-foreground shadow-soft ring-1 ring-edge'
          : 'text-secondary hover:text-foreground',
        value === 'x7' && usedUp && 'cursor-not-allowed opacity-60',
      )}
    >
      {icon}
      <span className="font-semibold">{label}</span>
      <span className="truncate text-muted">{hint}</span>
    </button>
  );
  return (
    <div
      role="radiogroup"
      aria-label={t('pickLabel')}
      className="mb-2 inline-flex max-w-full items-center gap-1 rounded-full bg-surface-elevated/70 p-1"
    >
      {option(
        'xedine',
        t('everyday'),
        t('everydayHint'),
        <Sparkles className="size-3.5" aria-hidden />,
      )}
      {option(
        'x7',
        t('name'),
        usedUp
          ? t('usedUp', { day: day(x7.resetsOn, locale) })
          : t('left', { count: formatNumber(x7.left, locale) }),
        <Zap className="size-3.5 text-brand-yellow" aria-hidden />,
      )}
    </div>
  );
}
