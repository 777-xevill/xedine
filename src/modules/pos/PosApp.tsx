'use client';

import { History, LogOut } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Input, Label } from '@/components/ui/form';
import { formatBDT, type Locale } from '@/lib/i18n/format';
import { computeLine, parseTakaToPoisha, sumLines, type VatConfig } from '@/lib/money';
import { now } from '@/lib/time/clock';
import {
  addOrderItems,
  applyOrderDiscount,
  attachCustomer,
  cancelOrder,
  closeShift,
  createClient,
  endStaffSession,
  fetchActiveStaff,
  fetchChannels,
  fetchMenu,
  fetchOpenShift,
  fetchOrder,
  fetchOrderItems,
  fetchOrderMoney,
  fetchReasonCodes,
  fetchReceiptInfo,
  fetchRecentOrders,
  fetchTables,
  fetchVatConfig,
  needsApproval,
  openShift,
  posTransport,
  refundOrder,
  voidOrderItem,
  type Channel,
  type DiningTable,
  type MenuCategory,
  type MenuItem,
  type OrderLine,
  type OrderRow,
  type ReasonCode,
  type ReceiptInfo,
  type ShiftRow,
  type StaffMember,
} from './client';
import {
  clearDevice,
  clearStaffSession,
  getDevice,
  getStaffSession,
  getTillSnapshot,
  nextProvisionalCounter,
  setDevice,
  setStaffSession,
  setTillSnapshot,
  type DeviceState,
  type StaffSessionState,
} from './device-storage';
import { DialogShell, ManagerApprovalStep, type PaymentMethod, type PickedItem } from './dialogs';
import { PairingScreen, StaffGate } from './gate';
import { applyTender, buildLocalOrder, provisionalReceiptNo } from './local-order';
import { isNetworkError, Outbox, type FlushResult, type OutboxEntry } from './outbox';
import { idbOutboxStore } from './outbox-idb';
import {
  cartKey,
  CartScreen,
  CheckoutScreen,
  orderLabel,
  OrderScreen,
  OrdersScreen,
  ReceiptScreen,
  SyncStatus,
  type CartItem,
  type CartMode,
} from './screens';
import { TillContext, useTill, type TillContextValue } from './till-context';

// crypto.randomUUID() is the standard Web Crypto API, available in every browser this app targets
// (this module is client-only: page.tsx loads it via next/dynamic, ssr: false).
const uid = () => crypto.randomUUID();
const nowIso = () => now().toISOString();

export function PosApp() {
  const locale = useLocale() as Locale;
  const sb = useMemo(() => createClient(), []);
  // Client-only mount, so reading localStorage in the initializer cannot mismatch a server render.
  const [device, setDeviceState] = useState<DeviceState | null>(() => getDevice());
  const [staffSession, setStaffSessionState] = useState<StaffSessionState | null>(() =>
    getStaffSession(),
  );

  useEffect(() => {
    // The service worker keeps /pos loadable with no network (public/sw.js). Best effort only.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    }
  }, []);

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
        onReset={() => {
          clearStaffSession();
          clearDevice();
          setStaffSessionState(null);
          setDeviceState(null);
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
    />
  );
}

function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

interface TillData {
  shift: ShiftRow | null;
  vat: VatConfig;
  menu: MenuCategory[];
  channels: Channel[];
  tables: DiningTable[];
  voidReasons: ReasonCode[];
  discountReasons: ReasonCode[];
  refundReasons: ReasonCode[];
  staff: StaffMember[];
  receipt: ReceiptInfo;
}

async function loadTillData(
  sb: ReturnType<typeof createClient>,
  device: DeviceState,
): Promise<TillData> {
  const [
    shift,
    vat,
    menu,
    channels,
    tables,
    voidReasons,
    discountReasons,
    refundReasons,
    staff,
    receipt,
  ] = await Promise.all([
    fetchOpenShift(sb, device.orgId, device.branchId, device.deviceId),
    fetchVatConfig(sb, device.orgId),
    fetchMenu(sb, device.orgId, device.branchId),
    fetchChannels(sb, device.orgId),
    fetchTables(sb, device.orgId, device.branchId),
    fetchReasonCodes(sb, device.orgId, 'void'),
    fetchReasonCodes(sb, device.orgId, 'discount'),
    fetchReasonCodes(sb, device.orgId, 'refund'),
    fetchActiveStaff(sb, device.orgId, device.branchId),
    fetchReceiptInfo(sb, device.orgId),
  ]);
  return {
    shift,
    vat,
    menu,
    channels,
    tables,
    voidReasons,
    discountReasons,
    refundReasons,
    staff,
    receipt,
  };
}

type Screen = 'cart' | 'order' | 'checkout' | 'receipt' | 'orders';

function Till({
  sb,
  device,
  staffSession,
  locale,
  onSwitchStaff,
}: {
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  staffSession: StaffSessionState;
  locale: Locale;
  onSwitchStaff: () => void;
}) {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const browserOnline = useBrowserOnline();
  // navigator.onLine only knows about the local network; a failed sync is the real signal.
  const [reachable, setReachable] = useState(true);
  const online = browserOnline && reachable;

  const [data, setData] = useState<TillData | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const outbox = useMemo(
    () => new Outbox(idbOutboxStore(device.deviceId), posTransport(sb), uid, nowIso),
    [sb, device.deviceId],
  );
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [syncing, setSyncing] = useState(false);

  const [screen, setScreen] = useState<Screen>('cart');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartMode, setCartMode] = useState<CartMode>({ kind: 'new' });
  const [chosenChannel, setChannelId] = useState('');
  const [tableId, setTableId] = useState('');
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [local, setLocal] = useState(false);
  const [paid, setPaid] = useState(0);
  const [refunded, setRefunded] = useState(0);
  const [change, setChange] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recent, setRecent] = useState<OrderRow[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);

  // Flushes run from timers and events; refs let them see the order on screen right now.
  const orderRef = useRef<OrderRow | null>(null);
  const localRef = useRef(false);
  useEffect(() => {
    orderRef.current = order;
    localRef.current = local;
  }, [order, local]);

  // ---------------------------------------------------------------------------------------
  // Load: network first, then the cached snapshot (ARCHITECTURE.md "Offline POS").
  // ---------------------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    loadTillData(sb, device)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setFromCache(false);
        setTillSnapshot(device.deviceId, { ...d, savedAt: nowIso() });
      })
      .catch(() => {
        if (cancelled) return;
        const snapshot = getTillSnapshot(device.deviceId);
        if (snapshot) {
          setData(snapshot);
          setFromCache(true);
          setReachable(false);
        } else setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sb, device]);

  const updateShift = useCallback(
    (shift: ShiftRow | null) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = { ...prev, shift };
        setTillSnapshot(device.deviceId, { ...next, savedAt: nowIso() });
        return next;
      });
    },
    [device.deviceId],
  );

  // ---------------------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------------------
  const refreshEntries = useCallback(async () => setEntries(await outbox.entries()), [outbox]);
  useEffect(() => {
    let alive = true;
    outbox
      .entries()
      .then((e) => alive && setEntries(e))
      .catch(() => undefined);
    const unsubscribe = outbox.subscribe(() => void refreshEntries());
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [outbox, refreshEntries]);

  const reloadOrder = useCallback(
    async (orderId: string) => {
      const [fresh, freshLines, money] = await Promise.all([
        fetchOrder(sb, device.orgId, orderId),
        fetchOrderItems(sb, device.orgId, orderId),
        fetchOrderMoney(sb, device.orgId, orderId),
      ]);
      if (!fresh || orderRef.current?.id !== orderId) return;
      setOrder(fresh);
      setLines(freshLines);
      setPaid(money.paidPoisha);
      setRefunded(money.refundedPoisha);
      setLocal(false);
    },
    [sb, device.orgId],
  );

  const flush = useCallback(async (): Promise<FlushResult> => {
    setSyncing(true);
    try {
      const result = await outbox.flush();
      setReachable(!result.offline);
      // The order on screen was rung up offline and has now fully reached the server: show the
      // server's own numbers (invoice number, order number, totals) from here on.
      const current = orderRef.current;
      if (current && localRef.current && result.synced > 0) {
        const left = (await outbox.entries()).some((e) => e.orderId === current.id);
        if (!left) await reloadOrder(current.id).catch(() => undefined);
      }
      return result;
    } finally {
      setSyncing(false);
    }
  }, [outbox, reloadOrder]);

  useEffect(() => {
    if (!browserOnline) return;
    // Sync as soon as the network is back, then keep trying while anything is queued.
    const first = window.setTimeout(() => void flush(), 0);
    const timer = window.setInterval(() => void flush(), 20_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [browserOnline, flush]);

  /** Queue one operation, try to send it now, and report what happened to it. */
  const enqueueAndFlush = async (orderId: string, op: Parameters<Outbox['enqueue']>[1]) => {
    const entry = await outbox.enqueue(orderId, op);
    const result = await flush();
    const synced = result.results.get(entry.id);
    if (synced) return { state: 'synced' as const, result: synced.result };
    const refused = (await outbox.entries()).find(
      (e) => e.id === entry.id && e.status === 'failed',
    );
    if (refused) {
      // Refused while the cashier is standing here: undo it and say so, rather than park it.
      await outbox.discard(entry.id);
      return { state: 'refused' as const, error: refused.error ?? '' };
    }
    return { state: 'queued' as const };
  };

  // ---------------------------------------------------------------------------------------
  // Cart
  // ---------------------------------------------------------------------------------------
  const channelId =
    chosenChannel ||
    (data?.channels.find((c) => c.kind === 'dine_in')?.id ?? data?.channels[0]?.id ?? '');
  const isDineIn = data?.channels.find((c) => c.id === channelId)?.kind === 'dine_in';
  const serviceBps = isDineIn ? (data?.vat.serviceChargeBps ?? 0) : 0;
  const tableName = (id: string | null) => data?.tables.find((tb) => tb.id === id)?.name ?? null;

  const preview = useMemo(() => {
    if (!data || cart.length === 0) return null;
    const cfg = { ...data.vat, serviceChargeBps: serviceBps };
    return sumLines(
      cart.map((c) =>
        computeLine({ unitPricePoisha: c.unitPricePoisha, quantity: c.quantity }, cfg),
      ),
    );
  }, [cart, data, serviceBps]);

  const addToCart = (item: MenuItem, picked: PickedItem) => {
    const key = cartKey(item.id, picked);
    const base = locale === 'bn' && item.name_bn ? item.name_bn : item.name;
    setCart((prev) => {
      if (prev.some((c) => c.key === key))
        return prev.map((c) =>
          c.key === key ? { ...c, quantity: Math.min(999, c.quantity + picked.quantity) } : c,
        );
      return [
        ...prev,
        {
          key,
          menuItemId: item.id,
          name: picked.variantName ? `${base} (${picked.variantName})` : base,
          variantId: picked.variantId,
          modifierIds: picked.modifierIds,
          modifiersLabel: picked.modifiersLabel,
          unitPricePoisha: picked.unitPricePoisha,
          quantity: picked.quantity,
          note: picked.note,
        },
      ];
    });
  };
  const changeQty = (key: string, delta: number) =>
    setCart((prev) =>
      prev.flatMap((c) =>
        c.key !== key
          ? [c]
          : c.quantity + delta <= 0
            ? []
            : [{ ...c, quantity: c.quantity + delta }],
      ),
    );
  const cartLines = () =>
    cart.map((c) => ({
      menu_item_id: c.menuItemId,
      quantity: c.quantity,
      ...(c.variantId ? { variant_id: c.variantId } : {}),
      modifier_ids: c.modifierIds,
      ...(c.note ? { note: c.note } : {}),
      client_unit_price_poisha: c.unitPricePoisha,
    }));

  const errorText = (e: unknown) => (isNetworkError(e) ? t('needsInternet') : t('actionRefused'));

  // ---------------------------------------------------------------------------------------
  // Order flow: place → kitchen → pay go through the outbox, so they work offline.
  // ---------------------------------------------------------------------------------------
  const placeOrder = async () => {
    if (!data?.shift || cart.length === 0 || !channelId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const orderId = uid();
      const placedAt = nowIso();
      const provisional = provisionalReceiptNo(
        device.deviceId,
        nextProvisionalCounter(device.deviceId),
      );
      const table = isDineIn ? tableId || null : null;
      const built = buildLocalOrder({
        orderId,
        lines: cart.map((c) => ({
          menuItemId: c.menuItemId,
          name: c.modifiersLabel ? `${c.name} — ${c.modifiersLabel}` : c.name,
          unitPricePoisha: c.unitPricePoisha,
          quantity: c.quantity,
          note: c.note || undefined,
        })),
        vat: data.vat,
        serviceChargeBps: serviceBps,
        channelId,
        tableId: table,
        placedAt,
        provisionalReceiptNo: provisional,
        makeLineId: uid,
      });
      const outcome = await enqueueAndFlush(orderId, {
        kind: 'submit_order',
        args: {
          orgId: device.orgId,
          branchId: device.branchId,
          orderId,
          idempotencyKey: uid(),
          deviceId: device.deviceId,
          staffId: staffSession.staffId,
          channelId,
          tableId: table,
          placedAt,
          lines: cartLines(),
          provisionalReceiptNo: provisional,
        },
      });
      if (outcome.state === 'refused') {
        setError(t('orderRefused'));
        return;
      }
      if (outcome.state === 'synced') {
        setOrder(outcome.result as OrderRow);
        setLines(await fetchOrderItems(sb, device.orgId, orderId).catch(() => built.lines));
        setLocal(false);
      } else {
        setOrder(built.order);
        setLines(built.lines);
        setLocal(true);
      }
      setPaid(0);
      setRefunded(0);
      setChange(0);
      setCart([]);
      setScreen('order');
    } finally {
      setBusy(false);
    }
  };

  const addRound = async () => {
    if (!order || cart.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await addOrderItems(sb, {
        orgId: device.orgId,
        branchId: device.branchId,
        orderId: order.id,
        batchKey: uid(),
        deviceId: device.deviceId,
        staffId: staffSession.staffId,
        lines: cartLines(),
      });
      setOrder(updated);
      setLines(await fetchOrderItems(sb, device.orgId, order.id));
      setCart([]);
      setCartMode({ kind: 'new' });
      setScreen('order');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const sendKitchen = async () => {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await enqueueAndFlush(order.id, {
        kind: 'send_to_kitchen',
        args: {
          orgId: device.orgId,
          branchId: device.branchId,
          orderId: order.id,
          deviceId: device.deviceId,
          staffId: staffSession.staffId,
        },
      });
      if (outcome.state === 'refused') {
        setError(t('actionRefused'));
        return;
      }
      const stamp = nowIso();
      setLines((prev) =>
        prev.map((l) =>
          l.status === 'active' && !l.kot_sent_at ? { ...l, kot_sent_at: stamp } : l,
        ),
      );
      setOrder((prev) =>
        prev && ['open', 'ready', 'served'].includes(prev.order_status)
          ? { ...prev, order_status: 'sent_to_kitchen' }
          : prev,
      );
    } finally {
      setBusy(false);
    }
  };

  const tender = async (method: PaymentMethod, amountPoisha: number): Promise<string | null> => {
    if (!order) return null;
    const check = applyTender({
      totalPoisha: order.total_poisha,
      paidPoisha: paid,
      method,
      amountPoisha,
    });
    if (!check.ok)
      return check.reason === 'over_balance'
        ? t('tenderOverBalance')
        : check.reason === 'nothing_due'
          ? t('nothingDue')
          : t('tenderInvalid');
    setBusy(true);
    try {
      const outcome = await enqueueAndFlush(order.id, {
        kind: 'record_payment',
        args: {
          orgId: device.orgId,
          branchId: device.branchId,
          orderId: order.id,
          method,
          amountPoisha,
          reference: null,
          idempotencyKey: uid(),
          deviceId: device.deviceId,
          staffId: staffSession.staffId,
        },
      });
      if (outcome.state === 'refused') return t('paymentRefused');
      setPaid(check.paidPoisha);
      setChange(check.changePoisha);
      if (outcome.state === 'synced') setOrder(outcome.result as OrderRow);
      else
        setOrder((prev) =>
          prev ? { ...prev, payment_status: check.fullyPaid ? 'paid' : 'partially_paid' } : prev,
        );
      if (check.fullyPaid) setScreen('receipt');
      return null;
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------------------------------
  // Online-only actions (ADR 0014): each needs the server, and most a manager approval.
  // ---------------------------------------------------------------------------------------
  const online_ = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(needsApproval(e) ? t('approvalRejected') : errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const doVoid = (line: OrderLine, reasonId: string, approvalId?: string) =>
    online_(async () => {
      if (!order) return;
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
      setOrder(updated);
      setLines(await fetchOrderItems(sb, device.orgId, order.id));
    });

  const doDiscount = (percentBps: number, reasonId: string, approvalId?: string) =>
    online_(async () => {
      if (!order) return;
      setOrder(
        await applyOrderDiscount(sb, {
          orgId: device.orgId,
          branchId: device.branchId,
          orderId: order.id,
          percentBps,
          reasonCodeId: reasonId,
          note: null,
          deviceId: device.deviceId,
          staffId: staffSession.staffId,
          approvalId,
        }),
      );
    });

  const doCancel = (reasonId: string, approvalId?: string) =>
    online_(async () => {
      if (!order) return;
      await cancelOrder(sb, {
        orgId: device.orgId,
        branchId: device.branchId,
        orderId: order.id,
        reasonCodeId: reasonId,
        note: null,
        deviceId: device.deviceId,
        staffId: staffSession.staffId,
        approvalId,
      });
      newOrder();
      setNotice(t('orderCancelled'));
    });

  const doAttachCustomer = (phone: string, name: string, consent: boolean) =>
    online_(async () => {
      if (!order) return;
      const customerId = await attachCustomer(sb, {
        orgId: device.orgId,
        branchId: device.branchId,
        orderId: order.id,
        phone,
        name: name.trim() || null,
        marketingConsent: consent,
        deviceId: device.deviceId,
        staffId: staffSession.staffId,
      });
      setOrder((prev) => (prev ? { ...prev, customer_id: customerId } : prev));
      setNotice(t('customerAdded'));
    });

  const doRefund = (amountPoisha: number, method: string, reasonId: string, approvalId: string) =>
    online_(async () => {
      if (!order) return;
      const updated = await refundOrder(sb, {
        orgId: device.orgId,
        branchId: device.branchId,
        orderId: order.id,
        method,
        amountPoisha,
        reasonCodeId: reasonId,
        note: null,
        idempotencyKey: uid(),
        deviceId: device.deviceId,
        staffId: staffSession.staffId,
        approvalId,
      });
      setOrder(updated);
      setRefunded((r) => r + amountPoisha);
      setChange(0);
      setNotice(t('refundDone', { amount: formatBDT(amountPoisha, locale) }));
    });

  // ---------------------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------------------
  function newOrder() {
    setCart([]);
    setCartMode({ kind: 'new' });
    setOrder(null);
    setLines([]);
    setLocal(false);
    setPaid(0);
    setRefunded(0);
    setChange(0);
    setError(null);
    setScreen('cart');
  }

  const loadRecent = async () => {
    setRecentLoading(true);
    try {
      setRecent(await fetchRecentOrders(sb, device.orgId, device.branchId));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRecentLoading(false);
    }
  };

  const openOrder = (o: OrderRow) =>
    online_(async () => {
      const [freshLines, money] = await Promise.all([
        fetchOrderItems(sb, device.orgId, o.id),
        fetchOrderMoney(sb, device.orgId, o.id),
      ]);
      setOrder(o);
      setLines(freshLines);
      setPaid(money.paidPoisha);
      setRefunded(money.refundedPoisha);
      setLocal(false);
      setChange(0);
      setCart([]);
      setCartMode({ kind: 'new' });
      const settled =
        o.order_status === 'cancelled' || !['unpaid', 'partially_paid'].includes(o.payment_status);
      setScreen(settled ? 'receipt' : 'order');
    });

  const switchStaff = async () => {
    // Queued work carries this cashier's id; send it while their session is still open.
    if (entries.length > 0) await flush().catch(() => undefined);
    onSwitchStaff();
  };

  // ---------------------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------------------
  const managers = useMemo(
    () => (data?.staff ?? []).filter((s) => s.role === 'manager' || s.role === 'owner'),
    [data],
  );
  const ctx: TillContextValue = useMemo(
    () => ({ sb, device, staffId: staffSession.staffId, managers, locale, online }),
    [sb, device, staffSession.staffId, managers, locale, online],
  );

  if (!data) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        {loadFailed ? (
          <Alert tone="danger">{t('firstLoadNeedsInternet')}</Alert>
        ) : (
          <p className="text-secondary">{tc('loading')}</p>
        )}
      </div>
    );
  }

  if (!data.shift) {
    return (
      <TillContext.Provider value={ctx}>
        <ShiftOpener
          staffId={staffSession.staffId}
          onOpened={updateShift}
          onSwitchStaff={() => void switchStaff()}
        />
      </TillContext.Provider>
    );
  }

  const pendingOrders = entries
    .filter((e) => e.op.kind === 'submit_order')
    .map((e) => ({
      orderId: e.orderId,
      provisionalReceiptNo: e.op.kind === 'submit_order' ? e.op.args.provisionalReceiptNo : null,
      placedAt: e.op.kind === 'submit_order' ? e.op.args.placedAt : e.createdAt,
    }));

  return (
    <TillContext.Provider value={ctx}>
      <div className="mx-auto flex h-dvh max-w-7xl flex-col gap-3 px-3 py-3">
        <header className="glass flex flex-wrap items-center justify-between gap-2 rounded-card px-4 py-2 sm:rounded-full">
          <span className="text-sm">
            <span className="font-semibold">{device.branchName}</span>
            <span className="text-secondary"> · {staffSession.staffName}</span>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <SyncStatus
              entries={entries}
              syncing={syncing}
              onSyncNow={() => void flush()}
              onDiscard={(id) => void outbox.discard(id)}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setScreen('orders');
                if (online) void loadRecent();
              }}
            >
              <History aria-hidden className="size-4" />
              {t('orders')}
            </Button>
            <ShiftCloser
              shift={data.shift}
              staffId={staffSession.staffId}
              blocked={entries.length > 0}
              onClosed={() => updateShift(null)}
            />
            <Button variant="ghost" size="sm" onClick={() => void switchStaff()}>
              <LogOut aria-hidden className="size-4" />
              {t('switchStaff')}
            </Button>
          </div>
        </header>
        {!online ? (
          <Alert tone="warning">{fromCache ? t('offlineCached') : t('offlineBanner')}</Alert>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}

        {screen === 'cart' ? (
          <CartScreen
            menu={data.menu}
            channels={data.channels}
            tables={data.tables}
            channelId={channelId}
            setChannelId={setChannelId}
            tableId={tableId}
            setTableId={setTableId}
            isDineIn={isDineIn}
            cart={cart}
            onAdd={addToCart}
            changeQty={changeQty}
            preview={preview}
            busy={busy}
            mode={cartMode}
            onSubmit={() => void (cartMode.kind === 'round' ? addRound() : placeOrder())}
            onCancelRound={() => {
              setCart([]);
              setCartMode({ kind: 'new' });
              setScreen('order');
            }}
          />
        ) : null}
        {screen === 'order' && order ? (
          <OrderScreen
            order={order}
            lines={lines}
            local={local}
            busy={busy}
            tableName={tableName(order.table_id)}
            receipt={data.receipt}
            voidReasons={data.voidReasons}
            discountReasons={data.discountReasons}
            onSendKitchen={() => void sendKitchen()}
            onVoid={(l, r, a) => void doVoid(l, r, a)}
            onDiscount={(p, r, a) => void doDiscount(p, r, a)}
            onCancel={(r, a) => void doCancel(r, a)}
            onAttachCustomer={(p, n, c) => void doAttachCustomer(p, n, c)}
            onAddRound={() => {
              setCart([]);
              setCartMode({ kind: 'round', orderLabel: orderLabel(order, t) });
              setScreen('cart');
            }}
            onCheckout={() => setScreen('checkout')}
            onNewOrder={newOrder}
          />
        ) : null}
        {screen === 'checkout' && order ? (
          <CheckoutScreen
            key={`${order.id}:${paid}`}
            order={order}
            paidPoisha={paid}
            busy={busy}
            onTender={tender}
            onBack={() => setScreen('order')}
          />
        ) : null}
        {screen === 'receipt' && order ? (
          <ReceiptScreen
            order={order}
            lines={lines}
            local={local}
            changePoisha={change}
            refundablePoisha={Math.max(0, paid - refunded)}
            tableName={tableName(order.table_id)}
            receipt={data.receipt}
            refundReasons={data.refundReasons}
            onNewOrder={newOrder}
            onRefund={(a, m, r, ap) => void doRefund(a, m, r, ap)}
          />
        ) : null}
        {screen === 'orders' ? (
          <OrdersScreen
            orders={recent}
            pending={pendingOrders}
            loading={recentLoading}
            tableName={tableName}
            onOpen={(o) => void openOrder(o)}
            onRefresh={() => void loadRecent()}
            onBack={() => setScreen(order ? 'order' : 'cart')}
          />
        ) : null}
      </div>
    </TillContext.Provider>
  );
}

function ShiftOpener({
  staffId,
  onOpened,
  onSwitchStaff,
}: {
  staffId: string;
  onOpened: (s: ShiftRow) => void;
  onSwitchStaff: () => void;
}) {
  const t = useTranslations('pos');
  const te = useTranslations('errors');
  const { sb, device, online } = useTill();
  const [float, setFloat] = useState('500');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto flex min-h-dvh max-w-xs flex-col justify-center gap-4 px-4">
      <div className="glass space-y-4 rounded-sheet p-6">
        <div>
          <h1 className="text-lg font-semibold">{t('shiftTitle')}</h1>
          <p className="mt-1 text-sm text-secondary">{t('shiftExplain')}</p>
        </div>
        {!online ? <Alert tone="warning">{t('needsInternet')}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div>
          <Label htmlFor="float">{t('openingFloat')}</Label>
          <Input
            id="float"
            inputMode="decimal"
            value={float}
            onChange={(e) => setFloat(e.target.value)}
          />
          <p className="mt-1 text-sm text-secondary">{t('floatHint')}</p>
        </div>
        <Button
          className="w-full"
          size="lg"
          disabled={busy || !online}
          onClick={() => {
            const poisha = parseTakaToPoisha(float);
            if (poisha === null || poisha < 0) return setError(te('invalidInput'));
            setBusy(true);
            openShift(sb, device.orgId, device.branchId, device.deviceId, staffId, poisha)
              .then(onOpened)
              .catch((e: unknown) =>
                setError(isNetworkError(e) ? t('needsInternet') : te('generic')),
              )
              .finally(() => setBusy(false));
          }}
        >
          {t('openShift')}
        </Button>
        <Button variant="ghost" className="w-full" onClick={onSwitchStaff}>
          {t('switchStaff')}
        </Button>
      </div>
    </div>
  );
}

function ShiftCloser({
  shift,
  staffId,
  blocked,
  onClosed,
}: {
  shift: ShiftRow;
  staffId: string;
  /** Payments still waiting to sync would make the expected cash wrong, so closing waits for them. */
  blocked: boolean;
  onClosed: () => void;
}) {
  const t = useTranslations('pos');
  const te = useTranslations('errors');
  const { sb, device, online, locale } = useTill();
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [needsMgr, setNeedsMgr] = useState(false);
  const [result, setResult] = useState<ShiftRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attempt = async (approvalId?: string) => {
    const poisha = parseTakaToPoisha(counted);
    if (poisha === null || poisha < 0) return setError(te('invalidInput'));
    setError(null);
    try {
      setResult(
        await closeShift(
          sb,
          device.orgId,
          device.branchId,
          shift.id,
          poisha,
          device.deviceId,
          staffId,
          approvalId,
        ),
      );
    } catch (e) {
      if (needsApproval(e) && !approvalId) setNeedsMgr(true);
      else setError(isNetworkError(e) ? t('needsInternet') : te('generic'));
    }
  };

  const close = () => {
    setOpen(false);
    setNeedsMgr(false);
    setError(null);
    if (result) onClosed();
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={!online || blocked}
        title={blocked ? t('syncBeforeClose') : undefined}
        onClick={() => setOpen(true)}
      >
        {t('closeShift')}
      </Button>
      {open ? (
        <DialogShell title={t('closeShift')} onClose={close}>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {result ? (
            <>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-secondary">{t('expectedCash')}</dt>
                  <dd className="tabular-nums">
                    {formatBDT(result.expected_cash_poisha ?? 0, locale)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-secondary">{t('countedCash')}</dt>
                  <dd className="tabular-nums">
                    {formatBDT(result.counted_cash_poisha ?? 0, locale)}
                  </dd>
                </div>
                <div className="flex justify-between font-bold">
                  <dt>{t('overShort')}</dt>
                  <dd
                    className={`tabular-nums ${(result.over_short_poisha ?? 0) === 0 ? 'text-success' : 'text-danger'}`}
                  >
                    {formatBDT(result.over_short_poisha ?? 0, locale)}
                  </dd>
                </div>
              </dl>
              {(result.over_short_poisha ?? 0) !== 0 ? (
                <Alert tone="warning">{t('discrepancyFlagged')}</Alert>
              ) : (
                <Alert tone="success">{t('drawerBalanced')}</Alert>
              )}
              <Button className="w-full" onClick={close}>
                {t('done')}
              </Button>
            </>
          ) : needsMgr ? (
            <ManagerApprovalStep action="close_shift" onApproved={(id) => void attempt(id)} />
          ) : (
            <>
              <div>
                <Label htmlFor="counted">{t('countedCash')}</Label>
                <Input
                  id="counted"
                  inputMode="decimal"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                />
              </div>
              <Button className="w-full" onClick={() => void attempt()}>
                {t('closeShift')}
              </Button>
            </>
          )}
        </DialogShell>
      ) : null}
    </>
  );
}
