import { Check, Clock, Umbrella, Users, X } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { DeleteNoteButton } from '@/components/delete-note-button';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardTitle,
  EmptyState,
  Hint,
  Label,
  PageTitle,
  Select,
  Textarea,
} from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import { formatDhakaDate, formatNumber, type Locale } from '@/lib/i18n/format';
import { addDays } from '@/lib/time/business-date';
import { businessToday } from '@/modules/metrics/queries';
import { addNoteAction, markAllPresentAction, markAttendanceAction } from '@/modules/staff/actions';
import { getOrgContext, pickBranch } from '@/modules/tenancy/context';

type Tab = 'attendance' | 'notes';
const STATUSES = ['present', 'half_day', 'leave', 'absent'] as const;
const STATUS_ICON = { present: Check, half_day: Clock, leave: Umbrella, absent: X } as const;
// Summary columns come back as present, half_day, on_leave, absent.
const SUMMARY_KEY = {
  present: 'present',
  half_day: 'half_day',
  leave: 'on_leave',
  absent: 'absent',
} as const;

/**
 * Staff records (ROADMAP Phase 10), in plain words and big tap targets: who came today (one tap each, or
 * everyone at once), and private notes about a person or the restaurant (ADR 0055; owner and managers).
 */
export default async function StaffRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ tab?: string; branch?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  const has = (r: string) => ctx.roles.includes(r as never);
  if (!['owner', 'manager', 'accountant'].some(has)) notFound();
  const canMark = has('owner') || has('manager');
  // Notes can be about a person, so only the owner and managers see them.
  const tabs: Tab[] = ['attendance', ...(canMark ? (['notes'] as const) : [])];
  const tab = (tabs as string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : tabs[0]!;
  const branch = pickBranch(ctx, sp.branch);
  if (!branch) notFound();
  const [t, locale] = await Promise.all([getTranslations('staffRecords'), getLocale()]);
  const loc = locale as Locale;
  const { date: today } = await businessToday(ctx.org.id);
  const from = addDays(today, -29);
  const supabase = await createClient();
  const num = (v: unknown) => formatNumber(Number(v ?? 0), loc);
  const href = (x: { tab?: Tab; branch?: string }) =>
    `/${ctx.org.slug}/staff/records?tab=${x.tab ?? tab}&branch=${x.branch ?? branch.id}`;
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );
  const { data: staff } = await supabase
    .from('staff')
    .select('id, display_name')
    .eq('org_id', ctx.org.id)
    .eq('branch_id', branch.id)
    .eq('is_active', true)
    .order('display_name');

  let body: React.ReactNode;
  if (tab === 'attendance') {
    const [{ data: todayRows }, { data: summary }] = await Promise.all([
      supabase
        .from('attendance')
        .select('staff_id, status')
        .eq('org_id', ctx.org.id)
        .eq('branch_id', branch.id)
        .eq('work_date', today),
      supabase.rpc('metric_attendance', {
        p_org: ctx.org.id,
        p_branch: branch.id,
        p_from: from,
        p_to: today,
      }),
    ]);
    const marked = new Map(
      (todayRows ?? []).map((r) => [r.staff_id as string, r.status as string]),
    );
    const total = (staff ?? []).length;
    const done = (staff ?? []).filter((s) => marked.has(s.id)).length;
    body = (
      <div className="mx-auto max-w-2xl space-y-5">
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="mb-0">{t('todayTitle', { date: today })}</CardTitle>
            {total > 0 ? (
              <span className="text-sm text-secondary">
                {done === total
                  ? t('allMarked')
                  : t('markedOf', { marked: num(done), total: num(total) })}
              </span>
            ) : null}
          </div>
          {total === 0 ? (
            <EmptyState title={t('noStaff')} body={t('noStaffBody')} />
          ) : (
            <>
              {canMark && done < total ? (
                <ActionForm
                  action={markAllPresentAction}
                  successKey="common.saved"
                  className="mb-3"
                >
                  <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                  <input type="hidden" name="branchId" value={branch.id} />
                  <input type="hidden" name="date" value={today} />
                  <Button type="submit" variant="secondary">
                    <Users aria-hidden className="size-4" />
                    {t('markAll')}
                  </Button>
                  <Hint className="mt-1">{t('markAllHint')}</Hint>
                </ActionForm>
              ) : null}
              <ul className="space-y-3">
                {(staff ?? []).map((s) => (
                  <li key={s.id} className="glass-tile rounded-input p-3">
                    <p className="mb-2 font-semibold">{s.display_name}</p>
                    {canMark ? (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {STATUSES.map((st) => {
                          const Icon = STATUS_ICON[st];
                          const on = marked.get(s.id) === st;
                          return (
                            <form key={st} action={markAttendanceAction}>
                              <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                              <input type="hidden" name="staffId" value={s.id} />
                              <input type="hidden" name="date" value={today} />
                              <input type="hidden" name="status" value={st} />
                              <Button
                                type="submit"
                                size="sm"
                                variant={on ? 'primary' : 'secondary'}
                                aria-pressed={on}
                                className="w-full"
                              >
                                <Icon aria-hidden className="size-4" />
                                {t(`status.${st}`)}
                              </Button>
                            </form>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-secondary">
                        {marked.get(s.id) ? t(`status.${marked.get(s.id)}`) : t('unmarked')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {total > 0 ? (
          <Card className="p-4 sm:p-5">
            <CardTitle>{t('summaryTitle')}</CardTitle>
            <ul className="space-y-3">
              {((summary ?? []) as Record<string, unknown>[]).map((r) => (
                <li
                  key={r.staff_id as string}
                  className="border-t border-line pt-3 first:border-t-0 first:pt-0"
                >
                  <p className="font-semibold">{r.display_name as string}</p>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                    {STATUSES.map((st) => (
                      <span key={st} className="inline-flex items-center gap-1">
                        {(() => {
                          const Icon = STATUS_ICON[st];
                          return <Icon aria-hidden className="size-3.5 text-secondary" />;
                        })()}
                        {`${t(`status.${st}`)}: `}
                        <b>{num(r[SUMMARY_KEY[st]])}</b>
                      </span>
                    ))}
                    {Number(r.unmarked ?? 0) > 0 ? (
                      <span className="text-secondary">
                        {`${t('unmarked')}: ${num(r.unmarked)}`}
                      </span>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
            <Hint className="mt-3">{t('summaryHint')}</Hint>
          </Card>
        ) : null}
      </div>
    );
  } else {
    const { data: noteRows } = await supabase
      .from('notes')
      .select('id, staff_id, body, created_at')
      .eq('org_id', ctx.org.id)
      .eq('branch_id', branch.id)
      .order('created_at', { ascending: false })
      .limit(100);
    const names = new Map((staff ?? []).map((s) => [s.id as string, s.display_name as string]));
    body = (
      <div className="mx-auto max-w-2xl space-y-5">
        <Card className="p-4 sm:p-5">
          <CardTitle>{t('noteTitle')}</CardTitle>
          <ActionForm action={addNoteAction} successKey="common.saved" className="space-y-3">
            {hidden}
            <input type="hidden" name="branchId" value={branch.id} />
            <div>
              <Label htmlFor="note-body">{t('noteLabel')}</Label>
              <Textarea
                id="note-body"
                name="body"
                rows={3}
                required
                maxLength={2000}
                placeholder={t('notePlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="note-about">{t('noteAbout')}</Label>
              <Select id="note-about" name="staffId" defaultValue="">
                <option value="">{t('aboutRestaurant')}</option>
                {(staff ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display_name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit">{t('noteSave')}</Button>
          </ActionForm>
          <Hint className="mt-3">{t('notesHint')}</Hint>
        </Card>

        <Card className="p-4 sm:p-5">
          <CardTitle>{t('notesTitle')}</CardTitle>
          {(noteRows ?? []).length === 0 ? (
            <EmptyState title={t('noNotes')} body={t('noNotesBody')} />
          ) : (
            <ul className="space-y-3">
              {(noteRows ?? []).map((n) => (
                <li key={n.id} className="glass-tile rounded-input p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-secondary">
                        {n.staff_id && names.get(n.staff_id as string)
                          ? t('aboutPerson', { name: names.get(n.staff_id as string) ?? '' })
                          : t('aboutRestaurant')}
                        {` · ${formatDhakaDate(new Date(n.created_at as string), loc)}`}
                      </p>
                      <p className="mt-1 text-sm whitespace-pre-wrap">{n.body as string}</p>
                    </div>
                    {canMark ? (
                      <DeleteNoteButton
                        orgId={ctx.org.id}
                        orgSlug={ctx.org.slug}
                        noteId={n.id as string}
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    );
  }

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {tabs.length > 1 ? (
          <PillNav
            label={t('sections')}
            items={tabs.map((x) => ({
              href: href({ tab: x }),
              label: t(`tabs.${x}`),
              active: x === tab,
            }))}
          />
        ) : (
          <span />
        )}
        {ctx.branches.length > 1 ? (
          <PillNav
            label={t('branches')}
            items={ctx.branches.map((b) => ({
              href: href({ branch: b.id }),
              label: b.name,
              active: b.id === branch.id,
            }))}
          />
        ) : null}
      </div>
      {body}
    </>
  );
}
