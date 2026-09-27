'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { parseTakaToPoisha } from '@/lib/money';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/** Branch-level setup for owners and branch managers (RLS: branch-scoped owner/manager writes). */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const scope = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG), branchId: z.uuid() });

const refresh = (orgSlug: string) => revalidatePath(`/${orgSlug}/branch`);

async function branchRow(orgId: string, branchId: string, itemId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('branch_item_prices')
    .select('id, price_poisha, is_available, has_price_override')
    .eq('org_id', orgId)
    .eq('branch_id', branchId)
    .eq('menu_item_id', itemId)
    .is('variant_id', null)
    .maybeSingle();
  return { supabase, row: data };
}

/** 86 an item at one branch (or bring it back). Never pins a price (has_price_override stays as is). */
export async function setAvailabilityAction(formData: FormData): Promise<void> {
  const parsed = scope
    .extend({ itemId: z.uuid(), available: z.enum(['true', 'false']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { orgId, branchId, itemId } = parsed.data;
  const available = parsed.data.available === 'true';
  const { supabase, row } = await branchRow(orgId, branchId, itemId);
  if (row) {
    const { error } = await supabase
      .from('branch_item_prices')
      .update({ is_available: available })
      .eq('id', row.id);
    if (error) console.error('availability', error.code);
  } else if (!available) {
    const { data: item } = await supabase
      .from('menu_items')
      .select('base_price_poisha')
      .eq('org_id', orgId)
      .eq('id', itemId)
      .single();
    const { error } = await supabase.from('branch_item_prices').insert({
      org_id: orgId,
      branch_id: branchId,
      menu_item_id: itemId,
      price_poisha: item?.base_price_poisha ?? 0,
      is_available: false,
      has_price_override: false,
    });
    if (error) console.error('availability', error.code);
  }
  refresh(parsed.data.orgSlug);
}

/** Set (or clear, with an empty price) this branch's own price for an item. Recorded in price history. */
export async function setBranchPriceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = scope
    .extend({ itemId: z.uuid(), price: z.string().max(20) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const { orgId, branchId, itemId } = parsed.data;
  const clearing = parsed.data.price.trim() === '';
  const price = clearing ? null : parseTakaToPoisha(parsed.data.price);
  if (!clearing && (price === null || price < 0)) return { error: 'invalidPrice' };

  const { supabase, row } = await branchRow(orgId, branchId, itemId);
  if (row) {
    const { error } = await supabase
      .from('branch_item_prices')
      .update(
        clearing
          ? { has_price_override: false }
          : { price_poisha: price!, has_price_override: true },
      )
      .eq('id', row.id);
    if (error) return { error: mapDbError(error) };
  } else if (!clearing) {
    const { error } = await supabase.from('branch_item_prices').insert({
      org_id: orgId,
      branch_id: branchId,
      menu_item_id: itemId,
      price_poisha: price!,
      is_available: true,
      has_price_override: true,
    });
    if (error) return { error: mapDbError(error) };
  }
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function createTableAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = scope
    .extend({
      name: z.string().trim().min(1).max(40),
      seats: z.union([z.literal(''), z.coerce.number().int().min(1).max(99)]),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.from('dining_tables').insert({
    org_id: parsed.data.orgId,
    branch_id: parsed.data.branchId,
    name: parsed.data.name,
    seats: parsed.data.seats === '' ? null : parsed.data.seats,
  });
  if (error) return { error: error.code === '23505' ? 'nameTaken' : mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function createStationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = scope
    .extend({ name: z.string().trim().min(1).max(40) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { count } = await supabase
    .from('stations')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', parsed.data.orgId)
    .eq('branch_id', parsed.data.branchId);
  const { error } = await supabase.from('stations').insert({
    org_id: parsed.data.orgId,
    branch_id: parsed.data.branchId,
    name: parsed.data.name,
    sort_order: count ?? 0,
  });
  if (error) return { error: error.code === '23505' ? 'nameTaken' : mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

const toggleSchema = z.object({
  orgSlug: z.string().regex(SLUG),
  id: z.uuid(),
  active: z.enum(['true', 'false']),
});

export async function toggleTableActiveAction(formData: FormData): Promise<void> {
  const parsed = toggleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('dining_tables')
    .update({ is_active: parsed.data.active !== 'true' })
    .eq('id', parsed.data.id);
  if (error) console.error('table toggle', error.code);
  refresh(parsed.data.orgSlug);
}

export async function toggleStationActiveAction(formData: FormData): Promise<void> {
  const parsed = toggleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('stations')
    .update({ is_active: parsed.data.active !== 'true' })
    .eq('id', parsed.data.id);
  if (error) console.error('station toggle', error.code);
  refresh(parsed.data.orgSlug);
}
