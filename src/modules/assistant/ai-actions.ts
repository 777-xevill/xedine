import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSY_BPS } from '@/modules/forecasting/busy';
import {
  matchIngredient,
  PURCHASE_UNITS,
  toBase,
  type BaseUnit,
  type IngredientRef,
  type PurchaseUnit,
} from '@/modules/purchasing/lines';
import type { Role } from '@/modules/tenancy/context';
import { mapDbError } from '@/modules/tenancy/form-state';
import {
  BUSY_WORDS,
  DAY_KINDS,
  FIXED_KINDS,
  mayDo,
  WASTE_REASONS,
  type ActionKind,
} from './action-kinds';
import { matchItem, type MenuRef } from './router';

/**
 * Prepares and makes the changes the assistant proposes (ADR 0067). `prepareAction` runs while the model
 * works: it turns names into ids, checks every value and who may do it, and returns what the person will see.
 * Nothing is written then. `runAction` runs only after the person tapped "Do these changes": the same table
 * write or RPC the page uses, with that person's own Supabase session, so RLS, roles and audit all apply.
 */

export interface ActionContext {
  sb: SupabaseClient;
  orgId: string;
  /** The business date today, on the restaurant's clock. */
  today: string;
  roles: readonly Role[];
  branches: { id: string; name: string }[];
  /** Filled on first use, then reused for the rest of the question. */
  cache: Map<string, unknown>;
}

export type Prepared =
  | {
      ok: true;
      kind: ActionKind;
      params: Record<string, unknown>;
      view: Record<string, unknown>;
      /** One line in English for the model to refer to. */
      summary: string;
    }
  | {
      ok: false;
      error: 'not_permitted' | 'not_found' | 'ambiguous' | 'invalid' | 'exists';
      detail: string;
    };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const norm = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
const text = (v: unknown, max: number) => {
  const s = String(v ?? '').trim();
  return s.length > 0 && s.length <= max ? s : null;
};
const isDate = (v: unknown): v is string =>
  typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A price or amount in whole currency units → minor units; null when it is not a sensible amount. */
export function toMinor(v: unknown, allowZero = false): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || n > 10_000_000) return null;
  return Math.round(n * 100);
}

type Failure = Extract<Prepared, { ok: false }>;
const fail = (error: Failure['error'], detail: string): Failure => ({
  ok: false,
  error,
  detail,
});

async function cached<T>(ctx: ActionContext, key: string, load: () => Promise<T>): Promise<T> {
  if (!ctx.cache.has(key)) ctx.cache.set(key, await load());
  return ctx.cache.get(key) as T;
}

type Dish = MenuRef & { is_active: boolean; base_price_poisha: number };
const dishes = (ctx: ActionContext) =>
  cached(ctx, 'dishes', async () => {
    const { data } = await ctx.sb
      .from('menu_items')
      .select('id, name, name_bn, is_active, base_price_poisha')
      .eq('org_id', ctx.orgId);
    return (data ?? []) as Dish[];
  });
const categories = (ctx: ActionContext) =>
  cached(ctx, 'categories', async () => {
    const { data } = await ctx.sb
      .from('menu_categories')
      .select('id, name, name_bn')
      .eq('org_id', ctx.orgId);
    return (data ?? []) as { id: string; name: string; name_bn: string | null }[];
  });
const ingredients = (ctx: ActionContext) =>
  cached(ctx, 'ingredients', async () => {
    const [{ data: rows }, { data: aliases }] = await Promise.all([
      ctx.sb.from('ingredients').select('id, name, name_bn, base').eq('org_id', ctx.orgId),
      ctx.sb.from('ingredient_aliases').select('ingredient_id, alias').eq('org_id', ctx.orgId),
    ]);
    return ((rows ?? []) as IngredientRef[]).map((i) => ({
      ...i,
      aliases: (aliases ?? []).filter((a) => a.ingredient_id === i.id).map((a) => String(a.alias)),
    }));
  });

/** One dish by name: exact first (English or Bangla), then the router's word match. */
async function findDish(ctx: ActionContext, name: unknown): Promise<Dish | Failure> {
  const all = await dishes(ctx);
  const n = norm(name);
  if (!n) return fail('invalid', 'the dish name is empty');
  const exact = all.filter((d) => norm(d.name) === n || norm(d.name_bn) === n);
  if (exact.length === 1) return exact[0]!;
  const hit = matchItem(n, exact.length > 1 ? exact : all);
  if (hit && !Array.isArray(hit)) return hit as Dish;
  if (Array.isArray(hit) && hit.length > 1)
    return fail('ambiguous', `which dish: ${hit.map((d) => d.name).join(', ')}`);
  return fail(
    'not_found',
    `no dish named "${String(name)}". Dishes: ${all
      .slice(0, 40)
      .map((d) => d.name)
      .join(', ')}`,
  );
}

function findBranch(ctx: ActionContext, name: unknown): { id: string; name: string } | Failure {
  const n = norm(name);
  if (!n) {
    if (ctx.branches.length === 1) return ctx.branches[0]!;
    return fail('ambiguous', `which branch: ${ctx.branches.map((b) => b.name).join(', ')}`);
  }
  const b =
    ctx.branches.find((x) => norm(x.name) === n) ??
    ctx.branches.find((x) => norm(x.name).includes(n));
  return b ?? fail('not_found', `branches: ${ctx.branches.map((x) => x.name).join(', ')}`);
}

const isFail = (v: unknown): v is Failure =>
  typeof v === 'object' && v !== null && 'ok' in v && (v as Prepared).ok === false;

const money = (minor: number) => (minor / 100).toLocaleString('en-US');

/** Turns the model's proposal into a checked change, or says what is wrong so the model can fix it. */
export async function prepareAction(
  kind: ActionKind,
  input: Record<string, unknown>,
  ctx: ActionContext,
): Promise<Prepared> {
  if (!mayDo(kind, ctx.roles))
    return fail('not_permitted', 'this person cannot make this change; the owner can');
  const ok = (params: Record<string, unknown>, view: Record<string, unknown>, summary: string) =>
    ({ ok: true, kind, params, view, summary }) as const;

  switch (kind) {
    case 'add_category': {
      const name = text(input.name, 80);
      if (!name) return fail('invalid', 'a category needs a name (up to 80 letters)');
      const nameBn = text(input.name_bn, 80);
      if ((await categories(ctx)).some((c) => norm(c.name) === norm(name)))
        return fail('exists', `the category "${name}" is already on the menu`);
      // A dish prepared after it in the same list may go into it.
      await cached(ctx, 'newCategories', async () => [] as string[]);
      (ctx.cache.get('newCategories') as string[]).push(norm(name));
      return ok({ name, name_bn: nameBn }, { name }, `Add the menu category "${name}"`);
    }

    case 'add_dish': {
      const name = text(input.name, 200);
      const price = toMinor(input.price);
      if (!name) return fail('invalid', 'a dish needs a name');
      if (price === null) return fail('invalid', 'the price must be a positive amount');
      if ((await dishes(ctx)).some((d) => norm(d.name) === norm(name)))
        return fail('exists', `"${name}" is already on the menu; use propose_change_price`);
      const catName = text(input.category, 80);
      const known = await categories(ctx);
      const cat = catName
        ? known.find((c) => norm(c.name) === norm(catName) || norm(c.name_bn) === norm(catName))
        : undefined;
      const proposed = (ctx.cache.get('newCategories') as string[] | undefined) ?? [];
      if (catName && !cat && !proposed.includes(norm(catName)))
        return fail(
          'not_found',
          `no menu category "${catName}": call propose_add_category first, or use one of: ${known
            .map((c) => c.name)
            .join(', ')}`,
        );
      return ok(
        {
          name,
          name_bn: text(input.name_bn, 200),
          price_minor: price,
          category_id: cat?.id ?? null,
          // A category proposed in the same list is made first, then found by name.
          category_name: cat ? null : catName,
        },
        { name, price_minor: price, category: cat?.name ?? catName ?? '' },
        `Add "${name}" at ${money(price)}${catName ? ` in ${cat?.name ?? catName}` : ''}`,
      );
    }

    case 'change_price': {
      const dish = await findDish(ctx, input.dish);
      if (isFail(dish)) return dish;
      const price = toMinor(input.new_price);
      if (price === null) return fail('invalid', 'the new price must be a positive amount');
      if (price === dish.base_price_poisha)
        return fail('exists', `${dish.name} is already ${money(price)}`);
      return ok(
        { item_id: dish.id, price_minor: price },
        { dish: dish.name, old_minor: dish.base_price_poisha, new_minor: price },
        `Change ${dish.name} from ${money(dish.base_price_poisha)} to ${money(price)}`,
      );
    }

    case 'set_dish_on_menu': {
      const dish = await findDish(ctx, input.dish);
      if (isFail(dish)) return dish;
      const on = input.on_menu === true;
      if (dish.is_active === on)
        return fail('exists', `${dish.name} is already ${on ? 'on' : 'off'} the menu`);
      return ok(
        { item_id: dish.id, active: on },
        { dish: dish.name, on },
        `${on ? 'Put' : 'Take'} ${dish.name} ${on ? 'back on' : 'off'} the menu`,
      );
    }

    case 'add_special_day': {
      if (!isDate(input.date)) return fail('invalid', 'date must be YYYY-MM-DD');
      const until = input.until === undefined || input.until === '' ? input.date : input.until;
      if (!isDate(until) || until < input.date)
        return fail('invalid', 'until must be YYYY-MM-DD, on or after date');
      if (input.date < addDays(ctx.today, -1))
        return fail('invalid', 'a special day cannot be before yesterday');
      const name = text(input.name, 120);
      if (!name) return fail('invalid', 'the day needs a name');
      const dayKind = (DAY_KINDS as readonly string[]).includes(String(input.kind))
        ? String(input.kind)
        : 'custom';
      const busy = (BUSY_WORDS as readonly string[]).includes(String(input.busy))
        ? (String(input.busy) as (typeof BUSY_WORDS)[number])
        : null;
      if (busy === 'closed' && !ctx.roles.includes('owner'))
        return fail('not_permitted', 'only the owner can mark the restaurant closed');
      const level = {
        much_busier: 'up2',
        busier: 'up1',
        quieter: 'down1',
        much_quieter: 'down2',
      } as const;
      return ok(
        {
          from: input.date,
          to: until,
          name,
          kind: dayKind,
          expect_bps: busy && busy !== 'closed' ? BUSY_BPS[level[busy]] : null,
          closed: busy === 'closed',
        },
        { name, from: input.date, to: until, busy: busy ?? '' },
        `Tell Xedine: ${name} on ${input.date}${until !== input.date ? ` to ${until}` : ''}${busy ? `, ${busy.replace('_', ' ')}` : ''}`,
      );
    }

    case 'add_party_order': {
      if (!isDate(input.date)) return fail('invalid', 'date must be YYYY-MM-DD');
      if (input.date < ctx.today || input.date > addDays(ctx.today, 60))
        return fail('invalid', 'a party order is for today up to 60 days ahead');
      const title = text(input.title, 120);
      if (!title) return fail('invalid', 'the party order needs a title');
      const readyAt = input.ready_at ? String(input.ready_at) : null;
      if (readyAt !== null && !TIME.test(readyAt)) return fail('invalid', 'ready_at must be HH:MM');
      const branch = findBranch(ctx, input.branch);
      if (isFail(branch)) return branch;
      const raw = Array.isArray(input.lines) ? (input.lines as Record<string, unknown>[]) : [];
      if (raw.length === 0 || raw.length > 12) return fail('invalid', 'one to twelve dishes');
      const lines: { menu_item_id: string; variant_id: string | null; qty: number }[] = [];
      const shown: { dish: string; plates: number }[] = [];
      for (const l of raw) {
        const dish = await findDish(ctx, l.dish);
        if (isFail(dish)) return dish;
        const plates = Number(l.plates);
        if (!Number.isInteger(plates) || plates < 1 || plates > 5000)
          return fail('invalid', 'plates must be a whole number from 1 to 5000');
        let variant: { id: string; name: string } | null = null;
        if (text(l.size, 80)) {
          const { data } = await ctx.sb
            .from('item_variants')
            .select('id, name')
            .eq('org_id', ctx.orgId)
            .eq('menu_item_id', dish.id)
            .eq('is_active', true);
          variant =
            ((data ?? []) as { id: string; name: string }[]).find(
              (v) => norm(v.name) === norm(l.size),
            ) ?? null;
          if (!variant)
            return fail(
              'not_found',
              `${dish.name} has no size "${String(l.size)}"; sizes: ${(data ?? []).map((v) => v.name).join(', ') || 'none'}`,
            );
        }
        lines.push({ menu_item_id: dish.id, variant_id: variant?.id ?? null, qty: plates });
        shown.push({ dish: variant ? `${dish.name} (${variant.name})` : dish.name, plates });
      }
      return ok(
        {
          branch_id: branch.id,
          date: input.date,
          ready_at: readyAt,
          title,
          note: text(input.note, 300),
          lines,
        },
        { title, date: input.date, ready_at: readyAt ?? '', branch: branch.name, lines: shown },
        `Party order "${title}" on ${input.date}: ${shown.map((s) => `${s.plates} × ${s.dish}`).join(', ')}`,
      );
    }

    case 'record_purchase': {
      const date = input.date === undefined || input.date === '' ? ctx.today : input.date;
      if (!isDate(date) || date > ctx.today || date < addDays(ctx.today, -30))
        return fail('invalid', 'the purchase date is today or up to 30 days back');
      const branch = findBranch(ctx, input.branch);
      if (isFail(branch)) return branch;
      const raw = Array.isArray(input.lines) ? (input.lines as Record<string, unknown>[]) : [];
      if (raw.length === 0 || raw.length > 30) return fail('invalid', 'one to thirty lines');
      const forDays =
        Number.isInteger(input.for_days) &&
        Number(input.for_days) >= 1 &&
        Number(input.for_days) <= 30
          ? Number(input.for_days)
          : null;
      const known = await ingredients(ctx);
      const lines: Record<string, unknown>[] = [];
      const shown: { item: string; qty: string; total_minor: number; is_new: boolean }[] = [];
      for (const l of raw) {
        const item = text(l.item, 120);
        const qty = Number(l.qty);
        const unit = String(l.unit) as PurchaseUnit;
        const total = toMinor(l.total, true);
        if (!item || !(qty > 0) || !(unit in PURCHASE_UNITS) || total === null)
          return fail('invalid', `check the line "${String(l.item)}": item, qty, unit and total`);
        const ing = matchIngredient(item, known);
        if (ing) {
          const qtyBase = toBase(qty, unit, ing.base);
          if (qtyBase === null)
            return fail('invalid', `${ing.name} is kept in ${ing.base}: use a unit that fits`);
          lines.push({
            ingredient_id: ing.id,
            qty_base: qtyBase,
            line_total_poisha: total,
            ...(forDays ? { for_days: forDays } : {}),
          });
          shown.push({ item: ing.name, qty: `${qty} ${unit}`, total_minor: total, is_new: false });
        } else {
          const base: BaseUnit = PURCHASE_UNITS[unit].base;
          lines.push({
            new_ingredient: { name: item, base },
            qty_base: Math.round(qty * PURCHASE_UNITS[unit].factor * 1000) / 1000,
            line_total_poisha: total,
            ...(forDays ? { for_days: forDays } : {}),
          });
          shown.push({ item, qty: `${qty} ${unit}`, total_minor: total, is_new: true });
        }
      }
      const supplierName = text(input.supplier, 120);
      let supplierId: string | null = null;
      if (supplierName) {
        const { data } = await ctx.sb.from('suppliers').select('id, name').eq('org_id', ctx.orgId);
        supplierId =
          ((data ?? []) as { id: string; name: string }[]).find(
            (s) => norm(s.name) === norm(supplierName),
          )?.id ?? null;
      }
      const total = shown.reduce((s, l) => s + l.total_minor, 0);
      return ok(
        {
          branch_id: branch.id,
          date,
          supplier_id: supplierId,
          supplier_name: supplierId ? null : supplierName,
          lines,
        },
        {
          date,
          supplier: supplierName ?? '',
          branch: branch.name,
          lines: shown,
          total_minor: total,
        },
        `Record the bazar of ${date}: ${shown.map((s) => `${s.qty} ${s.item} for ${money(s.total_minor)}`).join(', ')}`,
      );
    }

    case 'log_waste': {
      const qty = Number(input.qty);
      if (!(qty > 0) || qty > 100_000) return fail('invalid', 'the quantity must be positive');
      const unit = String(input.unit);
      const branch = findBranch(ctx, input.branch);
      if (isFail(branch)) return branch;
      const reasonCode = (WASTE_REASONS as readonly string[]).includes(String(input.reason))
        ? String(input.reason)
        : 'spoiled';
      const { data: reasons } = await ctx.sb
        .from('reason_codes')
        .select('id, code, label, label_bn')
        .eq('org_id', ctx.orgId)
        .eq('kind', 'waste')
        .eq('is_active', true);
      const list = (reasons ?? []) as {
        id: string;
        code: string;
        label: string;
        label_bn: string | null;
      }[];
      const reason = list.find((r) => r.code === reasonCode) ?? list[0];
      if (!reason) return fail('not_found', 'this restaurant has no waste reasons set up');
      let target: {
        ingredient_id: string | null;
        menu_item_id: string | null;
        qty: number;
        name: string;
      };
      if (unit === 'plates') {
        const dish = await findDish(ctx, input.item);
        if (isFail(dish)) return dish;
        if (!Number.isInteger(qty)) return fail('invalid', 'plates must be a whole number');
        target = { ingredient_id: null, menu_item_id: dish.id, qty, name: dish.name };
      } else {
        const ing = matchIngredient(String(input.item ?? ''), await ingredients(ctx));
        if (!ing) {
          const dish = await findDish(ctx, input.item);
          if (!isFail(dish) && unit === 'pcs' && Number.isInteger(qty))
            target = { ingredient_id: null, menu_item_id: dish.id, qty, name: dish.name };
          else return fail('not_found', `no ingredient named "${String(input.item)}"`);
        } else {
          if (!(unit in PURCHASE_UNITS)) return fail('invalid', 'use kg, g, l, ml or pcs');
          const qtyBase = toBase(qty, unit as PurchaseUnit, ing.base);
          if (qtyBase === null)
            return fail('invalid', `${ing.name} is kept in ${ing.base}: use a unit that fits`);
          target = { ingredient_id: ing.id, menu_item_id: null, qty: qtyBase, name: ing.name };
        }
      }
      return ok(
        {
          branch_id: branch.id,
          ingredient_id: target.ingredient_id,
          menu_item_id: target.menu_item_id,
          qty: target.qty,
          reason_id: reason.id,
          note: text(input.note, 300),
        },
        {
          item: target.name,
          qty: `${qty} ${unit}`,
          reason: reason.label,
          reason_bn: reason.label_bn ?? reason.label,
          branch: branch.name,
        },
        `Write down waste: ${qty} ${unit} ${target.name} (${reason.label})`,
      );
    }

    case 'add_supplier': {
      const name = text(input.name, 120);
      if (!name) return fail('invalid', 'the supplier needs a name');
      const { data } = await ctx.sb.from('suppliers').select('name').eq('org_id', ctx.orgId);
      if ((data ?? []).some((s) => norm(s.name) === norm(name)))
        return fail('exists', `the supplier "${name}" is already there`);
      return ok({ name }, { name }, `Add the supplier "${name}"`);
    }

    case 'add_fixed_cost': {
      const k = String(input.kind);
      if (!(FIXED_KINDS as readonly string[]).includes(k))
        return fail('invalid', `kind is one of ${FIXED_KINDS.join(', ')}`);
      const monthly = toMinor(input.monthly);
      if (monthly === null) return fail('invalid', 'the monthly amount must be positive');
      let branch: { id: string; name: string } | null = null;
      if (text(input.branch, 120)) {
        const b = findBranch(ctx, input.branch);
        if (isFail(b)) return b;
        branch = b;
      }
      const label = text(input.label, 120);
      return ok(
        { branch_id: branch?.id ?? null, kind: k, label, monthly_minor: monthly },
        { kind: k, label: label ?? '', monthly_minor: monthly, branch: branch?.name ?? '' },
        `Add the monthly cost ${label ?? k}: ${money(monthly)} a month`,
      );
    }

    case 'set_food_cost': {
      const pct = Number(input.percent);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100)
        return fail('invalid', 'percent is from 0 to 100');
      const bps = Math.round(pct * 100);
      return ok({ bps }, { pct: bps / 100 }, `Set the usual food cost to ${bps / 100}%`);
    }

    case 'remember_rule': {
      const body = text(input.text, 500);
      const k = ['goal', 'rule', 'constraint'].includes(String(input.kind))
        ? String(input.kind)
        : 'rule';
      if (!body || body.length < 3) return fail('invalid', 'say the rule in a sentence');
      return ok({ kind: k, body }, { kind: k, text: body }, `Remember: ${body}`);
    }
  }
}

export interface RunEnv {
  sb: SupabaseClient;
  orgId: string;
  userId: string;
  /** The business date today and the clock, for RPCs that take them. */
  today: string;
  nowIso: string;
}

type Ran = { ok: true } | { error: string };

const p = <T>(params: Record<string, unknown>, key: string) => params[key] as T;

/** Makes one approved change. Returns an errors.* key when it is refused. */
export async function runAction(
  kind: ActionKind,
  params: Record<string, unknown>,
  env: RunEnv,
): Promise<Ran> {
  const { sb, orgId } = env;
  const done = (error: { code?: string; message?: string } | null): Ran =>
    error ? { error: mapDbError(error) } : { ok: true };
  const touched = (res: { error: unknown; data: unknown[] | null }): Ran =>
    res.error
      ? { error: mapDbError(res.error as { code?: string }) }
      : res.data && res.data.length > 0
        ? { ok: true }
        : { error: 'notAllowed' };

  switch (kind) {
    case 'add_category':
      return done(
        (
          await sb.from('menu_categories').insert({
            org_id: orgId,
            name: p<string>(params, 'name'),
            name_bn: p<string | null>(params, 'name_bn'),
          })
        ).error,
      );
    case 'add_dish': {
      let categoryId = p<string | null>(params, 'category_id');
      const categoryName = p<string | null>(params, 'category_name');
      if (!categoryId && categoryName) {
        const { data } = await sb.from('menu_categories').select('id, name').eq('org_id', orgId);
        categoryId =
          ((data ?? []) as { id: string; name: string }[]).find(
            (c) => norm(c.name) === norm(categoryName),
          )?.id ?? null;
      }
      return done(
        (
          await sb.from('menu_items').insert({
            org_id: orgId,
            category_id: categoryId,
            name: p<string>(params, 'name'),
            name_bn: p<string | null>(params, 'name_bn'),
            base_price_poisha: p<number>(params, 'price_minor'),
          })
        ).error,
      );
    }
    case 'change_price':
      return touched(
        await sb
          .from('menu_items')
          .update({ base_price_poisha: p<number>(params, 'price_minor') })
          .eq('org_id', orgId)
          .eq('id', p<string>(params, 'item_id'))
          .select('id'),
      );
    case 'set_dish_on_menu':
      return touched(
        await sb
          .from('menu_items')
          .update({ is_active: p<boolean>(params, 'active') })
          .eq('org_id', orgId)
          .eq('id', p<string>(params, 'item_id'))
          .select('id'),
      );
    case 'add_special_day':
      return done(
        (
          await sb.rpc('add_special_day', {
            p_org: orgId,
            p_kind: p<string>(params, 'kind'),
            p_from: p<string>(params, 'from'),
            p_to: p<string>(params, 'to'),
            p_name: p<string>(params, 'name'),
            p_note: null,
            p_expect_bps: p<number | null>(params, 'expect_bps'),
            p_closed: p<boolean>(params, 'closed'),
            p_now: env.nowIso,
          })
        ).error,
      );
    case 'add_party_order':
      return done(
        (
          await sb.rpc('save_planned_order', {
            p_org: orgId,
            p_branch: p<string>(params, 'branch_id'),
            p_id: null,
            p_for: p<string>(params, 'date'),
            p_ready_at: p<string | null>(params, 'ready_at'),
            p_title: p<string>(params, 'title'),
            p_note: p<string | null>(params, 'note'),
            p_lines: p<unknown[]>(params, 'lines'),
            p_now: env.nowIso,
          })
        ).error,
      );
    case 'record_purchase':
      return done(
        (
          await sb.rpc('record_purchase_with_new_items', {
            p_org: orgId,
            p_branch: p<string>(params, 'branch_id'),
            p_supplier: p<string | null>(params, 'supplier_id'),
            p_supplier_name: p<string | null>(params, 'supplier_name'),
            p_purchased_on: p<string>(params, 'date'),
            p_lines: p<unknown[]>(params, 'lines'),
          })
        ).error,
      );
    case 'log_waste':
      return done(
        (
          await sb.rpc('log_waste', {
            p_org: orgId,
            p_branch: p<string>(params, 'branch_id'),
            p_ingredient: p<string | null>(params, 'ingredient_id'),
            p_menu_item: p<string | null>(params, 'menu_item_id'),
            p_qty: p<number>(params, 'qty'),
            p_reason: p<string>(params, 'reason_id'),
            p_note: p<string | null>(params, 'note'),
          })
        ).error,
      );
    case 'add_supplier': {
      const { error } = await sb
        .from('suppliers')
        .insert({ org_id: orgId, name: p<string>(params, 'name') });
      return error?.code === '23505' ? { error: 'nameTaken' } : done(error);
    }
    case 'add_fixed_cost':
      return done(
        (
          await sb.from('fixed_costs').insert({
            org_id: orgId,
            branch_id: p<string | null>(params, 'branch_id'),
            kind: p<string>(params, 'kind'),
            label: p<string | null>(params, 'label'),
            monthly_poisha: p<number>(params, 'monthly_minor'),
            effective_from: env.today,
          })
        ).error,
      );
    case 'set_food_cost':
      return touched(
        await sb
          .from('org_cost_settings')
          .update({ assumed_food_cost_bps: p<number>(params, 'bps') })
          .eq('org_id', orgId)
          .select('org_id'),
      );
    case 'remember_rule':
      return done(
        (
          await sb.from('org_context').insert({
            org_id: orgId,
            kind: p<string>(params, 'kind'),
            body: p<string>(params, 'body'),
            created_by: env.userId,
          })
        ).error,
      );
  }
}
