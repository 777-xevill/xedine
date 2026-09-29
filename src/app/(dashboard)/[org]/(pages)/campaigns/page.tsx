import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { StatusBadge } from '@/components/ui/badge';
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
  Select,
  Textarea,
} from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import {
  approveCampaignAction,
  createCampaignAction,
  runCampaignAction,
  setAutoRunAction,
} from '@/modules/customers/actions';
import { getOrgContext } from '@/modules/tenancy/context';

const KINDS = ['win_back', 'second_visit', 'thank_you', 'custom'] as const;
const SEGMENTS = ['all', 'regular', 'at_risk', 'returning', 'new', 'lost'] as const;
const STATUS_TONE = {
  draft: 'neutral',
  approved: 'info',
  running: 'success',
  paused: 'warning',
  done: 'neutral',
} as const;

/**
 * Campaigns (ROADMAP Phase 8): thank-you, second-visit nudge, win-back or custom — each approved by a
 * person, sent only to customers who consented, capped, and measured against a holdout.
 */
export default async function CampaignsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.roles.includes('owner') && !ctx.roles.includes('manager')) notFound();
  const [t, locale] = await Promise.all([getTranslations('campaigns'), getLocale()]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select(
      'id, name, kind, status, holdout_pct, audience, body_bn, body_en, auto_run, last_run_at, approved_at',
    )
    .eq('org_id', ctx.org.id)
    .order('created_at', { ascending: false });
  const at = now().toISOString();
  const results = new Map<string, Record<string, unknown>[]>();
  for (const c of campaigns ?? []) {
    if (c.status === 'draft') continue;
    const { data } = await supabase.rpc('metric_campaign_results', { p_campaign: c.id, p_now: at });
    results.set(c.id as string, (data ?? []) as Record<string, unknown>[]);
  }
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <Card>
          <CardTitle>{t('newTitle')}</CardTitle>
          <ActionForm
            action={createCampaignAction}
            successKey="campaigns.created"
            className="space-y-3"
          >
            {hidden}
            <div>
              <Label htmlFor="cm-name">{t('name')}</Label>
              <Input id="cm-name" name="name" required maxLength={120} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cm-kind">{t('kind')}</Label>
                <Select id="cm-kind" name="kind" defaultValue="win_back">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="cm-holdout">{t('holdout')}</Label>
                <Input
                  id="cm-holdout"
                  name="holdoutPct"
                  type="number"
                  min={0}
                  max={50}
                  defaultValue={10}
                />
              </div>
              <div>
                <Label htmlFor="cm-seg">{t('audience')}</Label>
                <Select id="cm-seg" name="segment" defaultValue="all">
                  {SEGMENTS.map((s) => (
                    <option key={s} value={s}>
                      {t(`segments.${s}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="cm-branch">{t('branch')}</Label>
                <Select id="cm-branch" name="branchId" defaultValue="">
                  <option value="">{t('allBranches')}</option>
                  {ctx.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Hint>{t('kindHint')}</Hint>
            <div>
              <Label htmlFor="cm-bn">{t('bodyBn')}</Label>
              <Textarea id="cm-bn" name="bodyBn" rows={3} maxLength={900} />
            </div>
            <div>
              <Label htmlFor="cm-en">{t('bodyEn')}</Label>
              <Textarea id="cm-en" name="bodyEn" rows={3} maxLength={900} />
            </div>
            <Hint>{t('bodyHint')}</Hint>
            <Button type="submit">{t('create')}</Button>
          </ActionForm>
        </Card>

        <div className="space-y-4">
          {(campaigns ?? []).length === 0 ? (
            <EmptyState title={t('none')} body={t('noneBody')} />
          ) : (
            (campaigns ?? []).map((c) => {
              const res = results.get(c.id as string) ?? [];
              const treated = res.find((r) => r.group_name === 'treated');
              const holdout = res.find((r) => r.group_name === 'holdout');
              const aud = (c.audience ?? {}) as { segment?: string; branch_id?: string | null };
              return (
                <Card key={c.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-bold">{c.name}</h2>
                      <p className="text-xs text-secondary">
                        {t(`kinds.${c.kind as string}`)} · {t(`segments.${aud.segment ?? 'all'}`)} ·{' '}
                        {aud.branch_id
                          ? (ctx.branches.find((b) => b.id === aud.branch_id)?.name ?? '')
                          : t('allBranches')}{' '}
                        · {t('holdoutShort', { pct: Number(c.holdout_pct) })}
                      </p>
                    </div>
                    <StatusBadge tone={STATUS_TONE[c.status as keyof typeof STATUS_TONE]}>
                      {t(`status.${c.status as string}`)}
                    </StatusBadge>
                  </div>
                  <p className="glass-tile mt-3 rounded-input p-3 text-sm whitespace-pre-wrap">
                    {(loc === 'bn' ? (c.body_bn ?? c.body_en) : (c.body_en ?? c.body_bn)) as string}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {c.status === 'draft' ? (
                      <ActionForm action={approveCampaignAction} successKey="campaigns.approved">
                        {hidden}
                        <input type="hidden" name="campaignId" value={c.id as string} />
                        <Button type="submit" size="sm">
                          {t('approve')}
                        </Button>
                      </ActionForm>
                    ) : (
                      <>
                        <RunForm campaignId={c.id as string} hidden={hidden} label={t('run')} />
                        <form action={setAutoRunAction}>
                          {hidden}
                          <input type="hidden" name="campaignId" value={c.id as string} />
                          <input
                            type="hidden"
                            name="autoRun"
                            value={c.auto_run ? 'false' : 'true'}
                          />
                          <Button type="submit" size="sm" variant="ghost">
                            {c.auto_run ? t('autoOff') : t('autoOn')}
                          </Button>
                        </form>
                      </>
                    )}
                  </div>
                  {c.auto_run ? <Hint>{t('autoHint')}</Hint> : null}
                  {treated || holdout ? (
                    <div className="mt-4 border-t border-line pt-3 text-sm">
                      <p className="font-semibold">{t('resultsTitle')}</p>
                      <p className="text-secondary">
                        {t('resultLine', {
                          treated: formatNumber(Number(treated?.customers ?? 0), loc),
                          treatedRate:
                            treated?.return_rate_bps == null
                              ? '—'
                              : formatBps(Number(treated.return_rate_bps), loc),
                          holdout: formatNumber(Number(holdout?.customers ?? 0), loc),
                          holdoutRate:
                            holdout?.return_rate_bps == null
                              ? '—'
                              : formatBps(Number(holdout.return_rate_bps), loc),
                        })}
                      </p>
                      {treated?.enough_data ? (
                        <p className="font-semibold">
                          {t('lift', { lift: formatBps(Number(treated.lift_bps ?? 0), loc) })}
                        </p>
                      ) : (
                        <Alert tone="info" className="mt-2">
                          {t('notEnough')}
                        </Alert>
                      )}
                    </div>
                  ) : null}
                </Card>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

async function RunForm({
  campaignId,
  hidden,
  label,
}: {
  campaignId: string;
  hidden: React.ReactNode;
  label: string;
}) {
  return (
    <ActionForm action={runCampaignAction} successKey="campaigns.ran">
      {hidden}
      <input type="hidden" name="campaignId" value={campaignId} />
      <Button type="submit" size="sm" variant="secondary">
        {label}
      </Button>
    </ActionForm>
  );
}
