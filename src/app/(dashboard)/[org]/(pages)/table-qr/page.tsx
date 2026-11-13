import { Gamepad2, IdCard, MessageSquareWarning, Star, UtensilsCrossed } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { PrintButton } from '@/components/print-button';
import { QrCode } from '@/components/qr-code';
import { Banner } from '@/components/stock/parts';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, Hint, Input, Label, PageTitle } from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import { publicEnv } from '@/lib/env';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { isNumberedTable, MAX_TABLES, tableUrl } from '@/modules/customers/table-qr';
import {
  makeTablesAction,
  resetTableLinkAction,
  saveGamesAction,
} from '@/modules/customers/table-qr-actions';
import { MAX_NAME, NAME_KEYS, parseGameNames } from '@/modules/games/catalog';
import { getOrgContext, pickBranch } from '@/modules/tenancy/context';

interface TableRow {
  id: string;
  name: string;
  qr_token: string;
}

/**
 * Table QR (ADR 0045): one QR code per table, printed and put on the table. The customer scans it with the
 * phone camera (no app) and gets the menu, the member card, a Google review and the complaint box.
 */
export default async function TableQrPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const [{ org }, { branch }] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner && !ctx.roles.includes('manager')) notFound();
  const current = pickBranch(ctx, branch);
  if (!current) notFound();
  const [t, locale] = await Promise.all([getTranslations('tableQr'), getLocale()]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const [tg, { data: tableRows }, { data: loyalty }, { data: games }] = await Promise.all([
    getTranslations('games'),
    supabase
      .from('dining_tables')
      .select('id, name, qr_token')
      .eq('org_id', ctx.org.id)
      .eq('branch_id', current.id)
      .eq('is_active', true),
    supabase.from('loyalty_settings').select('is_on').eq('org_id', ctx.org.id).maybeSingle(),
    supabase
      .from('org_settings')
      .select('games_on, game_names')
      .eq('org_id', ctx.org.id)
      .maybeSingle(),
  ]);
  const gameNames = parseGameNames(games?.game_names);
  // Numbered tables in number order, then the named ones.
  const tables = ((tableRows ?? []) as TableRow[]).sort((a, b) => {
    const na = isNumberedTable(a.name) ? Number(a.name) : Infinity;
    const nb = isNumberedTable(b.name) ? Number(b.name) : Infinity;
    return na === nb ? a.name.localeCompare(b.name) : na - nb;
  });
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const memberOn = loyalty?.is_on === true;
  const label = (name: string) =>
    isNumberedTable(name) ? t('tableN', { n: formatNumber(Number(name), loc) }) : name;
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
      <input type="hidden" name="branchId" value={current.id} />
    </>
  );
  const offers = [
    { icon: UtensilsCrossed, text: t('offerMenu') },
    { icon: IdCard, text: t('offerMember') },
    { icon: Star, text: t('offerReview') },
    { icon: MessageSquareWarning, text: t('offerComplaint') },
    { icon: Gamepad2, text: t('offerGames') },
  ];

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} actions={<LocaleSwitcher />} />
      <div className="mx-auto max-w-3xl space-y-5">
        {ctx.branches.length > 1 ? (
          <PillNav
            label={t('branchPicker')}
            items={ctx.branches.map((b) => ({
              href: `/${ctx.org.slug}/table-qr?branch=${b.id}`,
              label: b.name,
              active: b.id === current.id,
            }))}
          />
        ) : null}

        <Card className="p-4 sm:p-5">
          <CardTitle>{t('whatTitle')}</CardTitle>
          <ul className="grid gap-2 sm:grid-cols-2">
            {offers.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2 text-sm">
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-purple" />
                {text}
              </li>
            ))}
          </ul>
          <Hint className="mt-3">{t('noApp')}</Hint>
        </Card>

        {!memberOn ? (
          <Banner tone="warning" icon={<IdCard />} title={t('memberOffTitle')}>
            {ctx.isOwner ? (
              <Link
                href={`/${ctx.org.slug}/settings/member-card`}
                className="mt-1 inline-block text-sm font-medium text-purple underline"
              >
                {t('memberOffOwner')}
              </Link>
            ) : (
              <p className="mt-0.5 text-sm text-secondary">{t('memberOffManager')}</p>
            )}
          </Banner>
        ) : null}

        <Card className="p-4 sm:p-5">
          <CardTitle>{t('tablesTitle')}</CardTitle>
          <ActionForm action={makeTablesAction} successKey="common.saved" className="space-y-2">
            {hidden}
            <Label htmlFor="tq-count">{t('howMany')}</Label>
            <div className="flex gap-2">
              <Input
                id="tq-count"
                name="count"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_TABLES}
                required
                defaultValue={tables.length || undefined}
                placeholder="12"
                className="w-28"
              />
              <Button type="submit">{t('make')}</Button>
            </div>
            <Hint>{t('howManyHint')}</Hint>
          </ActionForm>
        </Card>

        <Card className="p-4 sm:p-5">
          <CardTitle>{t('gamesTitle')}</CardTitle>
          <Hint className="-mt-2 mb-3">{t('gamesHint')}</Hint>
          {ctx.isOwner ? (
            <ActionForm action={saveGamesAction} successKey="common.saved" className="space-y-3">
              <input type="hidden" name="orgId" value={ctx.org.id} />
              <input type="hidden" name="orgSlug" value={ctx.org.slug} />
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="on" defaultChecked={games?.games_on !== false} />
                {t('gamesOn')}
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {NAME_KEYS.map((k) => (
                  <div key={k}>
                    <Label htmlFor={`gn-${k}`}>{t(`gameLabel.${k}`)}</Label>
                    <Input
                      id={`gn-${k}`}
                      name={`name_${k}`}
                      maxLength={MAX_NAME}
                      defaultValue={gameNames[k] ?? ''}
                      placeholder={tg(`names.${k}`)}
                    />
                  </div>
                ))}
              </div>
              <Hint>{t('gamesNameHint', { restaurant: ctx.org.name })}</Hint>
              <Button type="submit" variant="secondary">
                {t('save')}
              </Button>
            </ActionForm>
          ) : (
            <p className="text-sm text-secondary">
              {games?.games_on === false ? t('gamesOffManager') : t('gamesOnManager')}
            </p>
          )}
        </Card>

        {tables.length > 0 ? (
          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="mb-0">
                {t('qrTitle', { n: formatNumber(tables.length, loc) })}
              </CardTitle>
              <PrintButton label={t('print')} />
            </div>
            <Hint className="mb-4">{t('printHint')}</Hint>
            <ul className="print-cards grid gap-3 sm:grid-cols-2">
              {tables.map((tb) => {
                const url = tableUrl(site, tb.qr_token);
                return (
                  <li
                    key={tb.id}
                    className="print-card glass-tile flex flex-col items-center gap-2 rounded-card p-4 text-center"
                  >
                    <p className="text-sm font-semibold">{ctx.org.name}</p>
                    <p className="text-2xl font-extrabold">{label(tb.name)}</p>
                    <QrCode
                      value={url}
                      label={t('qrLabel', { table: label(tb.name) })}
                      className="size-40 rounded-input"
                    />
                    <p className="text-sm font-semibold">{t('cardScan')}</p>
                    <p className="text-xs">
                      {games?.games_on === false ? t('cardOffers') : t('cardOffersGames')}
                    </p>
                    <div className="mt-1 flex flex-col items-center gap-1 print:hidden">
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-purple underline"
                      >
                        {t('open')}
                      </a>
                      <details className="text-sm">
                        <summary className="cursor-pointer text-xs text-secondary">
                          {t('resetSummary')}
                        </summary>
                        <Hint className="mt-1">{t('resetHint')}</Hint>
                        <ActionForm
                          action={resetTableLinkAction}
                          successKey="common.saved"
                          className="mt-2"
                        >
                          {hidden}
                          <input type="hidden" name="tableId" value={tb.id} />
                          <Button type="submit" size="sm" variant="secondary">
                            {t('reset')}
                          </Button>
                        </ActionForm>
                      </details>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
