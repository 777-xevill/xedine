'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Input, Label, Select } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { formatBDT, type Locale } from '@/lib/i18n/format';
import { computeLine, parseTakaToPoisha, sumLines, type VatConfig } from '@/lib/money';
import {
  applyOrderDiscount,
  approveAction,
  attachCustomer,
  cancelOrder,
  closeShift,
  createClient,
  endStaffSession,
  fetchActiveStaff,
  fetchBranches,
  fetchChannels,
  fetchMenu,
  fetchOpenShift,
  fetchOrderItems,
  fetchReasonCodes,
  fetchTables,
  needsApproval,
  openShift,
  recordPayment,
  refundOrder,
  registerAndClaimDevice,
  sendToKitchen,
  startStaffSession,
  submitOrder,
  voidOrderItem,
  type ApprovalAction,
  type ApprovalResult,
  type Branch,
  type Channel,
  type DiningTable,
  type MenuCategory,
  type OrderLine,
  type OrderRow,
  type ReasonCode,
  type ShiftRow,
  type StaffMember,
} from './client';
import {
  clearStaffSession,
  getDevice,
  getStaffSession,
  setDevice,
  setStaffSession,
  type DeviceState,
} from './device-storage';
import { Receipt } from './Receipt';

interface CartItem {
  key: string;
  menuItemId: string;
  name: string;
  unitPricePoisha: number;
  modifierIds: string[];
  modifiersLabel: string;
  modifiersPricePoisha: number;
  quantity: number;
  note?: string;
}

// crypto.randomUUID() is the standard Web Crypto API, available in every browser this app targets
// (this module is client-only per ADR 0013 / next/dynamic ssr:false) — no Node builtin needed here.
const uid = () => crypto.randomUUID();

export function PosApp() {
  const locale = useLocale() as Locale;
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const sb = useMemo(() => createClient(), []);

  // This tree only ever mounts client-side (page.tsx loads it via next/dynamic, ssr: false), so
  // reading localStorage in the initializer is safe: there is no server render to mismatch against.
  const [device, setDeviceState] = useState<DeviceState | null>(() => getDevice());
  const [staffSession, setStaffSessionState] = useState<{
    sessionId: string;
    staffId: string;
    staffName: string;
  } | null>(() => getStaffSession());
  const [error, setError] = useState<string | null>(null);

  if (!device)
    return (
      <PairingScreen
        sb={sb}
        onPaired={(d) => {
          setDevice(d);
          setDeviceState(d);
        }}
      />
    );
  if (!staffSession) {
    return (
      <StaffGate
        sb={sb}
        device={device}
        onSignedIn={(s) => {
          setStaffSession(s);
          setStaffSessionState(s);
        }}
      />
    );
  }
  return (
    <Till
      sb={sb}
      device={device}
      staffSession={staffSession}
      locale={locale}
      onSwitchStaff={() => {
        void endStaffSession(sb, staffSession.sessionId).catch(() => undefined);
        clearStaffSession();
        setStaffSessionState(null);
      }}
      error={error}
      setError={setError}
      t={t}
      tc={tc}
      te={te}
    />
  );
}

// -------------------------------------------------------------------------------------------
// Pairing: the manager/owner currently signed into this browser (ADR 0013) registers the device.
// -------------------------------------------------------------------------------------------
export function PairingScreen({
  sb,
  onPaired,
}: {
  sb: ReturnType<typeof createClient>;
  onPaired: (d: DeviceState) => void;
}) {
  const t = useTranslations('pos');
  const tn = useTranslations('nav');
  const te = useTranslations('errors');
  const [orgs, setOrgs] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [orgId, setOrgId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [name, setName] = useState('Counter 1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void sb
      .from('organizations')
      .select('id, name, slug')
      .order('name')
      .then(({ data }) => {
        setOrgs(data ?? []);
        if (data?.[0]) setOrgId(data[0].id);
      });
  }, [sb]);
  useEffect(() => {
    if (!orgId) return;
    void fetchBranches(sb, orgId).then((b) => {
      setBranches(b);
      setBranchId(b[0]?.id ?? '');
    });
  }, [sb, orgId]);

  const submit = async () => {
    setError(null);
    if (!orgId || !branchId || !name.trim()) return;
    setBusy(true);
    try {
      const org = orgs.find((o) => o.id === orgId)!;
      const branch = branches.find((b) => b.id === branchId)!;
      const deviceId = await registerAndClaimDevice(sb, orgId, branchId, name.trim());
      onPaired({ deviceId, orgId, orgSlug: org.slug, branchId, branchName: branch.name });
    } catch {
      setError(te('generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">{t('pairTitle')}</h1>
      <p className="text-secondary">{t('pairSubtitle')}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div>
        <Label htmlFor="org">{tn('organization')}</Label>
        <Select id="org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="branch">{t('selectBranch')}</Label>
        <Select id="branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="deviceName">{t('deviceName')}</Label>
        <Input id="deviceName" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Button onClick={() => void submit()} disabled={busy || !orgId || !branchId}>
        {busy ? t('pairing') : t('pairButton')}
      </Button>
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Staff gate: pick your name, then your PIN (Phase 0 start_staff_session).
// -------------------------------------------------------------------------------------------
export function StaffGate({
  sb,
  device,
  onSignedIn,
}: {
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  onSignedIn: (s: { sessionId: string; staffId: string; staffName: string }) => void;
}) {
  const t = useTranslations('pos');
  const te = useTranslations('errors');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [picked, setPicked] = useState<StaffMember | null>(null);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchActiveStaff(sb, device.orgId, device.branchId).then(setStaff);
  }, [sb, device]);

  const tryPin = useCallback(
    async (nextPin: string) => {
      if (!picked || nextPin.length < 4) return;
      const result = await startStaffSession(sb, device.deviceId, picked.id, nextPin);
      if (result.ok) {
        onSignedIn({
          sessionId: result.session_id,
          staffId: picked.id,
          staffName: picked.display_name,
        });
        return;
      }
      setPin('');
      if (result.reason === 'locked') setMessage(t('pinLocked'));
      else if (result.reason === 'wrong_pin')
        setMessage(t('pinWrong', { attempts: result.attempts_left ?? 0 }));
      else setMessage(te('generic'));
    },
    [sb, device, picked, onSignedIn, t, te],
  );

  if (!picked) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <h1 className="text-2xl font-semibold">{t('chooseStaff')}</h1>
        <div className="grid grid-cols-2 gap-3">
          {staff.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setPicked(s);
                setMessage(null);
              }}
              className="min-h-16 rounded-card border border-line bg-surface px-4 text-lg font-medium hover:border-cyan"
            >
              {s.display_name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xs flex-col justify-center gap-4 px-4">
      <h1 className="text-center text-xl font-semibold">{picked.display_name}</h1>
      <p className="text-center text-secondary">{t('enterPin')}</p>
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <div className="text-center text-3xl tracking-[0.5em]">
        {'•'.repeat(pin.length).padEnd(6, '·')}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) =>
          d === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              className="min-h-14 rounded-input border border-line bg-surface text-xl"
              onClick={() => {
                if (d === '⌫') return setPin((p) => p.slice(0, -1));
                const next = pin.length < 6 ? pin + d : pin;
                setPin(next);
                if (next.length >= 4) void tryPin(next);
              }}
            >
              {d}
            </button>
          ),
        )}
      </div>
      <Button variant="ghost" onClick={() => setPicked(null)}>
        {t('switchStaff')}
      </Button>
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// The till: shift gate, cart, order review, checkout, receipt.
// -------------------------------------------------------------------------------------------
type Screen = 'cart' | 'order' | 'checkout' | 'receipt';

function Till({
  sb,
  device,
  staffSession,
  locale,
  onSwitchStaff,
  error,
  setError,
  t,
  tc,
  te,
}: {
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  staffSession: { sessionId: string; staffId: string; staffName: string };
  locale: Locale;
  onSwitchStaff: () => void;
  error: string | null;
  setError: (e: string | null) => void;
  t: ReturnType<typeof useTranslations<'pos'>>;
  tc: ReturnType<typeof useTranslations<'common'>>;
  te: ReturnType<typeof useTranslations<'errors'>>;
}) {
  const [shift, setShift] = useState<ShiftRow | null | undefined>(undefined);
  const [vatConfig, setVatConfig] = useState<VatConfig | null>(null);
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [voidReasons, setVoidReasons] = useState<ReasonCode[]>([]);
  const [discountReasons, setDiscountReasons] = useState<ReasonCode[]>([]);
  const [refundReasons, setRefundReasons] = useState<ReasonCode[]>([]);
  const [managers, setManagers] = useState<StaffMember[]>([]);

  const [screen, setScreen] = useState<Screen>('cart');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [channelId, setChannelId] = useState('');
  const [tableId, setTableId] = useState<string | ''>('');
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetchOpenShift(sb, device.orgId, device.branchId, device.deviceId),
      sb
        .from('org_settings')
        .select('price_includes_vat, vat_rate_bps, service_charge_bps, vat_on_service_charge')
        .eq('org_id', device.orgId)
        .single(),
      fetchMenu(sb, device.orgId, device.branchId),
      fetchChannels(sb, device.orgId),
      fetchTables(sb, device.orgId, device.branchId),
      fetchReasonCodes(sb, device.orgId, 'void'),
      fetchReasonCodes(sb, device.orgId, 'discount'),
      fetchReasonCodes(sb, device.orgId, 'refund'),
      fetchActiveStaff(sb, device.orgId, device.branchId),
    ]).then(
      ([
        openShiftRow,
        settings,
        menuData,
        channelData,
        tableData,
        voidR,
        discR,
        refundR,
        staffList,
      ]) => {
        setShift(openShiftRow);
        if (settings.data) {
          setVatConfig({
            priceIncludesVat: settings.data.price_includes_vat,
            vatRateBps: settings.data.vat_rate_bps,
            serviceChargeBps: settings.data.service_charge_bps,
            vatOnServiceCharge: settings.data.vat_on_service_charge,
          });
        }
        setMenu(menuData);
        setChannels(channelData);
        setChannelId(channelData.find((c) => c.kind === 'dine_in')?.id ?? channelData[0]?.id ?? '');
        setTables(tableData);
        setVoidReasons(voidR);
        setDiscountReasons(discR);
        setRefundReasons(refundR);
        setManagers(staffList.filter((s) => s.role === 'manager' || s.role === 'owner'));
      },
    );
  }, [sb, device]);

  const isDineIn = channels.find((c) => c.id === channelId)?.kind === 'dine_in';
  const serviceBps = isDineIn ? (vatConfig?.serviceChargeBps ?? 0) : 0;

  const preview = useMemo(() => {
    if (!vatConfig) return null;
    const cfg = { ...vatConfig, serviceChargeBps: serviceBps };
    return sumLines(
      cart.map((c) =>
        computeLine(
          {
            unitPricePoisha: (c.unitPricePoisha + c.modifiersPricePoisha) * c.quantity,
            quantity: 1,
          },
          cfg,
        ),
      ),
    );
  }, [cart, vatConfig, serviceBps]);

  const addToCart = (
    item: { id: string; name: string; price: number },
    modifierIds: string[],
    modLabel: string,
    modPrice: number,
  ) => {
    const key = `${item.id}:${modifierIds.slice().sort().join(',')}`;
    setCart((prev) => {
      const existing = prev.find((c) => c.key === key);
      if (existing)
        return prev.map((c) => (c.key === key ? { ...c, quantity: c.quantity + 1 } : c));
      return [
        ...prev,
        {
          key,
          menuItemId: item.id,
          name: item.name,
          unitPricePoisha: item.price,
          modifierIds,
          modifiersLabel: modLabel,
          modifiersPricePoisha: modPrice,
          quantity: 1,
        },
      ];
    });
  };
  const changeQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev.flatMap((c) =>
        c.key === key
          ? c.quantity + delta <= 0
            ? []
            : [{ ...c, quantity: c.quantity + delta }]
          : [c],
      ),
    );
  };

  const placeOrder = async () => {
    if (!shift || cart.length === 0 || !channelId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await submitOrder(sb, {
        orgId: device.orgId,
        branchId: device.branchId,
        orderId: uid(),
        idempotencyKey: uid(),
        deviceId: device.deviceId,
        staffId: staffSession.staffId,
        channelId,
        tableId: isDineIn ? tableId || null : null,
        lines: cart.map((c) => ({
          menu_item_id: c.menuItemId,
          quantity: c.quantity,
          modifier_ids: c.modifierIds,
        })),
      });
      const createdLines = await fetchOrderItems(sb, device.orgId, created.id);
      setOrder(created);
      setLines(createdLines);
      setScreen('order');
    } catch {
      setError(te('generic'));
    } finally {
      setBusy(false);
    }
  };

  const sendKitchen = async () => {
    if (!order) return;
    setBusy(true);
    try {
      await sendToKitchen(
        sb,
        device.orgId,
        device.branchId,
        order.id,
        device.deviceId,
        staffSession.staffId,
      );
      setOrder({ ...order, order_status: 'sent_to_kitchen' });
    } catch {
      setError(te('generic'));
    } finally {
      setBusy(false);
    }
  };

  const doVoid = async (line: OrderLine, reasonId: string, approvalId?: string) => {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await voidOrderItem(sb, {
        orgId: device.orgId,
        branchId: device.branchId,
        orderItemId: line.id,
        reasonCodeId: reasonId,
        note: null,
        deviceId: device.deviceId,
        staffId: staffSession.staffId,
        approvalId,
      });
      setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, status: 'voided' } : l)));
      setOrder(updated);
    } catch {
      setError(te('generic'));
    } finally {
      setBusy(false);
    }
  };

  const applyDiscount = async (percentBps: number, reasonId: string, approvalId?: string) => {
    if (!order) return;
    setBusy(true);
    try {
      const updated = await applyOrderDiscount(sb, {
        orgId: device.orgId,
        branchId: device.branchId,
        orderId: order.id,
        percentBps,
        reasonCodeId: reasonId,
        note: null,
        deviceId: device.deviceId,
        staffId: staffSession.staffId,
        approvalId,
      });
      setOrder(updated);
    } catch {
      setError(te('generic'));
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async (reasonId: string, approvalId?: string) => {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await cancelOrder(sb, {
        orgId: device.orgId,
        branchId: device.branchId,
        orderId: order.id,
        reasonCodeId: reasonId,
        note: null,
        deviceId: device.deviceId,
        staffId: staffSession.staffId,
        approvalId,
      });
      setOrder(updated);
      setScreen('cart');
      setCart([]);
      setLines([]);
    } catch {
      setError(te('generic'));
    } finally {
      setBusy(false);
    }
  };

  const doAttachCustomer = async (phone: string, name: string, consent: boolean) => {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await attachCustomer(sb, {
        orgId: device.orgId,
        branchId: device.branchId,
        orderId: order.id,
        phone,
        name: name.trim() || null,
        marketingConsent: consent,
        deviceId: device.deviceId,
        staffId: staffSession.staffId,
      });
    } catch {
      setError(te('generic'));
    } finally {
      setBusy(false);
    }
  };

  const doRefund = async (amountPoisha: number, reasonId: string, approvalId: string) => {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await refundOrder(sb, {
        orgId: device.orgId,
        branchId: device.branchId,
        orderId: order.id,
        method: 'cash',
        amountPoisha,
        reasonCodeId: reasonId,
        note: null,
        idempotencyKey: uid(),
        deviceId: device.deviceId,
        staffId: staffSession.staffId,
        approvalId,
      });
      setOrder(updated);
    } catch {
      setError(te('generic'));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setCart([]);
    setOrder(null);
    setLines([]);
    setScreen('cart');
  };

  if (shift === undefined) return null;
  if (!shift) {
    return (
      <ShiftOpener
        sb={sb}
        device={device}
        staffSession={staffSession}
        t={t}
        te={te}
        onOpened={setShift}
        onSwitchStaff={onSwitchStaff}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-3 py-3">
      <header className="mb-3 flex items-center justify-between">
        <span className="text-sm text-secondary">
          {device.branchName} · {staffSession.staffName}
        </span>
        <div className="flex gap-2">
          <ShiftCloser
            sb={sb}
            device={device}
            staffSession={staffSession}
            managers={managers}
            shift={shift}
            t={t}
            onClosed={() => setShift(null)}
          />
          <Button variant="ghost" size="sm" onClick={onSwitchStaff}>
            {t('switchStaff')}
          </Button>
        </div>
      </header>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {screen === 'cart' ? (
        <CartScreen
          menu={menu}
          channels={channels}
          tables={tables}
          channelId={channelId}
          setChannelId={setChannelId}
          tableId={tableId}
          setTableId={setTableId}
          isDineIn={isDineIn}
          cart={cart}
          addToCart={addToCart}
          changeQty={changeQty}
          preview={preview}
          locale={locale}
          t={t}
          busy={busy}
          onPlaceOrder={() => void placeOrder()}
        />
      ) : null}
      {screen === 'order' && order ? (
        <OrderScreen
          order={order}
          lines={lines}
          locale={locale}
          t={t}
          busy={busy}
          onSendKitchen={() => void sendKitchen()}
          onVoid={doVoid}
          voidReasons={voidReasons}
          managers={managers}
          sb={sb}
          device={device}
          tableName={tables.find((tb) => tb.id === order.table_id)?.name ?? null}
          discountReasons={discountReasons}
          voidReasonsForCancel={voidReasons}
          onDiscount={(p, r, a) => void applyDiscount(p, r, a)}
          onCancel={(r, a) => void doCancel(r, a)}
          onAttachCustomer={(phone, name, consent) => void doAttachCustomer(phone, name, consent)}
          onCheckout={() => setScreen('checkout')}
        />
      ) : null}
      {screen === 'checkout' && order ? (
        <CheckoutScreen
          sb={sb}
          device={device}
          staffSession={staffSession}
          order={order}
          locale={locale}
          t={t}
          te={te}
          onPaid={(paid) => {
            setOrder(paid);
            setScreen('receipt');
          }}
        />
      ) : null}
      {screen === 'receipt' && order ? (
        <ReceiptScreen
          order={order}
          lines={lines}
          orgSlug={device.orgSlug}
          branchName={device.branchName}
          tableName={tables.find((tb) => tb.id === order.table_id)?.name ?? null}
          locale={locale}
          t={t}
          tc={tc}
          onNewOrder={reset}
          refundReasons={refundReasons}
          managers={managers}
          sb={sb}
          device={device}
          onRefund={(amount, reasonId, approvalId) => void doRefund(amount, reasonId, approvalId)}
        />
      ) : null}
    </div>
  );
}

function ShiftOpener({
  sb,
  device,
  staffSession,
  t,
  te,
  onOpened,
  onSwitchStaff,
}: {
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  staffSession: { staffId: string };
  t: ReturnType<typeof useTranslations<'pos'>>;
  te: ReturnType<typeof useTranslations<'errors'>>;
  onOpened: (s: ShiftRow) => void;
  onSwitchStaff: () => void;
}) {
  const [float, setFloat] = useState('500');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto flex min-h-dvh max-w-xs flex-col justify-center gap-4 px-4">
      <p className="text-secondary">{t('shiftClosedBanner')}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div>
        <Label htmlFor="float">{t('openingFloat')}</Label>
        <Input
          id="float"
          inputMode="decimal"
          value={float}
          onChange={(e) => setFloat(e.target.value)}
        />
      </div>
      <Button
        disabled={busy}
        onClick={() => {
          const poisha = parseTakaToPoisha(float);
          if (poisha === null || poisha < 0) return setError(te('invalidInput'));
          setBusy(true);
          openShift(
            sb,
            device.orgId,
            device.branchId,
            device.deviceId,
            staffSession.staffId,
            poisha,
          )
            .then(onOpened)
            .catch(() => setError(te('generic')))
            .finally(() => setBusy(false));
        }}
      >
        {t('openShift')}
      </Button>
      <Button variant="ghost" onClick={onSwitchStaff}>
        {t('switchStaff')}
      </Button>
    </div>
  );
}

function ShiftCloser({
  sb,
  device,
  staffSession,
  managers,
  shift,
  t,
  onClosed,
}: {
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  staffSession: { staffId: string };
  managers: StaffMember[];
  shift: ShiftRow;
  t: ReturnType<typeof useTranslations<'pos'>>;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [needsMgr, setNeedsMgr] = useState(false);
  const [result, setResult] = useState<ShiftRow | null>(null);
  const locale = useLocale() as Locale;

  const attempt = async (approvalId?: string) => {
    const poisha = parseTakaToPoisha(counted);
    if (poisha === null) return;
    try {
      const closed = await closeShift(
        sb,
        device.orgId,
        device.branchId,
        shift.id,
        poisha,
        device.deviceId,
        staffSession.staffId,
        approvalId,
      );
      setResult(closed);
    } catch (e) {
      if (needsApproval(e)) setNeedsMgr(true);
    }
  };

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t('closeShift')}
      </Button>
    );
  }
  return (
    <DialogShell>
      {result ? (
        <>
          <p>
            {t('expectedCash')}: {formatBDT(result.expected_cash_poisha ?? 0, locale)}
          </p>
          <p>
            {t('countedCash')}: {formatBDT(result.counted_cash_poisha ?? 0, locale)}
          </p>
          <p className={(result.over_short_poisha ?? 0) === 0 ? 'text-success' : 'text-danger'}>
            {t('overShort')}: {formatBDT(result.over_short_poisha ?? 0, locale)}
          </p>
          <Button className="w-full" onClick={onClosed}>
            OK
          </Button>
        </>
      ) : needsMgr ? (
        <>
          <h3 className="font-bold">{t('closeShift')}</h3>
          <ManagerApprovalStep
            sb={sb}
            device={device}
            action="close_shift"
            managers={managers}
            t={t}
            onApproved={(approvalId) => void attempt(approvalId)}
          />
        </>
      ) : (
        <>
          <Label htmlFor="counted">{t('countedCash')}</Label>
          <Input
            id="counted"
            inputMode="decimal"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              ✕
            </Button>
            <Button className="flex-1" onClick={() => void attempt()}>
              {t('closeShift')}
            </Button>
          </div>
        </>
      )}
    </DialogShell>
  );
}

function CartScreen({
  menu,
  channels,
  tables,
  channelId,
  setChannelId,
  tableId,
  setTableId,
  isDineIn,
  cart,
  addToCart,
  changeQty,
  preview,
  locale,
  t,
  busy,
  onPlaceOrder,
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
  addToCart: (
    item: { id: string; name: string; price: number },
    modifierIds: string[],
    modLabel: string,
    modPrice: number,
  ) => void;
  changeQty: (key: string, delta: number) => void;
  preview: ReturnType<typeof sumLines> | null;
  locale: Locale;
  t: ReturnType<typeof useTranslations<'pos'>>;
  busy: boolean;
  onPlaceOrder: () => void;
}) {
  const money = (p: number) => formatBDT(p, locale);
  return (
    <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-[1fr_320px]">
      <div className="overflow-y-auto rounded-card border border-line bg-surface p-3">
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
        {menu.map((cat) => (
          <div key={cat.id} className="mb-4">
            <h2 className="mb-2 text-sm font-semibold text-secondary">
              {locale === 'bn' && cat.name_bn ? cat.name_bn : cat.name}
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {cat.items
                .filter((i) => i.is_available)
                .map((item) => {
                  const price = item.branch_price_poisha ?? item.base_price_poisha;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addToCart({ id: item.id, name: item.name, price }, [], '', 0)}
                      className="flex min-h-16 flex-col items-start justify-between rounded-input border border-line bg-background-secondary p-2 text-start hover:border-cyan"
                    >
                      <span className="text-sm font-medium">
                        {locale === 'bn' && item.name_bn ? item.name_bn : item.name}
                      </span>
                      <span className="text-xs text-secondary">{money(price)}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col rounded-card border border-line bg-surface p-3">
        <h2 className="mb-2 font-semibold">{t('cart')}</h2>
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="text-sm text-secondary">{t('cartEmpty')}</p>
          ) : (
            cart.map((c) => (
              <div key={c.key} className="mb-2 flex items-center justify-between gap-2 text-sm">
                <span className="flex-1">{c.name}</span>
                <button
                  type="button"
                  className="size-7 rounded-input border border-line"
                  onClick={() => changeQty(c.key, -1)}
                >
                  -
                </button>
                <span className="w-5 text-center">{c.quantity}</span>
                <button
                  type="button"
                  className="size-7 rounded-input border border-line"
                  onClick={() => changeQty(c.key, 1)}
                >
                  +
                </button>
                <span className="w-16 text-end">
                  {money((c.unitPricePoisha + c.modifiersPricePoisha) * c.quantity)}
                </span>
              </div>
            ))
          )}
        </div>
        {preview ? (
          <div className="mt-2 space-y-1 border-t border-line pt-2 text-sm">
            <div className="flex justify-between">
              <span>{t('subtotal')}</span>
              <span>{money(preview.netPoisha)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('vat')}</span>
              <span>{money(preview.vatPoisha)}</span>
            </div>
            {preview.serviceChargePoisha > 0 ? (
              <div className="flex justify-between">
                <span>{t('serviceCharge')}</span>
                <span>{money(preview.serviceChargePoisha)}</span>
              </div>
            ) : null}
            <div className="flex justify-between font-semibold">
              <span>{t('total')}</span>
              <span>{money(preview.totalPoisha)}</span>
            </div>
          </div>
        ) : null}
        <Button className="mt-3" disabled={busy || cart.length === 0} onClick={onPlaceOrder}>
          {t('checkout')}
        </Button>
      </div>
    </div>
  );
}

function OrderScreen({
  order,
  lines,
  locale,
  t,
  busy,
  onSendKitchen,
  onVoid,
  voidReasons,
  managers,
  sb,
  device,
  tableName,
  discountReasons,
  voidReasonsForCancel,
  onDiscount,
  onCancel,
  onAttachCustomer,
  onCheckout,
}: {
  order: OrderRow;
  lines: OrderLine[];
  locale: Locale;
  t: ReturnType<typeof useTranslations<'pos'>>;
  busy: boolean;
  onSendKitchen: () => void;
  onVoid: (line: OrderLine, reasonId: string, approvalId?: string) => void;
  voidReasons: ReasonCode[];
  managers: StaffMember[];
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  tableName: string | null;
  discountReasons: ReasonCode[];
  voidReasonsForCancel: ReasonCode[];
  onDiscount: (percentBps: number, reasonId: string, approvalId?: string) => void;
  onCancel: (reasonId: string, approvalId?: string) => void;
  onAttachCustomer: (phone: string, name: string, consent: boolean) => void;
  onCheckout: () => void;
}) {
  const money = (p: number) => formatBDT(p, locale);
  const [voidTarget, setVoidTarget] = useState<OrderLine | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const cancelNeedsApproval = lines.some((l) => l.status === 'active' && l.kot_sent_at !== null);
  return (
    <div className="flex flex-1 flex-col gap-3">
      {/* Off-screen until window.print() (ARCHITECTURE.md: browser-print KOT). */}
      <Receipt
        kind="kot"
        order={order}
        lines={lines}
        orgName={device.orgSlug}
        branchName={device.branchName}
        tableName={tableName}
        locale={locale}
      />
      <div className="rounded-card border border-line bg-surface p-3">
        <ul className="divide-y divide-line">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className={l.status === 'voided' ? 'flex-1 text-muted line-through' : 'flex-1'}>
                {l.quantity} × {l.name_snapshot}
              </span>
              <span className="w-20 text-end">{money(l.total_poisha)}</span>
              {l.status === 'active' ? (
                <Button variant="ghost" size="sm" onClick={() => setVoidTarget(l)}>
                  {t('voidItem')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-2 space-y-1 border-t border-line pt-2 text-sm">
          <div className="flex justify-between">
            <span>{t('subtotal')}</span>
            <span>{money(order.net_poisha)}</span>
          </div>
          {order.discount_poisha > 0 ? (
            <div className="flex justify-between">
              <span>{t('discount')}</span>
              <span>-{money(order.discount_poisha)}</span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span>{t('vat')}</span>
            <span>{money(order.vat_poisha)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>{t('total')}</span>
            <span>{money(order.total_poisha)}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {order.order_status === 'open' ? (
          <Button disabled={busy} onClick={onSendKitchen}>
            {t('sendToKitchen')}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => window.print()}>
            {t('printKot')}
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={() => setDiscountOpen(true)}>
          {t('applyDiscount')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setCustomerOpen(true)}>
          {order.customer_id ? t('customerAdded') : t('addCustomer')}
        </Button>
        {order.payment_status === 'unpaid' ? (
          <Button variant="danger" disabled={busy} onClick={() => setCancelOpen(true)}>
            {t('cancelOrder')}
          </Button>
        ) : null}
        <Button className="ms-auto" disabled={busy} onClick={onCheckout}>
          {t('checkout')}
        </Button>
      </div>

      {voidTarget ? (
        <VoidDialog
          line={voidTarget}
          reasons={voidReasons}
          managers={managers}
          sb={sb}
          device={device}
          t={t}
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
          managers={managers}
          sb={sb}
          device={device}
          t={t}
          onClose={() => setDiscountOpen(false)}
          onConfirm={(p, r, a) => {
            onDiscount(p, r, a);
            setDiscountOpen(false);
          }}
        />
      ) : null}
      {cancelOpen ? (
        <CancelOrderDialog
          reasons={voidReasonsForCancel}
          managers={managers}
          needsApproval={cancelNeedsApproval}
          sb={sb}
          device={device}
          t={t}
          onClose={() => setCancelOpen(false)}
          onConfirm={(r, a) => {
            onCancel(r, a);
            setCancelOpen(false);
          }}
        />
      ) : null}
      {customerOpen ? (
        <CustomerDialog
          t={t}
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

/** Manager PIN → a single-use approval token (ADR 0014). Shared by void/discount/cancel/refund. */
function ManagerApprovalStep({
  sb,
  device,
  action,
  managers,
  t,
  onApproved,
}: {
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  action: ApprovalAction;
  managers: StaffMember[];
  t: ReturnType<typeof useTranslations<'pos'>>;
  onApproved: (approvalId: string) => void;
}) {
  const [managerId, setManagerId] = useState(managers[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result: ApprovalResult = await approveAction(sb, device.deviceId, managerId, pin, action);
    setBusy(false);
    if (!result.ok) {
      setPin('');
      if (result.reason === 'locked') setError(t('pinLocked'));
      else setError(t('pinWrong', { attempts: result.attempts_left ?? 0 }));
      return;
    }
    onApproved(result.approval_id);
  };

  return (
    <div className="space-y-3">
      <Alert tone="warning">{t('managerPinRequired')}</Alert>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div>
        <Label htmlFor="mgr">{t('managerPin')}</Label>
        <Select id="mgr" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </Select>
        <Input
          className="mt-2"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
      </div>
      <Button className="w-full" disabled={busy || pin.length < 4} onClick={() => void confirm()}>
        {t('approve')}
      </Button>
    </div>
  );
}

function DialogShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="glass-strong w-full max-w-xs space-y-3 rounded-sheet p-5">{children}</div>
    </div>
  );
}

function VoidDialog({
  line,
  reasons,
  managers,
  sb,
  device,
  t,
  onClose,
  onConfirm,
}: {
  line: OrderLine;
  reasons: ReasonCode[];
  managers: StaffMember[];
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  t: ReturnType<typeof useTranslations<'pos'>>;
  onClose: () => void;
  onConfirm: (reasonId: string, approvalId?: string) => void;
}) {
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? '');
  const [approving, setApproving] = useState(false);
  const needsMgr = line.kot_sent_at !== null;

  if (approving) {
    return (
      <DialogShell>
        <div className="flex items-center justify-between">
          <h3 className="font-bold">{t('voidItem')}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>
        <ManagerApprovalStep
          sb={sb}
          device={device}
          action="void_after_kot"
          managers={managers}
          t={t}
          onApproved={(approvalId) => onConfirm(reasonId, approvalId)}
        />
      </DialogShell>
    );
  }

  return (
    <DialogShell>
      <h3 className="font-bold">{t('voidItem')}</h3>
      <div>
        <Label htmlFor="vr">{t('voidReason')}</Label>
        <Select id="vr" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose}>
          ✕
        </Button>
        <Button
          className="flex-1"
          onClick={() => (needsMgr ? setApproving(true) : onConfirm(reasonId))}
        >
          {t('approve')}
        </Button>
      </div>
    </DialogShell>
  );
}

function DiscountDialog({
  reasons,
  managers,
  sb,
  device,
  t,
  onClose,
  onConfirm,
}: {
  reasons: ReasonCode[];
  managers: StaffMember[];
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  t: ReturnType<typeof useTranslations<'pos'>>;
  onClose: () => void;
  onConfirm: (percentBps: number, reasonId: string, approvalId?: string) => void;
}) {
  const [percent, setPercent] = useState('10');
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? '');
  const [approving, setApproving] = useState(false);
  const reason = reasons.find((r) => r.id === reasonId);

  if (approving) {
    return (
      <DialogShell>
        <div className="flex items-center justify-between">
          <h3 className="font-bold">{t('applyDiscount')}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>
        <ManagerApprovalStep
          sb={sb}
          device={device}
          action="discount"
          managers={managers}
          t={t}
          onApproved={(approvalId) =>
            onConfirm(Math.round(Number(percent) * 100), reasonId, approvalId)
          }
        />
      </DialogShell>
    );
  }

  return (
    <DialogShell>
      <h3 className="font-bold">{t('applyDiscount')}</h3>
      <div>
        <Label htmlFor="pct">{t('discountPercent')}</Label>
        <Input
          id="pct"
          inputMode="decimal"
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="dr">{t('reason')}</Label>
        <Select id="dr" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose}>
          ✕
        </Button>
        <Button
          className="flex-1"
          onClick={() =>
            reason?.requires_manager_approval
              ? setApproving(true)
              : onConfirm(Math.round(Number(percent) * 100), reasonId)
          }
        >
          {t('approve')}
        </Button>
      </div>
    </DialogShell>
  );
}

function CancelOrderDialog({
  reasons,
  managers,
  needsApproval: needsMgr,
  sb,
  device,
  t,
  onClose,
  onConfirm,
}: {
  reasons: ReasonCode[];
  managers: StaffMember[];
  needsApproval: boolean;
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  t: ReturnType<typeof useTranslations<'pos'>>;
  onClose: () => void;
  onConfirm: (reasonId: string, approvalId?: string) => void;
}) {
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? '');
  const [approving, setApproving] = useState(false);

  if (approving) {
    return (
      <DialogShell>
        <div className="flex items-center justify-between">
          <h3 className="font-bold">{t('cancelOrder')}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>
        <ManagerApprovalStep
          sb={sb}
          device={device}
          action="cancel_order"
          managers={managers}
          t={t}
          onApproved={(approvalId) => onConfirm(reasonId, approvalId)}
        />
      </DialogShell>
    );
  }

  return (
    <DialogShell>
      <h3 className="font-bold">{t('cancelOrder')}</h3>
      <div>
        <Label htmlFor="cr">{t('voidReason')}</Label>
        <Select id="cr" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose}>
          ✕
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          onClick={() => (needsMgr ? setApproving(true) : onConfirm(reasonId))}
        >
          {t('cancelOrder')}
        </Button>
      </div>
    </DialogShell>
  );
}

function CustomerDialog({
  t,
  onClose,
  onConfirm,
}: {
  t: ReturnType<typeof useTranslations<'pos'>>;
  onClose: () => void;
  onConfirm: (phone: string, name: string, consent: boolean) => void;
}) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  return (
    <DialogShell>
      <h3 className="font-bold">{t('addCustomer')}</h3>
      <div>
        <Label htmlFor="cphone">{t('customerPhone')}</Label>
        <Input
          id="cphone"
          inputMode="tel"
          placeholder="01XXXXXXXXX"
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
          className="size-4 accent-blue"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        {t('marketingConsent')}
      </label>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose}>
          ✕
        </Button>
        <Button
          className="flex-1"
          disabled={phone.trim() === ''}
          onClick={() => onConfirm(phone, name, consent)}
        >
          {t('save')}
        </Button>
      </div>
    </DialogShell>
  );
}

function RefundDialog({
  reasons,
  managers,
  maxAmountPoisha,
  sb,
  device,
  locale,
  t,
  onClose,
  onConfirm,
}: {
  reasons: ReasonCode[];
  managers: StaffMember[];
  maxAmountPoisha: number;
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  locale: Locale;
  t: ReturnType<typeof useTranslations<'pos'>>;
  onClose: () => void;
  onConfirm: (amountPoisha: number, reasonId: string, approvalId: string) => void;
}) {
  const [amount, setAmount] = useState(() => formatBDT(maxAmountPoisha, 'en', { symbol: false }));
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? '');
  const [approving, setApproving] = useState(false);
  const poisha = parseTakaToPoisha(amount);
  const valid = poisha !== null && poisha > 0 && poisha <= maxAmountPoisha;

  if (approving && poisha !== null) {
    return (
      <DialogShell>
        <div className="flex items-center justify-between">
          <h3 className="font-bold">{t('refundOrder')}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>
        <ManagerApprovalStep
          sb={sb}
          device={device}
          action="refund"
          managers={managers}
          t={t}
          onApproved={(approvalId) => onConfirm(poisha, reasonId, approvalId)}
        />
      </DialogShell>
    );
  }

  return (
    <DialogShell>
      <h3 className="font-bold">{t('refundOrder')}</h3>
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
      <div>
        <Label htmlFor="rr">{t('reason')}</Label>
        <Select id="rr" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose}>
          ✕
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          disabled={!valid}
          onClick={() => setApproving(true)}
        >
          {t('refundOrder')}
        </Button>
      </div>
    </DialogShell>
  );
}

const METHODS = ['cash', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'bank'] as const;

function CheckoutScreen({
  sb,
  device,
  staffSession,
  order,
  locale,
  t,
  te,
  onPaid,
}: {
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  staffSession: { staffId: string };
  order: OrderRow;
  locale: Locale;
  t: ReturnType<typeof useTranslations<'pos'>>;
  te: ReturnType<typeof useTranslations<'errors'>>;
  onPaid: (order: OrderRow) => void;
}) {
  const money = (p: number) => formatBDT(p, locale);
  const [current, setCurrent] = useState(order);
  const [method, setMethod] = useState<(typeof METHODS)[number]>('cash');
  const [amount, setAmount] = useState(() =>
    formatBDT(order.total_poisha, 'en', { symbol: false }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = current.total_poisha; // record_payment recomputes payment_status server-side; we just re-derive from the returned order.

  const addTender = async () => {
    const poisha = parseTakaToPoisha(amount);
    if (poisha === null || poisha <= 0) return setError(te('invalidInput'));
    setBusy(true);
    setError(null);
    try {
      const updated = await recordPayment(sb, {
        orgId: device.orgId,
        branchId: device.branchId,
        orderId: current.id,
        method,
        amountPoisha: poisha,
        reference: null,
        idempotencyKey: uid(),
        deviceId: device.deviceId,
        staffId: staffSession.staffId,
      });
      setCurrent(updated);
      if (updated.payment_status === 'paid') onPaid(updated);
      else setAmount(formatBDT(updated.total_poisha, 'en', { symbol: false }));
    } catch {
      setError(te('generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-sm flex-1 flex-col gap-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <p className="text-center text-3xl font-semibold">{money(remaining)}</p>
      <p className="text-center text-secondary">{t('amountDue')}</p>
      <div>
        <Label htmlFor="method">{t('paymentMethod')}</Label>
        <Select
          id="method"
          value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="amt">{t('amount')}</Label>
        <Input
          id="amt"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <Button disabled={busy} onClick={() => void addTender()}>
        {t('addPayment')}
      </Button>
    </div>
  );
}

function ReceiptScreen({
  order,
  lines,
  orgSlug,
  branchName,
  tableName,
  locale,
  t,
  tc,
  onNewOrder,
  refundReasons,
  managers,
  sb,
  device,
  onRefund,
}: {
  order: OrderRow;
  lines: OrderLine[];
  orgSlug: string;
  branchName: string;
  tableName: string | null;
  locale: Locale;
  t: ReturnType<typeof useTranslations<'pos'>>;
  tc: ReturnType<typeof useTranslations<'common'>>;
  onNewOrder: () => void;
  refundReasons: ReasonCode[];
  managers: StaffMember[];
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  onRefund: (amountPoisha: number, reasonId: string, approvalId: string) => void;
}) {
  const [refundOpen, setRefundOpen] = useState(false);
  const canRefund = order.payment_status === 'paid' || order.payment_status === 'partially_paid';
  return (
    <div className="mx-auto flex max-w-sm flex-1 flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-2xl font-semibold text-success">{t('orderComplete')}</h2>
      <p className="text-secondary">{order.invoice_no}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={() => window.print()}>
          {t('printReceipt')}
        </Button>
        <Button onClick={onNewOrder}>{t('newOrder')}</Button>
        {canRefund ? (
          <Button variant="danger" onClick={() => setRefundOpen(true)}>
            {t('refundOrder')}
          </Button>
        ) : null}
      </div>
      <Receipt
        kind="receipt"
        order={order}
        lines={lines}
        orgName={orgSlug}
        branchName={branchName}
        tableName={tableName}
        locale={locale}
      />
      <span className="sr-only">{tc('appName')}</span>
      {refundOpen ? (
        <RefundDialog
          reasons={refundReasons}
          managers={managers}
          maxAmountPoisha={order.total_poisha}
          sb={sb}
          device={device}
          locale={locale}
          t={t}
          onClose={() => setRefundOpen(false)}
          onConfirm={(amount, reasonId, approvalId) => {
            onRefund(amount, reasonId, approvalId);
            setRefundOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
