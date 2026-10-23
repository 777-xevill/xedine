import { Boxes, ClipboardList, Lightbulb, Plus, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { PageAgent } from '@/components/chat/page-agent';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Disclosure, ToneIcon } from '@/components/stock/parts';
import { StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, EmptyState, Hint, Input, PageTitle } from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import { aiConfigured } from '@/lib/llm-gateway';
import { formatBDT, formatDhakaDate, formatNumber, type Locale } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import { setIngredientPriceAction } from '@/modules/recipes/actions';
import { editorAmount, type DishRow } from '@/modules/recipes/dish';
import {
  allIngredients,
  dishRecipeLines,
  ingredientPrices,
  type IngredientPrice,
} from '@/modules/recipes/queries';
import { getOrgContext } from '@/modules/tenancy/context';
import { DishList, type DishView } from './dish-list';

const TABS = ['dishes', 'prices'] as const;
type Tab = (typeof TABS)[number];

/**
 * Dish ingredients (ADR 0037, was Recipes): what goes into one plate of each dish. The owner or the
 * manager writes it — the manager for the chef — and every dish placed at the till then takes it from
 * stock. Costs and prices only for owner and accountant (ADR 0007), decided in SQL.
 */
export default async function DishIngredientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  const has = (r: string) => ctx.roles.includes(r as never);
  if (!['owner', 'manager', 'kitchen', 'accountant'].some(has)) notFound();
  const canEdit = has('owner') || has('manager');
  const canSeeMoney = has('owner') || has('accountant');
  const tab: Tab = sp.tab === 'prices' && canSeeMoney ? 'prices' : 'dishes';

  const [t, ta, locale] = await Promise.all([
    getTranslations('recipes'),
    getTranslations('agent'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const [{ data: items }, lines, known, { data: drafts }, costRows, prices] = await Promise.all([
    supabase
      .from('menu_items')
      .select('id, name, name_bn')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .order('name'),
    dishRecipeLines(supabase, ctx.org.id),
    allIngredients(supabase, ctx.org.id),
    canEdit
      ? supabase
          .from('recipe_drafts')
          .select('id, menu_item_id, payload')
          .eq('org_id', ctx.org.id)
          .eq('status', 'pending_review')
          .not('menu_item_id', 'is', null)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as { id: string; menu_item_id: string; payload: unknown }[] }),
    canSeeMoney
      ? supabase.rpc('metric_recipe_costs', { p_org: ctx.org.id, p_now: now().toISOString() }).then(
          (r) =>
            (r.data ?? []) as {
              menu_item_id: string | null;
              unit_cost_poisha: number | null;
              complete: boolean;
            }[],
        )
      : Promise.resolve([]),
    canSeeMoney && tab === 'prices'
      ? ingredientPrices(supabase, ctx.org.id)
      : Promise.resolve(new Map<string, IngredientPrice>()),
  ]);

  const name = (n: string, bn: string | null) => (loc === 'bn' && bn ? bn : n);
  const linesBy = new Map<string, typeof lines>();
  for (const l of lines) linesBy.set(l.menu_item_id, [...(linesBy.get(l.menu_item_id) ?? []), l]);
  const draftBy = new Map<string, { id: string; payload: unknown }>();
  for (const d of drafts ?? [])
    if (!draftBy.has(d.menu_item_id as string)) draftBy.set(d.menu_item_id as string, d);
  const costBy = new Map(costRows.filter((c) => c.menu_item_id).map((c) => [c.menu_item_id!, c]));

  /** A saved suggestion's lines as rows ({ingredient, base, qty_base}); anything malformed is skipped. */
  const draftRows = (payload: unknown): DishRow[] => {
    const raw = (payload as { lines?: unknown })?.lines;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((l: { ingredient?: unknown; base?: unknown; qty_base?: unknown }) =>
      typeof l.ingredient === 'string' &&
      (l.base === 'g' || l.base === 'ml' || l.base === 'pcs') &&
      Number(l.qty_base) > 0
        ? [{ name: l.ingredient, ...editorAmount(Number(l.qty_base), l.base) }]
        : [],
    );
  };

  const dishes: DishView[] = (items ?? []).map((item) => {
    const own = linesBy.get(item.id as string) ?? [];
    const draft = draftBy.get(item.id as string);
    const cost = costBy.get(item.id as string);
    return {
      id: item.id as string,
      name: name(item.name as string, item.name_bn as string | null),
      rows: own.map((l) => ({ name: name(l.name, l.name_bn), ...editorAmount(l.qty, l.base) })),
      plates: own[0]?.plates ?? 1,
      aiHelped: own[0]?.source === 'ai_draft',
      draft: draft
        ? {
            id: draft.id,
            note: String((draft.payload as { notes?: unknown })?.notes ?? ''),
            rows: draftRows(draft.payload),
          }
        : null,
      cost:
        cost && canSeeMoney
          ? {
              complete: cost.complete,
              text: cost.unit_cost_poisha === null ? '' : formatBDT(cost.unit_cost_poisha, loc),
            }
          : null,
    };
  });
  const written = dishes.filter((d) => d.rows.length > 0).length;

  // A new dish is made on the Menu page (owner only, it needs a price); this page only fills it in.
  const addDish = ctx.isOwner ? (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href={`/${ctx.org.slug}/menu`}
        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
      >
        <Plus aria-hidden className="size-4" />
        {t('addDish')}
      </Link>
      <p className="text-sm text-secondary">{t('addDishHint')}</p>
    </div>
  ) : canEdit ? (
    <Hint>{t('askOwnerDish')}</Hint>
  ) : null;

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} actions={<LocaleSwitcher />} />
      {canSeeMoney ? (
        <PillNav
          label={t('sections')}
          className="mb-6"
          items={TABS.map((x) => ({
            href: `/${ctx.org.slug}/recipes${x === 'dishes' ? '' : `?tab=${x}`}`,
            label: t(`tabs.${x}`),
            active: x === tab,
          }))}
        />
      ) : null}

      {tab === 'dishes' ? (
        <div className="space-y-5">
          <Card className="p-4 sm:p-5">
            <Disclosure summary={t('how.title')} icon={<Lightbulb />} open={written === 0}>
              <ol className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ['write', <ClipboardList key="write" />, 'info'],
                    ['sell', <ReceiptText key="sell" />, 'warning'],
                    ['stock', <Boxes key="stock" />, 'success'],
                  ] as const
                ).map(([key, icon, tone], i) => (
                  <li key={key} className="glass-tile flex items-start gap-3 rounded-input p-3.5">
                    <ToneIcon tone={tone} icon={icon} className="size-11" solid />
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {`${formatNumber(i + 1, loc)}. ${t(`how.${key}Title`)}`}
                      </p>
                      <p className="mt-0.5 text-sm text-secondary">{t(`how.${key}Body`)}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-sm text-secondary">
                {t('how.usedLink')}{' '}
                <Link
                  href={`/${ctx.org.slug}/stock?tab=used`}
                  className="font-semibold text-purple hover:underline"
                >
                  {t('how.usedLinkText')}
                </Link>
              </p>
            </Disclosure>
          </Card>

          {dishes.length === 0 ? (
            <>
              <EmptyState title={t('noItems')} body={t('noItemsBody')} />
              {addDish}
            </>
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold">
                  {t('progress', {
                    done: formatNumber(written, loc),
                    total: formatNumber(dishes.length, loc),
                  })}
                </p>
                <div
                  className="mt-2 h-2 max-w-md overflow-hidden rounded-full bg-surface-elevated"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full bg-success-bright"
                    style={{ width: `${(written / dishes.length) * 100}%` }}
                  />
                </div>
                {!canEdit ? <Hint>{t('readOnly')}</Hint> : null}
              </div>
              {addDish}
              <DishList
                orgId={ctx.org.id}
                orgSlug={ctx.org.slug}
                dishes={dishes}
                known={known}
                canEdit={canEdit}
                aiReady={aiConfigured()}
              />
            </>
          )}
        </div>
      ) : (
        <Card className="p-4 sm:p-6">
          <p className="mb-4 max-w-2xl text-sm text-secondary">{t('pricesBody')}</p>
          {known.length === 0 ? (
            <EmptyState title={t('noIngredients')} />
          ) : (
            <ul className="space-y-2">
              {[...known]
                .sort(
                  (a, b) =>
                    Number(prices.has(a.id)) - Number(prices.has(b.id)) ||
                    name(a.name, a.name_bn).localeCompare(name(b.name, b.name_bn)),
                )
                .map((ing) => {
                  const p = prices.get(ing.id);
                  const per = t(`per.${ing.base}`);
                  return (
                    <li
                      key={ing.id}
                      className="glass-tile flex flex-wrap items-center justify-between gap-2 rounded-input p-3"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold">{name(ing.name, ing.name_bn)}</p>
                        <p className="text-xs text-secondary">
                          {!p
                            ? null
                            : p.source === 'purchases' && p.since
                              ? t('fromBazar', {
                                  date: formatDhakaDate(new Date(`${p.since}T06:00:00Z`), loc),
                                })
                              : t('typedPrice')}
                        </p>
                        {!p ? <StatusBadge tone="warning">{t('noPrice')}</StatusBadge> : null}
                      </div>
                      {ctx.isOwner ? (
                        <ActionForm
                          action={setIngredientPriceAction}
                          successKey="recipes.priceSaved"
                          className="flex flex-wrap items-center gap-2"
                        >
                          <input type="hidden" name="orgId" value={ctx.org.id} />
                          <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                          <input type="hidden" name="ingredientId" value={ing.id} />
                          <input type="hidden" name="base" value={ing.base} />
                          <Input
                            name="price"
                            inputMode="decimal"
                            required
                            aria-label={t('pricePerUnit', { unit: per })}
                            defaultValue={
                              p ? formatBDT(p.price_poisha, 'en', { symbol: false }) : ''
                            }
                            className="min-h-9 w-28"
                          />
                          <span className="text-xs text-secondary">{per}</span>
                          <Button type="submit" size="sm" variant="secondary">
                            {t('savePrice')}
                          </Button>
                        </ActionForm>
                      ) : (
                        <span className="text-sm tabular-nums">
                          {p ? `${formatBDT(p.price_poisha, loc)} ${per}` : null}
                        </span>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>
      )}

      {/* The assistant, for the people who have it (owner, manager, accountant). */}
      {['owner', 'manager', 'accountant'].some(has) ? (
        <>
          <div aria-hidden className="h-20" />
          <PageAgent
            page="recipes"
            pageNote={`${tab} tab, ${written} of ${dishes.length} dishes written`}
            orgId={ctx.org.id}
            orgSlug={ctx.org.slug}
            aiOn={aiConfigured()}
            labels={{
              open: ta('recipes.open'),
              title: ta('recipes.title'),
              subtitle: ta('recipes.subtitle'),
              placeholder: ta('recipes.placeholder'),
            }}
            summaryQuestion={ta('recipes.summary')}
            followUps={[ta('recipes.how'), ta('recipes.pot'), ta('recipes.used')]}
          />
        </>
      ) : null}
    </>
  );
}
