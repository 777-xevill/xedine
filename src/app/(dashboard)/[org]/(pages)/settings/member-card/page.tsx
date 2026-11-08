import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { AdjustPointsForm, MemberRulesForm, ResetCardButton } from '@/components/member-card-forms';
import { QrCode } from '@/components/qr-code';
import { SettingsNav } from '@/components/settings-nav';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState, Hint, Input, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { publicEnv } from '@/lib/env';
import { formatBDT, formatNumber, type Locale } from '@/lib/i18n/format';
import { poishaToTakaText } from '@/lib/money';
import { memberCardUrl } from '@/modules/customers/member-card';
import { getOrgContext } from '@/modules/tenancy/context';

interface MemberRow {
  customer_id: string;
  phone: string;
  name: string | null;
  points: number | string;
  last_visit: string | null;
  token: string | null;
}

/**
 * Member card (ADR 0042): the owner switches the card on, sets how points are earned and what they are
 * worth, and the member discount; finds a customer to fix their points or give them a new card link.
 */
export default async function MemberCardSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();

  const [t, locale] = await Promise.all([getTranslations('memberSettings'), getLocale()]);
  const loc = locale as Locale;
  const q = (sp.q ?? '').slice(0, 20);
  const supabase = await createClient();
  const [{ data: s }, { data: rows }] = await Promise.all([
    supabase
      .from('loyalty_settings')
      .select(
        'is_on, earn_points, earn_every_poisha, point_value_poisha, min_redeem_points, discount_on, discount_bps',
      )
      .eq('org_id', ctx.org.id)
      .maybeSingle(),
    supabase.rpc('member_points', { p_org: ctx.org.id, p_search: q || null, p_limit: 50 }),
  ]);
  const members = (rows ?? []) as MemberRow[];
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const taka = (p: number) => poishaToTakaText(p).replace(/\.00$/, '');

  return (
    <>
      <SettingsNav ctx={ctx} current="memberCard" />
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <div className="max-w-3xl space-y-6">
        <Card>
          <CardTitle>{t('howTitle')}</CardTitle>
          <ol className="list-decimal space-y-1.5 ps-5 text-sm text-secondary">
            <li>{t('how1')}</li>
            <li>{t('how2')}</li>
            <li>{t('how3')}</li>
            <li>{t('how4')}</li>
          </ol>
        </Card>

        <Card>
          <CardTitle>{t('rulesTitle')}</CardTitle>
          <MemberRulesForm
            orgId={ctx.org.id}
            orgSlug={ctx.org.slug}
            rules={{
              isOn: s?.is_on ?? false,
              earnPoints: String(s?.earn_points ?? 1),
              earnEvery: taka(Number(s?.earn_every_poisha ?? 10_000)),
              pointValue: taka(Number(s?.point_value_poisha ?? 100)),
              minRedeem: String(s?.min_redeem_points ?? 50),
              discountOn: s?.discount_on ?? false,
              discountPercent: taka(Number(s?.discount_bps ?? 1000)),
            }}
          />
        </Card>

        <Card>
          <CardTitle>{t('membersTitle')}</CardTitle>
          <form className="mb-4 flex gap-2" role="search">
            <Input
              name="q"
              defaultValue={q}
              inputMode="tel"
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
            />
            <Button type="submit" variant="secondary">
              {t('search')}
            </Button>
          </form>
          {members.length === 0 ? (
            <EmptyState title={t('none')} body={t('noneBody')} />
          ) : (
            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li key={m.customer_id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium tabular-nums">
                        {m.phone}
                        {m.name ? <span className="ms-2 text-secondary">{m.name}</span> : null}
                      </p>
                      <p className="text-sm text-secondary">
                        {t('pointsNow', { points: formatNumber(Number(m.points), loc) })}
                        {' · '}
                        {m.last_visit ? t('lastVisit', { date: m.last_visit }) : t('noVisit')}
                      </p>
                    </div>
                    <ResetCardButton
                      orgId={ctx.org.id}
                      orgSlug={ctx.org.slug}
                      customerId={m.customer_id}
                      hasCard={m.token !== null}
                    />
                  </div>
                  <details className="rounded-input border border-line p-3 text-sm">
                    <summary className="cursor-pointer font-medium">{t('manage')}</summary>
                    <div className="mt-3 space-y-4">
                      {m.token ? (
                        <div className="flex flex-wrap items-center gap-4">
                          <QrCode
                            value={memberCardUrl(site, m.token)}
                            label={t('cardQr')}
                            className="size-28"
                          />
                          <div className="min-w-0 space-y-1">
                            <a
                              href={memberCardUrl(site, m.token)}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium break-all text-purple underline"
                            >
                              {t('openCard')}
                            </a>
                            <Hint>{t('cardLinkHint')}</Hint>
                          </div>
                        </div>
                      ) : (
                        <Hint>{t('noCardYet')}</Hint>
                      )}
                      <AdjustPointsForm
                        orgId={ctx.org.id}
                        orgSlug={ctx.org.slug}
                        customerId={m.customer_id}
                      />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <Hint className="mt-3">
            {s
              ? t('rulesNow', {
                  points: formatNumber(s.earn_points, loc),
                  every: formatBDT(Number(s.earn_every_poisha), loc, { poisha: 'never' }),
                  worth: formatBDT(Number(s.point_value_poisha), loc),
                })
              : t('rulesNotSet')}
          </Hint>
        </Card>
      </div>
    </>
  );
}
