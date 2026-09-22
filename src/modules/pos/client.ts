'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/db/supabase-browser';

/** Typed wrappers over the Phase 1 RPCs and reads the POS/KDS surfaces need (ADR 0013). */

export interface Branch {
  id: string;
  name: string;
}
export interface StaffMember {
  id: string;
  display_name: string;
  role: string;
}
export interface Channel {
  id: string;
  name: string;
  kind: string;
}
export interface DiningTable {
  id: string;
  name: string;
}
export interface Station {
  id: string;
  name: string;
}
export interface ReasonCode {
  id: string;
  code: string;
  label: string;
  label_bn: string | null;
}
export interface MenuModifier {
  id: string;
  name: string;
  name_bn: string | null;
  price_poisha: number;
}
export interface ModifierGroup {
  id: string;
  name: string;
  name_bn: string | null;
  min_select: number;
  max_select: number;
  modifiers: MenuModifier[];
}
export interface MenuItem {
  id: string;
  category_id: string | null;
  name: string;
  name_bn: string | null;
  base_price_poisha: number;
  branch_price_poisha: number | null;
  is_available: boolean;
  is_combo: boolean;
  modifier_groups: ModifierGroup[];
}
export interface MenuCategory {
  id: string;
  name: string;
  name_bn: string | null;
  items: MenuItem[];
}

export interface OrderRow {
  id: string;
  order_status: string;
  payment_status: string;
  invoice_no: string | null;
  provisional_receipt_no: string | null;
  net_poisha: number;
  vat_poisha: number;
  service_charge_poisha: number;
  discount_poisha: number;
  total_poisha: number;
  channel_id: string;
  table_id: string | null;
  placed_at: string;
}

export interface OrderLine {
  id: string;
  menu_item_id: string | null;
  name_snapshot: string;
  quantity: number;
  unit_price_poisha: number;
  total_poisha: number;
  status: 'active' | 'voided';
  kot_sent_at: string | null;
  station_id: string | null;
  notes: string | null;
}

export interface ShiftRow {
  id: string;
  status: 'open' | 'closed';
  opening_float_poisha: number;
  expected_cash_poisha: number | null;
  counted_cash_poisha: number | null;
  over_short_poisha: number | null;
  opened_at: string;
}

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));

export async function fetchBranches(sb: SupabaseClient, orgId: string): Promise<Branch[]> {
  const { data, error } = await sb
    .from('branches')
    .select('id, name')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function registerAndClaimDevice(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
  name: string,
): Promise<string> {
  const { data: reg, error: e1 } = await sb.rpc('register_device', {
    p_org: orgId,
    p_branch: branchId,
    p_name: name,
  });
  if (e1) throw e1;
  const { device_id, pairing_code } = reg as { device_id: string; pairing_code: string };
  const { data: ok, error: e2 } = await sb.rpc('claim_device', {
    p_device: device_id,
    p_code: pairing_code,
  });
  if (e2) throw e2;
  if (!ok) throw new Error('device pairing failed');
  return device_id;
}

export async function fetchActiveStaff(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
): Promise<StaffMember[]> {
  const { data, error } = await sb
    .from('staff')
    .select('id, display_name, role')
    .eq('org_id', orgId)
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('display_name');
  if (error) throw error;
  return data ?? [];
}

export type StaffSessionResult =
  | { ok: true; session_id: string }
  | { ok: false; reason: string; attempts_left?: number; locked_until?: string };

export async function startStaffSession(
  sb: SupabaseClient,
  deviceId: string,
  staffId: string,
  pin: string,
): Promise<StaffSessionResult> {
  const { data, error } = await sb.rpc('start_staff_session', {
    p_device: deviceId,
    p_staff: staffId,
    p_pin: pin,
  });
  if (error) throw error;
  return data as StaffSessionResult;
}

export async function endStaffSession(sb: SupabaseClient, sessionId: string): Promise<void> {
  const { error } = await sb.rpc('end_staff_session', { p_session: sessionId });
  if (error) throw error;
}

export async function fetchChannels(sb: SupabaseClient, orgId: string): Promise<Channel[]> {
  const { data, error } = await sb
    .from('channels')
    .select('id, name, kind')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function fetchTables(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
): Promise<DiningTable[]> {
  const { data, error } = await sb
    .from('dining_tables')
    .select('id, name')
    .eq('org_id', orgId)
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function fetchStations(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
): Promise<Station[]> {
  const { data, error } = await sb
    .from('stations')
    .select('id, name')
    .eq('org_id', orgId)
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

export async function fetchReasonCodes(
  sb: SupabaseClient,
  orgId: string,
  kind: 'void' | 'discount',
): Promise<ReasonCode[]> {
  const { data, error } = await sb
    .from('reason_codes')
    .select('id, code, label, label_bn')
    .eq('org_id', orgId)
    .eq('kind', kind)
    .eq('is_active', true)
    .order('label');
  if (error) throw error;
  return data ?? [];
}

/** The branch menu, shaped for the POS grid: categories -> items -> modifier groups -> modifiers. */
export async function fetchMenu(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
): Promise<MenuCategory[]> {
  const [{ data: categories, error: ce }, { data: items, error: ie }, { data: prices, error: pe }] =
    await Promise.all([
      sb
        .from('menu_categories')
        .select('id, name, name_bn, sort_order')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('sort_order'),
      sb
        .from('menu_items')
        .select('id, category_id, name, name_bn, base_price_poisha, is_combo, is_active')
        .eq('org_id', orgId)
        .eq('is_active', true),
      sb
        .from('branch_item_prices')
        .select('menu_item_id, variant_id, price_poisha, is_available')
        .eq('org_id', orgId)
        .eq('branch_id', branchId),
    ]);
  if (ce) throw ce;
  if (ie) throw ie;
  if (pe) throw pe;

  const itemIds = (items ?? []).map((i) => i.id as string);
  const { data: groupLinks, error: gle } =
    itemIds.length > 0
      ? await sb
          .from('menu_item_modifier_groups')
          .select('menu_item_id, modifier_group_id')
          .in('menu_item_id', itemIds)
      : { data: [] as { menu_item_id: string; modifier_group_id: string }[], error: null };
  if (gle) throw gle;
  const groupIds = [...new Set((groupLinks ?? []).map((g) => g.modifier_group_id as string))];
  const [{ data: groups, error: ge }, { data: mods, error: me }] = await Promise.all([
    groupIds.length > 0
      ? sb
          .from('modifier_groups')
          .select('id, name, name_bn, min_select, max_select')
          .in('id', groupIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            name: string;
            name_bn: string | null;
            min_select: number;
            max_select: number;
          }[],
          error: null,
        }),
    groupIds.length > 0
      ? sb
          .from('modifiers')
          .select('id, group_id, name, name_bn, price_poisha')
          .in('group_id', groupIds)
          .eq('is_active', true)
          .order('sort_order')
      : Promise.resolve({
          data: [] as {
            id: string;
            group_id: string;
            name: string;
            name_bn: string | null;
            price_poisha: number;
          }[],
          error: null,
        }),
  ]);
  if (ge) throw ge;
  if (me) throw me;

  const priceByItem = new Map<string, { price: number; available: boolean }>();
  for (const p of prices ?? []) {
    if (p.variant_id) continue; // Phase 1 UI: base-item pricing only; variants use the item's own price map later.
    priceByItem.set(p.menu_item_id as string, {
      price: n(p.price_poisha),
      available: p.is_available as boolean,
    });
  }
  const modsByGroup = new Map<string, MenuModifier[]>();
  for (const m of mods ?? []) {
    const arr = modsByGroup.get(m.group_id as string) ?? [];
    arr.push({
      id: m.id as string,
      name: m.name as string,
      name_bn: m.name_bn as string | null,
      price_poisha: n(m.price_poisha),
    });
    modsByGroup.set(m.group_id as string, arr);
  }
  const groupsByItem = new Map<string, ModifierGroup[]>();
  for (const link of groupLinks ?? []) {
    const g = (groups ?? []).find((x) => x.id === link.modifier_group_id);
    if (!g) continue;
    const arr = groupsByItem.get(link.menu_item_id as string) ?? [];
    arr.push({
      id: g.id,
      name: g.name,
      name_bn: g.name_bn,
      min_select: g.min_select,
      max_select: g.max_select,
      modifiers: modsByGroup.get(g.id) ?? [],
    });
    groupsByItem.set(link.menu_item_id as string, arr);
  }

  const itemsByCategory = new Map<string | null, MenuItem[]>();
  for (const it of items ?? []) {
    const branchPrice = priceByItem.get(it.id as string);
    const entry: MenuItem = {
      id: it.id as string,
      category_id: it.category_id as string | null,
      name: it.name as string,
      name_bn: it.name_bn as string | null,
      base_price_poisha: n(it.base_price_poisha),
      branch_price_poisha: branchPrice ? branchPrice.price : null,
      is_available: branchPrice ? branchPrice.available : true,
      is_combo: it.is_combo as boolean,
      modifier_groups: groupsByItem.get(it.id as string) ?? [],
    };
    const key = it.category_id as string | null;
    const arr = itemsByCategory.get(key) ?? [];
    arr.push(entry);
    itemsByCategory.set(key, arr);
  }

  return (categories ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    name_bn: c.name_bn as string | null,
    items: itemsByCategory.get(c.id as string) ?? [],
  }));
}

export interface CartLine {
  menu_item_id: string;
  quantity: number;
  modifier_ids?: string[];
  note?: string;
}

export async function submitOrder(
  sb: SupabaseClient,
  args: {
    orgId: string;
    branchId: string;
    orderId: string;
    idempotencyKey: string;
    deviceId: string;
    staffId: string;
    channelId: string;
    tableId: string | null;
    lines: CartLine[];
  },
): Promise<OrderRow> {
  const { data, error } = await sb
    .rpc('submit_order', {
      p_org: args.orgId,
      p_branch: args.branchId,
      p_order_id: args.orderId,
      p_idempotency_key: args.idempotencyKey,
      p_device: args.deviceId,
      p_staff: args.staffId,
      p_channel: args.channelId,
      p_table: args.tableId,
      p_guests: null,
      p_placed_at: null,
      p_lines: args.lines,
    })
    .single();
  if (error) throw error;
  return data as OrderRow;
}

export async function sendToKitchen(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
  orderId: string,
  deviceId: string,
  staffId: string,
) {
  const { error } = await sb.rpc('send_to_kitchen', {
    p_org: orgId,
    p_branch: branchId,
    p_order: orderId,
    p_device: deviceId,
    p_staff: staffId,
  });
  if (error) throw error;
}

export async function recordPayment(
  sb: SupabaseClient,
  args: {
    orgId: string;
    branchId: string;
    orderId: string;
    method: string;
    amountPoisha: number;
    reference: string | null;
    idempotencyKey: string;
    deviceId: string;
    staffId: string;
  },
): Promise<OrderRow> {
  const { data, error } = await sb
    .rpc('record_payment', {
      p_org: args.orgId,
      p_branch: args.branchId,
      p_order: args.orderId,
      p_method: args.method,
      p_amount: args.amountPoisha,
      p_reference: args.reference,
      p_idempotency_key: args.idempotencyKey,
      p_device: args.deviceId,
      p_staff: args.staffId,
    })
    .single();
  if (error) throw error;
  return data as OrderRow;
}

export async function applyOrderDiscount(
  sb: SupabaseClient,
  args: {
    orgId: string;
    branchId: string;
    orderId: string;
    percentBps: number;
    reasonCodeId: string;
    note: string | null;
    deviceId: string;
    staffId: string;
  },
): Promise<OrderRow> {
  const { data, error } = await sb
    .rpc('apply_order_discount', {
      p_org: args.orgId,
      p_branch: args.branchId,
      p_order: args.orderId,
      p_percent_bps: args.percentBps,
      p_reason_code: args.reasonCodeId,
      p_reason_note: args.note,
      p_device: args.deviceId,
      p_staff: args.staffId,
    })
    .single();
  if (error) throw error;
  return data as OrderRow;
}

export async function voidOrderItem(
  sb: SupabaseClient,
  args: {
    orgId: string;
    branchId: string;
    orderItemId: string;
    reasonCodeId: string;
    note: string | null;
    deviceId: string;
    staffId: string;
    approverStaffId?: string;
  },
): Promise<void> {
  const { error } = await sb.rpc('void_order_item', {
    p_org: args.orgId,
    p_branch: args.branchId,
    p_order_item: args.orderItemId,
    p_reason_code: args.reasonCodeId,
    p_reason_note: args.note,
    p_device: args.deviceId,
    p_staff: args.staffId,
    p_approver_staff: args.approverStaffId ?? null,
  });
  if (error) throw error;
}

export async function fetchOrderItems(
  sb: SupabaseClient,
  orgId: string,
  orderId: string,
): Promise<OrderLine[]> {
  const { data, error } = await sb
    .from('order_items')
    .select(
      'id, menu_item_id, name_snapshot, quantity, unit_price_poisha, total_poisha, status, kot_sent_at, station_id, notes',
    )
    .eq('org_id', orgId)
    .eq('order_id', orderId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map(
    (r) =>
      ({
        ...r,
        unit_price_poisha: n(r.unit_price_poisha),
        total_poisha: n(r.total_poisha),
      }) as OrderLine,
  );
}

export async function fetchOpenShift(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
  deviceId: string,
): Promise<ShiftRow | null> {
  const { data, error } = await sb
    .from('shifts')
    .select(
      'id, status, opening_float_poisha, expected_cash_poisha, counted_cash_poisha, over_short_poisha, opened_at',
    )
    .eq('org_id', orgId)
    .eq('branch_id', branchId)
    .eq('device_id', deviceId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as ShiftRow | null;
}

export async function openShift(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
  deviceId: string,
  staffId: string,
  openingFloat: number,
): Promise<ShiftRow> {
  const { data, error } = await sb
    .rpc('open_shift', {
      p_org: orgId,
      p_branch: branchId,
      p_device: deviceId,
      p_staff: staffId,
      p_opening_float: openingFloat,
    })
    .single();
  if (error) throw error;
  return data as ShiftRow;
}

export async function closeShift(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
  shiftId: string,
  countedCash: number,
  deviceId: string,
  staffId: string,
): Promise<ShiftRow> {
  const { data, error } = await sb
    .rpc('close_shift', {
      p_org: orgId,
      p_branch: branchId,
      p_shift: shiftId,
      p_counted_cash: countedCash,
      p_device: deviceId,
      p_staff: staffId,
    })
    .single();
  if (error) throw error;
  return data as ShiftRow;
}

export { createClient };
