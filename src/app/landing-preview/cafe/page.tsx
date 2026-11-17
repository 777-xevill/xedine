import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { CafePreview } from '@/components/landing-3d/cafe-preview';
import {
  DEMO_ORDER,
  demoOrderTotal,
  MENU_PRICES,
  type DemoDish,
} from '@/components/landing-3d/story-ledger';
import { DEFAULT_LOCALE, formatMoney, isLocale } from '@/lib/i18n/format';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Hidden look test of one café corner, live in 3D (ADR 0064, approval 2). */
export default async function CafePreviewPage() {
  const [t, locale] = await Promise.all([getTranslations('landing3d'), getLocale()]);
  const money = (minor: number) =>
    formatMoney(minor, isLocale(locale) ? locale : DEFAULT_LOCALE, 'BDT');
  const dish = (d: DemoDish) => t(`dishes.${d}`);
  return (
    <CafePreview
      words={{
        title: t('cafe.title'),
        hint: t('cafe.hint'),
        note: t('cafe.note'),
        wave: t('preview.wave'),
        point: t('preview.point'),
      }}
      till={{
        newOrder: t('till.newOrder'),
        total: t('till.total'),
        placeOrder: t('till.placeOrder'),
        sent: t('till.sent'),
        dishes: {
          burger: dish('burger'),
          latte: dish('latte'),
          croissant: dish('croissant'),
          pizza: dish('pizza'),
          fries: dish('fries'),
        },
      }}
      order={DEMO_ORDER.map((d) => ({ dish: d, price: money(MENU_PRICES.BDT[d]) }))}
      total={money(demoOrderTotal(DEMO_ORDER))}
    />
  );
}
