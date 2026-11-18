import {
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDashed,
  HeartHandshake,
  Package,
  PartyPopper,
  Receipt,
  Rocket,
  Sparkles,
  Store,
  Users,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { AutoRefresh } from '@/components/auto-refresh';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, Hint, Label, PageTitle, Textarea } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { aiConfigured } from '@/lib/llm-gateway';
import { now } from '@/lib/time/clock';
import { cn } from '@/lib/utils';
import { importMenuAction } from '@/modules/menu/import-actions';
import { MenuPhotoForm } from '@/modules/menu/menu-photo-form';
import { getOrgContext } from '@/modules/tenancy/context';
import {
  parseSetupRows,
  SETUP_HREF,
  summarizeSetup,
  type SetupCategory,
  type SetupRow,
} from '@/modules/tenancy/setup-health';

const HOW = ['s1', 's2', 's3'] as const;

const ICON: Record<SetupCategory, LucideIcon> = {
  basics: Store,
  menu: UtensilsCrossed,
  selling: Receipt,
  costs: Wallet,
  stock: Package,
  team: Users,
  alerts: Bell,
  customers: HeartHandshake,
  golive: Rocket,
};

/**
 * Setup centre (ROADMAP Phase 10 onboarding). Every setting a restaurant needs, in plain groups that open
 * and close, each ticked by the data itself (metric_setup_health), so the page can never claim more than
 * is true. The health ring counts required steps only; optional extras are shown apart. The page re-reads
 * itself when the owner comes back to it, so the graph follows what they just changed.
 */
export default async function SetupPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();
  const [t, locale] = await Promise.all([getTranslations('setup'), getLocale()]);
  const loc = locale as Locale;
  const n = (v: number) => formatNumber(v, loc);
  const supabase = await createClient();
  const [{ data: rows }, { data: drafts }] = await Promise.all([
    supabase.rpc('metric_setup_health', { p_org: ctx.org.id, p_now: now().toISOString() }),
    supabase
      .from('menu_import_drafts')
      .select('id')
      .eq('org_id', ctx.org.id)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  const s = summarizeSetup(parseSetupRows(rows));
  const draft = drafts?.[0];
  const href = (step: string) => {
    const to = SETUP_HREF[step] ?? '';
    return to.startsWith('/') ? to : `/${ctx.org.slug}/${to}`;
  };
  const nextIndex = s.next ? s.requiredDone + 1 : 0;
  const nextStep = s.next?.step ?? '';

  const statusOf = (r: SetupRow) =>
    r.done
      ? {
          icon: CheckCircle2,
          cls: 'text-success',
          label: r.required ? t('status.done') : t('status.on'),
        }
      : r.required
        ? { icon: Circle, cls: 'text-warning', label: t('status.todo') }
        : { icon: CircleDashed, cls: 'text-secondary', label: t('status.optional') };

  return (
    <>
      <AutoRefresh />
      <PageTitle title={t('title')} subtitle={t('centreSubtitle')} />

      {/* Health dashboard: the ring is required steps done; bars show each group. */}
      <section
        aria-labelledby="setup-health"
        className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"
      >
        <Card className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <HealthRing
            value={s.health}
            label={t('health.ringLabel', { n: n(s.health) })}
            text={`${n(s.health)}%`}
          />
          <div className="min-w-0">
            <h2 id="setup-health" className="text-lg font-semibold">
              {t('health.title')}
            </h2>
            <p className="mt-1 text-sm text-secondary">
              {t('health.mustDo', { done: n(s.requiredDone), total: n(s.requiredTotal) })}
            </p>
            <p className="text-sm text-secondary">
              {t('health.extras', { done: n(s.optionalDone), total: n(s.optionalTotal) })}
            </p>
            <p className="mt-2 text-sm">
              {s.next ? t('health.missing', { n: n(s.missing.length) }) : t('health.allDone')}
            </p>
          </div>
        </Card>

        <Card>
          <CardTitle>{t('health.byGroup')}</CardTitle>
          <ul className="space-y-2.5">
            {s.categories.map((c) => {
              const total = c.requiredTotal > 0 ? c.requiredTotal : c.optionalTotal;
              const done = c.requiredTotal > 0 ? c.requiredDone : c.optionalDone;
              const pct = total === 0 ? 0 : Math.round((done * 100) / total);
              return (
                <li key={c.category}>
                  <a
                    href={`#group-${c.category}`}
                    className="group block rounded-input focus-visible:outline-2"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium group-hover:underline">
                        {t(`categories.${c.category}.title`)}
                      </span>
                      <span className="shrink-0 text-xs text-secondary">
                        {c.requiredTotal > 0
                          ? t('groupDone', { done: n(done), total: n(total) })
                          : t('groupExtras', { done: n(done), total: n(total) })}
                      </span>
                    </div>
                    <div
                      className="h-2 overflow-hidden rounded-full bg-line"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={total}
                      aria-valuenow={done}
                      aria-label={t(`categories.${c.category}.title`)}
                    >
                      <div
                        className={cn(
                          'h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700',
                          c.complete
                            ? 'bg-success-bright'
                            : c.requiredTotal > 0
                              ? 'bg-warning-bright'
                              : 'bg-secondary',
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        </Card>
      </section>

      {/* Step-by-step guidance: the one thing to do next, and how this page works. */}
      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {s.next ? (
          <Card className="border-warning/45 bg-warning/8">
            <p className="text-xs font-semibold uppercase tracking-wide text-warning">
              {t('next.label', { n: n(nextIndex), total: n(s.requiredTotal) })}
            </p>
            <h2 className="mt-1 text-lg font-semibold">{t(`items.${s.next.step}.title`)}</h2>
            <p className="mt-1 text-sm text-secondary">{t(`items.${s.next.step}.what`)}</p>
            <HowList steps={HOW.map((k) => t(`items.${nextStep}.how.${k}`))} />
            {SETUP_HREF[s.next.step] !== undefined ? (
              <Link
                href={href(s.next.step)}
                className="mt-4 inline-flex items-center gap-2 rounded-input bg-warning-bright px-4 py-2 text-sm font-semibold text-on-action motion-safe:transition-transform motion-safe:active:scale-95"
              >
                {t('next.go')}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            ) : null}
          </Card>
        ) : (
          <Card className="flex items-start gap-3">
            <PartyPopper aria-hidden className="size-6 shrink-0 text-warning" />
            <div>
              <h2 className="text-lg font-semibold">{t('next.doneTitle')}</h2>
              <p className="mt-1 text-sm text-secondary">{t('next.doneBody')}</p>
            </div>
          </Card>
        )}
        <Card>
          <CardTitle>{t('guide.title')}</CardTitle>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-secondary">
            <li>{t('guide.s1')}</li>
            <li>{t('guide.s2')}</li>
            <li>{t('guide.s3')}</li>
            <li>{t('guide.s4')}</li>
          </ol>
          <ul className="mt-3 flex flex-wrap gap-3 text-xs text-secondary">
            <li className="flex items-center gap-1">
              <CheckCircle2 aria-hidden className="size-4 text-success" /> {t('status.done')}
            </li>
            <li className="flex items-center gap-1">
              <Circle aria-hidden className="size-4 text-warning" /> {t('status.todo')}
            </li>
            <li className="flex items-center gap-1">
              <CircleDashed aria-hidden className="size-4 text-secondary" /> {t('status.optional')}
            </li>
          </ul>
        </Card>
      </div>

      {/* Every group, open while it still has a required step to do. */}
      <div className="space-y-3">
        {s.categories.map((c) => {
          const Icon = ICON[c.category];
          return (
            <details
              key={c.category}
              id={`group-${c.category}`}
              open={!c.complete && c.requiredTotal > 0}
              className="group scroll-mt-24 rounded-card border border-edge bg-surface"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <span className="grid size-10 shrink-0 place-items-center rounded-input bg-surface-elevated">
                  <Icon aria-hidden className="size-5 text-primary" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{t(`categories.${c.category}.title`)}</span>
                  <span className="block text-sm text-secondary">
                    {t(`categories.${c.category}.body`)}
                  </span>
                </span>
                <span
                  className={cn(
                    'hidden shrink-0 items-center gap-1 text-xs font-medium sm:flex',
                    c.complete ? 'text-success' : 'text-warning',
                  )}
                >
                  {c.complete ? (
                    <CheckCircle2 aria-hidden className="size-4" />
                  ) : (
                    <Circle aria-hidden className="size-4" />
                  )}
                  {c.requiredTotal > 0
                    ? c.complete
                      ? t('groupComplete')
                      : t('groupDone', { done: n(c.requiredDone), total: n(c.requiredTotal) })
                    : t('groupExtras', { done: n(c.optionalDone), total: n(c.optionalTotal) })}
                </span>
                <ChevronDown
                  aria-hidden
                  className="size-5 shrink-0 text-secondary motion-safe:transition-transform group-open:rotate-180"
                />
              </summary>
              <ul className="divide-y divide-line border-t border-line">
                {c.steps.map((r) => {
                  const st = statusOf(r);
                  return (
                    <li
                      key={r.step}
                      className="flex flex-wrap items-start gap-3 p-4 sm:flex-nowrap"
                    >
                      <st.icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', st.cls)} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {t(`items.${r.step}.title`)}{' '}
                          <span className={cn('ml-1 text-xs font-semibold', st.cls)}>
                            {st.label}
                          </span>
                        </p>
                        <p className="mt-0.5 text-sm text-secondary">{t(`items.${r.step}.what`)}</p>
                        {r.need > 1 || (r.need > 0 && !r.done && r.have > 0) ? (
                          <p className="mt-1 text-xs text-secondary">
                            {t('progress', { have: n(r.have), need: n(r.need) })}
                          </p>
                        ) : null}
                        <details className="group/how mt-2">
                          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-info [&::-webkit-details-marker]:hidden">
                            {t('showHow')}
                            <ChevronDown
                              aria-hidden
                              className="size-4 motion-safe:transition-transform group-open/how:rotate-180"
                            />
                          </summary>
                          <HowList steps={HOW.map((k) => t(`items.${r.step}.how.${k}`))} />
                        </details>
                      </div>
                      {SETUP_HREF[r.step] ? (
                        <Link
                          href={href(r.step)}
                          className="ml-8 inline-flex shrink-0 items-center gap-1 rounded-input border border-line px-3 py-1.5 text-sm font-semibold hover:bg-surface-hover sm:ml-0"
                        >
                          {r.done ? t('change') : t('setUp')}
                          <ArrowRight aria-hidden className="size-4" />
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </div>

      {/* The menu is read from photos or pasted, right here (Setup's "Menu" step points at this). */}
      <div id="menu-import" className="mt-8 grid scroll-mt-24 gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>{t('menuPhotos.title')}</CardTitle>
          <p className="mb-4 text-sm text-secondary">{t('menuPhotos.body')}</p>
          {draft ? (
            <Link
              href={`/${ctx.org.slug}/setup/menu`}
              className="mb-4 flex items-center gap-3 rounded-input border border-warning/45 bg-warning/8 px-3.5 py-3 text-sm font-semibold transition-colors hover:bg-warning/15"
            >
              <Sparkles aria-hidden className="size-4 shrink-0 text-warning" />
              <span className="flex-1">{t('menuPhotos.waiting')}</span>
              <span className="text-warning">{t('menuPhotos.review')}</span>
            </Link>
          ) : null}
          <MenuPhotoForm orgId={ctx.org.id} orgSlug={ctx.org.slug} enabled={aiConfigured()} />
        </Card>
        <Card>
          <CardTitle>{t('importTitle')}</CardTitle>
          <ActionForm action={importMenuAction} successKey="setup.imported" className="space-y-3">
            <input type="hidden" name="orgId" value={ctx.org.id} />
            <input type="hidden" name="orgSlug" value={ctx.org.slug} />
            <div>
              <Label htmlFor="menu-csv">{t('csvLabel')}</Label>
              <Textarea
                id="menu-csv"
                name="csv"
                rows={8}
                required
                maxLength={60000}
                placeholder={t('csvPlaceholder')}
                className="font-mono text-xs"
              />
            </div>
            <Hint>{t('csvHint')}</Hint>
            <Button type="submit" variant="secondary">
              {t('import')}
            </Button>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

function HowList({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-secondary">
      {steps.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

/** The health graph: a ring filled to the share of required steps done. */
function HealthRing({ value, label, text }: { value: number; label: string; text: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, value)) / 100) * c;
  return (
    <div className="relative size-36 shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="12" className="stroke-line" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          className={cn(
            'motion-safe:transition-[stroke-dasharray] motion-safe:duration-700',
            value >= 100 ? 'stroke-success-bright' : 'stroke-warning-bright',
          )}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-3xl font-bold tabular-nums">
        {text}
      </span>
    </div>
  );
}
