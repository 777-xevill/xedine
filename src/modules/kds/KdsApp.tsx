'use client';

import {
  AlarmClock,
  Bike,
  CheckCircle2,
  ChefHat,
  CircleDashed,
  Clock3,
  Flame,
  LogOut,
  ShoppingBag,
  StickyNote,
  Store,
  Trash2,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/db/supabase-browser';
import { now } from '@/lib/time/clock';
import { endStaffSession } from '@/modules/pos/client';
import {
  clearDevice,
  clearStaffSession,
  getDevice,
  getStaffSession,
  setDevice,
  setStaffSession,
  type DeviceState,
  type StaffSessionState,
} from '@/modules/pos/device-storage';
import { PairingScreen, StaffGate } from '@/modules/pos/gate';
import {
  advanceOrderStatus,
  fetchActiveOrders,
  fetchKdsLookups,
  subscribeKds,
  type KdsLine,
  type KdsOrder,
} from './client';
import { WasteDialog } from './WasteDialog';

const NEXT_LABEL: Record<string, 'start' | 'ready' | 'served'> = {
  sent_to_kitchen: 'start',
  preparing: 'ready',
  ready: 'served',
};

/** Presentation only: from this age the clock is tinted yellow (late, at 15, is unchanged). */
const WARN_MINUTES = 10;

/** Icons beside the status words (never colour alone, BRAND.md). */
const STATUS_ICON: Record<string, LucideIcon> = {
  sent_to_kitchen: CircleDashed,
  preparing: Flame,
  ready: CheckCircle2,
};
/** Where the food goes, at a glance: a table, a bag to take away, a rider. */
const KIND_ICON: Record<string, LucideIcon> = {
  dine_in: Utensils,
  takeaway: ShoppingBag,
  own_delivery: Bike,
  foodpanda: Bike,
  pathao_food: Bike,
};

/** Minutes since a ticket (or its latest round) reached the kitchen. */
const minutesSince = (iso: string) =>
  Math.max(0, Math.floor((now().getTime() - Date.parse(iso)) / 60_000));

/** Kitchen Display: oldest-first, two-tap, dark by construction (KDS has no light variant). */
export function KdsApp() {
  const sb = useMemo(() => createClient(), []);
  const tp = useTranslations('pos');
  // Client-only mount (page.tsx uses next/dynamic, ssr: false) — safe to read localStorage eagerly.
  const [device, setDeviceState] = useState<DeviceState | null>(() => getDevice());
  const [staffSession, setStaffSessionState] = useState<StaffSessionState | null>(() =>
    getStaffSession(),
  );
  // Set when the database has ended the cook's session (it lasts 12 hours) while the screen still held it.
  const [expired, setExpired] = useState(false);

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
  if (!staffSession)
    return (
      <StaffGate
        sb={sb}
        device={device}
        notice={expired ? tp('sessionExpired') : null}
        onSignedIn={(s) => {
          setExpired(false);
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
  return (
    <Board
      sb={sb}
      device={device}
      staff={staffSession}
      onSessionExpired={() => {
        clearStaffSession();
        setStaffSessionState(null);
        setExpired(true);
      }}
      onSwitchStaff={() => {
        void endStaffSession(sb, staffSession.sessionId).catch(() => undefined);
        clearStaffSession();
        setStaffSessionState(null);
      }}
    />
  );
}

interface Ticket {
  order: KdsOrder;
  lines: KdsLine[];
  /** The latest round's send time: a new round restarts the ticket's clock. */
  sentAt: string;
}

function Board({
  sb,
  device,
  staff,
  onSwitchStaff,
  onSessionExpired,
}: {
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  staff: StaffSessionState;
  onSwitchStaff: () => void;
  onSessionExpired: () => void;
}) {
  const t = useTranslations('kds');
  const tp = useTranslations('pos');
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [lines, setLines] = useState<KdsLine[]>([]);
  const [lookups, setLookups] = useState<Awaited<ReturnType<typeof fetchKdsLookups>>>({
    stations: [],
    tables: [],
    channels: [],
  });
  const [stationFilter, setStationFilter] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [wasteOpen, setWasteOpen] = useState(false);
  const [, setTick] = useState(0);

  const refresh = useCallback(() => {
    fetchActiveOrders(sb, device.orgId, device.branchId)
      .then(({ orders: o, lines: l }) => {
        setOrders(o);
        setLines(l);
        setError(null);
      })
      .catch(() => setError(tp('needsInternet')));
  }, [sb, device.orgId, device.branchId, tp]);

  useEffect(() => {
    const first = window.setTimeout(refresh, 0);
    fetchKdsLookups(sb, device.orgId, device.branchId)
      .then(setLookups)
      .catch(() => undefined);
    const channel = subscribeKds(sb, device.orgId, device.branchId, refresh);
    // Realtime can drop silently on bad Wi-Fi; a slow poll keeps the pass honest either way.
    const poll = window.setInterval(() => {
      setTick((n) => n + 1);
      refresh();
    }, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(poll);
      void sb.removeChannel(channel);
    };
  }, [sb, device.orgId, device.branchId, refresh]);

  const tickets: Ticket[] = useMemo(() => {
    const byOrder = new Map<string, KdsLine[]>();
    for (const l of lines) {
      if (stationFilter !== 'all' && l.station_id !== stationFilter) continue;
      const arr = byOrder.get(l.order_id) ?? [];
      arr.push(l);
      byOrder.set(l.order_id, arr);
    }
    return orders
      .filter((o) => (byOrder.get(o.id) ?? []).some((l) => l.status === 'active'))
      .map((o) => {
        const ls = byOrder.get(o.id)!;
        const sentAt = ls.reduce((max, l) => (l.kot_sent_at > max ? l.kot_sent_at : max), '');
        return { order: o, lines: ls, sentAt };
      })
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  }, [orders, lines, stationFilter]);

  const advance = (orderId: string) => {
    setBusyOrder(orderId);
    advanceOrderStatus(sb, device.orgId, device.branchId, orderId, device.deviceId, staff.staffId)
      .then(refresh)
      .catch(() => setError(tp('actionRefused')))
      .finally(() => setBusyOrder(null));
  };

  const tableName = (id: string | null) => lookups.tables.find((x) => x.id === id)?.name ?? null;
  const channelName = (id: string) => lookups.channels.find((x) => x.id === id)?.name ?? '';
  const channelKind = (id: string) => lookups.channels.find((x) => x.id === id)?.kind ?? '';

  return (
    <div className="min-h-dvh p-3">
      <header className="till-pane mb-3 flex flex-wrap items-center justify-between gap-2 rounded-card py-2 ps-4 pe-2 sm:rounded-full">
        <span className="text-sm">
          <span className="font-semibold">{device.branchName}</span>
          <span className="text-secondary"> · {staff.staffName}</span>
        </span>
        <nav aria-label={t('stations')} className="flex flex-wrap gap-2">
          {[{ id: 'all', name: t('allStations') }, ...lookups.stations].map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={stationFilter === s.id}
              onClick={() => setStationFilter(s.id)}
              className="till-chip"
            >
              {s.name}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => setWasteOpen(true)}>
            <Trash2 aria-hidden className="size-4" />
            {t('wasteButton')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onSwitchStaff}>
            <LogOut aria-hidden className="size-4" />
            {tp('switchStaff')}
          </Button>
        </div>
      </header>
      {wasteOpen ? (
        <WasteDialog
          sb={sb}
          device={device}
          staff={staff}
          onSessionExpired={onSessionExpired}
          onClose={() => setWasteOpen(false)}
        />
      ) : null}
      {error ? <Alert tone="warning">{error}</Alert> : null}

      {tickets.length === 0 ? (
        <div className="till-enter mt-24 flex flex-col items-center gap-4 text-center">
          <span
            aria-hidden
            className="till-raised flex size-20 items-center justify-center rounded-full"
          >
            <ChefHat className="size-9 text-muted" />
          </span>
          <p className="text-xl font-semibold text-secondary">{t('noTickets')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tickets.map(({ order: o, lines: ls, sentAt }) => {
            const age = minutesSince(sentAt);
            const late = age >= 15;
            // Presentation only: the clock is tinted yellow a little before the ticket counts as late.
            const ageState = late ? 'late' : age >= WARN_MINUTES ? 'warn' : 'fresh';
            const action = NEXT_LABEL[o.order_status];
            const table = tableName(o.table_id);
            const StatusIcon = STATUS_ICON[o.order_status] ?? CircleDashed;
            const PlaceIcon = table ? Utensils : (KIND_ICON[channelKind(o.channel_id)] ?? Store);
            return (
              <article
                key={o.id}
                data-age={ageState}
                data-status={o.order_status}
                className="till-ticket till-pane flex flex-col rounded-card"
              >
                <div className="till-band flex items-start justify-between gap-2 px-4 pt-3.5 pb-3">
                  <div className="min-w-0">
                    <p className="text-2xl leading-tight font-bold tracking-[-0.03em]">
                      {o.order_number !== null
                        ? tp('orderNumber', { number: o.order_number })
                        : o.id.slice(0, 8)}
                    </p>
                    <p className="mt-1 inline-flex items-center gap-1.5 text-base font-semibold text-secondary">
                      <PlaceIcon aria-hidden className="size-4 shrink-0 text-muted" />
                      {table ?? channelName(o.channel_id)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span key={ageState} className="till-age till-nudge">
                      {late ? (
                        <AlarmClock aria-hidden className="size-4" />
                      ) : (
                        <Clock3 aria-hidden className="size-4" />
                      )}
                      {t('sentAgo', { minutes: age })}
                    </span>
                    <span
                      key={o.order_status}
                      className="till-swap inline-flex items-center gap-1 text-xs font-medium text-secondary"
                    >
                      <StatusIcon aria-hidden className="size-3.5" />
                      {tp(`orderStatus.${o.order_status}`)}
                    </span>
                  </div>
                </div>
                <ul className="flex-1 space-y-2 px-4 py-3">
                  {ls.map((l) => (
                    <li
                      key={l.id}
                      className={`till-line flex items-baseline gap-2.5 ${l.status === 'voided' ? 'text-muted line-through' : ''}`}
                    >
                      <span className="min-w-9 shrink-0 text-xl font-bold tabular-nums">
                        {l.quantity}×
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-lg leading-snug font-medium">{l.name_snapshot}</span>
                        {l.status === 'voided' ? (
                          <span className="ms-2 inline-block rounded-full bg-danger px-2 py-0.5 align-middle text-[0.6875rem] font-bold text-on-action no-underline">
                            {t('voided')}
                          </span>
                        ) : null}
                        {l.notes ? (
                          <span className="mt-1 flex w-fit items-center gap-1.5 rounded-lg border border-warning/35 bg-warning/10 px-2 py-0.5 text-sm font-medium text-warning no-underline">
                            <StickyNote aria-hidden className="size-3.5 shrink-0" />
                            {l.notes}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                {action ? (
                  <div className="px-4 pb-4">
                    <Button
                      size="lg"
                      className="w-full text-[1.0625rem]"
                      disabled={busyOrder === o.id}
                      onClick={() => advance(o.id)}
                    >
                      <span key={action} className="till-swap">
                        {t(action)}
                      </span>
                    </Button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
