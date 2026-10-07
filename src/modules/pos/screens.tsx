'use client';

import {
  ArrowLeft,
  CloudOff,
  History,
  Image as ImageIcon,
  Minus,
  Plus,
  Printer,
  RefreshCw,
  Type,
  UserPlus,
  Wifi,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { StatusBadge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Input, Label, Select } from '@/components/ui/form';
import { Segmented } from '@/components/ui/segmented';
import { formatBDT, formatDhakaDateTime } from '@/lib/i18n/format';
import { parseTakaToPoisha, type LineAmounts } from '@/lib/money';
import type {
  Channel,
  DiningTable,
  MenuCategory,
  MenuItem,
  OrderLine,
  OrderRow,
  ReasonCode,
  ReceiptInfo,
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
  const { locale } = useTill();
  const money = (p: number) => formatBDT(p, locale);
  return (
    <dl className="space-y-1 text-sm">
      <div className="flex justify-between">
        <dt className="text-secondary">{t('subtotal')}</dt>
        <dd className="tabular-nums">{money(amounts.netPoisha)}</dd>
      </div>
      {amounts.discountPoisha ? (
        <div className="flex justify-between">
          <dt className="text-secondary">{t('discount')}</dt>
          <dd className="tabular-nums">−{money(amounts.discountPoisha)}</dd>
        </div>
      ) : null}
      <div className="flex justify-between">
        <dt className="text-secondary">{t('vat')}</dt>
        <dd className="tabular-nums">{money(amounts.vatPoisha)}</dd>
      </div>
      {amounts.serviceChargePoisha > 0 ? (
        <div className="flex justify-between">
          <dt className="text-secondary">{t('serviceCharge')}</dt>
          <dd className="tabular-nums">{money(amounts.serviceChargePoisha)}</dd>
        </div>
      ) : null}
      <div className="flex justify-between border-t border-line pt-1.5 text-base font-bold">
        <dt>{t('total')}</dt>
        <dd className="tabular-nums">{money(amounts.totalPoisha)}</dd>
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
  const money = (p: number) => formatBDT(p, locale);
  const [category, setCategory] = useState<string>('all');
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [view, setView] = useState<TillView>(() => getTillView());
  const chooseView = (next: TillView) => {
    setView(next);
    setTillView(next);
  };
  const shown = category === 'all' ? menu : menu.filter((c) => c.id === category);

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
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_340px]">
      <section className="glass flex min-h-0 flex-col rounded-card p-3">
        {mode.kind === 'round' ? (
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="font-semibold">{t('addingToOrder', { order: mode.orderLabel })}</p>
            <Button variant="ghost" size="sm" onClick={onCancelRound}>
              <ArrowLeft aria-hidden className="size-4" />
              {t('backToOrder')}
            </Button>
          </div>
        ) : (
          <div className="mb-3 flex flex-wrap items-end gap-2">
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
        )}

        <CashierHelper menu={menu} onAdd={onAdd} />

        <div className="mb-3 flex items-start gap-2">
          <nav
            aria-label={t('categories')}
            className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1"
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
                className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition ${
                  category === c.id
                    ? 'border-purple bg-surface-elevated text-foreground'
                    : 'glass-tile text-secondary'
                }`}
              >
                {c.label}
              </button>
            ))}
          </nav>
          <Segmented
            label={t('viewLabel')}
            value={view}
            onChange={chooseView}
            className="shrink-0"
            options={[
              {
                value: 'text',
                label: t('viewText'),
                icon: <Type aria-hidden className="size-4" />,
              },
              {
                value: 'photo',
                label: t('viewPhoto'),
                icon: <ImageIcon aria-hidden className="size-4" />,
              },
            ]}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pe-1">
          {shown.map((cat) => {
            const items = cat.items.filter((i) => i.is_available);
            if (items.length === 0) return null;
            return (
              <div key={cat.id} className="mb-4">
                <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                  {itemLabel(cat, locale)}
                </h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {items.map((item) => (
                    <ItemTile
                      key={item.id}
                      item={item}
                      label={itemLabel(item, locale)}
                      view={view}
                      onTap={() => tap(item)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <aside className="glass flex min-h-0 flex-col rounded-card p-3">
        <h2 className="mb-2 font-semibold">{t('cart')}</h2>
        <div className="min-h-24 flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="text-sm text-secondary">{t('cartEmpty')}</p>
          ) : (
            <ul className="space-y-2">
              {cart.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{c.name}</p>
                    {c.modifiersLabel ? (
                      <p className="text-xs text-secondary">{c.modifiersLabel}</p>
                    ) : null}
                    {c.note ? <p className="text-xs text-muted italic">{c.note}</p> : null}
                    <p className="text-xs text-muted tabular-nums">{money(c.unitPricePoisha)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="subtle"
                      size="icon"
                      className="size-9"
                      aria-label={t('less')}
                      onClick={() => changeQty(c.key, -1)}
                    >
                      <Minus aria-hidden className="size-4" />
                    </Button>
                    <span className="w-6 text-center font-semibold tabular-nums">{c.quantity}</span>
                    <Button
                      variant="subtle"
                      size="icon"
                      className="size-9"
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
          <div className="mt-2 border-t border-line pt-2">
            <Totals amounts={preview} />
          </div>
        ) : null}
        <Button size="lg" className="mt-3" disabled={busy || cart.length === 0} onClick={onSubmit}>
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
  onCancel,
  onAttachCustomer,
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
  onSendKitchen: () => void;
  onVoid: (line: OrderLine, reasonId: string, approvalId?: string) => void;
  onDiscount: (percentBps: number, reasonId: string, approvalId?: string) => void;
  onCancel: (reasonId: string, approvalId?: string) => void;
  onAttachCustomer: (phone: string, name: string, consent: boolean) => void;
  onAddRound: () => void;
  onCheckout: () => void;
  onNewOrder: () => void;
}) {
  const t = useTranslations('pos');
  const { locale, online } = useTill();
  const money = (p: number) => formatBDT(p, locale);
  const [voidTarget, setVoidTarget] = useState<OrderLine | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);

  const closed = order.order_status === 'cancelled' || order.order_status === 'completed';
  const unpaid = order.payment_status === 'unpaid' || order.payment_status === 'partially_paid';
  // Voids, discounts, cancels and customers need the server now (ADR 0014); so does a new round.
  const live = online && !local;
  const hasUnsent = lines.some((l) => l.status === 'active' && l.kot_sent_at === null);
  const anySent = lines.some((l) => l.status === 'active' && l.kot_sent_at !== null);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_300px]">
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
      <section className="glass flex min-h-0 flex-col rounded-card p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold">{orderLabel(order, t)}</h2>
            <p className="text-sm text-secondary">
              {tableName ? `${tableName} · ` : ''}
              {formatDhakaDateTime(new Date(order.placed_at), locale)}
            </p>
          </div>
          <OrderBadges order={order} local={local} />
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
              <div className={l.status === 'voided' ? 'flex-1 text-muted line-through' : 'flex-1'}>
                <p className="font-medium">
                  {l.quantity} × {l.name_snapshot}
                </p>
                {l.notes ? <p className="text-xs text-muted italic">{l.notes}</p> : null}
                {l.status === 'active' && l.kot_sent_at === null ? (
                  <p className="text-xs text-warning">{t('notSentYet')}</p>
                ) : null}
              </div>
              <span className="w-24 text-end tabular-nums">{money(l.total_poisha)}</span>
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

      <aside className="glass flex flex-col gap-3 rounded-card p-4">
        <Totals
          amounts={{
            netPoisha: order.net_poisha,
            discountPoisha: order.discount_poisha,
            vatPoisha: order.vat_poisha,
            serviceChargePoisha: order.service_charge_poisha,
            totalPoisha: order.total_poisha,
          }}
        />
        {!live ? (
          <p className="flex items-center gap-1.5 text-xs text-secondary">
            <CloudOff aria-hidden className="size-3.5" />
            {t('someActionsNeedInternet')}
          </p>
        ) : null}
        {!closed && hasUnsent ? (
          <Button size="lg" disabled={busy} onClick={onSendKitchen}>
            {t('sendToKitchen')}
          </Button>
        ) : null}
        {anySent && receipt ? (
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer aria-hidden className="size-4" />
            {t('printKot')}
          </Button>
        ) : null}
        {!closed && unpaid ? (
          <>
            <Button size="lg" disabled={busy} onClick={onCheckout}>
              {t('checkout')}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={busy || !live} onClick={onAddRound}>
                <Plus aria-hidden className="size-4" />
                {t('addItems')}
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !live}
                onClick={() => setDiscountOpen(true)}
              >
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
              {order.payment_status === 'unpaid' ? (
                <Button
                  variant="danger"
                  disabled={busy || !live}
                  onClick={() => setCancelOpen(true)}
                >
                  {t('cancelOrder')}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
        <Button variant="ghost" className="mt-auto" onClick={onNewOrder}>
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
  const money = (p: number) => formatBDT(p, locale);
  const due = Math.max(0, order.total_poisha - paidPoisha);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState(() => formatBDT(due, 'en', { symbol: false }));
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
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4">
      <Button variant="ghost" className="self-start" onClick={onBack}>
        <ArrowLeft aria-hidden className="size-4" />
        {t('backToOrder')}
      </Button>
      <div className="glass rounded-card p-5 text-center">
        <p className="text-sm text-secondary">{t('amountDue')}</p>
        <p className="text-4xl font-bold tabular-nums">{money(due)}</p>
        <p className="mt-1 text-sm text-secondary tabular-nums">
          {t('total')} {money(order.total_poisha)} · {t('amountPaid')} {money(paidPoisha)}
        </p>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <MethodPicker value={method} onChange={setMethod} />
      <div>
        <Label htmlFor="amt">{t('amount')}</Label>
        <Input
          id="amt"
          inputMode="decimal"
          className="text-lg"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      {method === 'cash' ? (
        <div className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <Button
              key={q}
              variant="subtle"
              size="sm"
              disabled={busy}
              onClick={() => void submit(q)}
            >
              {money(q)}
            </Button>
          ))}
        </div>
      ) : null}
      <Button size="lg" disabled={busy} onClick={() => void submit(parseTakaToPoisha(amount))}>
        {t('addPayment')}
      </Button>
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
  onNewOrder,
  onRefund,
}: {
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
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 text-center">
      {receipt ? (
        <Receipt
          kind="receipt"
          order={order}
          lines={lines}
          info={receipt}
          tableName={tableName}
          locale={locale}
        />
      ) : null}
      <div className="glass w-full rounded-card p-6">
        <h2 className={`text-2xl font-bold ${cancelled ? 'text-danger' : 'text-success'}`}>
          {cancelled ? t('orderCancelled') : t('orderComplete')}
        </h2>
        <p className="mt-1 text-secondary">{order.invoice_no ?? order.provisional_receipt_no}</p>
        <div className="mt-3 flex justify-center">
          <OrderBadges order={order} local={local} />
        </div>
        {changePoisha > 0 ? (
          <p className="mt-4 text-3xl font-bold tabular-nums">
            {t('change', { amount: formatBDT(changePoisha, locale) })}
          </p>
        ) : null}
        {local ? <p className="mt-3 text-xs text-secondary">{t('provisionalNote')}</p> : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {receipt && !cancelled ? (
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer aria-hidden className="size-4" />
            {t('printReceipt')}
          </Button>
        ) : null}
        <Button size="lg" onClick={onNewOrder}>
          {t('newOrder')}
        </Button>
        {refundablePoisha > 0 && !local ? (
          <Button variant="danger" disabled={!online} onClick={() => setRefundOpen(true)}>
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
  const money = (p: number) => formatBDT(p, locale);
  return (
    <section className="glass flex min-h-0 flex-1 flex-col rounded-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <History aria-hidden className="size-5" />
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
      <ul className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {pending.map((p) => (
          <li
            key={p.orderId}
            className="glass-tile flex items-center justify-between gap-2 rounded-input p-3"
          >
            <div>
              <p className="font-semibold">{p.provisionalReceiptNo}</p>
              <p className="text-xs text-secondary">
                {formatDhakaDateTime(new Date(p.placedAt), locale)}
              </p>
            </div>
            <StatusBadge tone="warning">{t('waitingSync')}</StatusBadge>
          </li>
        ))}
        {orders.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onOpen(o)}
              className="glass-tile flex w-full flex-wrap items-center justify-between gap-2 rounded-input p-3 text-start transition hover:border-purple"
            >
              <div>
                <p className="font-semibold">
                  {orderLabel(o, t)}
                  {tableName(o.table_id) ? ` · ${tableName(o.table_id)}` : ''}
                </p>
                <p className="text-xs text-secondary">
                  {formatDhakaDateTime(new Date(o.placed_at), locale)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <OrderBadges order={o} local={false} />
                <span className="w-24 text-end font-semibold tabular-nums">
                  {money(o.total_poisha)}
                </span>
              </div>
            </button>
          </li>
        ))}
        {!loading && orders.length === 0 && pending.length === 0 ? (
          <li className="text-sm text-secondary">{t('noOrders')}</li>
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
        <StatusBadge tone={tone as 'success'} className="min-h-9 px-3 text-sm">
          <span className="inline-flex items-center gap-1.5">
            {online ? (
              <Wifi aria-hidden className="size-3.5" />
            ) : (
              <CloudOff aria-hidden className="size-3.5" />
            )}
            {label}
          </span>
        </StatusBadge>
      </button>
      {open ? (
        <DialogShell title={t('syncTitle')} onClose={() => setOpen(false)} wide>
          <p className="text-sm text-secondary">{t('syncBody')}</p>
          {entries.length === 0 ? (
            <p className="text-sm">{t('noQueue')}</p>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => (
                <li key={e.id} className="glass-tile rounded-input p-3 text-sm">
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
                    {formatDhakaDateTime(new Date(e.createdAt), locale)}
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
