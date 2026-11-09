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
  Textarea,
} from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import { businessToday } from '@/modules/metrics/queries';
import {
  addIncidentActionAction,
  completeIncidentActionAction,
  openIncidentAction,
  reopenIncidentAction,
  saveIncidentAction,
} from '@/modules/reviews/incident-actions';
import { getOrgContext } from '@/modules/tenancy/context';

const KINDS = ['complaint', 'food_safety', 'hygiene', 'injury', 'equipment', 'other'] as const;
const SEVERITIES = ['low', 'medium', 'high'] as const;
const SOURCES = ['in_person', 'phone', 'facebook', 'foodpanda', 'google', 'other'] as const;
const STATUS_TONE = { open: 'danger', in_progress: 'warning', resolved: 'success' } as const;
const SEVERITY_TONE = { low: 'info', medium: 'warning', high: 'danger' } as const;

interface Incident {
  id: string;
  branch_id: string;
  kind: (typeof KINDS)[number];
  severity: (typeof SEVERITIES)[number];
  status: keyof typeof STATUS_TONE;
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

interface Action {
  id: string;
  incident_id: string;
  kind: 'corrective' | 'note';
  body: string;
  due_on: string | null;
  done_at: string | null;
}

/**
 * Complaints (ADR 0043): one record from "the customer said" to "this is what we changed". A case closes
 * only with its cause, what the customer got, and every corrective action done.
 */
export default async function ComplaintsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.roles.includes('owner') && !ctx.roles.includes('manager')) notFound();
  const [t, locale] = await Promise.all([getTranslations('complaints'), getLocale()]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const args = { p_org: ctx.org.id, p_branch: ctx.selectedBranchId, p_now: now().toISOString() };
  const [{ date: today }, list, summary, ingredients] = await Promise.all([
    businessToday(ctx.org.id),
    supabase.rpc('metric_incidents', args),
    supabase.rpc('metric_incident_summary', args),
    supabase
      .from('ingredients')
      .select('id, name, name_bn')
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
  const branchName = (id: string) => ctx.branches.find((b) => b.id === id)?.name ?? '';
  const showBranch = ctx.branches.length > 1;
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );
  const median = s.median_hours_to_resolve;

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t('statOpen')}
          value={n(Number(s.open_count ?? 0) + Number(s.in_progress_count ?? 0))}
        />
        <Stat label={t('statHigh')} value={n(s.high_unresolved)} />
        <Stat label={t('statOverdue')} value={n(s.overdue_actions)} />
        <Stat
          label={t('statHours')}
          value={median === null || median === undefined ? '—' : n(median)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {incidents.length === 0 ? (
            <Card>
              <EmptyState title={t('none')} />
            </Card>
          ) : (
            incidents.map((x) => {
              const steps = actions.get(x.id) ?? [];
              const closed = x.status === 'resolved';
              const ingredient =
                loc === 'bn' && x.ingredient_name_bn ? x.ingredient_name_bn : x.ingredient_name;
              return (
                <Card key={x.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{x.title}</p>
                      <p className="text-xs text-secondary">
                        {showBranch ? `${branchName(x.branch_id)} · ` : ''}
                        {t(`kinds.${x.kind}`)} · {t(`sources.${x.source}`)} · {x.occurred_on}
                        {x.order_ref ? ` · ${x.order_ref}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge tone={SEVERITY_TONE[x.severity]}>
                        {t(`severities.${x.severity}`)}
                      </StatusBadge>
                      <StatusBadge tone={STATUS_TONE[x.status]}>
                        {t(`statuses.${x.status}`)}
                      </StatusBadge>
                    </div>
                  </div>
                  {x.details ? (
                    <p className="mt-2 text-sm whitespace-pre-wrap">{x.details}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-secondary">
                    {t('age', { count: x.age_days, n: n(x.age_days) })}
                    {ingredient ? ` · ${t('ingredient')}: ${ingredient}` : ''}
                    {Number(x.overdue_actions) > 0
                      ? ` · ${t('overdue', { n: n(x.overdue_actions) })}`
                      : ''}
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

                  <div className="mt-3 border-t border-line pt-3">
                    <p className="mb-2 text-sm font-semibold">{t('actionsTitle')}</p>
                    {steps.length === 0 ? (
                      <p className="text-sm text-secondary">{t('noActions')}</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {steps.map((a) => (
                          <li
                            key={a.id}
                            className="flex flex-wrap items-center justify-between gap-2"
                          >
                            <span>
                              {a.body}
                              {a.due_on ? (
                                <span className="ms-1 text-xs text-secondary">
                                  · {t('dueBy', { date: a.due_on })}
                                </span>
                              ) : null}
                            </span>
                            {a.kind === 'note' ? (
                              <StatusBadge tone="neutral">{t('note')}</StatusBadge>
                            ) : a.done_at ? (
                              <StatusBadge tone="success">{t('done')}</StatusBadge>
                            ) : closed ? null : (
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
                    )}
                    {!closed ? (
                      <ActionForm
                        action={addIncidentActionAction}
                        successKey="common.saved"
                        className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end"
                      >
                        {hidden}
                        <input type="hidden" name="incidentId" value={x.id} />
                        <div>
                          <Label htmlFor={`ab-${x.id}`}>{t('newAction')}</Label>
                          <Input
                            id={`ab-${x.id}`}
                            name="body"
                            required
                            maxLength={1000}
                            placeholder={t('newActionExample')}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`ak-${x.id}`}>{t('actionKind')}</Label>
                          <Select id={`ak-${x.id}`} name="kind" defaultValue="corrective">
                            <option value="corrective">{t('corrective')}</option>
                            <option value="note">{t('note')}</option>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor={`ad-${x.id}`}>{t('dueOn')}</Label>
                          <Input id={`ad-${x.id}`} name="dueOn" type="date" min={today} />
                        </div>
                        <Button type="submit" size="sm" variant="secondary">
                          {t('addAction')}
                        </Button>
                      </ActionForm>
                    ) : null}
                  </div>

                  {closed ? (
                    <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
                      <p>
                        <span className="font-semibold">{`${t('rootCause')}: `}</span>
                        {x.root_cause}
                      </p>
                      <p>
                        <span className="font-semibold">{`${t('customerResolution')}: `}</span>
                        {x.customer_resolution}
                      </p>
                      <details>
                        <summary className="cursor-pointer text-secondary">{t('reopen')}</summary>
                        <ActionForm
                          action={reopenIncidentAction}
                          successKey="common.saved"
                          className="mt-2 flex flex-wrap items-end gap-2"
                        >
                          {hidden}
                          <input type="hidden" name="incidentId" value={x.id} />
                          <div className="min-w-48 flex-1">
                            <Label htmlFor={`ro-${x.id}`}>{t('reopenReason')}</Label>
                            <Input id={`ro-${x.id}`} name="reason" required maxLength={300} />
                          </div>
                          <Button type="submit" size="sm" variant="secondary">
                            {t('reopen')}
                          </Button>
                        </ActionForm>
                      </details>
                    </div>
                  ) : (
                    <ActionForm
                      action={saveIncidentAction}
                      successKey="common.saved"
                      className="mt-3 space-y-2 border-t border-line pt-3"
                    >
                      {hidden}
                      <input type="hidden" name="incidentId" value={x.id} />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label htmlFor={`st-${x.id}`}>{t('status')}</Label>
                          <Select id={`st-${x.id}`} name="status" defaultValue={x.status}>
                            <option value="open">{t('statuses.open')}</option>
                            <option value="in_progress">{t('statuses.in_progress')}</option>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor={`sv-${x.id}`}>{t('severity')}</Label>
                          <Select id={`sv-${x.id}`} name="severity" defaultValue={x.severity}>
                            {SEVERITIES.map((v) => (
                              <option key={v} value={v}>
                                {t(`severities.${v}`)}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label htmlFor={`rc-${x.id}`}>{t('rootCause')}</Label>
                        <Textarea
                          id={`rc-${x.id}`}
                          name="rootCause"
                          rows={2}
                          maxLength={2000}
                          defaultValue={x.root_cause ?? ''}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`cr-${x.id}`}>{t('customerResolution')}</Label>
                        <Textarea
                          id={`cr-${x.id}`}
                          name="customerResolution"
                          rows={2}
                          maxLength={2000}
                          defaultValue={x.customer_resolution ?? ''}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="submit"
                          size="sm"
                          variant="secondary"
                          name="intent"
                          value="save"
                        >
                          {t('save')}
                        </Button>
                        <Button type="submit" size="sm" name="intent" value="resolve">
                          {t('resolve')}
                        </Button>
                      </div>
                    </ActionForm>
                  )}
                </Card>
              );
            })
          )}
        </div>

        <Card className="h-fit">
          <CardTitle>{t('openTitle')}</CardTitle>
          <ActionForm action={openIncidentAction} successKey="common.saved" className="space-y-3">
            {hidden}
            <div>
              <Label htmlFor="in-title">{t('whatHappened')}</Label>
              <Input
                id="in-title"
                name="title"
                required
                maxLength={160}
                placeholder={t('whatHappenedExample')}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="in-kind">{t('kind')}</Label>
                <Select id="in-kind" name="kind" defaultValue="complaint">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="in-sev">{t('severity')}</Label>
                <Select id="in-sev" name="severity" defaultValue="medium">
                  {SEVERITIES.map((v) => (
                    <option key={v} value={v}>
                      {t(`severities.${v}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="in-src">{t('source')}</Label>
                <Select id="in-src" name="source" defaultValue="in_person">
                  {SOURCES.map((v) => (
                    <option key={v} value={v}>
                      {t(`sources.${v}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="in-on">{t('date')}</Label>
                <Input
                  id="in-on"
                  name="occurredOn"
                  type="date"
                  max={today}
                  defaultValue={today}
                  required
                />
              </div>
              <div>
                <Label htmlFor="in-branch">{t('branch')}</Label>
                <Select
                  id="in-branch"
                  name="branchId"
                  defaultValue={ctx.selectedBranchId ?? ctx.branches[0]?.id ?? ''}
                >
                  {ctx.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="in-bill">{t('bill')}</Label>
                <Input id="in-bill" name="orderRef" maxLength={60} />
              </div>
            </div>
            <div>
              <Label htmlFor="in-details">{t('details')}</Label>
              <Textarea id="in-details" name="details" rows={3} maxLength={4000} />
            </div>
            <details>
              <summary className="cursor-pointer text-sm text-secondary">
                {t('foodRelated')}
              </summary>
              <div className="mt-2 space-y-2">
                <Label htmlFor="in-ing">{t('ingredient')}</Label>
                <Select id="in-ing" name="ingredientId" defaultValue="">
                  <option value="">{t('noIngredient')}</option>
                  {(ingredients.data ?? []).map((i) => (
                    <option key={i.id as string} value={i.id as string}>
                      {loc === 'bn' && i.name_bn ? (i.name_bn as string) : (i.name as string)}
                    </option>
                  ))}
                </Select>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="hold" />
                  {t('holdToo')}
                </label>
              </div>
            </details>
            <details>
              <summary className="cursor-pointer text-sm text-secondary">
                {t('customerDetails')}
              </summary>
              <div className="mt-2 space-y-2">
                <div>
                  <Label htmlFor="in-cn">{t('customerName')}</Label>
                  <Input id="in-cn" name="customerName" maxLength={120} autoComplete="off" />
                </div>
                <div>
                  <Label htmlFor="in-cp">{t('customerPhone')}</Label>
                  <Input
                    id="in-cp"
                    name="customerPhone"
                    type="tel"
                    maxLength={30}
                    autoComplete="off"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="contactOk" />
                  {t('contactOk')}
                </label>
              </div>
            </details>
            <Button type="submit">{t('open')}</Button>
          </ActionForm>
          <Hint className="mt-2">{t('openHint')}</Hint>
        </Card>
      </div>
    </>
  );
}
