import { CircleAlert, CircleCheck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { QrCode } from '@/components/qr-code';
import { Banner } from '@/components/stock/parts';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, Hint, Input, PageTitle, Select, Textarea } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { publicEnv } from '@/lib/env';
import { formatDhakaDate, formatNumber, type Locale } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import { businessToday } from '@/modules/metrics/queries';
import { complaintUrl } from '@/modules/reviews/complaint-link';
import {
  addIncidentActionAction,
  completeIncidentActionAction,
  reopenIncidentAction,
  resetComplaintLinkAction,
  saveIncidentAction,
} from '@/modules/reviews/incident-actions';
import { getOrgContext } from '@/modules/tenancy/context';

const SEVERITIES = ['low', 'medium', 'high'] as const;
const SEVERITY_TONE = { low: 'info', medium: 'warning', high: 'danger' } as const;

interface Incident {
  id: string;
  branch_id: string;
  kind: 'complaint' | 'food_safety' | 'hygiene' | 'injury' | 'equipment' | 'other';
  severity: (typeof SEVERITIES)[number];
  status: 'open' | 'in_progress' | 'resolved';
  source: string;
  title: string;
  details: string | null;
  occurred_on: string;
  order_ref: string | null;
  ingredient_name: string | null;
  ingredient_name_bn: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  contact_ok: boolean;
  root_cause: string | null;
  customer_resolution: string | null;
  age_days: number;
  corrective_actions: number;
  open_actions: number;
  overdue_actions: number;
}

interface BranchLink {
  id: string;
  name: string;
  complaint_token: string;
}

interface Action {
  id: string;
  incident_id: string;
  kind: 'corrective' | 'note';
  body: string;
  due_on: string | null;
  done_at: string | null;
}

/**
 * Complaints (ADR 0043), phone first: customers write them by scanning the branch's QR code, and they appear
 * here. Each open case walks through three plain steps. A case closes only with its cause, what the customer
 * got, and every corrective action done.
 */
export default async function ComplaintsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.roles.includes('owner') && !ctx.roles.includes('manager')) notFound();
  const [t, locale] = await Promise.all([getTranslations('complaints'), getLocale()]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const args = { p_org: ctx.org.id, p_branch: ctx.selectedBranchId, p_now: now().toISOString() };
  const [{ date: today }, list, summary, branchRows] = await Promise.all([
    businessToday(ctx.org.id),
    supabase.rpc('metric_incidents', args),
    supabase.rpc('metric_incident_summary', args),
    supabase
      .from('branches')
      .select('id, name, complaint_token')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .order('name'),
  ]);
  const incidents = (list.data ?? []) as Incident[];
  const s = ((summary.data ?? []) as Record<string, unknown>[])[0] ?? {};
  const { data: actionRows } =
    incidents.length > 0
      ? await supabase
          .from('incident_actions')
          .select('id, incident_id, kind, body, due_on, done_at')
          .eq('org_id', ctx.org.id)
          .in(
            'incident_id',
            incidents.map((i) => i.id),
          )
          .order('created_at')
      : { data: [] as Action[] };
  const actions = new Map<string, Action[]>();
  for (const a of (actionRows ?? []) as Action[])
    actions.set(a.incident_id, [...(actions.get(a.incident_id) ?? []), a]);

  const n = (v: unknown) => formatNumber(Number(v ?? 0), loc);
  const day = (d: string) => formatDhakaDate(new Date(`${d}T06:00:00Z`), loc);
  const branchName = (id: string) => ctx.branches.find((b) => b.id === id)?.name ?? '';
  const showBranch = ctx.branches.length > 1;
  const open = incidents.filter((x) => x.status !== 'resolved');
  const closed = incidents.filter((x) => x.status === 'resolved');
  const overdue = Number(s.overdue_actions ?? 0);
  const median = s.median_hours_to_resolve;
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const links = ((branchRows.data ?? []) as BranchLink[]).filter((b) =>
    ctx.selectedBranchId ? b.id === ctx.selectedBranchId : ctx.branches.some((c) => c.id === b.id),
  );
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );

  const header = (x: Incident) => (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-semibold">{x.title}</p>
        <p className="text-xs text-secondary">
          {showBranch ? `${branchName(x.branch_id)} · ` : ''}
          {t(`kinds.${x.kind}`)} · {day(x.occurred_on)}
          {x.order_ref ? ` · ${x.order_ref}` : ''}
        </p>
      </div>
      <StatusBadge tone={x.status === 'resolved' ? 'success' : SEVERITY_TONE[x.severity]}>
        {x.status === 'resolved' ? t('statuses.resolved') : t(`severities.${x.severity}`)}
      </StatusBadge>
    </div>
  );

  const facts = (x: Incident) => {
    const ingredient =
      loc === 'bn' && x.ingredient_name_bn ? x.ingredient_name_bn : x.ingredient_name;
    return (
      <>
        {x.details && x.details !== x.title ? (
          <p className="mt-2 text-sm whitespace-pre-wrap">{x.details}</p>
        ) : null}
        <p className="mt-2 text-xs text-secondary">
          {t('age', { count: x.age_days, n: n(x.age_days) })} · {t(`sources.${x.source}`)}
          {ingredient ? ` · ${t('ingredient')}: ${ingredient}` : ''}
          {Number(x.overdue_actions) > 0 ? ` · ${t('overdue', { n: n(x.overdue_actions) })}` : ''}
        </p>
        {x.customer_name || x.customer_phone ? (
          <p className="mt-1 text-sm">
            {x.customer_name ?? t('customer')}
            {x.customer_phone && x.contact_ok ? (
              <>
                {' · '}
                <a
                  className="text-info underline-offset-4 hover:underline"
                  href={`tel:${x.customer_phone}`}
                >
                  {x.customer_phone}
                </a>
              </>
            ) : null}
            {x.customer_phone && !x.contact_ok ? ` · ${t('noContact')}` : ''}
          </p>
        ) : null}
      </>
    );
  };

  const stepTitle = (step: number, text: string) => (
    <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-xs"
      >
        {n(step)}
      </span>
      {text}
    </p>
  );

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} actions={<LocaleSwitcher />} />
      <div className="mx-auto max-w-2xl space-y-5">
        {open.length > 0 ? (
          <Banner
            tone={overdue > 0 ? 'danger' : 'warning'}
            icon={<CircleAlert />}
            title={t('summaryOpen', { count: open.length, n: n(open.length) })}
            body={overdue > 0 ? t('summaryOverdue', { n: n(overdue) }) : undefined}
          />
        ) : (
          <Banner tone="success" icon={<CircleCheck />} title={t('summaryNone')} />
        )}

        {open.map((x) => {
          const steps = actions.get(x.id) ?? [];
          return (
            <Card key={x.id} className="p-4 sm:p-5">
              {header(x)}
              {facts(x)}

              <div className="mt-4 border-t border-line pt-3">
                {stepTitle(1, t('stepChange'))}
                {steps.length > 0 ? (
                  <ul className="mb-3 space-y-2 text-sm">
                    {steps.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0">
                          {a.body}
                          {a.due_on ? (
                            <span className="ms-1 text-xs text-secondary">
                              · {t('dueBy', { date: day(a.due_on) })}
                            </span>
                          ) : null}
                        </span>
                        {a.kind === 'note' ? (
                          <StatusBadge tone="neutral">{t('note')}</StatusBadge>
                        ) : a.done_at ? (
                          <StatusBadge tone="success">{t('done')}</StatusBadge>
                        ) : (
                          <ActionForm action={completeIncidentActionAction}>
                            {hidden}
                            <input type="hidden" name="actionId" value={a.id} />
                            <Button type="submit" size="sm" variant="secondary">
                              {t('markDone')}
                            </Button>
                          </ActionForm>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <ActionForm action={addIncidentActionAction} successKey="common.saved">
                  {hidden}
                  <input type="hidden" name="incidentId" value={x.id} />
                  <input type="hidden" name="kind" value="corrective" />
                  <div className="flex gap-2">
                    <Input
                      name="body"
                      required
                      maxLength={1000}
                      placeholder={t('newActionExample')}
                      aria-label={t('stepChange')}
                      className="min-w-0 flex-1"
                    />
                    <Button type="submit" size="sm" variant="secondary">
                      {t('addAction')}
                    </Button>
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-secondary">
                      {t('addDate')}
                    </summary>
                    <Input
                      name="dueOn"
                      type="date"
                      min={today}
                      aria-label={t('dueOn')}
                      className="mt-1 w-44"
                    />
                  </details>
                </ActionForm>
              </div>

              <ActionForm
                action={saveIncidentAction}
                successKey="common.saved"
                className="mt-4 space-y-4 border-t border-line pt-3"
              >
                {hidden}
                <input type="hidden" name="incidentId" value={x.id} />
                <input type="hidden" name="status" value={x.status} />
                <div>
                  {stepTitle(2, t('rootCause'))}
                  <Textarea
                    name="rootCause"
                    rows={2}
                    maxLength={2000}
                    defaultValue={x.root_cause ?? ''}
                    aria-label={t('rootCause')}
                  />
                </div>
                <div>
                  {stepTitle(3, t('customerResolution'))}
                  <Textarea
                    name="customerResolution"
                    rows={2}
                    maxLength={2000}
                    defaultValue={x.customer_resolution ?? ''}
                    aria-label={t('customerResolution')}
                  />
                </div>
                <details>
                  <summary className="cursor-pointer text-xs text-secondary">
                    {t('changeSeverity')}
                  </summary>
                  <Select
                    name="severity"
                    defaultValue={x.severity}
                    aria-label={t('severity')}
                    className="mt-1"
                  >
                    {SEVERITIES.map((v) => (
                      <option key={v} value={v}>
                        {t(`severities.${v}`)}
                      </option>
                    ))}
                  </Select>
                </details>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" name="intent" value="resolve">
                    {t('resolve')}
                  </Button>
                  <Button type="submit" size="sm" variant="ghost" name="intent" value="save">
                    {t('save')}
                  </Button>
                </div>
              </ActionForm>
            </Card>
          );
        })}

        <Card className="p-4 sm:p-5">
          <CardTitle>{t('linkTitle')}</CardTitle>
          <Hint>{t('linkHint')}</Hint>
          <ul className="mt-3 space-y-4">
            {links.map((b) => {
              const url = complaintUrl(site, b.complaint_token);
              return (
                <li key={b.id} className="flex flex-wrap items-start gap-4">
                  <QrCode value={url} label={t('linkQr')} className="size-32 rounded-input" />
                  <div className="min-w-0 flex-1 space-y-2">
                    {showBranch ? <p className="font-semibold">{b.name}</p> : null}
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-purple underline"
                    >
                      {t('linkOpen')}
                    </a>
                    <details className="text-sm">
                      <summary className="cursor-pointer text-xs text-secondary">
                        {t('linkResetSummary')}
                      </summary>
                      <Hint className="mt-1">{t('linkResetHint')}</Hint>
                      <ActionForm
                        action={resetComplaintLinkAction}
                        successKey="common.saved"
                        className="mt-2"
                      >
                        {hidden}
                        <input type="hidden" name="branchId" value={b.id} />
                        <Button type="submit" size="sm" variant="secondary">
                          {t('linkReset')}
                        </Button>
                      </ActionForm>
                    </details>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        {closed.length > 0 ? (
          <details className="glass-tile rounded-card p-4">
            <summary className="cursor-pointer font-semibold">
              {t('closedTitle', { n: n(closed.length) })}
            </summary>
            <ul className="mt-3 space-y-4">
              {closed.map((x) => (
                <li key={x.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                  {header(x)}
                  <details className="mt-1 text-sm">
                    <summary className="cursor-pointer text-xs text-secondary">
                      {t('seeWhatWasDone')}
                    </summary>
                    {facts(x)}
                    <ul className="mt-2 space-y-1">
                      {(actions.get(x.id) ?? []).map((a) => (
                        <li key={a.id}>{a.body}</li>
                      ))}
                    </ul>
                    <p className="mt-2">
                      <span className="font-semibold">{`${t('rootCause')}: `}</span>
                      {x.root_cause}
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold">{`${t('customerResolution')}: `}</span>
                      {x.customer_resolution}
                    </p>
                    <ActionForm
                      action={reopenIncidentAction}
                      successKey="common.saved"
                      className="mt-2 flex gap-2"
                    >
                      {hidden}
                      <input type="hidden" name="incidentId" value={x.id} />
                      <Input
                        name="reason"
                        required
                        maxLength={300}
                        placeholder={t('reopenReason')}
                        aria-label={t('reopenReason')}
                        className="min-w-0 flex-1"
                      />
                      <Button type="submit" size="sm" variant="secondary">
                        {t('reopen')}
                      </Button>
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
            {median === null || median === undefined ? null : (
              <Hint className="mt-3">{t('usualHours', { n: n(median) })}</Hint>
            )}
          </details>
        ) : null}
      </div>
    </>
  );
}
