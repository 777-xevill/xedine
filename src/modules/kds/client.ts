'use client';

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export interface KdsOrder {
  id: string;
  order_status: string;
  order_number: number | null;
  table_id: string | null;
  channel_id: string;
  placed_at: string;
}
export interface KdsLine {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name_snapshot: string;
  quantity: number;
  status: 'active' | 'voided';
  station_id: string | null;
  notes: string | null;
  kot_sent_at: string;
}

const ACTIVE_STATUSES = ['sent_to_kitchen', 'preparing', 'ready'];

/**
 * Tickets on the pass: orders the kitchen still owns, and only the lines that were actually sent.
 * Voided lines stay (struck through) so the cook knows to stop making them.
 */
export async function fetchActiveOrders(sb: SupabaseClient, orgId: string, branchId: string) {
  const { data: orders, error: oe } = await sb
    .from('orders')
    .select('id, order_status, order_number, table_id, channel_id, placed_at')
    .eq('org_id', orgId)
    .eq('branch_id', branchId)
    .in('order_status', ACTIVE_STATUSES)
    .order('placed_at');
  if (oe) throw oe;
  const orderIds = (orders ?? []).map((o) => o.id as string);
  const { data: lines, error: le } =
    orderIds.length > 0
      ? await sb
          .from('order_items')
          .select(
            'id, order_id, menu_item_id, name_snapshot, quantity, status, station_id, notes, kot_sent_at',
          )
          .eq('org_id', orgId)
          .in('order_id', orderIds)
          .not('kot_sent_at', 'is', null)
          .order('created_at')
      : { data: [] as KdsLine[], error: null };
  if (le) throw le;
  return { orders: (orders ?? []) as KdsOrder[], lines: (lines ?? []) as KdsLine[] };
}

export async function fetchKdsLookups(sb: SupabaseClient, orgId: string, branchId: string) {
  const [stations, tables, channels] = await Promise.all([
    sb
      .from('stations')
      .select('id, name')
      .eq('org_id', orgId)
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('sort_order'),
    sb.from('dining_tables').select('id, name').eq('org_id', orgId).eq('branch_id', branchId),
    sb.from('channels').select('id, name, kind').eq('org_id', orgId),
  ]);
  for (const r of [stations, tables, channels]) if (r.error) throw r.error;
  return {
    stations: (stations.data ?? []) as { id: string; name: string }[],
    tables: (tables.data ?? []) as { id: string; name: string }[],
    channels: (channels.data ?? []) as { id: string; name: string; kind: string }[],
  };
}

export async function advanceOrderStatus(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
  orderId: string,
  deviceId: string,
  staffId: string,
) {
  const { data, error } = await sb.rpc('advance_order_status', {
    p_org: orgId,
    p_branch: branchId,
    p_order: orderId,
    p_device: deviceId,
    p_staff: staffId,
  });
  if (error) throw error;
  return data as string;
}

/** Realtime: re-fetch on any order/order_item change for this branch rather than diffing events by hand. */
export function subscribeKds(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
  onChange: () => void,
): RealtimeChannel {
  return sb
    .channel(`kds:${orgId}:${branchId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_items', filter: `branch_id=eq.${branchId}` },
      onChange,
    )
    .subscribe();
}
