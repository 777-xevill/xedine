import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  DeleteCodeButton,
  DiscountCodeForm,
  ToggleCodeButton,
} from '@/components/discount-code-forms';
import { SettingsNav } from '@/components/settings-nav';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardTitle, EmptyState, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatBps, formatDhakaDate, formatNumber, type Locale } from '@/lib/i18n/format';
import { businessDate } from '@/lib/time/business-date';
import { now } from '@/lib/time/clock';
import { codeStatus, type CodeStatus } from '@/modules/discounts/codes';
import { getOrgContext } from '@/modules/tenancy/context';

const TONE: Record<CodeStatus, 'success' | 'neutral' | 'warning' | 'danger'> = {
  working: 'success',
  off: 'neutral',
  ended: 'warning',
  usedUp: 'warning',
};

/** Secret discount codes (ADR 0038): the owner and managers make them; the cashier types one at the till. */
export default async function DiscountCodesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner && !ctx.roles.includes('manager')) notFound();

  const [t, locale] = await Promise.all([getTranslations('discountCodes'), getLocale()]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const [{ data: codes }, { data: usesRows }] = await Promise.all([
    supabase
      .from('discount_codes')
      .select('id, code, percent_bps, max_uses, ends_on, note, is_active')
      .eq('org_id', ctx.org.id)
      .order('created_at', { ascending: false }),
    supabase.rpc('discount_code_uses', { p_org: ctx.org.id }),
  ]);
  const uses = new Map(
    ((usesRows ?? []) as { discount_code_id: string; uses: number | string }[]).map((r) => [
      r.discount_code_id,
      Number(r.uses),
    ]),
  );
  const today = businessDate(now());

  return (
    <>
      <SettingsNav ctx={ctx} current="discountCodes" />
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <div className="max-w-3xl space-y-6">
        <Card>
          <CardTitle>{t('makeTitle')}</CardTitle>
          <p className="-mt-2 mb-4 text-sm text-secondary">{t('makeBody')}</p>
          <DiscountCodeForm orgId={ctx.org.id} orgSlug={ctx.org.slug} />
        </Card>

        <Card>
          <CardTitle>{t('listTitle')}</CardTitle>
          {(codes ?? []).length === 0 ? (
            <EmptyState title={t('none')} body={t('noneBody')} />
          ) : (
            <ul className="divide-y divide-line">
              {(codes ?? []).map((c) => {
                const used = uses.get(c.id) ?? 0;
                const status = codeStatus(c, used, today);
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-base font-semibold tracking-wider">
                          {c.code}
                        </span>
                        <span className="font-medium">
                          {t('percentOff', { percent: formatBps(c.percent_bps, loc) })}
                        </span>
                        <StatusBadge tone={TONE[status]}>{t(`status.${status}`)}</StatusBadge>
                      </p>
                      <p className="text-sm text-secondary">
                        {c.max_uses === null
                          ? t('usedAny', { n: formatNumber(used, loc) })
                          : t('usedOf', {
                              n: formatNumber(used, loc),
                              max: formatNumber(c.max_uses, loc),
                            })}
                        {' · '}
                        {c.ends_on
                          ? t('until', {
                              date: formatDhakaDate(new Date(`${c.ends_on}T12:00:00+06:00`), loc),
                            })
                          : t('noEnd')}
                        {c.note ? ` · ${c.note}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <ToggleCodeButton orgSlug={ctx.org.slug} id={c.id} active={c.is_active} />
                      <DeleteCodeButton orgSlug={ctx.org.slug} id={c.id} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
