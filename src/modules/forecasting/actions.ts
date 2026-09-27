'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import { formatQuantity } from '@/modules/inventory/format';
import {
  parseQuantity,
  toBase,
  type BaseUnit,
  type PurchaseUnit,
} from '@/modules/purchasing/lines';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Calendar, forecast and the bazar list (ROADMAP Phase 7). The list moves through audited RPCs:
 * generate (draft) → approve (owner/manager, edits teach the tuning) → send (WhatsApp outbox) →
 * reconcile (against the purchases entered for the day).
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const refresh = (slug: string) => {
  revalidatePath(`/${slug}/plan`);
  revalidatePath(`/${slug}/calendar`);
};
const KINDS = [
  'ramadan',
  'iftar_window',
  'eid',
  'holiday',
  'salary_week',
  'weather',
  'hartal',
  'cricket',
  'custom',
] as const;

// ---------------------------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------------------------
export async function addCalendarEventAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      name: z.string().trim().min(1).max(120),
      kind: z.enum(KINDS),
      startsOn: z.string().regex(DATE),
      endsOn: z.string().regex(DATE),
      closed: z.literal('on').optional(),
      note: z.string().trim().max(300).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success || parsed.data.endsOn < parsed.data.startsOn)
    return { error: 'calendarInvalid' };
  const supabase = await createClient();
  const { error } = await supabase.from('calendar_events').insert({
    org_id: parsed.data.orgId,
    name: parsed.data.name,
    kind: parsed.data.kind,
    starts_on: parsed.data.startsOn,
    ends_on: parsed.data.endsOn,
    closed: parsed.data.closed === 'on',
    note: parsed.data.note || null,
    source: 'owner',
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function deleteCalendarEventAction(formData: FormData): Promise<void> {
  const parsed = base.extend({ id: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('calendar_events')
    .delete()
    .eq('id', parsed.data.id)
    .eq('org_id', parsed.data.orgId);
  if (error) console.error('calendar delete', error.code);
  refresh(parsed.data.orgSlug);
}

export async function flagDayAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({ date: z.string().regex(DATE), kind: z.enum(['weather', 'hartal', 'cricket']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('flag_day', {
    p_org: parsed.data.orgId,
    p_date: parsed.data.date,
    p_kind: parsed.data.kind,
    p_now: now().toISOString(),
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Bazar list
// ---------------------------------------------------------------------------------------------
export async function generateBazarAction(formData: FormData): Promise<void> {
  const parsed = base
    .extend({ branchId: z.uuid(), forDate: z.string().regex(DATE) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('generate_bazar_list', {
    p_org: parsed.data.orgId,
    p_branch: parsed.data.branchId,
    p_for: parsed.data.forDate,
    p_now: now().toISOString(),
  });
  if (error) console.error('bazar generate', error.code);
  refresh(parsed.data.orgSlug);
}

/** qty-<lineId> + unit-<lineId>: the approver's quantity; blank = as suggested, 0 = drop the line. */
export async function approveBazarAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base.extend({ listId: z.uuid() }).safeParse({
    orgId: formData.get('orgId'),
    orgSlug: formData.get('orgSlug'),
    listId: formData.get('listId'),
  });
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { data: lines } = await supabase
    .from('bazar_list_lines')
    .select('id, ingredients(base)')
    .eq('bazar_list_id', parsed.data.listId);
  const edits: { line_id: string; qty_base: number }[] = [];
  for (const l of lines ?? []) {
    const text = String(formData.get(`qty-${l.id}`) ?? '').trim();
    if (text === '') continue;
    const qty = parseQuantity(text);
    const b = (l.ingredients as unknown as { base: BaseUnit } | null)?.base ?? 'g';
    const unit = String(formData.get(`unit-${l.id}`) ?? '') as PurchaseUnit;
    const qtyBase = qty === 0 ? 0 : qty === null ? null : toBase(qty, unit, b);
    if (qtyBase === null) return { error: 'quantityInvalid' };
    edits.push({ line_id: l.id as string, qty_base: qtyBase });
  }
  const { error } = await supabase.rpc('approve_bazar_list', {
    p_list: parsed.data.listId,
    p_lines: edits,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

/**
 * One WhatsApp message per supplier with a phone (their lines) and, if given, one to the purchaser (the
 * whole list), in the org's language. The outbox sends them; nothing goes out directly from here.
 */
export async function sendBazarAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({ listId: z.uuid(), purchaserPhone: z.string().trim().max(20).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { data: list } = await supabase
    .from('bazar_lists')
    .select('id, org_id, branch_id, for_date, branches(name)')
    .eq('id', parsed.data.listId)
    .maybeSingle();
  if (!list) return { error: 'notAllowed' };
  const [{ data: lines }, { data: settings }] = await Promise.all([
    supabase
      .from('bazar_list_lines')
      .select(
        'approved_qty_base, supplier_id, suppliers(name, phone), ingredients(name, name_bn, base)',
      )
      .eq('bazar_list_id', parsed.data.listId),
    supabase.from('org_settings').select('default_locale').eq('org_id', list.org_id).maybeSingle(),
  ]);
  const locale = ((settings?.default_locale as Locale | undefined) ?? 'bn') as Locale;
  const [t, tu] = await Promise.all([
    getTranslations({ locale, namespace: 'plan' }),
    getTranslations({ locale, namespace: 'units' }),
  ]);
  type Line = {
    approved_qty_base: number;
    supplier_id: string | null;
    suppliers: { name: string; phone: string | null } | null;
    ingredients: { name: string; name_bn: string | null; base: BaseUnit } | null;
  };
  const all = (lines ?? []) as unknown as Line[];
  const lineText = (l: Line) =>
    `• ${locale === 'bn' && l.ingredients?.name_bn ? l.ingredients.name_bn : (l.ingredients?.name ?? '')} — ${formatQuantity(
      Number(l.approved_qty_base),
      l.ingredients?.base ?? 'g',
      locale,
      (u) => tu(u),
    )}`;
  const branch = (list.branches as unknown as { name: string } | null)?.name ?? '';
  const header = t('messageHeader', { date: String(list.for_date), branch });
  const messages: { to_phone: string; language: string; body: string }[] = [];
  const bySupplier = new Map<string, Line[]>();
  for (const l of all)
    if (l.supplier_id && l.suppliers?.phone)
      bySupplier.set(l.supplier_id, [...(bySupplier.get(l.supplier_id) ?? []), l]);
  for (const ls of bySupplier.values())
    messages.push({
      to_phone: ls[0]!.suppliers!.phone!,
      language: locale,
      body: [header, ...ls.map(lineText)].join('\n'),
    });
  if (parsed.data.purchaserPhone)
    messages.push({
      to_phone: parsed.data.purchaserPhone,
      language: locale,
      body: [
        header,
        ...all.map(lineText),
        t('messageLines', { count: formatNumber(all.length, locale) }),
      ].join('\n'),
    });
  const { error } = await supabase.rpc('send_bazar_list', {
    p_list: parsed.data.listId,
    p_messages: messages,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function reconcileBazarAction(formData: FormData): Promise<void> {
  const parsed = base.extend({ listId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('reconcile_bazar_list', { p_list: parsed.data.listId });
  if (error) console.error('bazar reconcile', error.code);
  refresh(parsed.data.orgSlug);
}
