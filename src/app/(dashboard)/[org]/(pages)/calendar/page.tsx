import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
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
} from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { addDays } from '@/lib/time/business-date';
import { addCalendarEventAction, deleteCalendarEventAction } from '@/modules/forecasting/actions';
import { businessToday } from '@/modules/metrics/queries';
import { getOrgContext } from '@/modules/tenancy/context';

const KINDS = [
  'ramadan',
  'iftar_window',
  'eid',
  'holiday',
  'salary_week',
  'weather',
  'hartal',
  'cricket',
  'custom',
] as const;

/** The Bangladesh calendar the forecast reads (ROADMAP Phase 7). Everyone sees it; the owner edits it. */
export default async function CalendarPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (ctx.roles.length === 0) notFound();
  const t = await getTranslations('calendar');
  const { date: today } = await businessToday(ctx.org.id);
  const supabase = await createClient();
  const { data: events } = await supabase
    .from('calendar_events')
    .select('id, name, kind, starts_on, ends_on, closed, note, source')
    .eq('org_id', ctx.org.id)
    .gte('ends_on', addDays(today, -60))
    .order('starts_on');
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );
  const upcoming = (events ?? []).filter((e) => (e.ends_on as string) >= today);
  const past = (events ?? []).filter((e) => (e.ends_on as string) < today).reverse();
  const list = (rows: typeof upcoming) =>
    rows.length === 0 ? (
      <EmptyState title={t('none')} />
    ) : (
      <ul className="space-y-2">
        {rows.map((e) => (
          <li
            key={e.id}
            className="glass-tile flex flex-wrap items-center justify-between gap-2 rounded-input p-3"
          >
            <div>
              <p className="font-semibold">{e.name}</p>
              <p className="text-xs text-secondary">
                {e.starts_on === e.ends_on
                  ? e.starts_on
                  : t('range', { from: e.starts_on as string, to: e.ends_on as string })}
                {e.note ? ` · ${e.note as string}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge tone={e.closed ? 'danger' : 'info'}>
                {e.closed ? t('closed') : t(`kinds.${e.kind as string}`)}
              </StatusBadge>
              {ctx.isOwner ? (
                <form action={deleteCalendarEventAction}>
                  {hidden}
                  <input type="hidden" name="id" value={e.id as string} />
                  <Button type="submit" size="sm" variant="ghost">
                    {t('remove')}
                  </Button>
                </form>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {ctx.isOwner ? (
          <Card>
            <CardTitle>{t('addTitle')}</CardTitle>
            <ActionForm
              action={addCalendarEventAction}
              successKey="common.saved"
              className="space-y-3"
            >
              {hidden}
              <div>
                <Label htmlFor="c-name">{t('name')}</Label>
                <Input id="c-name" name="name" required maxLength={120} />
              </div>
              <div>
                <Label htmlFor="c-kind">{t('kind')}</Label>
                <Select id="c-kind" name="kind" defaultValue="holiday">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="c-from">{t('from')}</Label>
                  <Input id="c-from" name="startsOn" type="date" required />
                </div>
                <div>
                  <Label htmlFor="c-to">{t('to')}</Label>
                  <Input id="c-to" name="endsOn" type="date" required />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="closed" className="size-4" />
                {t('closedLabel')}
              </label>
              <div>
                <Label htmlFor="c-note">{t('note')}</Label>
                <Input id="c-note" name="note" maxLength={300} />
              </div>
              <Hint>{t('verifyHint')}</Hint>
              <Button type="submit">{t('add')}</Button>
            </ActionForm>
          </Card>
        ) : null}
        <div className="space-y-6">
          <Card>
            <CardTitle>{t('upcoming')}</CardTitle>
            {list(upcoming)}
          </Card>
          <Card>
            <CardTitle>{t('recent')}</CardTitle>
            {list(past)}
          </Card>
        </div>
      </div>
    </>
  );
}
