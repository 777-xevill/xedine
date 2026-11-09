import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardTitle,
  EmptyState,
  Hint,
  Input,
  Label,
  PageTitle,
  Select,
  Stat,
} from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import {
  addCheckAction,
  addStarterChecksAction,
  recordCheckAction,
  setCheckActiveAction,
} from '@/modules/compliance/check-actions';
import { getOrgContext } from '@/modules/tenancy/context';

type State = 'done' | 'problem' | 'due' | 'missing';

interface CheckRow {
  branch_id: string;
  check_id: string;
  name: string;
  name_bn: string | null;
  category: 'hygiene' | 'inspection' | 'document';
  frequency: 'daily' | 'weekly' | 'monthly';
  needs_note: boolean;
  period_start: string;
  period_end: string;
  is_current: boolean;
  state: State;
  note: string | null;
  late: boolean;
}

const STATE_TONE = {
  done: 'success',
  problem: 'danger',
  due: 'warning',
  missing: 'danger',
} as const;
const DAYS = 7;

/**
 * Daily checks (ADR 0043): the restaurant's own hygiene tasks, inspection records and paperwork, what is due
 * today, and what nobody recorded. The list is the owner's to edit; it does not claim to be the law.
 */
export default async function DailyChecksPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  const has = (roles: string[]) => roles.some((r) => ctx.roles.includes(r as never));
  if (!has(['owner', 'manager', 'kitchen', 'accountant'])) notFound();
  const canRecord = has(['owner', 'manager', 'kitchen']);
  const canEdit = has(['owner', 'manager']);
  const canSeeDocuments = has(['owner', 'manager', 'accountant']);
  const [t, locale] = await Promise.all([getTranslations('dailyChecks'), getLocale()]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const at = now().toISOString();
  const args = { p_org: ctx.org.id, p_branch: ctx.selectedBranchId, p_now: at };
  const [checks, summary, list, documents] = await Promise.all([
    supabase.rpc('metric_daily_checks', { ...args, p_days: DAYS }),
    supabase.rpc('metric_daily_checks_summary', { ...args, p_days: DAYS }),
    supabase
      .from('compliance_checks')
      .select('id, name, name_bn, category, frequency, is_active')
      .eq('org_id', ctx.org.id)
      .order('is_active', { ascending: false })
      .order('name'),
    canSeeDocuments
      ? supabase.rpc('metric_compliance', args)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const rows = (checks.data ?? []) as CheckRow[];
  const summaries = (summary.data ?? []) as {
    branch_id: string;
    due_now: number;
    done_now: number;
    problems_now: number;
    missing: number;
    score_bps: number | null;
  }[];
  const defined = (list.data ?? []) as {
    id: string;
    name: string;
    name_bn: string | null;
    category: CheckRow['category'];
    frequency: CheckRow['frequency'];
    is_active: boolean;
  }[];
  const docs = (
    (documents.data ?? []) as {
      kind: string;
      ref_id: string | null;
      label: string;
      due_on: string;
      days_left: number;
      status: string;
    }[]
  ).filter((d) => d.status === 'expired' || d.status === 'urgent');

  const label = (x: { name: string; name_bn: string | null }) =>
    loc === 'bn' && x.name_bn ? x.name_bn : x.name;
  const branchName = (id: string) => ctx.branches.find((b) => b.id === id)?.name ?? '';
  const showBranch = ctx.branches.length > 1;
  const n = (v: number) => formatNumber(Number(v), loc);
  const current = rows.filter((r) => r.is_current);
  const missing = rows.filter((r) => r.state === 'missing');
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );

  const recordForm = (r: CheckRow, late: boolean) => (
    <ActionForm
      action={recordCheckAction}
      successKey="common.saved"
      className="mt-2 flex flex-wrap items-center gap-2"
    >
      {hidden}
      <input type="hidden" name="branchId" value={r.branch_id} />
      <input type="hidden" name="checkId" value={r.check_id} />
      {late ? <input type="hidden" name="date" value={r.period_end} /> : null}
      <Input
        name="note"
        maxLength={500}
        defaultValue={r.note ?? ''}
        placeholder={r.needs_note ? t('notePlaceholderRequired') : t('notePlaceholder')}
        aria-label={t('note')}
        className="min-w-40 flex-1"
      />
      <Button type="submit" size="sm" name="status" value="done">
        {t('markDone')}
      </Button>
      <Button type="submit" size="sm" variant="danger" name="status" value="problem">
        {t('markProblem')}
      </Button>
    </ActionForm>
  );

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      {summaries.map((s) => (
        <section key={s.branch_id} className="mb-6">
          {showBranch ? (
            <h2 className="mb-2 text-sm font-semibold">{branchName(s.branch_id)}</h2>
          ) : null}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t('statDue')} value={n(s.due_now)} />
            <Stat label={t('statDone')} value={n(s.done_now)} />
            <Stat label={t('statMissing', { days: n(DAYS) })} value={n(s.missing)} />
            <Stat
              label={t('statScore', { days: n(DAYS) })}
              value={s.score_bps === null ? '—' : formatBps(Number(s.score_bps), loc)}
            />
          </div>
        </section>
      ))}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="p-4 sm:p-6">
            <CardTitle>{t('todayTitle')}</CardTitle>
            {current.length === 0 ? (
              <EmptyState title={t('noChecks')} />
            ) : (
              <ul className="space-y-3">
                {current.map((r) => (
                  <li
                    key={`${r.branch_id}-${r.check_id}-${r.period_start}`}
                    className="glass-tile rounded-input p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{label(r)}</p>
                        <p className="text-xs text-secondary">
                          {showBranch ? `${branchName(r.branch_id)} · ` : ''}
                          {t(`category.${r.category}`)} · {t(`frequency.${r.frequency}`)}
                        </p>
                      </div>
                      <StatusBadge tone={STATE_TONE[r.state]}>{t(`state.${r.state}`)}</StatusBadge>
                    </div>
                    {r.note && !canRecord ? <p className="mt-2 text-sm">{r.note}</p> : null}
                    {canRecord ? recordForm(r, false) : null}
                  </li>
                ))}
              </ul>
            )}
            <Hint className="mt-3">{t('problemHint')}</Hint>
          </Card>

          <Card className="p-4 sm:p-6">
            <CardTitle>{t('missingTitle', { days: n(DAYS) })}</CardTitle>
            {missing.length === 0 ? (
              <EmptyState title={t('noneMissing')} />
            ) : (
              <ul className="space-y-3">
                {missing.map((r) => (
                  <li
                    key={`${r.branch_id}-${r.check_id}-${r.period_start}`}
                    className="glass-tile rounded-input p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{label(r)}</p>
                        <p className="text-xs text-secondary">
                          {showBranch ? `${branchName(r.branch_id)} · ` : ''}
                          {r.period_start === r.period_end
                            ? r.period_start
                            : `${r.period_start} – ${r.period_end}`}
                        </p>
                      </div>
                      <StatusBadge tone="danger">{t('state.missing')}</StatusBadge>
                    </div>
                    {canRecord ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm text-secondary">
                          {t('recordLate')}
                        </summary>
                        {recordForm(r, true)}
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <Hint className="mt-3">{t('lateHint')}</Hint>
          </Card>
        </div>

        <div className="space-y-6">
          {canSeeDocuments ? (
            <Card>
              <CardTitle>{t('documentsTitle')}</CardTitle>
              {docs.length === 0 ? (
                <EmptyState title={t('documentsOk')} />
              ) : (
                <ul className="space-y-2 text-sm">
                  {docs.map((d) => (
                    <li key={d.ref_id ?? d.kind} className="flex items-start justify-between gap-2">
                      <span>{d.kind === 'vat_return' ? t('vatReturn') : d.label}</span>
                      <StatusBadge tone="danger">
                        {Number(d.days_left) < 0
                          ? t('docExpired', { days: n(-Number(d.days_left)) })
                          : t('docDue', { days: n(Number(d.days_left)) })}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href={`/${ctx.org.slug}/compliance`}
                className="mt-3 inline-block text-sm font-semibold text-info underline-offset-4 hover:underline"
              >
                {t('documentsLink')}
              </Link>
            </Card>
          ) : null}

          {canEdit ? (
            <Card>
              <CardTitle>{t('addTitle')}</CardTitle>
              {defined.length === 0 ? (
                <ActionForm
                  action={addStarterChecksAction}
                  successKey="common.saved"
                  className="mb-4"
                >
                  {hidden}
                  <Button type="submit">{t('addStarter')}</Button>
                  <Hint className="mt-2">{t('starterHint')}</Hint>
                </ActionForm>
              ) : null}
              <ActionForm action={addCheckAction} successKey="common.saved" className="space-y-3">
                {hidden}
                <div>
                  <Label htmlFor="ck-name">{t('name')}</Label>
                  <Input id="ck-name" name="name" required maxLength={120} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="ck-cat">{t('categoryLabel')}</Label>
                    <Select id="ck-cat" name="category" defaultValue="hygiene">
                      {(['hygiene', 'inspection', 'document'] as const).map((c) => (
                        <option key={c} value={c}>
                          {t(`category.${c}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="ck-freq">{t('frequencyLabel')}</Label>
                    <Select id="ck-freq" name="frequency" defaultValue="daily">
                      {(['daily', 'weekly', 'monthly'] as const).map((f) => (
                        <option key={f} value={f}>
                          {t(`frequency.${f}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="needsNote" />
                  {t('needsNote')}
                </label>
                <Button type="submit" variant="secondary">
                  {t('add')}
                </Button>
              </ActionForm>
            </Card>
          ) : null}

          <Card>
            <CardTitle>{t('listTitle')}</CardTitle>
            {defined.length === 0 ? (
              <EmptyState title={t('noChecks')} />
            ) : (
              <ul className="space-y-2 text-sm">
                {defined.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <span className={c.is_active ? '' : 'text-muted line-through'}>
                      {label(c)}
                      <span className="ms-1 text-xs text-secondary">
                        · {t(`frequency.${c.frequency}`)}
                      </span>
                    </span>
                    {canEdit ? (
                      <ActionForm action={setCheckActiveAction}>
                        {hidden}
                        <input type="hidden" name="checkId" value={c.id} />
                        <input type="hidden" name="active" value={String(!c.is_active)} />
                        <Button type="submit" size="sm" variant="ghost">
                          {c.is_active ? t('switchOff') : t('switchOn')}
                        </Button>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
