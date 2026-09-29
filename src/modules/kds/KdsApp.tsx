'use client';

import { Clock3, LogOut, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/db/supabase-browser';
import { now } from '@/lib/time/clock';
import { endStaffSession } from '@/modules/pos/client';
import {
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

/** Minutes since a ticket (or its latest round) reached the kitchen. */
const minutesSince = (iso: string) =>
  Math.max(0, Math.floor((now().getTime() - Date.parse(iso)) / 60_000));

/** Kitchen Display: oldest-first, two-tap, dark by construction (KDS has no light variant). */
export function KdsApp() {
  const sb = useMemo(() => createClient(), []);
  // Client-only mount (page.tsx uses next/dynamic, ssr: false) — safe to read localStorage eagerly.
  const [device, setDeviceState] = useState<DeviceState | null>(() => getDevice());
  const [staffSession, setStaffSessionState] = useState<StaffSessionState | null>(() =>
    getStaffSession(),
  );

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
        onSignedIn={(s) => {
          setStaffSession(s);
          setStaffSessionState(s);
        }}
      />
    );
  return (
    <Board
      sb={sb}
      device={device}
      staff={staffSession}
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
}: {
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  staff: StaffSessionState;
  onSwitchStaff: () => void;
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

  return (
    <div className="min-h-dvh p-3">
      <header className="glass mb-3 flex flex-wrap items-center justify-between gap-2 rounded-full px-4 py-2">
        <span className="text-sm">
          <span className="font-semibold">{device.branchName}</span>
          <span className="text-secondary"> · {staff.staffName}</span>
        </span>
        <nav aria-label={t('stations')} className="flex flex-wrap gap-1.5">
          {[{ id: 'all', name: t('allStations') }, ...lookups.stations].map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={stationFilter === s.id}
              onClick={() => setStationFilter(s.id)}
              className={`min-h-10 rounded-full border px-4 text-sm font-medium transition ${
                stationFilter === s.id
                  ? 'border-purple bg-surface-elevated text-foreground'
                  : 'glass-tile text-secondary'
              }`}
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
        <WasteDialog sb={sb} device={device} staff={staff} onClose={() => setWasteOpen(false)} />
      ) : null}
      {error ? <Alert tone="warning">{error}</Alert> : null}

      {tickets.length === 0 ? (
        <p className="mt-16 text-center text-lg text-secondary">{t('noTickets')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tickets.map(({ order: o, lines: ls, sentAt }) => {
            const age = minutesSince(sentAt);
            const late = age >= 15;
            const action = NEXT_LABEL[o.order_status];
            const table = tableName(o.table_id);
            return (
              <article
                key={o.id}
                className={`glass flex flex-col rounded-card p-4 ${late ? 'border-danger/70' : ''}`}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xl font-bold">
                      {o.order_number !== null
                        ? tp('orderNumber', { number: o.order_number })
                        : o.id.slice(0, 8)}
                    </p>
                    <p className="text-sm text-secondary">{table ?? channelName(o.channel_id)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`inline-flex items-center gap-1 text-sm font-semibold tabular-nums ${late ? 'text-danger' : 'text-secondary'}`}
                    >
                      <Clock3 aria-hidden className="size-4" />
                      {t('sentAgo', { minutes: age })}
                    </span>
                    <span className="text-xs text-muted">
                      {tp(`orderStatus.${o.order_status}`)}
                    </span>
                  </div>
                </div>
                <ul className="mb-3 flex-1 space-y-1.5">
                  {ls.map((l) => (
                    <li
                      key={l.id}
                      className={l.status === 'voided' ? 'text-muted line-through' : ''}
                    >
                      <span className="text-lg font-bold tabular-nums">{l.quantity}×</span>{' '}
                      <span className="text-base">{l.name_snapshot}</span>
                      {l.status === 'voided' ? (
                        <span className="ms-1 text-xs font-semibold text-danger no-underline">
                          {t('voided')}
                        </span>
                      ) : null}
                      {l.notes ? (
                        <span className="block text-sm text-warning">{l.notes}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {action ? (
                  <Button
                    size="lg"
                    className="w-full"
                    disabled={busyOrder === o.id}
                    onClick={() => advance(o.id)}
                  >
                    {t(action)}
                  </Button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
