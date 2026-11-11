import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Card, EmptyState, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { aiConfigured } from '@/lib/llm-gateway';
import type { Locale } from '@/lib/i18n/format';
import { isAllergen, type Allergen } from '@/modules/menu/food-facts';
import { getOrgContext } from '@/modules/tenancy/context';
import { NutritionList, type NutritionDish } from './nutrition-list';

/**
 * Food facts (ADR 0049): calories, protein, carbs, fat and allergens for every dish. "Fill with AI" makes
 * a first guess; the owner or a manager checks it and approves. Customers see only approved facts, on
 * the table page's menu.
 */
export default async function NutritionPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.roles.some((r) => r === 'owner' || r === 'manager')) notFound();

  const [t, locale] = await Promise.all([getTranslations('nutrition'), getLocale()]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const [{ data: items }, { data: facts }] = await Promise.all([
    supabase
      .from('menu_items')
      .select('id, name, name_bn')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .order('name')
      .limit(500),
    supabase
      .from('dish_nutrition')
      .select('menu_item_id, kcal, protein_g, carbs_g, fat_g, allergens, status')
      .eq('org_id', ctx.org.id),
  ]);
  const by = new Map((facts ?? []).map((f) => [f.menu_item_id as string, f]));
  const dishes: NutritionDish[] = (items ?? []).map((i) => {
    const f = by.get(i.id as string);
    return {
      id: i.id as string,
      name: loc === 'bn' && i.name_bn ? (i.name_bn as string) : (i.name as string),
      facts: f
        ? {
            kcal: Number(f.kcal),
            protein_g: Number(f.protein_g),
            carbs_g: Number(f.carbs_g),
            fat_g: Number(f.fat_g),
            allergens: ((f.allergens as string[]) ?? []).filter(isAllergen) as Allergen[],
            approved: f.status === 'approved',
          }
        : null,
    };
  });

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} actions={<LocaleSwitcher />} />
      {dishes.length === 0 ? (
        <EmptyState title={t('empty')} body={t('emptyBody')} />
      ) : (
        <Card className="p-4 sm:p-5">
          <NutritionList
            orgId={ctx.org.id}
            orgSlug={ctx.org.slug}
            dishes={dishes}
            aiReady={aiConfigured()}
          />
        </Card>
      )}
    </>
  );
}
