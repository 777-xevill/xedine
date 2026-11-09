import { CircleAlert, CircleCheck, ClipboardList, ShieldAlert } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Banner } from '@/components/stock/parts';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Card,
  CardTitle,
  Hint,
  Input,
  Label,
  PageTitle,
  Select,
} from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatDhakaDate, formatDhakaDateTime, formatNumber, type Locale } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import {
  holdIngredientAction,
  releaseHoldAction,
  saveShelfLivesAction,
  setBlockExpiredAction,
  setLotExpiryAction,
  throwAwayLotAction,
} from '@/modules/inventory/food-safety-actions';
import { formatQuantity } from '@/modules/inventory/format';
import { suggestShelfLife } from '@/modules/inventory/shelf-life-suggest';
import type { BaseUnit } from '@/modules/purchasing/lines';
import { getOrgContext } from '@/modules/tenancy/context';

const STOCK_ROLES = ['owner', 'manager', 'kitchen', 'purchaser', 'accountant'];
const QUICK_REASONS = ['smell', 'look', 'fridge', 'recall'] as const;

interface Block {
  branch_id: string;
  ingredient_id: string;
  name: string;
  name_bn: string | null;
  reason: 'held' | 'expired';
  expired_on: string | null;
  hold_id: string | null;
  note: string | null;
  lot_kind: string | null;
  lot_id: string | null;
  dishes: string[];
  dishes_bn: string[];
}

interface Lot {
  branch_id: string;
  ingredient_id: string;
  name: string;
  name_bn: string | null;
  base: BaseUnit;
  lot_kind: string;
  lot_id: string;
  received_on: string;
  expires_on: string;
  days_left: number;
  on_shelf_qty: number;
  estimated: boolean;
  status: 'expired' | 'today' | 'soon' | 'fresh';
}

// Red is kept for what someone reported as unsafe; a date is a warning.
const LOT_TONE = {
  expired: 'warning',
  today: 'warning',
  soon: 'warning',
  fresh: 'success',
} as const;

/**
 * Food safety (ADR 0043), phone first: one sentence on top, then only what needs doing. The list of days is
 * filled in with common values for the owner to check, so setting up is one look and one Save.
 */
export default async function FoodSafetyPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  const has = (roles: string[]) => roles.some((r) => ctx.roles.includes(r as never));
  if (!has(STOCK_ROLES)) notFound();
  const canHold = has(['owner', 'manager', 'kitchen']);
  const canRelease = has(['owner', 'manager']);
  const [t, tu, locale] = await Promise.all([
    getTranslations('foodSafety'),
    getTranslations('units'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const args = { p_org: ctx.org.id, p_branch: ctx.selectedBranchId, p_now: now().toISOString() };
  const [blocks, lots, sold, stale, ingredients, settings] = await Promise.all([
    supabase.rpc('metric_food_safety_blocks', args),
    supabase.rpc('metric_food_safety', { ...args, p_all: true }),
    supabase.rpc('metric_food_safety_sold', args),
    supabase.rpc('metric_food_safety_stale', args),
    supabase
      .from('ingredients')
      .select('id, name, name_bn, shelf_life_days')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('org_settings')
      .select('food_safety_block_expired')
      .eq('org_id', ctx.org.id)
      .maybeSingle(),
  ]);
  const blockRows = (blocks.data ?? []) as Block[];
  // One row per ingredient, however many branches it is stopped at.
  const blockGroups = [...new Set(blockRows.map((b) => b.ingredient_id))].map((id) =>
    blockRows.filter((b) => b.ingredient_id === id),
  );
  const anyHeld = blockRows.some((b) => b.reason === 'held');
  const staleRows = (stale.data ?? []) as {
    ingredient_id: string;
    name: string;
    name_bn: string | null;
    last_received: string;
  }[];
  const allLots = ((lots.data ?? []) as Lot[]).map((l) => ({
    ...l,
    on_shelf_qty: Number(l.on_shelf_qty),
    days_left: Number(l.days_left),
  }));
  const lotRows = allLots.filter((l) => l.status !== 'fresh');
  const soldRows = (sold.data ?? []) as {
    branch_id: string;
    order_id: string;
    at: string;
    ingredients: string[];
  }[];
  const items = (
    (ingredients.data ?? []) as {
      id: string;
      name: string;
      name_bn: string | null;
      shelf_life_days: number | null;
    }[]
  ).map((i) => ({
    ...i,
    suggested: i.shelf_life_days === null ? suggestShelfLife(i.name, i.name_bn) : null,
  }));
  const missing = items.filter((i) => i.shelf_life_days === null);
  const suggestedCount = missing.filter((i) => i.suggested !== null).length;
  const ordered = [...missing, ...items.filter((i) => i.shelf_life_days !== null)];
  const blockOn = settings.data?.food_safety_block_expired !== false;
  const needsSetup = missing.length > 0 && items.length > 0;

  const label = (x: { name: string; name_bn: string | null }) =>
    loc === 'bn' && x.name_bn ? x.name_bn : x.name;
  const day = (d: string) => formatDhakaDate(new Date(`${d}T06:00:00Z`), loc);
  const n = (v: number) => formatNumber(v, loc);
  const branchName = (id: string) => ctx.branches.find((b) => b.id === id)?.name ?? '';
  const showBranch = ctx.branches.length > 1;
  const qty = (q: number, b: BaseUnit) =>
    formatQuantity(q, b, loc, (u) => tu(u), { maxDecimals: 1 });
  const lotBadge = (l: { status: Lot['status']; days_left: number }) =>
    l.status === 'expired'
      ? t('lotExpired', { days: n(-l.days_left) })
      : l.status === 'today'
        ? t('lotToday')
        : t('lotSoon', { days: n(l.days_left) });
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );
  const expiredLots = lotRows.filter((l) => l.status === 'expired' && l.on_shelf_qty > 0).length;
  const soonLots = lotRows.length;

  const shelfList = canRelease ? (
    <ActionForm action={saveShelfLivesAction} successKey="common.saved">
      {hidden}
      <div className="space-y-2">
        {ordered.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-3">
            <Label htmlFor={`sl-${i.id}`} className="mb-0 min-w-0 flex-1 truncate">
              {label(i)}
              {i.suggested !== null ? (
                <span className="ms-1.5 text-xs font-normal text-secondary">{t('suggested')}</span>
              ) : null}
            </Label>
            <input type="hidden" name={`was:${i.id}`} value={i.shelf_life_days ?? ''} />
            <Input
              id={`sl-${i.id}`}
              name={`days:${i.id}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={3650}
              defaultValue={i.shelf_life_days ?? i.suggested ?? ''}
              aria-label={t('days')}
              className="w-20 text-center"
            />
          </div>
        ))}
      </div>
      <div className="sticky bottom-20 mt-3">
        <Button type="submit" className="w-full">
          {t('saveShelf')}
        </Button>
      </div>
    </ActionForm>
  ) : (
    <ul className="space-y-1 text-sm">
      {ordered.map((i) => (
        <li key={i.id} className="flex justify-between gap-3">
          <span>{label(i)}</span>
          <span className="text-secondary tabular-nums">
            {i.shelf_life_days === null
              ? t('notSet')
              : t('daysValue', { count: i.shelf_life_days, n: n(i.shelf_life_days) })}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} actions={<LocaleSwitcher />} />
      <div className="mx-auto max-w-2xl space-y-5">
        {blockGroups.length > 0 ? (
          <Banner
            tone={anyHeld ? 'danger' : 'warning'}
            icon={<ShieldAlert />}
            title={t('summaryBlocked', { count: blockGroups.length, n: n(blockGroups.length) })}
            body={t('summaryBlockedBody')}
          />
        ) : expiredLots > 0 ? (
          <Banner
            tone="warning"
            icon={<CircleAlert />}
            title={t('summaryExpired', { count: expiredLots, n: n(expiredLots) })}
            body={t('summaryExpiredBody')}
          />
        ) : soonLots > 0 ? (
          <Banner
            tone="info"
            icon={<CircleAlert />}
            title={t('summarySoon', { count: soonLots, n: n(soonLots) })}
          />
        ) : needsSetup && canRelease ? (
          <Banner
            tone="info"
            icon={<ClipboardList />}
            title={t('summarySetup')}
            body={t('summarySetupBody')}
          />
        ) : staleRows.length > 0 ? (
          <Banner
            tone="neutral"
            icon={<CircleCheck />}
            title={t('summaryNothingStopped')}
            body={t('summaryStale', { count: staleRows.length, n: n(staleRows.length) })}
          />
        ) : (
          <Banner tone="success" icon={<CircleCheck />} title={t('summaryOk')} />
        )}

        {blockGroups.map((group) => {
          const first = group[0]!;
          const held = group.some((b) => b.reason === 'held');
          const dishes = first.dishes.length;
          return (
            <details key={first.ingredient_id} className="glass-tile rounded-card p-4">
              <summary className="cursor-pointer">
                <span className="inline-flex w-[calc(100%-1.25rem)] flex-wrap items-center justify-between gap-2 align-top">
                  <span className="min-w-0">
                    <span className="block font-semibold">{label(first)}</span>
                    <span className="block text-xs text-secondary">
                      {showBranch
                        ? `${group.map((b) => branchName(b.branch_id)).join(', ')} · `
                        : ''}
                      {dishes > 0
                        ? t('dishesCount', { count: dishes, n: n(dishes) })
                        : t('noDishesShort')}
                    </span>
                  </span>
                  <StatusBadge tone={held ? 'danger' : 'warning'}>
                    {held ? t('doNotUse') : t('pastDate')}
                  </StatusBadge>
                </span>
              </summary>
              <div className="mt-3 space-y-3">
                {group.map((b) => (
                  <div
                    key={b.branch_id}
                    className="border-t border-line pt-3 first:border-t-0 first:pt-0"
                  >
                    <p className="text-sm">
                      {showBranch ? `${branchName(b.branch_id)}: ` : ''}
                      {b.reason === 'held'
                        ? t('heldBecause', { reason: b.note ?? '' })
                        : t('expiredOn', { date: b.expired_on ? day(b.expired_on) : '' })}
                    </p>
                    <p className="mt-1 text-sm text-secondary">
                      {b.dishes.length > 0
                        ? t('dishesStopped', {
                            dishes: (loc === 'bn' ? b.dishes_bn : b.dishes).join(', '),
                          })
                        : t('noDishesStopped')}
                    </p>
                    {canRelease && b.reason === 'held' && b.hold_id ? (
                      <ActionForm
                        action={releaseHoldAction}
                        successKey="common.saved"
                        className="mt-2 flex gap-2"
                      >
                        {hidden}
                        <input type="hidden" name="holdId" value={b.hold_id} />
                        <Input
                          name="note"
                          required
                          maxLength={300}
                          placeholder={t('releaseNote')}
                          aria-label={t('releaseNote')}
                          className="min-w-0 flex-1"
                        />
                        <Button type="submit" size="sm" variant="secondary">
                          {t('release')}
                        </Button>
                      </ActionForm>
                    ) : null}
                    {canRelease && b.reason === 'expired' && b.lot_id && b.lot_kind ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm text-secondary">
                          {t('stillSafe')}
                        </summary>
                        <ActionForm
                          action={setLotExpiryAction}
                          successKey="common.saved"
                          className="mt-2 space-y-2"
                        >
                          {hidden}
                          <input type="hidden" name="lotKind" value={b.lot_kind} />
                          <input type="hidden" name="lotId" value={b.lot_id} />
                          <Label htmlFor={`exp-${b.lot_id}`}>{t('safeUntil')}</Label>
                          <Input id={`exp-${b.lot_id}`} name="expiresOn" type="date" required />
                          <Label htmlFor={`why-${b.lot_id}`}>{t('whySafe')}</Label>
                          <Input id={`why-${b.lot_id}`} name="note" required maxLength={300} />
                          <Button type="submit" size="sm" variant="secondary">
                            {t('saveDate')}
                          </Button>
                        </ActionForm>
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>
          );
        })}

        {lotRows.map((l) => (
          <Card key={l.lot_id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{label(l)}</p>
                <p className="text-xs text-secondary">
                  {showBranch ? `${branchName(l.branch_id)} · ` : ''}
                  {t('lotDates', { bought: day(l.received_on), until: day(l.expires_on) })}
                </p>
              </div>
              <StatusBadge tone={LOT_TONE[l.status]}>{lotBadge(l)}</StatusBadge>
            </div>
            {l.on_shelf_qty > 0 ? (
              <p className="mt-2 text-sm">
                {l.estimated
                  ? t('probablyLeft', { qty: qty(l.on_shelf_qty, l.base) })
                  : t('left', { qty: qty(l.on_shelf_qty, l.base) })}
              </p>
            ) : null}
            {canHold && l.status === 'expired' && l.on_shelf_qty > 0 ? (
              <ActionForm
                action={throwAwayLotAction}
                successKey="foodSafety.thrown"
                className="mt-2"
              >
                {hidden}
                <input type="hidden" name="branchId" value={l.branch_id} />
                <input type="hidden" name="ingredientId" value={l.ingredient_id} />
                <input type="hidden" name="qty" value={l.on_shelf_qty} />
                <Button type="submit" size="sm" variant="danger">
                  {t('throwAway')}
                </Button>
              </ActionForm>
            ) : null}
            {canHold && l.status !== 'expired' ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-secondary">
                  {t('packetDate')}
                </summary>
                <ActionForm
                  action={setLotExpiryAction}
                  successKey="common.saved"
                  className="mt-2 space-y-2"
                >
                  {hidden}
                  <input type="hidden" name="lotKind" value={l.lot_kind} />
                  <input type="hidden" name="lotId" value={l.lot_id} />
                  <Label htmlFor={`pk-${l.lot_id}`}>{t('safeUntil')}</Label>
                  <Input id={`pk-${l.lot_id}`} name="expiresOn" type="date" required />
                  <Label htmlFor={`pn-${l.lot_id}`}>{t('dateNote')}</Label>
                  <Input id={`pn-${l.lot_id}`} name="note" maxLength={300} />
                  <Button type="submit" size="sm" variant="secondary">
                    {t('saveDate')}
                  </Button>
                </ActionForm>
              </details>
            ) : null}
          </Card>
        ))}

        {allLots.length > 0 ? (
          <details open className="glass-tile rounded-card p-4">
            <summary className="cursor-pointer font-semibold">
              {t('datesTitle', { n: n(allLots.length) })}
            </summary>
            <ul className="mt-3 space-y-3">
              {allLots.map((l) => (
                <li key={l.lot_id} className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{label(l)}</p>
                    <p className="text-xs text-secondary">
                      {showBranch ? `${branchName(l.branch_id)} · ` : ''}
                      {t('lotDates', { bought: day(l.received_on), until: day(l.expires_on) })}
                    </p>
                  </div>
                  <StatusBadge tone={LOT_TONE[l.status]}>{lotBadge(l)}</StatusBadge>
                </li>
              ))}
            </ul>
            <Hint className="mt-3">{t('datesHint')}</Hint>
          </details>
        ) : null}

        {staleRows.length > 0 ? (
          <details className="glass-tile rounded-card p-4">
            <summary className="cursor-pointer font-semibold">
              {t('staleTitle', { n: n(staleRows.length) })}
            </summary>
            <p className="mt-2 text-sm text-secondary">{t('staleHint')}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {staleRows.map((r) => (
                <li key={r.ingredient_id} className="flex justify-between gap-3">
                  <span>{label(r)}</span>
                  <span className="text-secondary">
                    {t('staleLine', { date: day(r.last_received) })}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {soldRows.length > 0 ? (
          <Alert tone="danger">
            <p className="font-semibold">{t('soldTitle')}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {soldRows.map((s) => (
                <li key={s.order_id}>
                  {formatDhakaDateTime(new Date(s.at), loc)} · {s.ingredients.join(', ')}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs">{t('soldHint')}</p>
          </Alert>
        ) : null}

        {needsSetup && canRelease ? (
          <Card className="p-4 sm:p-5">
            <CardTitle>{t('shelfTitle')}</CardTitle>
            <p className="mb-3 text-sm text-secondary">
              {suggestedCount > 0
                ? t('shelfFilled', { count: suggestedCount, n: n(suggestedCount) })
                : t('shelfEmpty')}
            </p>
            {shelfList}
            <Hint className="mt-2">{t('shelfHint')}</Hint>
          </Card>
        ) : null}

        {canHold ? (
          <details className="glass-tile rounded-card p-4">
            <summary className="cursor-pointer font-semibold">{t('holdTitle')}</summary>
            <ActionForm
              action={holdIngredientAction}
              successKey="foodSafety.held"
              className="mt-3 space-y-3"
            >
              {hidden}
              <div>
                <Label htmlFor="fs-item">{t('item')}</Label>
                <Select id="fs-item" name="ingredientId" required defaultValue="">
                  <option value="" disabled>
                    {t('pickItem')}
                  </option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {label(i)}
                    </option>
                  ))}
                </Select>
              </div>
              {showBranch ? (
                <div>
                  <Label htmlFor="fs-branch">{t('branch')}</Label>
                  <Select
                    id="fs-branch"
                    name="branchId"
                    defaultValue={ctx.selectedBranchId ?? ctx.branches[0]?.id ?? ''}
                  >
                    {ctx.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <input type="hidden" name="branchId" value={ctx.branches[0]?.id ?? ''} />
              )}
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">{t('holdReason')}</legend>
                <div className="space-y-1.5">
                  {QUICK_REASONS.map((r) => (
                    <label key={r} className="flex min-h-9 items-center gap-2 text-sm">
                      <input type="radio" name="reasonPick" value={t(`quickReasons.${r}`)} />
                      {t(`quickReasons.${r}`)}
                    </label>
                  ))}
                </div>
                <Input
                  name="reason"
                  maxLength={300}
                  placeholder={t('holdReasonOther')}
                  aria-label={t('holdReasonOther')}
                  className="mt-2"
                />
              </fieldset>
              <Button type="submit" variant="danger">
                {t('hold')}
              </Button>
            </ActionForm>
            <Hint className="mt-2">{t('holdHint')}</Hint>
          </details>
        ) : null}

        {items.length > 0 && !(needsSetup && canRelease) ? (
          <details className="glass-tile rounded-card p-4">
            <summary className="cursor-pointer font-semibold">{t('shelfTitle')}</summary>
            <div className="mt-3">{shelfList}</div>
            <Hint className="mt-2">{t('shelfHint')}</Hint>
          </details>
        ) : null}

        {ctx.isOwner ? (
          <details className="glass-tile rounded-card p-4">
            <summary className="cursor-pointer font-semibold">{t('tillTitle')}</summary>
            <ActionForm
              action={setBlockExpiredAction}
              successKey="common.saved"
              className="mt-3 flex items-end gap-2"
            >
              {hidden}
              <div className="min-w-0 flex-1">
                <Label htmlFor="fs-block">{t('tillLabel')}</Label>
                <Select id="fs-block" name="block" defaultValue={blockOn ? 'on' : 'off'}>
                  <option value="on">{t('tillBlock')}</option>
                  <option value="off">{t('tillWarn')}</option>
                </Select>
              </div>
              <Button type="submit" variant="secondary">
                {t('save')}
              </Button>
            </ActionForm>
            <Hint className="mt-2">{t('tillHint')}</Hint>
          </details>
        ) : null}
      </div>
    </>
  );
}
