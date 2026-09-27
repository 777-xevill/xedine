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
  Select,
  Textarea,
} from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import { aiConfigured } from '@/lib/llm-gateway';
import { formatBDT, formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import {
  addIngredientAction,
  approveDraftAction,
  discardDraftAction,
  draftRecipesAction,
  saveRecipeAction,
  setIngredientPriceAction,
  updateDraftAction,
} from '@/modules/recipes/actions';
import { getOrgContext } from '@/modules/tenancy/context';

const TABS = ['recipes', 'ingredients', 'drafts'] as const;
type Tab = (typeof TABS)[number];
const BLANK_ROWS = 4;

interface Line {
  ingredient: string;
  base: string;
  qty_base: number;
  yield_pct: number;
}

/** Recipes, ingredients and AI drafts (ROADMAP Phase 3). Costs only for owner/accountant (ADR 0007). */
export default async function RecipesPage({
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
  const canSeeMoney = has('owner') || has('accountant');
  const canDraft = has('owner') || has('kitchen');
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'recipes';

  const [t, locale] = await Promise.all([getTranslations('recipes'), getLocale()]);
  const loc = locale as Locale;
  const money = (p: number) => formatBDT(p, loc);
  const supabase = await createClient();
  const [
    { data: items },
    { data: recipes },
    { data: lines },
    { data: ingredients },
    { data: prices },
    { data: drafts },
  ] = await Promise.all([
    supabase
      .from('menu_items')
      .select('id, name, base_price_poisha')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('recipes')
      .select('id, menu_item_id, yield_portions, source, version')
      .eq('org_id', ctx.org.id)
      .eq('status', 'active'),
    supabase
      .from('recipe_lines')
      .select('recipe_id, ingredient_id, sub_recipe_id, qty_base, yield_pct')
      .eq('org_id', ctx.org.id),
    supabase
      .from('ingredients')
      .select('id, name, base')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .order('name'),
    canSeeMoney
      ? supabase
          .from('ingredient_costs')
          .select('ingredient_id, manual_cost_poisha, per_base_qty')
          .eq('org_id', ctx.org.id)
      : Promise.resolve({
          data: [] as { ingredient_id: string; manual_cost_poisha: number; per_base_qty: number }[],
        }),
    supabase
      .from('recipe_drafts')
      .select('id, menu_item_id, item_name, payload, model, created_at')
      .eq('org_id', ctx.org.id)
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false }),
  ]);
  const costs = canSeeMoney
    ? (((
        await supabase.rpc('metric_recipe_costs', { p_org: ctx.org.id, p_now: now().toISOString() })
      ).data ?? []) as {
        recipe_id: string;
        unit_cost_poisha: number | null;
        complete: boolean;
        food_cost_bps: number | null;
      }[])
    : [];
  const costBy = new Map(costs.map((c) => [c.recipe_id, c]));
  const ingredientBy = new Map((ingredients ?? []).map((i) => [i.id as string, i]));
  const priceBy = new Map((prices ?? []).map((p) => [p.ingredient_id as string, p]));
  const recipeBy = new Map((recipes ?? []).map((r) => [r.menu_item_id as string, r]));
  const linesBy = new Map<string, NonNullable<typeof lines>>();
  for (const l of lines ?? [])
    linesBy.set(l.recipe_id as string, [...(linesBy.get(l.recipe_id as string) ?? []), l]);
  const unitOf = (b: string) => t(`units.${b}`);
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );
  const withRecipe = (items ?? []).filter((i) => recipeBy.has(i.id as string)).length;

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <PillNav
        label={t('sections')}
        className="mb-6"
        items={TABS.map((x) => ({
          href: `/${ctx.org.slug}/recipes?tab=${x}`,
          label:
            x === 'drafts' ? t('tabs.drafts', { count: (drafts ?? []).length }) : t(`tabs.${x}`),
          active: x === tab,
        }))}
      />

      {tab === 'recipes' ? (
        <>
          <p className="mb-4 text-sm text-secondary">
            {t('coverage', {
              with: formatNumber(withRecipe, loc),
              total: formatNumber((items ?? []).length, loc),
            })}
          </p>
          {(items ?? []).length === 0 ? (
            <EmptyState title={t('noItems')} />
          ) : (
            <ul className="space-y-3">
              {(items ?? []).map((item) => {
                const recipe = recipeBy.get(item.id as string);
                const cost = recipe ? costBy.get(recipe.id as string) : undefined;
                const rows = recipe ? (linesBy.get(recipe.id as string) ?? []) : [];
                return (
                  <li key={item.id}>
                    <Card className="p-4">
                      <details>
                        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold">{item.name}</p>
                            <p className="text-xs text-secondary">
                              {recipe
                                ? t('recipeMeta', {
                                    lines: rows.length,
                                    version: recipe.version as number,
                                  })
                                : t('noRecipe')}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {recipe?.source === 'ai_draft' ? (
                              <Badge tone="accent" icon={<Sparkles />}>
                                {t('aiDrafted')}
                              </Badge>
                            ) : null}
                            {cost ? (
                              cost.complete ? (
                                <span className="text-sm tabular-nums">
                                  {t('costLine', {
                                    cost: money(cost.unit_cost_poisha ?? 0),
                                    pct:
                                      cost.food_cost_bps === null
                                        ? '—'
                                        : formatBps(cost.food_cost_bps, loc),
                                  })}
                                </span>
                              ) : (
                                <StatusBadge tone="warning">{t('incomplete')}</StatusBadge>
                              )
                            ) : !recipe ? (
                              <StatusBadge tone="neutral">{t('noRecipe')}</StatusBadge>
                            ) : null}
                          </div>
                        </summary>
                        {rows.length > 0 ? (
                          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                            {rows.map((l, i) => {
                              const ing = ingredientBy.get(l.ingredient_id as string);
                              return (
                                <li key={i} className="flex justify-between gap-2">
                                  <span>{ing?.name ?? t('subRecipe')}</span>
                                  <span className="text-secondary tabular-nums">
                                    {formatNumber(Number(l.qty_base), loc, {
                                      fractionDigits: Number(l.qty_base) % 1 ? 1 : 0,
                                    })}{' '}
                                    {ing ? unitOf(ing.base as string) : t('portions')}
                                    {Number(l.yield_pct) < 100
                                      ? ` · ${t('yieldShort', { pct: formatNumber(Number(l.yield_pct), loc) })}`
                                      : ''}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                        {ctx.isOwner ? (
                          <ActionForm
                            action={saveRecipeAction}
                            successKey="recipes.saved"
                            className="mt-4 space-y-2 border-t border-line pt-4"
                          >
                            {hidden}
                            <input type="hidden" name="itemId" value={item.id as string} />
                            <p className="text-sm font-semibold">
                              {recipe ? t('editRecipe') : t('writeRecipe')}
                            </p>
                            <div className="w-40">
                              <Label htmlFor={`y-${item.id}`}>{t('yieldPortions')}</Label>
                              <Input
                                id={`y-${item.id}`}
                                name="yieldPortions"
                                type="number"
                                min={1}
                                step="any"
                                defaultValue={Number(recipe?.yield_portions ?? 1)}
                              />
                            </div>
                            {[
                              ...rows.filter((r) => r.ingredient_id),
                              ...Array.from({ length: BLANK_ROWS }, () => null),
                            ].map((l, i) => (
                              <div
                                key={i}
                                className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2"
                              >
                                <Select
                                  name={`line-${i}-ingredient`}
                                  aria-label={t('ingredient')}
                                  defaultValue={(l?.ingredient_id as string) ?? ''}
                                >
                                  <option value="">{t('chooseIngredient')}</option>
                                  {(ingredients ?? []).map((ing) => (
                                    <option key={ing.id} value={ing.id as string}>
                                      {ing.name} ({unitOf(ing.base as string)})
                                    </option>
                                  ))}
                                </Select>
                                <Input
                                  name={`line-${i}-qty`}
                                  inputMode="decimal"
                                  aria-label={t('qty')}
                                  placeholder={t('qty')}
                                  defaultValue={l ? String(l.qty_base) : ''}
                                />
                                <Input
                                  name={`line-${i}-yield`}
                                  inputMode="decimal"
                                  aria-label={t('yieldPct')}
                                  placeholder={t('yieldPct')}
                                  defaultValue={l ? String(l.yield_pct) : ''}
                                />
                              </div>
                            ))}
                            <Hint>{t('recipeHint')}</Hint>
                            <Button type="submit" size="sm">
                              {t('saveRecipe')}
                            </Button>
                          </ActionForm>
                        ) : null}
                      </details>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}

      {tab === 'ingredients' ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {ctx.isOwner ? (
            <Card>
              <CardTitle>{t('addIngredient')}</CardTitle>
              <ActionForm
                action={addIngredientAction}
                successKey="recipes.saved"
                className="space-y-3"
              >
                {hidden}
                <div>
                  <Label htmlFor="ing-name">{t('ingredientName')}</Label>
                  <Input id="ing-name" name="name" required maxLength={120} />
                </div>
                <div>
                  <Label htmlFor="ing-base">{t('measuredIn')}</Label>
                  <Select id="ing-base" name="base" defaultValue="g">
                    {(['g', 'ml', 'pcs'] as const).map((b) => (
                      <option key={b} value={b}>
                        {t(`bases.${b}`)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="ing-price">{t('pricePer')}</Label>
                  <Input id="ing-price" name="price" inputMode="decimal" />
                  <Hint>{t('priceHint')}</Hint>
                </div>
                <Button type="submit">{t('addIngredient')}</Button>
              </ActionForm>
            </Card>
          ) : null}
          <Card>
            <CardTitle>{t('ingredientsTitle')}</CardTitle>
            {(ingredients ?? []).length === 0 ? (
              <EmptyState title={t('noIngredients')} />
            ) : (
              <ul className="space-y-2">
                {(ingredients ?? []).map((ing) => {
                  const p = priceBy.get(ing.id as string);
                  const perUnit = p
                    ? Math.round(
                        (Number(p.manual_cost_poisha) * (ing.base === 'pcs' ? 1 : 1000)) /
                          Number(p.per_base_qty),
                      )
                    : null;
                  return (
                    <li
                      key={ing.id}
                      className="glass-tile flex flex-wrap items-center justify-between gap-2 rounded-input p-3"
                    >
                      <div>
                        <p className="font-semibold">{ing.name}</p>
                        <p className="text-xs text-secondary">{t(`bases.${ing.base as string}`)}</p>
                      </div>
                      {canSeeMoney ? (
                        ctx.isOwner ? (
                          <ActionForm
                            action={setIngredientPriceAction}
                            successKey="recipes.saved"
                            className="flex items-center gap-2"
                          >
                            {hidden}
                            <input type="hidden" name="ingredientId" value={ing.id as string} />
                            <input type="hidden" name="base" value={ing.base as string} />
                            <Input
                              name="price"
                              inputMode="decimal"
                              required
                              aria-label={t('pricePerUnit', {
                                unit: t(`per.${ing.base as string}`),
                              })}
                              defaultValue={
                                perUnit === null ? '' : formatBDT(perUnit, 'en', { symbol: false })
                              }
                              className="min-h-9 w-28"
                            />
                            <span className="text-xs text-secondary">
                              {t(`per.${ing.base as string}`)}
                            </span>
                            <Button type="submit" size="sm" variant="secondary">
                              {t('save')}
                            </Button>
                          </ActionForm>
                        ) : (
                          <span className="text-sm tabular-nums">
                            {perUnit === null
                              ? t('noPrice')
                              : `${money(perUnit)} ${t(`per.${ing.base as string}`)}`}
                          </span>
                        )
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'drafts' ? (
        <div className="space-y-6">
          {canDraft ? (
            <Card>
              <CardTitle className="flex items-center gap-2">
                <Sparkles aria-hidden className="size-5 text-purple" />
                {t('draftTitle')}
              </CardTitle>
              <p className="-mt-2 mb-4 max-w-2xl text-sm text-secondary">{t('draftBody')}</p>
              {!aiConfigured() ? (
                <Alert tone="warning" className="mb-4">
                  {t('aiNotConfigured')}
                </Alert>
              ) : null}
              <ActionForm
                action={draftRecipesAction}
                successKey="recipes.drafted"
                className="space-y-3"
              >
                {hidden}
                <div>
                  <Label htmlFor="menu-text">{t('menuText')}</Label>
                  <Textarea
                    id="menu-text"
                    name="menuText"
                    rows={5}
                    maxLength={8000}
                    placeholder={t('menuPlaceholder')}
                  />
                </div>
                <div>
                  <Label htmlFor="menu-photo">{t('menuPhoto')}</Label>
                  <Input
                    id="menu-photo"
                    name="photo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                  />
                </div>
                <Button type="submit" disabled={!aiConfigured()}>
                  {t('draftButton')}
                </Button>
              </ActionForm>
            </Card>
          ) : null}

          {(drafts ?? []).length === 0 ? (
            <EmptyState title={t('noDrafts')} />
          ) : (
            <ul className="space-y-4">
              {(drafts ?? []).map((d) => {
                const payload = d.payload as {
                  yield_portions?: number;
                  notes?: string;
                  lines?: Line[];
                };
                const draftLines = [
                  ...(payload.lines ?? []),
                  ...Array.from({ length: 2 }, () => null),
                ];
                return (
                  <li key={d.id}>
                    <Card className="p-5">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-lg font-bold">{d.item_name}</h3>
                        <Badge tone="accent" icon={<Sparkles />}>
                          {t('aiDraftBadge')}
                        </Badge>
                      </div>
                      {payload.notes ? (
                        <p className="mb-3 text-sm text-secondary">{payload.notes}</p>
                      ) : null}
                      {canDraft ? (
                        <ActionForm
                          action={updateDraftAction}
                          successKey="recipes.saved"
                          className="space-y-2"
                        >
                          {hidden}
                          <input type="hidden" name="draftId" value={d.id as string} />
                          <input type="hidden" name="notes" value={payload.notes ?? ''} />
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div>
                              <Label htmlFor={`item-${d.id}`}>{t('menuItem')}</Label>
                              <Select
                                id={`item-${d.id}`}
                                name="menuItemId"
                                defaultValue={(d.menu_item_id as string) ?? ''}
                              >
                                <option value="">{t('chooseItem')}</option>
                                {(items ?? []).map((i) => (
                                  <option key={i.id} value={i.id as string}>
                                    {i.name}
                                  </option>
                                ))}
                              </Select>
                            </div>
                            <div>
                              <Label htmlFor={`dy-${d.id}`}>{t('yieldPortions')}</Label>
                              <Input
                                id={`dy-${d.id}`}
                                name="yieldPortions"
                                type="number"
                                min={1}
                                step="any"
                                defaultValue={payload.yield_portions ?? 1}
                              />
                            </div>
                          </div>
                          {draftLines.map((l, i) => (
                            <div
                              key={i}
                              className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2"
                            >
                              <Input
                                name={`line-${i}-name`}
                                aria-label={t('ingredient')}
                                placeholder={t('ingredient')}
                                defaultValue={l?.ingredient ?? ''}
                              />
                              <Select
                                name={`line-${i}-base`}
                                aria-label={t('measuredIn')}
                                defaultValue={l?.base ?? 'g'}
                              >
                                {(['g', 'ml', 'pcs'] as const).map((b) => (
                                  <option key={b} value={b}>
                                    {unitOf(b)}
                                  </option>
                                ))}
                              </Select>
                              <Input
                                name={`line-${i}-qty`}
                                inputMode="decimal"
                                aria-label={t('qty')}
                                placeholder={t('qty')}
                                defaultValue={l ? String(l.qty_base) : ''}
                              />
                              <Input
                                name={`line-${i}-yield`}
                                inputMode="decimal"
                                aria-label={t('yieldPct')}
                                placeholder={t('yieldPct')}
                                defaultValue={l ? String(l.yield_pct) : ''}
                              />
                            </div>
                          ))}
                          <Button type="submit" size="sm" variant="secondary">
                            {t('saveDraft')}
                          </Button>
                        </ActionForm>
                      ) : null}
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                        {ctx.isOwner ? (
                          <ActionForm action={approveDraftAction} successKey="recipes.approved">
                            {hidden}
                            <input type="hidden" name="draftId" value={d.id as string} />
                            <Button type="submit" size="sm">
                              {t('approve')}
                            </Button>
                          </ActionForm>
                        ) : (
                          <Hint>{t('ownerApproves')}</Hint>
                        )}
                        {canDraft ? (
                          <form action={discardDraftAction}>
                            {hidden}
                            <input type="hidden" name="draftId" value={d.id as string} />
                            <Button type="submit" size="sm" variant="ghost">
                              {t('discard')}
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </>
  );
}
