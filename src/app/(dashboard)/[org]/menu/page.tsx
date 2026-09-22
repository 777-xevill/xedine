import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { CategoryForm, ItemForm } from '@/components/menu-forms';
import { Button } from '@/components/ui/button';
import { Card, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, type Locale } from '@/lib/i18n/format';
import { toggleItemActiveAction } from '@/modules/menu/actions';
import { getOrgContext } from '@/modules/tenancy/context';

export default async function MenuPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();

  const [t, locale] = await Promise.all([getTranslations('menu'), getLocale()]);
  const supabase = await createClient();
  const [{ data: categories }, { data: items }] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name')
      .eq('org_id', ctx.org.id)
      .order('sort_order'),
    supabase
      .from('menu_items')
      .select('id, category_id, name, base_price_poisha, is_active')
      .eq('org_id', ctx.org.id)
      .order('name'),
  ]);
  const categoryName = new Map((categories ?? []).map((c) => [c.id, c.name]));

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <Card className="mb-6">
        <h2 className="mb-3 text-lg font-semibold">{t('categoriesTitle')}</h2>
        <CategoryForm orgId={ctx.org.id} orgSlug={ctx.org.slug} />
        <ul className="mt-3 flex flex-wrap gap-2">
          {(categories ?? []).map((c) => (
            <li key={c.id} className="rounded-input border border-line px-3 py-1 text-sm">
              {c.name}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t('itemsTitle')}</h2>
        <ItemForm orgId={ctx.org.id} orgSlug={ctx.org.slug} categories={categories ?? []} />
        <ul className="mt-4 divide-y divide-line">
          {(items ?? []).map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p
                  className={item.is_active ? 'font-medium' : 'font-medium text-muted line-through'}
                >
                  {item.name}
                </p>
                <p className="text-sm text-secondary">
                  {item.category_id ? categoryName.get(item.category_id) : t('uncategorised')} ·{' '}
                  {formatBDT(item.base_price_poisha, locale as Locale)}
                </p>
              </div>
              <form action={toggleItemActiveAction}>
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                <input type="hidden" name="active" value={String(item.is_active)} />
                <Button type="submit" variant="secondary" size="sm">
                  {item.is_active ? t('deactivate') : t('activate')}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
