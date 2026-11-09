import { Check, CircleCheck, ClipboardList, Clock } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Banner } from '@/components/stock/parts';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Card, Hint, Input, Label, PageTitle, Select } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatBps, formatDhakaDate, formatNumber, type Locale } from '@/lib/i18n/format';
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
 * Daily checks (ADR 0043), phone first: what is left to do today, one tap each. Everything else (what was
 * missed, the list itself) waits behind a tap. The list is the owner's; it does not claim to be the law.
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
  const summaries = (summary.data ?? []) as { branch_id: string; score_bps: number | null }[];
  const defined = (list.data ?? []) as {
    id: string;
    name: string;
    name_bn: string | null;
    frequency: CheckRow['frequency'];
    is_active: boolean;
  }[];
  const docs = (
    (documents.data ?? []) as {
      kind: string;
      ref_id: string | null;
      label: string;
      days_left: number;
      status: string;
    }[]
  ).filter((d) => d.status === 'expired' || d.status === 'urgent');

  const label = (x: { name: string; name_bn: string | null }) =>
    loc === 'bn' && x.name_bn ? x.name_bn : x.name;
  const day = (d: string) => formatDhakaDate(new Date(`${d}T06:00:00Z`), loc);
  const branchName = (id: string) => ctx.branches.find((b) => b.id === id)?.name ?? '';
  const showBranch = ctx.branches.length > 1;
  const n = (v: number) => formatNumber(Number(v), loc);
  const due = rows.filter((r) => r.is_current && r.state === 'due');
  const recorded = rows.filter((r) => r.is_current && r.state !== 'due');
  const missing = rows.filter((r) => r.state === 'missing');
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );
  const rowKey = (r: CheckRow) => `${r.branch_id}-${r.check_id}-${r.period_start}`;
  const place = (r: CheckRow) => (showBranch ? `${branchName(r.branch_id)} · ` : '');

  const doneForm = (r: CheckRow, late: boolean) => (
    <ActionForm
      action={recordCheckAction}
      successKey="common.saved"
      className="mt-2 flex flex-wrap items-center gap-2"
    >
      {hidden}
      <input type="hidden" name="branchId" value={r.branch_id} />
      <input type="hidden" name="checkId" value={r.check_id} />
      <input type="hidden" name="status" value="done" />
      {late ? <input type="hidden" name="date" value={r.period_end} /> : null}
      {r.needs_note ? (
        <Input
          name="note"
          required
          maxLength={500}
          defaultValue={r.note ?? ''}
          placeholder={t('notePlaceholderRequired')}
          aria-label={t('note')}
          className="min-w-32 flex-1"
        />
      ) : null}
      <Button type="submit" size="sm">
        <Check aria-hidden className="size-4" />
        {t('markDone')}
      </Button>
    </ActionForm>
  );

  const problemForm = (r: CheckRow, late: boolean) => (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm text-secondary">{t('somethingWrong')}</summary>
      <ActionForm
        action={recordCheckAction}
        successKey="common.saved"
        className="mt-2 flex flex-wrap items-center gap-2"
      >
        {hidden}
        <input type="hidden" name="branchId" value={r.branch_id} />
        <input type="hidden" name="checkId" value={r.check_id} />
        <input type="hidden" name="status" value="problem" />
        {late ? <input type="hidden" name="date" value={r.period_end} /> : null}
        <Input
          name="note"
          required
          maxLength={500}
          placeholder={t('problemPlaceholder')}
          aria-label={t('note')}
          className="min-w-32 flex-1"
        />
        <Button type="submit" size="sm" variant="danger">
          {t('markProblem')}
        </Button>
      </ActionForm>
      <Hint className="mt-1">{t('problemHint')}</Hint>
    </details>
  );

  const heading = (r: CheckRow, subtitle: string, badge: React.ReactNode) => (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-semibold">{label(r)}</p>
        <p className="text-xs text-secondary">{subtitle}</p>
      </div>
      {badge}
    </div>
  );

  const checkList = (
    <details className="glass-tile rounded-card p-4">
      <summary className="cursor-pointer font-semibold">{t('listTitle')}</summary>
      {canEdit ? (
        <ActionForm action={addCheckAction} successKey="common.saved" className="mt-3 space-y-3">
          {hidden}
          <div>
            <Label htmlFor="ck-name">{t('name')}</Label>
            <Input id="ck-name" name="name" required maxLength={120} />
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="needsNote" />
            {t('needsNote')}
          </label>
          <Button type="submit" variant="secondary">
            {t('add')}
          </Button>
        </ActionForm>
      ) : null}
      <ul className="mt-4 space-y-2 text-sm">
        {defined.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <span className={c.is_active ? '' : 'text-muted line-through'}>
              {label(c)}
              <span className="ms-1 text-xs text-secondary">· {t(`frequency.${c.frequency}`)}</span>
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
    </details>
  );

  const documentsCard =
    canSeeDocuments && docs.length > 0 ? (
      <Alert tone="danger">
        <p className="font-semibold">{t('documentsTitle')}</p>
        <ul className="mt-1 space-y-1 text-sm">
          {docs.map((d) => (
            <li key={d.ref_id ?? d.kind}>
              {d.kind === 'vat_return' ? t('vatReturn') : d.label}
              {' · '}
              {Number(d.days_left) < 0
                ? t('docExpired', { days: n(-Number(d.days_left)) })
                : t('docDue', { days: n(Number(d.days_left)) })}
            </li>
          ))}
        </ul>
        <Link
          href={`/${ctx.org.slug}/compliance`}
          className="mt-2 inline-block text-sm font-semibold underline-offset-4 hover:underline"
        >
          {t('documentsLink')}
        </Link>
      </Alert>
    ) : null;

  const title = (
    <PageTitle title={t('title')} subtitle={t('subtitle')} actions={<LocaleSwitcher />} />
  );

  // A restaurant with no list yet sees one thing to do.
  if (defined.length === 0) {
    return (
      <>
        {title}
        <div className="mx-auto max-w-2xl space-y-5">
          <Banner
            tone="info"
            icon={<ClipboardList />}
            title={t('startTitle')}
            body={canEdit ? t('startBody') : t('startAskOwner')}
          >
            {canEdit ? (
              <ActionForm action={addStarterChecksAction} className="mt-3">
                {hidden}
                <Button type="submit">{t('addStarter')}</Button>
              </ActionForm>
            ) : null}
          </Banner>
          {canEdit ? <Hint>{t('starterHint')}</Hint> : null}
          {documentsCard}
          {canEdit ? checkList : null}
        </div>
      </>
    );
  }

  return (
    <>
      {title}
      <div className="mx-auto max-w-2xl space-y-5">
        {due.length > 0 ? (
          <Banner
            tone="warning"
            icon={<Clock />}
            title={t('summaryDue', { count: due.length, n: n(due.length) })}
          />
        ) : (
          <Banner tone="success" icon={<CircleCheck />} title={t('summaryAllDone')} />
        )}
        {documentsCard}

        {due.map((r) => (
          <Card key={rowKey(r)} className="p-4">
            {heading(
              r,
              `${place(r)}${t(`category.${r.category}`)} · ${t(`frequency.${r.frequency}`)}`,
              null,
            )}
            {canRecord ? (
              <>
                {doneForm(r, false)}
                {problemForm(r, false)}
              </>
            ) : null}
          </Card>
        ))}

        {recorded.length > 0 ? (
          <details className="glass-tile rounded-card p-4">
            <summary className="cursor-pointer font-semibold">
              {t('recordedTitle', { n: n(recorded.length) })}
            </summary>
            <ul className="mt-3 space-y-3">
              {recorded.map((r) => (
                <li key={rowKey(r)}>
                  {heading(
                    r,
                    `${place(r)}${r.note ?? t(`frequency.${r.frequency}`)}`,
                    <StatusBadge tone={STATE_TONE[r.state]}>{t(`state.${r.state}`)}</StatusBadge>,
                  )}
                  {canRecord ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-secondary">
                        {t('change')}
                      </summary>
                      {doneForm(r, false)}
                      {problemForm(r, false)}
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {missing.length > 0 ? (
          <details className="glass-tile rounded-card p-4">
            <summary className="cursor-pointer font-semibold">
              {t('missingTitle', { n: n(missing.length), days: n(DAYS) })}
            </summary>
            <ul className="mt-3 space-y-3">
              {missing.map((r) => (
                <li key={rowKey(r)}>
                  {heading(
                    r,
                    `${place(r)}${
                      r.period_start === r.period_end
                        ? day(r.period_start)
                        : `${day(r.period_start)} – ${day(r.period_end)}`
                    }`,
                    <StatusBadge tone="danger">{t('state.missing')}</StatusBadge>,
                  )}
                  {canRecord ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-secondary">
                        {t('recordLate')}
                      </summary>
                      {doneForm(r, true)}
                      {problemForm(r, true)}
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
            <Hint className="mt-3">{t('lateHint')}</Hint>
          </details>
        ) : null}

        {summaries.map((s) =>
          s.score_bps === null ? null : (
            <Hint key={s.branch_id}>
              {showBranch ? `${branchName(s.branch_id)}: ` : ''}
              {t('scoreLine', { score: formatBps(Number(s.score_bps), loc), days: n(DAYS) })}
            </Hint>
          ),
        )}

        {checkList}
      </div>
    </>
  );
}
