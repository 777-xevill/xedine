import { ChevronDown } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  CategoryForm,
  ItemForm,
  ItemModifierGroupsForm,
  ModifierForm,
  ModifierGroupForm,
  VariantForm,
} from '@/components/menu-forms';
import { ItemPhotoField } from '@/components/item-photo-field';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, type Locale } from '@/lib/i18n/format';
import {
  toggleCategoryActiveAction,
  toggleItemActiveAction,
  toggleModifierActiveAction,
  toggleModifierGroupActiveAction,
  toggleVariantActiveAction,
} from '@/modules/menu/actions';
import { getOrgContext } from '@/modules/tenancy/context';

export default async function MenuPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();

  const [t, locale] = await Promise.all([getTranslations('menu'), getLocale()]);
  const supabase = await createClient();
  const [
    { data: categories },
    { data: items },
    { data: variants },
    { data: groups },
    { data: modifiers },
    { data: links },
  ] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, is_active')
      .eq('org_id', ctx.org.id)
      .order('sort_order'),
    supabase
      .from('menu_items')
      .select('id, category_id, name, base_price_poisha, is_active, photo_path')
      .eq('org_id', ctx.org.id)
      .order('name'),
    supabase
      .from('item_variants')
      .select('id, menu_item_id, name, price_delta_poisha, is_active')
      .eq('org_id', ctx.org.id)
      .order('sort_order'),
    supabase
      .from('modifier_groups')
      .select('id, name, min_select, max_select, is_active')
      .eq('org_id', ctx.org.id)
      .order('name'),
    supabase
      .from('modifiers')
      .select('id, group_id, name, price_poisha, is_active')
      .eq('org_id', ctx.org.id)
      .order('sort_order'),
    supabase
      .from('menu_item_modifier_groups')
      .select('menu_item_id, modifier_group_id')
      .eq('org_id', ctx.org.id),
  ]);

  interface VariantRow {
    id: string;
    menu_item_id: string;
    name: string;
    price_delta_poisha: number;
    is_active: boolean;
  }
  interface ModifierRow {
    id: string;
    group_id: string;
    name: string;
    price_poisha: number;
    is_active: boolean;
  }
  const categoryName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const variantsByItem = new Map<string, VariantRow[]>();
  for (const v of (variants ?? []) as VariantRow[]) {
    const arr = variantsByItem.get(v.menu_item_id) ?? [];
    arr.push(v);
    variantsByItem.set(v.menu_item_id, arr);
  }
  const modifiersByGroup = new Map<string, ModifierRow[]>();
  for (const m of (modifiers ?? []) as ModifierRow[]) {
    const arr = modifiersByGroup.get(m.group_id) ?? [];
    arr.push(m);
    modifiersByGroup.set(m.group_id, arr);
  }
  const groupsByItem = new Map<string, string[]>();
  for (const link of links ?? []) {
    const arr = groupsByItem.get(link.menu_item_id) ?? [];
    arr.push(link.modifier_group_id);
    groupsByItem.set(link.menu_item_id, arr);
  }
  const activeGroups = (groups ?? []).filter((g) => g.is_active);
  const money = (p: number) => formatBDT(p, locale as Locale);

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <Card className="mb-6">
        <CardTitle>{t('categoriesTitle')}</CardTitle>
        <CategoryForm orgId={ctx.org.id} orgSlug={ctx.org.slug} />
        <ul className="mt-3 flex flex-wrap gap-2">
          {(categories ?? []).map((c) => (
            <li
              key={c.id}
              className={`glass-tile flex items-center gap-1.5 rounded-full py-1 ps-3 pe-1.5 text-sm ${c.is_active ? '' : 'text-muted line-through'}`}
            >
              {c.name}
              <form action={toggleCategoryActiveAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                <input type="hidden" name="active" value={String(c.is_active)} />
                <Button type="submit" variant="ghost" size="sm" className="min-h-6 px-2 text-xs">
                  {c.is_active ? t('deactivate') : t('activate')}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mb-6">
        <CardTitle>{t('itemsTitle')}</CardTitle>
        <ItemForm orgId={ctx.org.id} orgSlug={ctx.org.slug} categories={categories ?? []} />
        {(items ?? []).length === 0 ? (
          <EmptyState className="mt-4" title={t('noItems')} />
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {(items ?? []).map((item) => (
              <li key={item.id} className="relative py-3">
                <form action={toggleItemActiveAction} className="absolute end-0 top-3">
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                  <input type="hidden" name="active" value={String(item.is_active)} />
                  <Button type="submit" variant="secondary" size="sm">
                    {item.is_active ? t('deactivate') : t('activate')}
                  </Button>
                </form>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-2 pe-32">
                    <div className="flex items-center gap-2">
                      <ChevronDown
                        aria-hidden
                        className="size-4 text-secondary transition group-open:rotate-180"
                      />
                      <div>
                        <p
                          className={
                            item.is_active
                              ? 'font-semibold'
                              : 'font-semibold text-muted line-through'
                          }
                        >
                          {item.name}
                        </p>
                        <p className="text-sm text-secondary">
                          {item.category_id
                            ? categoryName.get(item.category_id)
                            : t('uncategorised')}
                          {' · '}
                          {money(item.base_price_poisha)}
                        </p>
                      </div>
                    </div>
                  </summary>

                  <div className="mt-3 ms-6 space-y-4 border-s border-line ps-4">
                    <ItemPhotoField
                      orgId={ctx.org.id}
                      orgSlug={ctx.org.slug}
                      itemId={item.id}
                      photoPath={(item.photo_path as string | null) ?? null}
                    />

                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-secondary">
                        {t('variantsTitle')}
                      </h3>
                      {(variantsByItem.get(item.id) ?? []).length > 0 ? (
                        <ul className="mb-2 flex flex-wrap gap-2">
                          {(variantsByItem.get(item.id) ?? []).map((v) => (
                            <li
                              key={v.id}
                              className={`glass-tile flex items-center gap-1.5 rounded-full py-1 ps-3 pe-1.5 text-sm ${v.is_active ? '' : 'text-muted line-through'}`}
                            >
                              {v.name} ({v.price_delta_poisha >= 0 ? '+' : ''}
                              {money(v.price_delta_poisha)})
                              <form action={toggleVariantActiveAction}>
                                <input type="hidden" name="id" value={v.id} />
                                <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                                <input type="hidden" name="active" value={String(v.is_active)} />
                                <Button
                                  type="submit"
                                  variant="ghost"
                                  size="sm"
                                  className="min-h-6 px-2 text-xs"
                                >
                                  {v.is_active ? t('deactivate') : t('activate')}
                                </Button>
                              </form>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <VariantForm orgId={ctx.org.id} orgSlug={ctx.org.slug} itemId={item.id} />
                    </div>

                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-secondary">
                        {t('addOnGroupsTitle')}
                      </h3>
                      <ItemModifierGroupsForm
                        orgId={ctx.org.id}
                        orgSlug={ctx.org.slug}
                        itemId={item.id}
                        groups={activeGroups}
                        selected={groupsByItem.get(item.id) ?? []}
                      />
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>{t('addOnGroupsTitle')}</CardTitle>
        <p className="-mt-2 mb-4 text-sm text-secondary">{t('addOnGroupsBody')}</p>
        <ModifierGroupForm orgId={ctx.org.id} orgSlug={ctx.org.slug} />
        {(groups ?? []).length === 0 ? (
          <EmptyState className="mt-4" title={t('noGroupsYet')} />
        ) : (
          <ul className="mt-4 space-y-4">
            {(groups ?? []).map((g) => (
              <li key={g.id} className="glass-tile rounded-input p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p
                    className={
                      g.is_active ? 'font-semibold' : 'font-semibold text-muted line-through'
                    }
                  >
                    {g.name}{' '}
                    <span className="text-sm font-normal text-secondary">
                      ({t('selectRange', { min: g.min_select, max: g.max_select })})
                    </span>
                  </p>
                  <form action={toggleModifierGroupActiveAction}>
                    <input type="hidden" name="id" value={g.id} />
                    <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                    <input type="hidden" name="active" value={String(g.is_active)} />
                    <Button type="submit" variant="ghost" size="sm">
                      {g.is_active ? t('deactivate') : t('activate')}
                    </Button>
                  </form>
                </div>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {(modifiersByGroup.get(g.id) ?? []).map((m) => (
                    <li
                      key={m.id}
                      className={`glass rounded-full py-1 ps-3 pe-1.5 text-sm ${m.is_active ? '' : 'text-muted line-through'}`}
                    >
                      {m.name} ({money(m.price_poisha)})
                      <form action={toggleModifierActiveAction} className="ms-1 inline">
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                        <input type="hidden" name="active" value={String(m.is_active)} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="min-h-6 px-1.5 text-xs"
                        >
                          {m.is_active ? t('deactivate') : t('activate')}
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
                <div className="mt-2">
                  <ModifierForm orgId={ctx.org.id} orgSlug={ctx.org.slug} groupId={g.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
