'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Alert, Input, Label, Select, Textarea } from '@/components/ui/form';
import { formatBDT } from '@/lib/i18n/format';
import { parseTakaToPoisha } from '@/lib/money';
import {
  approveAction,
  type ApprovalAction,
  type ApprovalResult,
  type MenuItem,
  type OrderLine,
  type ReasonCode,
} from './client';
import { isNetworkError } from './outbox';
import { useTill } from './till-context';

export function DialogShell({
  title,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('pos');
  // Rendered on <body>: a dialog opened from inside the glass top bar (backdrop-filter) would otherwise
  // be positioned relative to that bar, not the screen, and show up as a clipped strip.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-30 flex items-end justify-center bg-foreground/25 p-3 backdrop-blur-[2px] sm:items-center"
    >
      <div
        className={`glass-strong max-h-[90dvh] w-full space-y-3 overflow-y-auto rounded-sheet p-5 ${wide ? 'max-w-lg' : 'max-w-sm'}`}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold">{title}</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('close')}>
            <X aria-hidden className="size-5" />
          </Button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const reasonLabel = (r: ReasonCode, locale: string) =>
  locale === 'bn' && r.label_bn ? r.label_bn : r.label;

function ReasonSelect({
  id,
  label,
  reasons,
  value,
  onChange,
}: {
  id: string;
  label: string;
  reasons: ReasonCode[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { locale } = useTill();
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {reasons.map((r) => (
          <option key={r.id} value={r.id}>
            {reasonLabel(r, locale)}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Manager PIN → a single-use approval token (ADR 0014). Shared by every sensitive action. */
export function ManagerApprovalStep({
  action,
  onApproved,
}: {
  action: ApprovalAction;
  onApproved: (approvalId: string) => void;
}) {
  const t = useTranslations('pos');
  const te = useTranslations('errors');
  const { sb, device, managers } = useTill();
  const [managerId, setManagerId] = useState(managers[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    let result: ApprovalResult;
    try {
      result = await approveAction(sb, device.deviceId, managerId, pin, action);
    } catch (e) {
      setBusy(false);
      setError(isNetworkError(e) ? t('needsInternet') : te('generic'));
      return;
    }
    setBusy(false);
    if (!result.ok) {
      setPin('');
      if (result.reason === 'locked') setError(t('pinLocked'));
      else if (result.reason === 'not_a_manager') setError(t('notAManager'));
      else setError(t('pinWrong', { attempts: result.attempts_left ?? 0 }));
      return;
    }
    onApproved(result.approval_id);
  };

  if (managers.length === 0) return <Alert tone="warning">{t('noManagers')}</Alert>;
  return (
    <div className="space-y-3">
      <Alert tone="warning">{t('managerPinRequired')}</Alert>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div>
        <Label htmlFor="mgr">{t('manager')}</Label>
        <Select id="mgr" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="mgr-pin">{t('managerPin')}</Label>
        <Input
          id="mgr-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      <Button className="w-full" disabled={busy || pin.length < 4} onClick={() => void confirm()}>
        {t('approve')}
      </Button>
    </div>
  );
}

export function VoidDialog({
  line,
  reasons,
  onClose,
  onConfirm,
}: {
  line: OrderLine;
  reasons: ReasonCode[];
  onClose: () => void;
  onConfirm: (reasonId: string, approvalId?: string) => void;
}) {
  const t = useTranslations('pos');
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? '');
  const [approving, setApproving] = useState(false);
  const needsMgr = line.kot_sent_at !== null;
  return (
    <DialogShell title={t('voidItem')} onClose={onClose}>
      <p className="text-sm text-secondary">
        {line.quantity} × {line.name_snapshot}
      </p>
      {approving ? (
        <ManagerApprovalStep
          action="void_after_kot"
          onApproved={(approvalId) => onConfirm(reasonId, approvalId)}
        />
      ) : (
        <>
          <ReasonSelect
            id="vr"
            label={t('voidReason')}
            reasons={reasons}
            value={reasonId}
            onChange={setReasonId}
          />
          <Button
            variant="danger"
            className="w-full"
            disabled={!reasonId}
            onClick={() => (needsMgr ? setApproving(true) : onConfirm(reasonId))}
          >
            {t('voidItem')}
          </Button>
        </>
      )}
    </DialogShell>
  );
}

export function DiscountDialog({
  reasons,
  onClose,
  onConfirm,
}: {
  reasons: ReasonCode[];
  onClose: () => void;
  onConfirm: (percentBps: number, reasonId: string, approvalId?: string) => void;
}) {
  const t = useTranslations('pos');
  const [percent, setPercent] = useState('10');
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? '');
  const [approving, setApproving] = useState(false);
  const reason = reasons.find((r) => r.id === reasonId);
  const bps = Math.round(Number(percent) * 100);
  const valid = Number.isFinite(bps) && bps > 0 && bps <= 10_000 && !!reasonId;
  return (
    <DialogShell title={t('applyDiscount')} onClose={onClose}>
      {approving ? (
        <ManagerApprovalStep
          action="discount"
          onApproved={(approvalId) => onConfirm(bps, reasonId, approvalId)}
        />
      ) : (
        <>
          <div>
            <Label htmlFor="pct">{t('discountPercent')}</Label>
            <Input
              id="pct"
              inputMode="decimal"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </div>
          <ReasonSelect
            id="dr"
            label={t('reason')}
            reasons={reasons}
            value={reasonId}
            onChange={setReasonId}
          />
          <Button
            className="w-full"
            disabled={!valid}
            onClick={() =>
              reason?.requires_manager_approval ? setApproving(true) : onConfirm(bps, reasonId)
            }
          >
            {t('applyDiscount')}
          </Button>
        </>
      )}
    </DialogShell>
  );
}

export function CancelOrderDialog({
  reasons,
  needsApproval,
  onClose,
  onConfirm,
}: {
  reasons: ReasonCode[];
  needsApproval: boolean;
  onClose: () => void;
  onConfirm: (reasonId: string, approvalId?: string) => void;
}) {
  const t = useTranslations('pos');
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? '');
  const [approving, setApproving] = useState(false);
  return (
    <DialogShell title={t('cancelOrder')} onClose={onClose}>
      {approving ? (
        <ManagerApprovalStep
          action="cancel_order"
          onApproved={(approvalId) => onConfirm(reasonId, approvalId)}
        />
      ) : (
        <>
          <ReasonSelect
            id="cr"
            label={t('reason')}
            reasons={reasons}
            value={reasonId}
            onChange={setReasonId}
          />
          <Button
            variant="danger"
            className="w-full"
            disabled={!reasonId}
            onClick={() => (needsApproval ? setApproving(true) : onConfirm(reasonId))}
          >
            {t('cancelOrder')}
          </Button>
        </>
      )}
    </DialogShell>
  );
}

export function CustomerDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (phone: string, name: string, consent: boolean) => void;
}) {
  const t = useTranslations('pos');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  return (
    <DialogShell title={t('addCustomer')} onClose={onClose}>
      <div>
        <Label htmlFor="cphone">{t('customerPhone')}</Label>
        <Input
          id="cphone"
          inputMode="tel"
          autoComplete="off"
          placeholder={t('phonePlaceholder')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="cname">{t('customerName')}</Label>
        <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-purple"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        {t('marketingConsent')}
      </label>
      <Button
        className="w-full"
        disabled={phone.trim() === ''}
        onClick={() => onConfirm(phone, name, consent)}
      >
        {t('save')}
      </Button>
    </DialogShell>
  );
}

export function RefundDialog({
  reasons,
  maxAmountPoisha,
  onClose,
  onConfirm,
}: {
  reasons: ReasonCode[];
  maxAmountPoisha: number;
  onClose: () => void;
  onConfirm: (amountPoisha: number, method: string, reasonId: string, approvalId: string) => void;
}) {
  const t = useTranslations('pos');
  const { locale } = useTill();
  const [amount, setAmount] = useState(() => formatBDT(maxAmountPoisha, 'en', { symbol: false }));
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('cash');
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? '');
  const [approving, setApproving] = useState(false);
  const poisha = parseTakaToPoisha(amount);
  const valid = poisha !== null && poisha > 0 && poisha <= maxAmountPoisha && !!reasonId;
  return (
    <DialogShell title={t('refundOrder')} onClose={onClose}>
      {approving && poisha !== null ? (
        <ManagerApprovalStep
          action="refund"
          onApproved={(approvalId) => onConfirm(poisha, method, reasonId, approvalId)}
        />
      ) : (
        <>
          <p className="text-sm text-secondary">
            {t('maxRefund', { amount: formatBDT(maxAmountPoisha, locale) })}
          </p>
          <div>
            <Label htmlFor="ramt">{t('amount')}</Label>
            <Input
              id="ramt"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <MethodPicker value={method} onChange={setMethod} />
          <ReasonSelect
            id="rr"
            label={t('reason')}
            reasons={reasons}
            value={reasonId}
            onChange={setReasonId}
          />
          <Button
            variant="danger"
            className="w-full"
            disabled={!valid}
            onClick={() => setApproving(true)}
          >
            {t('refundOrder')}
          </Button>
        </>
      )}
    </DialogShell>
  );
}

export const PAYMENT_METHODS = [
  'cash',
  'card',
  'bkash',
  'nagad',
  'rocket',
  'upay',
  'bank',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function MethodPicker({
  value,
  onChange,
}: {
  value: PaymentMethod;
  onChange: (m: PaymentMethod) => void;
}) {
  const t = useTranslations('pos');
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-secondary">{t('paymentMethod')}</legend>
      <div className="grid grid-cols-4 gap-1.5">
        {PAYMENT_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={value === m}
            onClick={() => onChange(m)}
            className={`min-h-11 rounded-full border px-2 text-sm font-medium transition ${
              value === m
                ? 'border-purple bg-surface-elevated text-foreground'
                : 'glass-tile text-secondary'
            }`}
          >
            {t(`methods.${m}`)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// -------------------------------------------------------------------------------------------
// Item picker: size/variant, add-ons within each group's min/max, a kitchen note, quantity.
// The server re-checks all of it (insert_order_lines); this only stops obvious mistakes early.
// -------------------------------------------------------------------------------------------
export interface PickedItem {
  variantId: string | null;
  variantName: string | null;
  modifierIds: string[];
  modifiersLabel: string;
  /** Price per unit, printed basis: the item (or variant) price plus the chosen add-ons. */
  unitPricePoisha: number;
  note: string;
  quantity: number;
}

/** Mirrors private.resolve_item_price: a variant's own branch price, else base price + delta. */
export function itemUnitPrice(item: MenuItem, variantId: string | null): number {
  const variant = variantId ? item.variants.find((v) => v.id === variantId) : undefined;
  if (variant)
    return variant.branch_price_poisha ?? item.base_price_poisha + variant.price_delta_poisha;
  return item.branch_price_poisha ?? item.base_price_poisha;
}

export function ItemPicker({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (picked: PickedItem) => void;
}) {
  const t = useTranslations('pos');
  const { locale } = useTill();
  const money = (p: number) => formatBDT(p, locale);
  const label = (x: { name: string; name_bn: string | null }) =>
    locale === 'bn' && x.name_bn ? x.name_bn : x.name;
  const variants = item.variants.filter((v) => v.is_available);
  const [variantId, setVariantId] = useState<string | null>(variants[0]?.id ?? null);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState('');
  const [quantity, setQuantity] = useState(1);

  const toggle = (groupId: string, modId: string, max: number) =>
    setChosen((prev) => {
      const current = prev[groupId] ?? [];
      if (current.includes(modId))
        return { ...prev, [groupId]: current.filter((m) => m !== modId) };
      // A single-choice group behaves like radio buttons.
      if (max === 1) return { ...prev, [groupId]: [modId] };
      if (current.length >= max) return prev;
      return { ...prev, [groupId]: [...current, modId] };
    });

  const groupsOk = item.modifier_groups.every((g) => {
    const n = (chosen[g.id] ?? []).length;
    return n >= g.min_select && n <= g.max_select;
  });
  const allMods = item.modifier_groups.flatMap((g) =>
    g.modifiers.filter((m) => (chosen[g.id] ?? []).includes(m.id)),
  );
  const modsPrice = allMods.reduce((s, m) => s + m.price_poisha, 0);
  const unit = itemUnitPrice(item, variantId) + modsPrice;
  const variant = item.variants.find((v) => v.id === variantId) ?? null;

  return (
    <DialogShell title={label(item)} onClose={onClose} wide>
      {variants.length > 0 ? (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-secondary">{t('size')}</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={variantId === v.id}
                onClick={() => setVariantId(v.id)}
                className={`min-h-11 rounded-full border px-4 text-sm font-medium transition ${
                  variantId === v.id
                    ? 'border-purple bg-surface-elevated text-foreground'
                    : 'glass-tile text-secondary'
                }`}
              >
                {label(v)} · {money(itemUnitPrice(item, v.id))}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {item.modifier_groups.map((g) => {
        const n = (chosen[g.id] ?? []).length;
        const ok = n >= g.min_select && n <= g.max_select;
        return (
          <fieldset key={g.id}>
            <legend className="mb-1.5 flex w-full items-center justify-between gap-2 text-sm font-medium text-secondary">
              <span>{label(g)}</span>
              <span className={ok ? 'text-muted' : 'text-warning'}>
                {g.min_select > 0
                  ? t('pickRange', { min: g.min_select, max: g.max_select })
                  : t('pickUpTo', { max: g.max_select })}
              </span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {g.modifiers.map((m) => {
                const on = (chosen[g.id] ?? []).includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(g.id, m.id, g.max_select)}
                    className={`min-h-11 rounded-full border px-4 text-sm transition ${
                      on
                        ? 'border-purple bg-surface-elevated text-foreground'
                        : 'glass-tile text-secondary'
                    }`}
                  >
                    {label(m)}
                    {m.price_poisha > 0 ? ` +${money(m.price_poisha)}` : ''}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <div>
        <Label htmlFor="item-note">{t('itemNote')}</Label>
        <Textarea
          id="item-note"
          rows={2}
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="icon"
            aria-label={t('less')}
            disabled={quantity <= 1}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          >
            −
          </Button>
          <span className="w-8 text-center text-lg font-semibold tabular-nums">{quantity}</span>
          <Button
            variant="secondary"
            size="icon"
            aria-label={t('more')}
            disabled={quantity >= 99}
            onClick={() => setQuantity((q) => Math.min(99, q + 1))}
          >
            +
          </Button>
        </div>
        <Button
          size="lg"
          disabled={!groupsOk || (variants.length > 0 && !variantId)}
          onClick={() =>
            onAdd({
              variantId,
              variantName: variant ? label(variant) : null,
              modifierIds: allMods.map((m) => m.id),
              modifiersLabel: allMods.map(label).join(', '),
              unitPricePoisha: unit,
              note: note.trim(),
              quantity,
            })
          }
        >
          {t('addToCart')} · {money(unit)}
        </Button>
      </div>
    </DialogShell>
  );
}
