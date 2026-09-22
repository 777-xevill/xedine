'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/db/supabase-browser';
import { PairingScreen, StaffGate } from '@/modules/pos/PosApp';
import {
  getDevice,
  getStaffSession,
  setDevice,
  setStaffSession,
  type DeviceState,
} from '@/modules/pos/device-storage';
import { now } from '@/lib/time/clock';
import {
  advanceOrderStatus,
  fetchActiveOrders,
  subscribeKds,
  type KdsLine,
  type KdsOrder,
} from './client';

const NEXT_LABEL: Record<string, 'start' | 'ready' | 'served'> = {
  sent_to_kitchen: 'start',
  preparing: 'ready',
  ready: 'served',
};

const ticketAge = (placedAt: string) =>
  Math.max(0, Math.round((now().getTime() - Date.parse(placedAt)) / 60_000));

/** Kitchen Display: oldest-first, two-tap, dark by construction (KDS has no light variant). */
export function KdsApp() {
  const t = useTranslations('kds');
  const sb = useMemo(() => createClient(), []);
  // Client-only mount (page.tsx uses next/dynamic, ssr: false) — safe to read localStorage eagerly.
  const [device, setDeviceState] = useState<DeviceState | null>(() => getDevice());
  const [staffSession, setStaffSessionState] = useState<{
    sessionId: string;
    staffId: string;
    staffName: string;
  } | null>(() => getStaffSession());

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
  return <Board sb={sb} device={device} staffId={staffSession.staffId} t={t} />;
}

function Board({
  sb,
  device,
  staffId,
  t,
}: {
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  staffId: string;
  t: ReturnType<typeof useTranslations<'kds'>>;
}) {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [lines, setLines] = useState<KdsLine[]>([]);
  const [stations, setStations] = useState<{ id: string; name: string }[]>([]);
  const [stationFilter, setStationFilter] = useState<string | 'all'>('all');
  const [, forceTick] = useState(0);

  const refresh = () =>
    void fetchActiveOrders(sb, device.orgId, device.branchId).then(({ orders: o, lines: l }) => {
      setOrders(o);
      setLines(l);
    });

  useEffect(() => {
    refresh();
    void sb
      .from('stations')
      .select('id, name')
      .eq('org_id', device.orgId)
      .eq('branch_id', device.branchId)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setStations(data ?? []));
    const channel = subscribeKds(sb, device.orgId, device.branchId, refresh);
    const tick = setInterval(() => forceTick((n) => n + 1), 30_000); // refresh ticket-age labels
    return () => {
      void sb.removeChannel(channel);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is stable enough for this effect's lifetime
  }, [sb, device]);

  const filteredLines =
    stationFilter === 'all' ? lines : lines.filter((l) => l.station_id === stationFilter);
  const orderIdsWithLines = new Set(filteredLines.map((l) => l.order_id));
  const visibleOrders = orders.filter((o) => orderIdsWithLines.has(o.id)); // already oldest-first (query ORDER BY placed_at)

  const advance = (orderId: string) =>
    void advanceOrderStatus(
      sb,
      device.orgId,
      device.branchId,
      orderId,
      device.deviceId,
      staffId,
    ).then(refresh);

  return (
    <div className="min-h-dvh bg-background p-3">
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStationFilter('all')}
          className={`min-h-9 rounded-input border px-3 text-sm ${stationFilter === 'all' ? 'border-cyan text-cyan' : 'border-line text-secondary'}`}
        >
          {t('allStations')}
        </button>
        {stations.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStationFilter(s.id)}
            className={`min-h-9 rounded-input border px-3 text-sm ${stationFilter === s.id ? 'border-cyan text-cyan' : 'border-line text-secondary'}`}
          >
            {s.name}
          </button>
        ))}
      </div>
      {visibleOrders.length === 0 ? (
        <p className="mt-8 text-center text-secondary">{t('noTickets')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {visibleOrders.map((o) => {
            const items = filteredLines.filter((l) => l.order_id === o.id);
            const age = ticketAge(o.placed_at);
            const urgent = age >= 15;
            const action = NEXT_LABEL[o.order_status];
            return (
              <div
                key={o.id}
                className={`rounded-card border p-3 ${urgent ? 'border-danger' : 'border-line'} bg-surface`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-xs text-secondary">{o.id.slice(0, 8)}</span>
                  <span className={urgent ? 'text-danger' : 'text-secondary'}>
                    {t('sentAgo', { minutes: age })}
                  </span>
                </div>
                <ul className="mb-3 space-y-1">
                  {items.map((l) => (
                    <li key={l.id} className="text-sm">
                      <span className="font-semibold">{l.quantity}×</span> {l.name_snapshot}
                      {l.notes ? (
                        <span className="block text-xs text-secondary">{l.notes}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {action ? (
                  <Button className="w-full" onClick={() => advance(o.id)}>
                    {t(action)}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
