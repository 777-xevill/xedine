'use client';

import {
  ArrowLeft,
  BadgePercent,
  Ban,
  CheckCircle2,
  ChefHat,
  Clock3,
  CloudOff,
  History,
  Image as ImageIcon,
  Minus,
  Plus,
  Printer,
  QrCode as QrIcon,
  RefreshCw,
  ScanLine,
  ShoppingBag,
  Star,
  Type,
  UserPlus,
  Utensils,
  Wallet,
  Wifi,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Badge, StatusBadge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Input, Label, Select } from '@/components/ui/form';
import { Segmented } from '@/components/ui/segmented';
import { formatMoney, formatBps, formatDateTime, formatNumber } from '@/lib/i18n/format';
import { tillPlace } from './till-place';
import { taxKindOf } from '@/modules/social/culture';
import { parseTakaToPoisha, type LineAmounts } from '@/lib/money';
import { memberCardUrl } from '@/modules/customers/member-card';
import type {
  Channel,
  DiningTable,
  MenuCategory,
  MenuItem,
  OrderLine,
  OrderRow,
  ReasonCode,
  ReceiptInfo,
  TillMember,
} from './client';
import {
  CancelOrderDialog,
  CustomerDialog,
  DialogShell,
  DiscountDialog,
  ItemPicker,
  itemUnitPrice,
  MethodPicker,
  RefundDialog,
  VoidDialog,
  type PaymentMethod,
  type PickedItem,
} from './dialogs';
import { CashierHelper } from './cashier-helper';
import { getTillView, setTillView, type TillView } from './device-storage';
import { ItemTile } from './item-tile';
import { MemberCardDialog, ScanCardDialog, UsePointsDialog } from './member-dialogs';
import type { OutboxEntry } from './outbox';
import { Receipt } from './Receipt';
import { useTill } from './till-context';

export interface CartItem {
  key: string;
  menuItemId: string;
  name: string;
  variantId: string | null;
  modifierIds: string[];
  modifiersLabel: string;
  /** Per unit, printed basis, add-ons included. */
  unitPricePoisha: number;
  quantity: number;
  note: string;
}

export function cartKey(menuItemId: string, picked: PickedItem): string {
  return [
    menuItemId,
    picked.variantId ?? '',
    [...picked.modifierIds].sort().join(','),
    picked.note,
  ].join('|');
}

const itemLabel = (x: { name: string; name_bn: string | null }, locale: string) =>
  locale === 'bn' && x.name_bn ? x.name_bn : x.name;

function Totals({
  amounts,
}: {
  amounts: Pick<LineAmounts, 'netPoisha' | 'vatPoisha' | 'serviceChargePoisha' | 'totalPoisha'> & {
    discountPoisha?: number;
  };
}) {
  const t = useTranslations('pos');
  const tp = useTranslations('place');
  const { locale } = useTill();
  const money = (p: number) => formatMoney(p, locale, tillPlace().currency);
  return (
    <dl className="space-y-1.5 text-sm">
      <div className="flex justify-between gap-3">
        <dt className="text-secondary">{t('subtotal')}</dt>
        <dd className="text-secondary tabular-nums">{money(amounts.netPoisha)}</dd>
      </div>
      {amounts.discountPoisha ? (
        <div className="flex justify-between gap-3">
          <dt className="text-secondary">{t('discount')}</dt>
          <dd className="font-medium text-warning tabular-nums">
            −{money(amounts.discountPoisha)}
          </dd>
        </div>
      ) : null}
      <div className="flex justify-between gap-3">
        <dt className="text-secondary">
          {t('vat', { tax: tp(`taxNames.${taxKindOf(tillPlace().country)}`) })}
        </dt>
        <dd className="text-secondary tabular-nums">{money(amounts.vatPoisha)}</dd>
      </div>
      {amounts.serviceChargePoisha > 0 ? (
        <div className="flex justify-between gap-3">
          <dt className="text-secondary">{t('serviceCharge')}</dt>
          <dd className="text-secondary tabular-nums">{money(amounts.serviceChargePoisha)}</dd>
        </div>
      ) : null}
      {/* The hero: the figure the customer pays, large; it rolls up into place when it changes. */}
      <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <dt className="text-base font-semibold">{t('total')}</dt>
        <dd className="text-[2rem] leading-none font-bold tracking-[-0.035em] tabular-nums">
          <span key={amounts.totalPoisha} className="till-figure">
            {money(amounts.totalPoisha)}
          </span>
        </dd>
      </div>
    </dl>
  );
}

// -------------------------------------------------------------------------------------------
// Cart
// -------------------------------------------------------------------------------------------
export type CartMode = { kind: 'new' } | { kind: 'round'; orderLabel: string };

export function CartScreen({
  menu,
  channels,
  tables,
  channelId,
  setChannelId,
  tableId,
  setTableId,
  isDineIn,
  cart,
  onAdd,
  changeQty,
  preview,
  busy,
  mode,
  onSubmit,
  onCancelRound,
}: {
  menu: MenuCategory[];
  channels: Channel[];
  tables: DiningTable[];
  channelId: string;
  setChannelId: (v: string) => void;
  tableId: string;
  setTableId: (v: string) => void;
  isDineIn: boolean;
  cart: CartItem[];
  onAdd: (item: MenuItem, picked: PickedItem) => void;
  changeQty: (key: string, delta: number) => void;
  preview: LineAmounts | null;
  busy: boolean;
  mode: CartMode;
  onSubmit: () => void;
  onCancelRound: () => void;
}) {
  const t = useTranslations('pos');
  const { locale } = useTill();
  const money = (p: number) => formatMoney(p, locale, tillPlace().currency);
  const [category, setCategory] = useState<string>('all');
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [view, setView] = useState<TillView>(() => getTillView());
  const chooseView = (next: TillView) => {
    setView(next);
    setTillView(next);
  };
  const shown = category === 'all' ? menu : menu.filter((c) => c.id === category);
  // How many of each dish the cart holds (all sizes together): only rings its tile, never a price.
  const inCart = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cart) counts.set(c.menuItemId, (counts.get(c.menuItemId) ?? 0) + c.quantity);
    return counts;
  }, [cart]);

  const tap = (item: MenuItem) => {
    if (item.variants.length > 0 || item.modifier_groups.length > 0) {
      setPicking(item);
      return;
    }
    onAdd(item, {
      variantId: null,
      variantName: null,
      modifierIds: [],
      modifiersLabel: '',
      unitPricePoisha: itemUnitPrice(item, null),
      note: '',
      quantity: 1,
    });
  };

  return (
    <div className="till-enter grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_340px]">
      <section className="till-pane flex min-h-0 flex-col rounded-card p-3 sm:p-4">
        {mode.kind === 'round' ? (
          <div className="till-raised mb-3 flex items-center justify-between gap-2 rounded-input py-1.5 ps-4 pe-1.5">
            <p className="font-semibold">{t('addingToOrder', { order: mode.orderLabel })}</p>
            <Button variant="ghost" size="sm" onClick={onCancelRound}>
              <ArrowLeft aria-hidden className="size-4" />
              {t('backToOrder')}
            </Button>
          </div>
        ) : null}

        <CashierHelper
          menu={menu}
          onAdd={onAdd}
          toolbar={
            <Segmented
              label={t('viewLabel')}
              value={view}
              onChange={chooseView}
              size="sm"
              options={[
                {
                  value: 'text',
                  label: t('viewText'),
                  icon: <Type aria-hidden className="size-3.5" />,
                },
                {
                  value: 'photo',
                  label: t('viewPhoto'),
                  icon: <ImageIcon aria-hidden className="size-3.5" />,
                },
              ]}
            />
          }
        />

        <div className="mb-3">
          <nav
            aria-label={t('categories')}
            className="till-scroll -mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 pb-1"
          >
            {[
              { id: 'all', label: t('allItems') },
              ...menu.map((c) => ({ id: c.id, label: itemLabel(c, locale) })),
            ].map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
                className="till-chip"
              >
                {c.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="till-scroll min-h-0 flex-1 overflow-y-auto pe-1">
          {shown.map((cat) => {
            const items = cat.items.filter((i) => i.is_available);
            if (items.length === 0) return null;
            return (
              <div key={cat.id} className="mb-5 last:mb-1">
                <h2 className="mb-2.5 flex items-center gap-3 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                  <span className="shrink-0">{itemLabel(cat, locale)}</span>
                  <span aria-hidden className="h-px flex-1 bg-line" />
                </h2>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                  {items.map((item) => (
                    <ItemTile
                      key={item.id}
                      item={item}
                      label={itemLabel(item, locale)}
                      view={view}
                      inCart={inCart.get(item.id) ?? 0}
                      onTap={() => tap(item)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <aside className="till-pane flex min-h-0 flex-col rounded-card p-3 sm:p-4">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold tracking-tight">
          <ShoppingBag aria-hidden className="size-5 text-muted" />
          {t('cart')}
        </h2>
        {mode.kind !== 'round' ? (
          <div className="mb-2 grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="channel">{t('channel')}</Label>
              <Select id="channel" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            {isDineIn ? (
              <div>
                <Label htmlFor="table">{t('table')}</Label>
                <Select id="table" value={tableId} onChange={(e) => setTableId(e.target.value)}>
                  <option value="">{t('noTable')}</option>
                  {tables.map((tb) => (
                    <option key={tb.id} value={tb.id}>
                      {tb.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="till-scroll -mx-1 min-h-24 flex-1 overflow-y-auto px-1">
          {cart.length === 0 ? (
            <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 text-center">
              <span
                aria-hidden
                className="till-raised flex size-14 items-center justify-center rounded-full"
              >
                <ShoppingBag className="size-6 text-muted" />
              </span>
              <p className="text-sm text-secondary">{t('cartEmpty')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {cart.map((c) => (
                <li key={c.key} className="till-line flex items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.9375rem] leading-snug font-semibold">{c.name}</p>
                    {c.modifiersLabel ? (
                      <p className="mt-0.5 text-xs text-secondary">{c.modifiersLabel}</p>
                    ) : null}
                    {c.note ? <p className="mt-0.5 text-xs text-muted italic">{c.note}</p> : null}
                    <p className="mt-0.5 text-xs text-muted tabular-nums">
                      {money(c.unitPricePoisha)}
                    </p>
                  </div>
                  <div className="till-well flex shrink-0 items-center gap-0.5 rounded-full p-0.5">
                    <Button
                      variant="subtle"
                      size="icon"
                      aria-label={t('less')}
                      onClick={() => changeQty(c.key, -1)}
                    >
                      <Minus aria-hidden className="size-4" />
                    </Button>
                    <span className="w-7 text-center text-base font-bold tabular-nums">
                      <span key={c.quantity} className="till-pop">
                        {c.quantity}
                      </span>
                    </span>
                    <Button
                      variant="subtle"
                      size="icon"
                      aria-label={t('more')}
                      onClick={() => changeQty(c.key, 1)}
                    >
                      <Plus aria-hidden className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {preview && cart.length > 0 && mode.kind === 'new' ? (
          <div className="till-enter mt-2 border-t border-line pt-3">
            <Totals amounts={preview} />
          </div>
        ) : null}
        <Button
          size="lg"
          className="till-cta mt-3 min-h-16 w-full text-[1.0625rem]"
          disabled={busy || cart.length === 0}
          onClick={onSubmit}
        >
          {mode.kind === 'round' ? t('addToOrder') : t('placeOrder')}
        </Button>
      </aside>

      {picking ? (
        <ItemPicker
          item={picking}
          onClose={() => setPicking(null)}
          onAdd={(picked) => {
            onAdd(picking, picked);
            setPicking(null);
          }}
        />
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Order
// -------------------------------------------------------------------------------------------
const ORDER_TONE: Record<string, BadgeTone> = {
  open: 'neutral',
  sent_to_kitchen: 'info',
  preparing: 'info',
  ready: 'success',
  served: 'success',
  completed: 'success',
  cancelled: 'danger',
};
const PAYMENT_TONE: Record<string, BadgeTone> = {
  unpaid: 'warning',
  partially_paid: 'warning',
  paid: 'success',
  partially_refunded: 'info',
  refunded: 'danger',
};

export function OrderBadges({ order, local }: { order: OrderRow; local: boolean }) {
  const t = useTranslations('pos');
  return (
    <div className="flex flex-wrap gap-1.5">
      <StatusBadge tone={(ORDER_TONE[order.order_status] ?? 'neutral') as 'neutral'}>
        {t(`orderStatus.${order.order_status}`)}
      </StatusBadge>
      <StatusBadge tone={(PAYMENT_TONE[order.payment_status] ?? 'neutral') as 'neutral'}>
        {t(`paymentStatus.${order.payment_status}`)}
      </StatusBadge>
      {local ? <StatusBadge tone="warning">{t('waitingSync')}</StatusBadge> : null}
    </div>
  );
}

export function orderLabel(order: OrderRow, t: ReturnType<typeof useTranslations<'pos'>>): string {
  if (order.order_number !== null) return t('orderNumber', { number: order.order_number });
  return order.invoice_no ?? order.provisional_receipt_no ?? '';
}

export function OrderScreen({
  order,
  lines,
  local,
  busy,
  tableName,
  receipt,
  voidReasons,
  discountReasons,
  onSendKitchen,
  onVoid,
  onDiscount,
  onDiscountCode,
  onCancel,
  onAttachCustomer,
  memberCardOn,
  member,
  onScanCard,
  onUsePoints,
  onAddRound,
  onCheckout,
  onNewOrder,
}: {
  order: OrderRow;
  lines: OrderLine[];
  local: boolean;
  busy: boolean;
  tableName: string | null;
  receipt: ReceiptInfo | null;
  voidReasons: ReasonCode[];
  discountReasons: ReasonCode[];
  /** The owner switched the member card on (ADR 0042). */
  memberCardOn: boolean;
  /** The member on this bill, as the server sees them; null while none. */
  member: TillMember | null;
  onScanCard: (token: string) => void;
  onUsePoints: (points: number) => void;
  onSendKitchen: () => void;
  onVoid: (line: OrderLine, reasonId: string, approvalId?: string) => void;
  onDiscount: (percentBps: number, reasonId: string, approvalId?: string) => void;
  onDiscountCode: (code: string) => void;
  onCancel: (reasonId: string, approvalId?: string) => void;
  onAttachCustomer: (phone: string, name: string, consent: boolean) => void;
  onAddRound: () => void;
  onCheckout: () => void;
  onNewOrder: () => void;
}) {
  const t = useTranslations('pos');
  const { locale, online } = useTill();
  const money = (p: number) => formatMoney(p, locale, tillPlace().currency);
  const [voidTarget, setVoidTarget] = useState<OrderLine | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const memberOn = member?.is_on === true;
  const cardUrl =
    memberOn && member.token && typeof window !== 'undefined'
      ? memberCardUrl(window.location.origin, member.token)
      : null;

  const closed = order.order_status === 'cancelled' || order.order_status === 'completed';
  const unpaid = order.payment_status === 'unpaid' || order.payment_status === 'partially_paid';
  // Voids, discounts, cancels and customers need the server now (ADR 0014); so does a new round.
  const live = online && !local;
  const hasUnsent = lines.some((l) => l.status === 'active' && l.kot_sent_at === null);
  const anySent = lines.some((l) => l.status === 'active' && l.kot_sent_at !== null);

  return (
    <div className="till-enter grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_320px]">
      {receipt ? (
        <Receipt
          kind="kot"
          order={order}
          lines={lines}
          info={receipt}
          tableName={tableName}
          locale={locale}
        />
      ) : null}
      <section className="till-pane flex min-h-0 flex-col rounded-card p-4 sm:p-5">
        <div className="mb-1 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div className="min-w-0">
            <h2 className="text-[1.75rem] leading-tight font-bold tracking-[-0.03em]">
              {orderLabel(order, t)}
            </h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-secondary">
              {tableName ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <Utensils aria-hidden className="size-4 text-muted" />
                  {tableName}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Clock3 aria-hidden className="size-4 text-muted" />
                {formatDateTime(new Date(order.placed_at), locale, tillPlace().tz)}
              </span>
            </p>
          </div>
          <OrderBadges order={order} local={local} />
        </div>
        <ul className="till-scroll min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {lines.map((l) => (
            <li key={l.id} className="till-line flex items-center gap-3 py-3 text-sm">
              <span
                className={`flex h-8 min-w-10 shrink-0 items-center justify-center rounded-full px-2 text-sm font-bold tabular-nums ${
                  l.status === 'voided' ? 'text-muted line-through' : 'till-raised'
                }`}
              >
                {l.quantity}×
              </span>
              <div
                className={
                  l.status === 'voided'
                    ? 'min-w-0 flex-1 text-muted line-through'
                    : 'min-w-0 flex-1'
                }
              >
                <p className="text-[0.9375rem] font-semibold">{l.name_snapshot}</p>
                {l.notes ? <p className="mt-0.5 text-xs text-muted italic">{l.notes}</p> : null}
                {l.status === 'active' && l.kot_sent_at === null ? (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-warning">
                    <ChefHat aria-hidden className="size-3.5" />
                    {t('notSentYet')}
                  </p>
                ) : null}
              </div>
              <span
                className={`w-24 text-end font-semibold tabular-nums ${l.status === 'voided' ? 'text-muted' : ''}`}
              >
                {money(l.total_poisha)}
              </span>
              {l.status === 'active' && unpaid && !closed ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !live}
                  onClick={() => setVoidTarget(l)}
                >
                  {t('voidItem')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <aside className="till-pane till-scroll flex min-h-0 flex-col gap-3 overflow-y-auto rounded-card p-4">
        <Totals
          amounts={{
            netPoisha: order.net_poisha,
            discountPoisha: order.discount_poisha,
            vatPoisha: order.vat_poisha,
            serviceChargePoisha: order.service_charge_poisha,
            totalPoisha: order.total_poisha,
          }}
        />
        {memberOn ? (
          <div className="till-raised rounded-input p-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold">
              <Star aria-hidden className="size-4 text-purple" />
              {member.name ?? t('member')}
            </p>
            <p className="text-secondary">
              {t('memberPoints', { points: formatNumber(member.points ?? 0, locale) })}
              {member.discount_on && member.discount_bps
                ? ` · ${t('memberDiscountOn', { percent: formatBps(member.discount_bps, locale) })}`
                : ''}
            </p>
            {(member.used_here ?? 0) > 0 ? (
              <p className="text-secondary">
                {t('pointsUsedHere', {
                  points: formatNumber(member.used_here ?? 0, locale),
                  amount: formatMoney(member.used_worth_poisha ?? 0, locale, tillPlace().currency),
                })}
              </p>
            ) : null}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {!closed && order.payment_status === 'unpaid' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || !live}
                  onClick={() => setPointsOpen(true)}
                >
                  {t('usePoints')}
                </Button>
              ) : null}
              {cardUrl ? (
                <Button variant="secondary" size="sm" onClick={() => setCardOpen(true)}>
                  <QrIcon aria-hidden className="size-4" />
                  {t('showCard')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {!live ? (
          <p className="flex items-center gap-1.5 text-xs text-secondary">
            <CloudOff aria-hidden className="size-3.5" />
            {t('someActionsNeedInternet')}
          </p>
        ) : null}
        {!closed && hasUnsent ? (
          <Button size="lg" className="w-full" disabled={busy} onClick={onSendKitchen}>
            <ChefHat aria-hidden className="size-5" />
            {t('sendToKitchen')}
          </Button>
        ) : null}
        {anySent && receipt ? (
          <Button variant="secondary" className="w-full" onClick={() => window.print()}>
            <Printer aria-hidden className="size-4" />
            {t('printKot')}
          </Button>
        ) : null}
        {!closed && unpaid ? (
          <>
            <Button size="lg" className="w-full" disabled={busy} onClick={onCheckout}>
              <Wallet aria-hidden className="size-5" />
              {t('checkout')}
            </Button>
            <div className="grid grid-cols-2 gap-2 [&_svg]:shrink-0 [&>button]:px-3 [&>button]:leading-tight [&>button]:whitespace-normal">
              <Button variant="secondary" disabled={busy || !live} onClick={onAddRound}>
                <Plus aria-hidden className="size-4" />
                {t('addItems')}
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !live}
                onClick={() => setDiscountOpen(true)}
              >
                <BadgePercent aria-hidden className="size-4" />
                {t('applyDiscount')}
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !live}
                onClick={() => setCustomerOpen(true)}
              >
                <UserPlus aria-hidden className="size-4" />
                {order.customer_id ? t('customerAdded') : t('addCustomer')}
              </Button>
              {memberCardOn ? (
                <Button
                  variant="secondary"
                  disabled={busy || !live}
                  onClick={() => setScanOpen(true)}
                >
                  <ScanLine aria-hidden className="size-4" />
                  {t('scanCard')}
                </Button>
              ) : null}
              {order.payment_status === 'unpaid' ? (
                <Button
                  variant="danger"
                  disabled={busy || !live}
                  onClick={() => setCancelOpen(true)}
                >
                  <Ban aria-hidden className="size-4" />
                  {t('cancelOrder')}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
        <Button variant="ghost" className="mt-auto shrink-0" onClick={onNewOrder}>
          <Plus aria-hidden className="size-4" />
          {t('newOrder')}
        </Button>
      </aside>

      {voidTarget ? (
        <VoidDialog
          line={voidTarget}
          reasons={voidReasons}
          onClose={() => setVoidTarget(null)}
          onConfirm={(reasonId, approvalId) => {
            onVoid(voidTarget, reasonId, approvalId);
            setVoidTarget(null);
          }}
        />
      ) : null}
      {discountOpen ? (
        <DiscountDialog
          reasons={discountReasons}
          onClose={() => setDiscountOpen(false)}
          onConfirm={(p, r, a) => {
            onDiscount(p, r, a);
            setDiscountOpen(false);
          }}
          onCode={(code) => {
            onDiscountCode(code);
            setDiscountOpen(false);
          }}
        />
      ) : null}
      {cancelOpen ? (
        <CancelOrderDialog
          reasons={voidReasons}
          needsApproval={anySent}
          onClose={() => setCancelOpen(false)}
          onConfirm={(r, a) => {
            onCancel(r, a);
            setCancelOpen(false);
          }}
        />
      ) : null}
      {customerOpen ? (
        <CustomerDialog
          onClose={() => setCustomerOpen(false)}
          onConfirm={(phone, name, consent) => {
            onAttachCustomer(phone, name, consent);
            setCustomerOpen(false);
          }}
        />
      ) : null}
      {scanOpen ? (
        <ScanCardDialog
          onClose={() => setScanOpen(false)}
          onToken={(token) => {
            setScanOpen(false);
            onScanCard(token);
          }}
        />
      ) : null}
      {cardOpen && cardUrl ? (
        <MemberCardDialog
          url={cardUrl}
          name={member?.name ?? null}
          onClose={() => setCardOpen(false)}
        />
      ) : null}
      {pointsOpen && member ? (
        <UsePointsDialog
          member={member}
          onClose={() => setPointsOpen(false)}
          onConfirm={(points) => {
            setPointsOpen(false);
            onUsePoints(points);
          }}
        />
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Checkout: one tender at a time; split across methods until nothing is due.
// -------------------------------------------------------------------------------------------
export function CheckoutScreen({
  order,
  paidPoisha,
  busy,
  onTender,
  onBack,
}: {
  order: OrderRow;
  paidPoisha: number;
  busy: boolean;
  onTender: (method: PaymentMethod, amountPoisha: number) => Promise<string | null>;
  onBack: () => void;
}) {
  const t = useTranslations('pos');
  const { locale } = useTill();
  const money = (p: number) => formatMoney(p, locale, tillPlace().currency);
  const due = Math.max(0, order.total_poisha - paidPoisha);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState(() =>
    formatMoney(due, 'en', tillPlace().currency, { symbol: false }),
  );
  const [error, setError] = useState<string | null>(null);

  // Round-up notes a cashier is likely to be handed, as quick buttons (৳100, ৳500, ৳1000).
  const quick = useMemo(() => {
    const ups = [10_000, 50_000, 100_000].map((step) => Math.ceil(due / step) * step);
    return [...new Set([due, ...ups])].filter((v) => v > 0).slice(0, 4);
  }, [due]);

  const submit = async (poisha: number | null) => {
    if (poisha === null || poisha <= 0) return setError(t('tenderInvalid'));
    setError(null);
    const err = await onTender(method, poisha);
    if (err) setError(err);
  };

  return (
    <div className="till-enter mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-3">
      <Button variant="ghost" className="self-start" onClick={onBack}>
        <ArrowLeft aria-hidden className="size-4" />
        {t('backToOrder')}
      </Button>
      <div className="till-scroll grid min-h-0 flex-1 content-start gap-3 overflow-y-auto md:grid-cols-2">
        <div className="till-raised flex flex-col items-center justify-center rounded-card px-6 py-8 text-center md:min-h-[24rem]">
          <p className="text-sm font-medium text-secondary">{t('amountDue')}</p>
          <p className="mt-3 text-[3.25rem] leading-none font-bold tracking-[-0.04em] tabular-nums">
            {money(due)}
          </p>
          <p className="mt-5 text-sm text-secondary tabular-nums">
            {t('total')} {money(order.total_poisha)} · {t('amountPaid')} {money(paidPoisha)}
          </p>
        </div>
        <div className="till-pane flex flex-col gap-4 rounded-card p-4 sm:p-5">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <MethodPicker value={method} onChange={setMethod} />
          <div>
            <Label htmlFor="amt">{t('amount')}</Label>
            <Input
              id="amt"
              inputMode="decimal"
              className="min-h-14 text-2xl font-semibold tracking-tight tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {method === 'cash' ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {quick.map((q) => (
                <Button
                  key={q}
                  variant="secondary"
                  className="min-h-12 px-3 tabular-nums"
                  disabled={busy}
                  onClick={() => void submit(q)}
                >
                  {money(q)}
                </Button>
              ))}
            </div>
          ) : null}
          <Button
            size="lg"
            className="mt-1 w-full"
            disabled={busy}
            onClick={() => void submit(parseTakaToPoisha(amount))}
          >
            {t('addPayment')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Receipt
// -------------------------------------------------------------------------------------------
export function ReceiptScreen({
  order,
  lines,
  local,
  changePoisha,
  refundablePoisha,
  tableName,
  receipt,
  refundReasons,
  memberToken,
  onNewOrder,
  onRefund,
}: {
  /** The member's card link token: the receipt prints its QR (ADR 0042). */
  memberToken: string | null;
  order: OrderRow;
  lines: OrderLine[];
  local: boolean;
  changePoisha: number;
  refundablePoisha: number;
  tableName: string | null;
  receipt: ReceiptInfo | null;
  refundReasons: ReasonCode[];
  onNewOrder: () => void;
  onRefund: (amountPoisha: number, method: string, reasonId: string, approvalId: string) => void;
}) {
  const t = useTranslations('pos');
  const { locale, online } = useTill();
  const [refundOpen, setRefundOpen] = useState(false);
  const cancelled = order.order_status === 'cancelled';
  return (
    <div className="till-enter mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 text-center">
      {receipt ? (
        <Receipt
          kind="receipt"
          order={order}
          lines={lines}
          info={receipt}
          tableName={tableName}
          locale={locale}
          memberUrl={
            memberToken && typeof window !== 'undefined'
              ? memberCardUrl(window.location.origin, memberToken)
              : null
          }
        />
      ) : null}
      <div className="till-pane w-full rounded-sheet px-6 pt-8 pb-7">
        <span
          aria-hidden
          className={`till-done mx-auto mb-4 flex size-16 items-center justify-center rounded-full ${
            cancelled
              ? 'border border-danger/60 bg-danger/12 text-danger'
              : 'border border-edge-strong bg-surface-hover text-success'
          }`}
        >
          {cancelled ? <XCircle className="size-8" /> : <CheckCircle2 className="size-8" />}
        </span>
        <h2
          className={`text-[1.75rem] leading-tight font-bold tracking-[-0.03em] ${cancelled ? 'text-danger' : 'text-success'}`}
        >
          {cancelled ? t('orderCancelled') : t('orderComplete')}
        </h2>
        <p className="mt-1 text-secondary tabular-nums">
          {order.invoice_no ?? order.provisional_receipt_no}
        </p>
        <div className="mt-3 flex justify-center">
          <OrderBadges order={order} local={local} />
        </div>
        {changePoisha > 0 ? (
          <p className="till-raised mt-5 rounded-card px-4 py-4 text-[2rem] leading-tight font-bold tracking-[-0.03em] tabular-nums">
            {t('change', { amount: formatMoney(changePoisha, locale, tillPlace().currency) })}
          </p>
        ) : null}
        {local ? <p className="mt-3 text-xs text-secondary">{t('provisionalNote')}</p> : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {receipt && !cancelled ? (
          <Button variant="secondary" size="lg" onClick={() => window.print()}>
            <Printer aria-hidden className="size-4" />
            {t('printReceipt')}
          </Button>
        ) : null}
        <Button size="lg" className="min-w-40" onClick={onNewOrder}>
          <Plus aria-hidden className="size-5" />
          {t('newOrder')}
        </Button>
        {refundablePoisha > 0 && !local ? (
          <Button variant="danger" size="lg" disabled={!online} onClick={() => setRefundOpen(true)}>
            {t('refundOrder')}
          </Button>
        ) : null}
      </div>
      {refundOpen ? (
        <RefundDialog
          reasons={refundReasons}
          maxAmountPoisha={refundablePoisha}
          onClose={() => setRefundOpen(false)}
          onConfirm={(amount, method, reasonId, approvalId) => {
            onRefund(amount, method, reasonId, approvalId);
            setRefundOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Order list: today's work on this branch, plus sales still waiting to sync from this tablet.
// -------------------------------------------------------------------------------------------
export interface PendingOrder {
  orderId: string;
  provisionalReceiptNo: string | null;
  placedAt: string;
}

export function OrdersScreen({
  orders,
  pending,
  loading,
  tableName,
  onOpen,
  onRefresh,
  onBack,
}: {
  orders: OrderRow[];
  pending: PendingOrder[];
  loading: boolean;
  tableName: (id: string | null) => string | null;
  onOpen: (order: OrderRow) => void;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const t = useTranslations('pos');
  const { locale, online } = useTill();
  const money = (p: number) => formatMoney(p, locale, tillPlace().currency);
  return (
    <section className="till-pane till-enter flex min-h-0 flex-1 flex-col rounded-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 text-[1.75rem] leading-tight font-bold tracking-[-0.03em]">
          <History aria-hidden className="size-6 text-muted" />
          {t('ordersTitle')}
        </h2>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={!online || loading} onClick={onRefresh}>
            <RefreshCw aria-hidden className="size-4" />
            {t('refresh')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft aria-hidden className="size-4" />
            {t('backToTill')}
          </Button>
        </div>
      </div>
      {!online ? <Alert tone="warning">{t('ordersOffline')}</Alert> : null}
      <ul className="till-scroll mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {pending.map((p) => (
          <li
            key={p.orderId}
            className="till-line flex items-center justify-between gap-2 rounded-[1.125rem] border border-dashed border-warning/45 bg-warning/5 px-4 py-3"
          >
            <div>
              <p className="font-semibold tabular-nums">{p.provisionalReceiptNo}</p>
              <p className="mt-0.5 text-xs text-secondary tabular-nums">
                {formatDateTime(new Date(p.placedAt), locale, tillPlace().tz)}
              </p>
            </div>
            <StatusBadge tone="warning">{t('waitingSync')}</StatusBadge>
          </li>
        ))}
        {orders.map((o) => (
          <li key={o.id} className="till-line">
            <button
              type="button"
              onClick={() => onOpen(o)}
              className="till-tile flex min-h-16 w-full flex-wrap items-center justify-between gap-2 rounded-[1.125rem] px-4 py-3 text-start"
            >
              <div>
                <p className="text-[0.9375rem] font-semibold">
                  {orderLabel(o, t)}
                  {tableName(o.table_id) ? ` · ${tableName(o.table_id)}` : ''}
                </p>
                <p className="mt-0.5 text-xs text-secondary tabular-nums">
                  {formatDateTime(new Date(o.placed_at), locale, tillPlace().tz)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <OrderBadges order={o} local={false} />
                <span className="w-28 text-end text-base font-bold tracking-tight tabular-nums">
                  {money(o.total_poisha)}
                </span>
              </div>
            </button>
          </li>
        ))}
        {!loading && orders.length === 0 && pending.length === 0 ? (
          <li className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <span
              aria-hidden
              className="till-raised flex size-14 items-center justify-center rounded-full"
            >
              <History className="size-6 text-muted" />
            </span>
            <span className="text-sm text-secondary">{t('noOrders')}</span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

// -------------------------------------------------------------------------------------------
// Sync status: always visible in the till header.
// -------------------------------------------------------------------------------------------
export function SyncStatus({
  entries,
  syncing,
  onSyncNow,
  onDiscard,
}: {
  entries: OutboxEntry[];
  syncing: boolean;
  onSyncNow: () => void;
  onDiscard: (entryId: string) => void;
}) {
  const t = useTranslations('pos');
  const { online, locale } = useTill();
  const [open, setOpen] = useState(false);
  const failed = entries.filter((e) => e.status === 'failed').length;
  const waiting = entries.length - failed;

  const tone: BadgeTone = failed > 0 ? 'danger' : !online || waiting > 0 ? 'warning' : 'success';
  const label = syncing
    ? t('syncing')
    : failed > 0
      ? t('failedCount', { count: failed })
      : waiting > 0
        ? t('waitingCount', { count: waiting })
        : online
          ? t('allSynced')
          : t('offline');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full"
        aria-label={`${online ? t('online') : t('offline')} · ${label}`}
      >
        <Badge
          tone={tone}
          icon={online ? <Wifi /> : <CloudOff />}
          className="min-h-9 px-3.5 text-[0.8125rem]"
        >
          <span key={label} className="till-swap">
            {label}
          </span>
        </Badge>
      </button>
      {open ? (
        <DialogShell title={t('syncTitle')} onClose={() => setOpen(false)} wide>
          <p className="text-sm text-secondary">{t('syncBody')}</p>
          {entries.length === 0 ? (
            <p className="text-sm">{t('noQueue')}</p>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => (
                <li key={e.id} className="till-soft till-line rounded-input p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {t(`op.${e.op.kind}`)}
                      {e.op.kind === 'submit_order' && e.op.args.provisionalReceiptNo
                        ? ` · ${e.op.args.provisionalReceiptNo}`
                        : ''}
                    </span>
                    <StatusBadge tone={e.status === 'failed' ? 'danger' : 'warning'}>
                      {e.status === 'failed' ? t('syncFailed') : t('waitingSync')}
                    </StatusBadge>
                  </div>
                  <p className="text-xs text-muted">
                    {formatDateTime(new Date(e.createdAt), locale, tillPlace().tz)}
                  </p>
                  {e.error ? <p className="mt-1 text-xs text-danger">{e.error}</p> : null}
                  {e.status === 'failed' ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-secondary">{t('discardWarning')}</p>
                      <Button variant="danger" size="sm" onClick={() => onDiscard(e.id)}>
                        {t('discard')}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Button className="w-full" disabled={!online || syncing} onClick={onSyncNow}>
            <RefreshCw aria-hidden className="size-4" />
            {t('syncNow')}
          </Button>
        </DialogShell>
      ) : null}
    </>
  );
}
