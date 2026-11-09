import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { StatusBadge } from '@/components/ui/badge';
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
} from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatDhakaDateTime, formatNumber, type Locale } from '@/lib/i18n/format';
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
import type { BaseUnit } from '@/modules/purchasing/lines';
import { getOrgContext } from '@/modules/tenancy/context';

const STOCK_ROLES = ['owner', 'manager', 'kitchen', 'purchaser', 'accountant'];

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
  status: 'expired' | 'today' | 'soon';
}

const LOT_TONE = { expired: 'danger', today: 'danger', soon: 'warning' } as const;

/**
 * Food safety (ADR 0043). What cannot be cooked right now and why, what is about to go off, and the one
 * number per ingredient that makes it all automatic: how many days it stays safe.
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
  const [blocks, lots, sold, ingredients, settings] = await Promise.all([
    supabase.rpc('metric_food_safety_blocks', args),
    supabase.rpc('metric_food_safety', args),
    supabase.rpc('metric_food_safety_sold', args),
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
  const lotRows = ((lots.data ?? []) as Lot[]).map((l) => ({
    ...l,
    on_shelf_qty: Number(l.on_shelf_qty),
    days_left: Number(l.days_left),
  }));
  const soldRows = (sold.data ?? []) as {
    branch_id: string;
    order_id: string;
    at: string;
    ingredients: string[];
  }[];
  const items = (ingredients.data ?? []) as {
    id: string;
    name: string;
    name_bn: string | null;
    shelf_life_days: number | null;
  }[];
  const missing = items.filter((i) => i.shelf_life_days === null);
  const ordered = [...missing, ...items.filter((i) => i.shelf_life_days !== null)];
  const blockOn = settings.data?.food_safety_block_expired !== false;

  const label = (x: { name: string; name_bn: string | null }) =>
    loc === 'bn' && x.name_bn ? x.name_bn : x.name;
  const branchName = (id: string) => ctx.branches.find((b) => b.id === id)?.name ?? '';
  const showBranch = ctx.branches.length > 1;
  const qty = (q: number, b: BaseUnit) =>
    formatQuantity(q, b, loc, (u) => tu(u), { maxDecimals: 1 });
  const lotBadge = (l: { status: Lot['status']; days_left: number }) =>
    l.status === 'expired'
      ? t('lotExpired', { days: formatNumber(-l.days_left, loc) })
      : l.status === 'today'
        ? t('lotToday')
        : t('lotSoon', { days: formatNumber(l.days_left, loc) });
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="p-4 sm:p-6">
            <CardTitle>{t('blockedTitle')}</CardTitle>
            {blockRows.length === 0 ? (
              <EmptyState title={t('noneBlocked')} />
            ) : (
              <ul className="space-y-3">
                {blockRows.map((b) => (
                  <li
                    key={`${b.branch_id}-${b.ingredient_id}`}
                    className="glass-tile rounded-input p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{label(b)}</p>
                        <p className="text-xs text-secondary">
                          {showBranch ? `${branchName(b.branch_id)} · ` : ''}
                          {b.reason === 'held'
                            ? t('heldBecause', { reason: b.note ?? '' })
                            : t('expiredOn', { date: b.expired_on ?? '' })}
                        </p>
                      </div>
                      <StatusBadge tone="danger">{t('doNotUse')}</StatusBadge>
                    </div>
                    <p className="mt-2 text-sm">
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
                        className="mt-2 flex flex-wrap items-end gap-2"
                      >
                        {hidden}
                        <input type="hidden" name="holdId" value={b.hold_id} />
                        <div className="min-w-48 flex-1">
                          <Label htmlFor={`rel-${b.hold_id}`}>{t('releaseNote')}</Label>
                          <Input id={`rel-${b.hold_id}`} name="note" required maxLength={300} />
                        </div>
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
                          className="mt-2 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end"
                        >
                          {hidden}
                          <input type="hidden" name="lotKind" value={b.lot_kind} />
                          <input type="hidden" name="lotId" value={b.lot_id} />
                          <div>
                            <Label htmlFor={`exp-${b.lot_id}`}>{t('safeUntil')}</Label>
                            <Input id={`exp-${b.lot_id}`} name="expiresOn" type="date" required />
                          </div>
                          <div>
                            <Label htmlFor={`why-${b.lot_id}`}>{t('whySafe')}</Label>
                            <Input id={`why-${b.lot_id}`} name="note" required maxLength={300} />
                          </div>
                          <Button type="submit" size="sm" variant="secondary">
                            {t('saveDate')}
                          </Button>
                        </ActionForm>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {!blockOn ? <Hint className="mt-3">{t('warnOnlyHint')}</Hint> : null}
          </Card>

          <Card className="p-4 sm:p-6">
            <CardTitle>{t('lotsTitle')}</CardTitle>
            {lotRows.length === 0 ? (
              <EmptyState title={t('noLots')} />
            ) : (
              <ul className="space-y-3">
                {lotRows.map((l) => (
                  <li key={l.lot_id} className="glass-tile rounded-input p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{label(l)}</p>
                        <p className="text-xs text-secondary">
                          {showBranch ? `${branchName(l.branch_id)} · ` : ''}
                          {t('lotDates', { bought: l.received_on, until: l.expires_on })}
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
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      {canHold && l.status === 'expired' && l.on_shelf_qty > 0 ? (
                        <ActionForm action={throwAwayLotAction} successKey="foodSafety.thrown">
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
                        <details className="w-full">
                          <summary className="cursor-pointer text-sm text-secondary">
                            {t('packetDate')}
                          </summary>
                          <ActionForm
                            action={setLotExpiryAction}
                            successKey="common.saved"
                            className="mt-2 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end"
                          >
                            {hidden}
                            <input type="hidden" name="lotKind" value={l.lot_kind} />
                            <input type="hidden" name="lotId" value={l.lot_id} />
                            <div>
                              <Label htmlFor={`pk-${l.lot_id}`}>{t('safeUntil')}</Label>
                              <Input id={`pk-${l.lot_id}`} name="expiresOn" type="date" required />
                            </div>
                            <div>
                              <Label htmlFor={`pn-${l.lot_id}`}>{t('dateNote')}</Label>
                              <Input id={`pn-${l.lot_id}`} name="note" maxLength={300} />
                            </div>
                            <Button type="submit" size="sm" variant="secondary">
                              {t('saveDate')}
                            </Button>
                          </ActionForm>
                        </details>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Hint className="mt-3">{t('lotsHint')}</Hint>
          </Card>

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
        </div>

        <div className="space-y-6">
          {canHold ? (
            <Card>
              <CardTitle>{t('holdTitle')}</CardTitle>
              <ActionForm
                action={holdIngredientAction}
                successKey="foodSafety.held"
                className="space-y-3"
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
                <div>
                  <Label htmlFor="fs-reason">{t('holdReason')}</Label>
                  <Input
                    id="fs-reason"
                    name="reason"
                    required
                    maxLength={300}
                    placeholder={t('holdReasonExample')}
                  />
                </div>
                <Button type="submit" variant="danger">
                  {t('hold')}
                </Button>
              </ActionForm>
              <Hint className="mt-2">{t('holdHint')}</Hint>
            </Card>
          ) : null}

          <Card>
            <CardTitle>{t('shelfTitle')}</CardTitle>
            <p className="mb-3 text-sm text-secondary">
              {missing.length > 0
                ? t('shelfMissing', { count: missing.length, n: formatNumber(missing.length, loc) })
                : t('shelfAllSet')}
            </p>
            {items.length === 0 ? (
              <EmptyState title={t('noItems')} />
            ) : canRelease ? (
              <ActionForm action={saveShelfLivesAction} successKey="common.saved">
                {hidden}
                <div className="max-h-96 space-y-2 overflow-y-auto pe-1">
                  {ordered.map((i) => (
                    <div key={i.id} className="flex items-center justify-between gap-3">
                      <Label htmlFor={`sl-${i.id}`} className="mb-0 min-w-0 flex-1 truncate">
                        {label(i)}
                      </Label>
                      <input type="hidden" name={`was:${i.id}`} value={i.shelf_life_days ?? ''} />
                      <Input
                        id={`sl-${i.id}`}
                        name={`days:${i.id}`}
                        type="number"
                        min={1}
                        max={3650}
                        defaultValue={i.shelf_life_days ?? ''}
                        aria-label={t('days')}
                        className="w-24"
                      />
                    </div>
                  ))}
                </div>
                <Button type="submit" className="mt-3">
                  {t('saveShelf')}
                </Button>
              </ActionForm>
            ) : (
              <ul className="max-h-96 space-y-1 overflow-y-auto text-sm">
                {ordered.map((i) => (
                  <li key={i.id} className="flex justify-between gap-3">
                    <span>{label(i)}</span>
                    <span className="tabular-nums text-secondary">
                      {i.shelf_life_days === null
                        ? t('notSet')
                        : t('daysValue', {
                            count: i.shelf_life_days,
                            n: formatNumber(i.shelf_life_days, loc),
                          })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Hint className="mt-2">{t('shelfHint')}</Hint>
          </Card>

          {ctx.isOwner ? (
            <Card>
              <CardTitle>{t('tillTitle')}</CardTitle>
              <ActionForm
                action={setBlockExpiredAction}
                successKey="common.saved"
                className="flex items-end gap-2"
              >
                {hidden}
                <div className="flex-1">
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
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
