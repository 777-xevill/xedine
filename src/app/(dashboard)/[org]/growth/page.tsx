import { Sparkles } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Card,
  CardTitle,
  EmptyState,
  Hint,
  Input,
  Label,
  PageTitle,
  Textarea,
} from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { aiConfigured } from '@/lib/llm-gateway';
import { now } from '@/lib/time/clock';
import {
  approveGrowthDraftAction,
  discardGrowthDraftAction,
  draftGrowthIdeaAction,
  markGrowthPostedAction,
  writeGrowthIdeaAction,
} from '@/modules/growth/actions';
import { getOrgContext } from '@/modules/tenancy/context';

const STATUS_TONE = {
  draft: 'neutral',
  approved: 'info',
  posted: 'success',
  discarded: 'neutral',
} as const;

/**
 * Growth (ROADMAP Phase 10, PRODUCT.md M17: optional, no auto-posting). Content ideas grounded in real
 * sales data, approved by a person before use, with a simple calendar. Growth/Chain plans only.
 */
export default async function GrowthPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.roles.includes('owner') && !ctx.roles.includes('manager')) notFound();
  const [t, locale] = await Promise.all([getTranslations('growth'), getLocale()]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const [{ data: inputs }, { data: drafts }] = await Promise.all([
    supabase.rpc('metric_growth_inputs', {
      p_org: ctx.org.id,
      p_branch: ctx.selectedBranchId,
      p_now: now().toISOString(),
    }),
    supabase
      .from('growth_content_drafts')
      .select(
        'id, kind, title, hook, shot_list, caption_bn, caption_en, target_date, status, model',
      )
      .eq('org_id', ctx.org.id)
      .neq('status', 'discarded')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);
  const row = ((inputs ?? []) as Record<string, unknown>[])[0];
  const list = (drafts ?? []) as {
    id: string;
    kind: string;
    title: string;
    hook: string | null;
    shot_list: string | null;
    caption_bn: string | null;
    caption_en: string | null;
    target_date: string | null;
    status: keyof typeof STATUS_TONE;
    model: string | null;
  }[];
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
      <input type="hidden" name="branchId" value={ctx.selectedBranchId ?? ''} />
    </>
  );
  const scheduled = list
    .filter((d) => d.status === 'approved' && d.target_date)
    .sort((a, b) => a.target_date!.localeCompare(b.target_date!));

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      {!aiConfigured() ? (
        <Alert tone="warning" className="mb-6">
          {t('aiNotConfigured')}
        </Alert>
      ) : null}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>{t('pushItemTitle')}</CardTitle>
          {row?.top_item_name ? (
            <>
              <p className="text-sm text-secondary">
                {t('pushItemFact', {
                  item: String(row.top_item_name),
                  qty: formatNumber(Number(row.top_item_qty), loc),
                })}
              </p>
              <ActionForm
                action={draftGrowthIdeaAction}
                successKey="growth.drafted"
                className="mt-3"
              >
                {hidden}
                <input type="hidden" name="kind" value="push_item" />
                <Button type="submit" size="sm" variant="secondary" disabled={!aiConfigured()}>
                  <Sparkles aria-hidden className="size-4" />
                  {t('draftIdea')}
                </Button>
              </ActionForm>
            </>
          ) : (
            <EmptyState title={t('noSalesYet')} />
          )}
        </Card>
        <Card>
          <CardTitle>{t('fixDaypartTitle')}</CardTitle>
          {row?.weak_daypart ? (
            <>
              <p className="text-sm text-secondary">
                {t('fixDaypartFact', {
                  weak: String(row.weak_daypart),
                  weakShare: formatBps(Number(row.weak_daypart_share_bps), loc),
                  strong: String(row.strong_daypart),
                  strongShare: formatBps(Number(row.strong_daypart_share_bps), loc),
                })}
              </p>
              <ActionForm
                action={draftGrowthIdeaAction}
                successKey="growth.drafted"
                className="mt-3"
              >
                {hidden}
                <input type="hidden" name="kind" value="fix_daypart" />
                <Button type="submit" size="sm" variant="secondary" disabled={!aiConfigured()}>
                  <Sparkles aria-hidden className="size-4" />
                  {t('draftIdea')}
                </Button>
              </ActionForm>
            </>
          ) : (
            <EmptyState title={t('noSalesYet')} />
          )}
        </Card>
      </div>

      {scheduled.length > 0 ? (
        <Card className="mb-6">
          <CardTitle>{t('calendarTitle')}</CardTitle>
          <ul className="space-y-2">
            {scheduled.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 border-t border-line pt-2 text-sm"
              >
                <span>
                  <span className="font-semibold tabular-nums">{d.target_date}</span> — {d.title}
                </span>
                <form action={markGrowthPostedAction}>
                  {hidden}
                  <input type="hidden" name="draftId" value={d.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    {t('markPosted')}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardTitle>{t('writeOwnTitle')}</CardTitle>
          <ActionForm
            action={writeGrowthIdeaAction}
            successKey="common.saved"
            className="space-y-3"
          >
            {hidden}
            <div>
              <Label htmlFor="gr-title">{t('ideaTitle')}</Label>
              <Input id="gr-title" name="title" required maxLength={120} />
            </div>
            <div>
              <Label htmlFor="gr-hook">{t('hook')}</Label>
              <Input id="gr-hook" name="hook" maxLength={300} />
            </div>
            <div>
              <Label htmlFor="gr-shots">{t('shotList')}</Label>
              <Textarea id="gr-shots" name="shotList" rows={2} maxLength={600} />
            </div>
            <div>
              <Label htmlFor="gr-bn">{t('captionBn')}</Label>
              <Textarea id="gr-bn" name="captionBn" rows={3} maxLength={900} />
            </div>
            <div>
              <Label htmlFor="gr-en">{t('captionEn')}</Label>
              <Textarea id="gr-en" name="captionEn" rows={3} maxLength={900} />
            </div>
            <Button type="submit">{t('save')}</Button>
          </ActionForm>
        </Card>

        <div className="space-y-4">
          {list.length === 0 ? (
            <EmptyState title={t('none')} body={t('noneBody')} />
          ) : (
            list.map((d) => (
              <Card key={d.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold">{d.title}</h2>
                    {d.hook ? <p className="text-xs text-secondary">{d.hook}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {d.model ? (
                      <Badge tone="accent" icon={<Sparkles />}>
                        {t('aiDraft')}
                      </Badge>
                    ) : null}
                    <StatusBadge tone={STATUS_TONE[d.status]}>
                      {t(`status.${d.status}`)}
                    </StatusBadge>
                  </div>
                </div>
                {d.shot_list ? <p className="mt-2 text-sm text-secondary">{d.shot_list}</p> : null}
                {d.caption_bn ? (
                  <p className="glass-tile mt-2 rounded-input p-3 text-sm">{d.caption_bn}</p>
                ) : null}
                {d.caption_en ? (
                  <p className="glass-tile mt-2 rounded-input p-3 text-sm">{d.caption_en}</p>
                ) : null}
                {d.status === 'draft' ? (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                    <ActionForm
                      action={approveGrowthDraftAction}
                      successKey="growth.approved"
                      className="flex flex-wrap items-end gap-2"
                    >
                      {hidden}
                      <input type="hidden" name="draftId" value={d.id} />
                      <div>
                        <Label htmlFor={`date-${d.id}`}>{t('targetDate')}</Label>
                        <Input id={`date-${d.id}`} name="targetDate" type="date" />
                      </div>
                      <Button type="submit" size="sm">
                        {t('approve')}
                      </Button>
                    </ActionForm>
                    <form action={discardGrowthDraftAction}>
                      {hidden}
                      <input type="hidden" name="draftId" value={d.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        {t('discard')}
                      </Button>
                    </form>
                  </div>
                ) : null}
              </Card>
            ))
          )}
        </div>
      </div>
      <Hint className="mt-6">{t('noAutoPost')}</Hint>
    </>
  );
}
