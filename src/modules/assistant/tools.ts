import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BaseUnit } from '@/modules/purchasing/lines';
import { qtyText } from './for-model';
import { matchItem, type MenuRef, type Window } from './router';

/**
 * The assistant's tools (ARCHITECTURE.md "AI layer"): each is a thin call to a metric function and
 * returns the data with its metric_id, filters and as_of so an answer can cite it. They run with the
 * caller's own Supabase session, so the assistant inherits their permissions (ADR 0007): a manager's
 * money question comes back "not_permitted", not a number.
 */
export interface ToolContext {
  sb: SupabaseClient;
  orgId: string;
  nowIso: string;
  menu: MenuRef[];
  branches: { id: string; name: string }[];
}

export type ToolResult =
  | {
      metric_id: string;
      filters: Record<string, unknown>;
      as_of: string;
      data: unknown;
      /** Totals for a list that was cut short, so the model knows how much more there is. */
      summary?: Record<string, unknown>;
    }
  | { error: 'not_permitted' | 'not_found' | 'ambiguous' | 'failed'; detail?: unknown };

const WINDOW_ENUM = [
  'last_2h',
  'today',
  'yesterday',
  'last_7d',
  'week_to_date',
  'month_to_date',
  'last_30d',
] as const;
const windowProp = {
  type: 'string',
  enum: WINDOW_ENUM,
  description:
    'Named period. Business days start at the branch cutoff (04:00) in Asia/Dhaka; last_7d includes today.',
} as const;
const branchProp = {
  type: 'string',
  description: 'Branch name, when the question is about one branch. Omit for all branches.',
} as const;

export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'get_item_sales',
    description:
      'How many of one menu item were sold in a period, and their net sales (VAT excluded). Use for "how many X sold today / in the last 2 hours / this month".',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Menu item name as the user wrote it.' },
        window: windowProp,
        branch: branchProp,
      },
      required: ['item', 'window'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_sales',
    description:
      'Net sales, completed orders, average order and guests for a period, per branch and in total.',
    input_schema: {
      type: 'object',
      properties: {
        window: { ...windowProp, enum: WINDOW_ENUM.filter((w) => w !== 'last_2h') },
        branch: branchProp,
      },
      required: ['window'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_top_items',
    description: 'Best or worst selling items by quantity in a period.',
    input_schema: {
      type: 'object',
      properties: {
        window: windowProp,
        direction: { type: 'string', enum: ['top', 'bottom'] },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
        branch: branchProp,
      },
      required: ['window', 'direction'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_channel_mix',
    description:
      'Net sales and orders by channel (dine-in, takeaway, delivery platforms) for a period.',
    input_schema: {
      type: 'object',
      properties: {
        window: { ...windowProp, enum: WINDOW_ENUM.filter((w) => w !== 'last_2h') },
        branch: branchProp,
      },
      required: ['window'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_flash_pnl',
    description:
      "Today's estimated profit, costs and break-even (owner and accountant only). Food cost comes from recipes where they exist (food_cost_basis 'recipes'), else an assumed % ('assumed' or 'mixed'); say so when it is assumed.",
    input_schema: {
      type: 'object',
      properties: { branch: branchProp },
      additionalProperties: false,
    },
  },
  {
    name: 'get_findings',
    description:
      'Open money leaks found in the till data, ranked by taka impact, with their evidence summary (owner and accountant only).',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 10 } },
      additionalProperties: false,
    },
  },
  {
    name: 'explain_finding',
    description:
      'Everything behind one money leak (by its id, or its rank in the open list, 1 = biggest): what was found, where, when, the ৳ impact, the evidence (quantities, prices, suspect dishes) and suggested actions. Owner and accountant only. Quantities are base units (g, ml, pcs); *_x1000 fields are poisha per 1,000 base units.',
    input_schema: {
      type: 'object',
      properties: {
        finding_id: { type: 'string', description: 'The finding id (a UUID), when known.' },
        rank: { type: 'integer', minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_stock_status',
    description:
      'Stock that should be on the shelf per ingredient, and how many days it lasts (green/yellow/red), from the last count, purchases, transfers, sales and waste. Quantities are base units (g, ml, pcs).',
    input_schema: {
      type: 'object',
      properties: { branch: branchProp, only_low: { type: 'boolean' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_food_cost_gap',
    description:
      'Between the last two stock counts: what recipes say food should have cost, and why the actual cost differs — logged waste, prices paid above standard, and unexplained usage (owner and accountant only).',
    input_schema: {
      type: 'object',
      properties: { branch: branchProp },
      additionalProperties: false,
    },
  },
  {
    name: 'get_forecast',
    description:
      'Forecast units to sell tomorrow per item (all dayparts), per branch and in total. model_shown says whether the calendar-aware model is used (it beats "same weekday last week" by ≥ 10%) or the naive guess.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Menu item, when the question names one.' },
        branch: branchProp,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_menu_matrix',
    description:
      'Menu engineering classes (star, plowhorse, puzzle, dog) with margins per item for a period (owner and accountant only).',
    input_schema: {
      type: 'object',
      properties: { window: { ...windowProp, enum: ['last_7d', 'last_30d', 'month_to_date'] } },
      required: ['window'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_branches',
    description:
      'Branches side by side for a period: sales per day, orders, average order, delivery share, serving time, rating, return rate, discounts; for owner and accountant also food cost %, labour %, waste %, unexplained usage % and the gap to the best branch in poisha.',
    input_schema: {
      type: 'object',
      properties: { window: { ...windowProp, enum: ['last_7d', 'last_30d', 'month_to_date'] } },
      required: ['window'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_benchmarks',
    description:
      'Last full month against peers (only groups of five or more restaurants) or a labelled industry reference range: own value, p25/p50/p75 and where the restaurant falls (owner and accountant only). Percentages are basis points; money is poisha.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_customers_summary',
    description:
      'Identified orders, first-time customers who came back within 30/60 days, and how many customers are regulars, at risk, new, returning or lost. Counts only — no names or phones.',
    input_schema: {
      type: 'object',
      properties: { branch: branchProp },
      additionalProperties: false,
    },
  },
  {
    name: 'get_reviews_summary',
    description:
      'Average rating (0–10) per source for the last 30 days and the most common complaint themes in reviews and after-meal comments.',
    input_schema: {
      type: 'object',
      properties: { branch: branchProp },
      additionalProperties: false,
    },
  },
  {
    name: 'get_stock_loss',
    description:
      "WHERE THE LOSS IS, item by item: which ingredients were used more than the recipes of the dishes sold needed, between the branch's last two stock counts (the Stock page's Loss tab). Every gram over the recipe is a loss; at or over the owner's loss line (loss_line) it is a real loss, under it a small loss. Per item: how much more than the recipes, % over, the loss in money (owner and accountant only), how much of it was written down as waste and how much is not explained, and staff food (shown apart, not a loss). Biggest loss first, plus the total loss and counts. Use this for 'where / which item / why is there a loss'.",
    input_schema: {
      type: 'object',
      properties: {
        branch: branchProp,
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Items to list (default 8).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_waste',
    description:
      'Food written down as waste in a period (spoiled, burnt, dropped, cooked but not sold, returned, staff food): per reason and item, how much, how many times, and its value (owner and accountant only). Biggest first, plus the total.',
    input_schema: {
      type: 'object',
      properties: {
        window: {
          ...windowProp,
          enum: ['today', 'yesterday', 'last_7d', 'week_to_date', 'month_to_date', 'last_30d'],
        },
        branch: branchProp,
      },
      required: ['window'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_purchases',
    description:
      'What was bought (the bazar) in a period: per ingredient the quantity, the money spent and how many purchases, biggest spend first, plus the total spent. Owner, accountant and purchaser only.',
    input_schema: {
      type: 'object',
      properties: {
        window: {
          ...windowProp,
          enum: ['today', 'yesterday', 'last_7d', 'week_to_date', 'month_to_date', 'last_30d'],
        },
        branch: branchProp,
      },
      required: ['window'],
      additionalProperties: false,
    },
  },
];

/** Most ingredients a stock answer lists (worst first). */
const STOCK_ROWS = 15;

const num = (v: unknown) => Number(v ?? 0);

function fail(error: { code?: string } | null): ToolResult {
  return { error: error?.code === '42501' ? 'not_permitted' : 'failed' };
}

function branchId(ctx: ToolContext, name: unknown): string | null | undefined {
  if (typeof name !== 'string' || name.trim() === '') return null;
  const b = ctx.branches.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
  return b ? b.id : undefined;
}

async function windowDates(ctx: ToolContext, window: Window) {
  const { data, error } = await ctx.sb.rpc('metric_window', {
    p_org: ctx.orgId,
    p_window: window,
    p_now: ctx.nowIso,
  });
  if (error) throw error;
  const row = (data as { from_date: string; to_date: string }[])[0]!;
  return { from: row.from_date, to: row.to_date };
}

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const as_of = ctx.nowIso;
  const window = (WINDOW_ENUM as readonly string[]).includes(String(input.window))
    ? (input.window as Window)
    : 'today';
  const branch = branchId(ctx, input.branch);
  if (branch === undefined)
    return {
      error: 'not_found',
      detail: { branch: input.branch, branches: ctx.branches.map((b) => b.name) },
    };
  try {
    switch (name) {
      case 'get_item_sales': {
        const item = matchItem(String(input.item ?? ''), ctx.menu);
        if (!item) return { error: 'not_found', detail: { item: input.item } };
        if (Array.isArray(item))
          return { error: 'ambiguous', detail: { candidates: item.map((i) => i.name) } };
        const { data, error } = await ctx.sb.rpc('metric_item_qty', {
          p_org: ctx.orgId,
          p_branch: branch,
          p_window: window,
          p_now: ctx.nowIso,
          p_item: item.id,
        });
        if (error) return fail(error);
        const rows = (data ?? []) as Record<string, unknown>[];
        const dates = rows[0]
          ? { from: rows[0].from_date, to: rows[0].to_date }
          : await windowDates(ctx, window);
        return {
          metric_id: 'items.qty_sold',
          filters: { item: item.name, window, branch: input.branch ?? null, ...dates },
          as_of,
          data: {
            item_name: item.name,
            qty: rows.reduce((s, r) => s + num(r.qty), 0),
            net_poisha: rows.reduce((s, r) => s + num(r.net_poisha), 0),
          },
        };
      }
      case 'get_sales': {
        const { from, to } = await windowDates(ctx, window);
        const { data, error } = await ctx.sb.rpc('metric_sales', {
          p_org: ctx.orgId,
          p_branch: branch,
          p_from: from,
          p_to: to,
        });
        if (error) return fail(error);
        const rows = (data ?? []) as Record<string, unknown>[];
        const shape = (r: Record<string, unknown>) => ({
          branch: r.branch_id
            ? (ctx.branches.find((b) => b.id === r.branch_id)?.name ?? null)
            : 'all',
          orders: num(r.orders_completed),
          net_sales_poisha: num(r.net_poisha),
          average_order_poisha: r.aov_poisha === null ? null : num(r.aov_poisha),
          guests: num(r.covers),
        });
        return {
          metric_id: 'sales.net',
          filters: { window, from, to, branch: input.branch ?? null },
          as_of,
          data: rows.map(shape),
        };
      }
      case 'get_top_items': {
        const { data, error } = await ctx.sb.rpc('metric_item_qty', {
          p_org: ctx.orgId,
          p_branch: branch,
          p_window: window,
          p_now: ctx.nowIso,
        });
        if (error) return fail(error);
        const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
          item: String(r.name),
          qty: num(r.qty),
          net_poisha: num(r.net_poisha),
        }));
        const limit = Math.min(20, Math.max(1, num(input.limit) || 5));
        rows.sort((a, b) => (input.direction === 'bottom' ? a.qty - b.qty : b.qty - a.qty));
        return {
          metric_id: 'items.qty_sold',
          filters: { window, direction: input.direction ?? 'top', branch: input.branch ?? null },
          as_of,
          data: rows.slice(0, limit),
        };
      }
      case 'get_channel_mix': {
        const { from, to } = await windowDates(ctx, window);
        const { data, error } = await ctx.sb.rpc('metric_sales_split', {
          p_org: ctx.orgId,
          p_branch: branch,
          p_from: from,
          p_to: to,
          p_dimension: 'channel',
        });
        if (error) return fail(error);
        return {
          metric_id: 'sales.by_channel',
          filters: { window, from, to, branch: input.branch ?? null },
          as_of,
          data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
            channel: r.label,
            orders: num(r.orders),
            net_sales_poisha: num(r.net_poisha),
          })),
        };
      }
      case 'get_flash_pnl': {
        const { data, error } = await ctx.sb.rpc('metric_flash_pnl', {
          p_org: ctx.orgId,
          p_branch: branch,
          p_now: ctx.nowIso,
        });
        if (error) return fail(error);
        return {
          metric_id: 'pnl.flash.estimated_profit',
          filters: { branch: input.branch ?? null },
          as_of,
          data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
            branch: r.branch_id
              ? (ctx.branches.find((b) => b.id === r.branch_id)?.name ?? null)
              : 'all',
            net_sales_poisha: num(r.net_poisha),
            food_cost_basis: r.cogs_basis,
            assumed_food_cost_bps: num(r.assumed_food_cost_bps),
            food_cost_poisha: num(r.cogs_poisha),
            commission_poisha: num(r.commission_poisha),
            labour_poisha: num(r.labour_daily_poisha),
            fixed_costs_poisha: num(r.fixed_daily_poisha),
            estimated_profit_poisha: num(r.estimated_profit_poisha),
            breakeven_remaining_poisha: num(r.breakeven_remaining_poisha),
          })),
        };
      }
      case 'get_findings': {
        const { data, error } = await ctx.sb
          .from('findings')
          .select(
            'id, type, branch_id, period_start, period_end, impact_poisha, confidence, subject, status',
          )
          .eq('org_id', ctx.orgId)
          .in('status', ['new', 'acknowledged'])
          .order('impact_poisha', { ascending: false })
          .limit(Math.min(10, Math.max(1, num(input.limit) || 5)));
        if (error) return fail(error);
        // Findings are money rows (ADR 0007): a manager's query returns nothing, which means no permission.
        return {
          metric_id: 'findings',
          filters: { status: 'open' },
          as_of,
          data: (data ?? []).map((f) => ({
            id: f.id,
            type: f.type,
            branch: ctx.branches.find((b) => b.id === f.branch_id)?.name ?? null,
            from: f.period_start,
            to: f.period_end,
            impact_poisha: num(f.impact_poisha),
            confidence: f.confidence,
            about:
              (f.subject as Record<string, unknown>)?.staff_name ??
              (f.subject as Record<string, unknown>)?.item_name ??
              (f.subject as Record<string, unknown>)?.channel_name ??
              (f.subject as Record<string, unknown>)?.ingredient_name ??
              null,
          })),
        };
      }
      case 'explain_finding': {
        let q = ctx.sb
          .from('findings')
          .select(
            'id, type, branch_id, period_start, period_end, impact_poisha, confidence, status, subject, suggested_actions, finding_evidence(summary)',
          )
          .eq('org_id', ctx.orgId);
        const fid = typeof input.finding_id === 'string' ? input.finding_id.trim() : '';
        if (/^[0-9a-f-]{36}$/i.test(fid)) q = q.eq('id', fid);
        else
          q = q
            .in('status', ['new', 'acknowledged'])
            .order('impact_poisha', { ascending: false })
            .range(Math.max(0, num(input.rank) - 1), Math.max(0, num(input.rank) - 1));
        const { data, error } = await q.limit(1);
        if (error) return fail(error);
        const f = (data ?? [])[0];
        // Findings are money rows: no row means no finding, or no permission to see it.
        if (!f)
          return {
            error: 'not_found',
            detail: { finding_id: fid || null, rank: input.rank ?? null },
          };
        const evidence =
          (f.finding_evidence as { summary: Record<string, unknown> }[] | null)?.[0]?.summary ?? {};
        return {
          metric_id: 'findings',
          filters: { finding_id: f.id },
          as_of,
          data: {
            id: f.id,
            type: f.type,
            branch: ctx.branches.find((b) => b.id === f.branch_id)?.name ?? null,
            from: f.period_start,
            to: f.period_end,
            impact_poisha: num(f.impact_poisha),
            confidence: f.confidence,
            status: f.status,
            subject: f.subject,
            evidence,
            suggested_actions: f.suggested_actions,
          },
        };
      }
      case 'get_stock_status': {
        const { data, error } = await ctx.sb.rpc('metric_stock_status', {
          p_org: ctx.orgId,
          p_branch: branch,
          p_now: ctx.nowIso,
        });
        if (error) return fail(error);
        const all = (data ?? []) as Record<string, unknown>[];
        // Most urgent first, so the cap below drops the comfortable items, not the ones running out.
        const urgency = (r: Record<string, unknown>) =>
          r.band === 'red' ? 0 : r.band === 'yellow' ? 1 : r.band === 'green' ? 2 : 3;
        const rows = all
          .filter((r) => !input.only_low || r.band === 'red' || r.band === 'yellow')
          .sort(
            (a, b) =>
              urgency(a) - urgency(b) ||
              (a.days_of_cover === null ? Infinity : num(a.days_of_cover)) -
                (b.days_of_cover === null ? Infinity : num(b.days_of_cover)),
          )
          .map((r) => ({
            branch: ctx.branches.find((b) => b.id === r.branch_id)?.name ?? null,
            ingredient: r.name,
            base: r.base,
            stock_qty: r.stock_qty === null ? null : num(r.stock_qty),
            on_shelf: r.stock_qty === null ? null : qtyText(num(r.stock_qty), r.base as BaseUnit),
            used_per_day:
              r.avg_daily_qty === null ? null : qtyText(num(r.avg_daily_qty), r.base as BaseUnit),
            // ADR 0030: never counted — stock_qty is bought minus used, an estimate.
            estimated: r.estimated === true,
            days_of_cover: r.days_of_cover === null ? null : num(r.days_of_cover),
            band: r.band,
            last_count_date: r.last_count_date,
          }));
        return {
          metric_id: 'stock.days_of_cover',
          filters: { branch: input.branch ?? null, only_low: input.only_low ?? false },
          as_of,
          // A phone-sized answer needs the worst few, not every ingredient (and the model's request
          // has a size limit): the counts say how many more there are.
          summary: {
            ingredients: all.length,
            red: all.filter((r) => r.band === 'red').length,
            yellow: all.filter((r) => r.band === 'yellow').length,
            green: all.filter((r) => r.band === 'green').length,
            listed: Math.min(rows.length, STOCK_ROWS),
          },
          data: rows.slice(0, STOCK_ROWS),
        };
      }
      case 'get_food_cost_gap': {
        const counts = await ctx.sb
          .from('stock_counts')
          .select('counted_on')
          .eq('org_id', ctx.orgId)
          .eq('status', 'submitted')
          .order('counted_on', { ascending: false })
          .limit(30);
        const dates = [...new Set((counts.data ?? []).map((c) => c.counted_on as string))];
        if (dates.length < 2)
          return { error: 'not_found', detail: { reason: 'two_counts_needed' } };
        const { data, error } = await ctx.sb.rpc('metric_variance_bridge', {
          p_org: ctx.orgId,
          p_branch: branch,
          p_from: dates[1],
          p_to: dates[0],
        });
        if (error) return fail(error);
        return {
          metric_id: 'variance.bridge',
          filters: { branch: input.branch ?? null, from: dates[1], to: dates[0] },
          as_of,
          data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
            branch: r.branch_id
              ? (ctx.branches.find((b) => b.id === r.branch_id)?.name ?? null)
              : 'all',
            food_cost_by_recipes_poisha: num(r.tfc_standard_poisha),
            logged_waste_poisha: num(r.waste_poisha),
            price_effect_poisha: num(r.price_effect_poisha),
            unexplained_usage_poisha: num(r.unexplained_poisha),
            actual_food_cost_poisha: num(r.cogs_actual_poisha),
            count_uncertainty_poisha: num(r.uncertainty_poisha),
            net_sales_poisha: num(r.net_sales_poisha),
          })),
        };
      }
      case 'get_forecast': {
        const { data: w, error: we } = await ctx.sb.rpc('metric_window', {
          p_org: ctx.orgId,
          p_window: 'today',
          p_now: ctx.nowIso,
        });
        if (we) return fail(we);
        const today = (w as { to_date: string }[])[0]!.to_date;
        const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
          .toISOString()
          .slice(0, 10);
        const { data, error } = await ctx.sb.rpc('metric_forecast', {
          p_org: ctx.orgId,
          p_branch: branch,
          p_date: tomorrow,
          p_now: ctx.nowIso,
        });
        if (error) return fail(error);
        const rows = (data ?? []) as Record<string, unknown>[];
        const item =
          typeof input.item === 'string' && input.item.trim()
            ? matchItem(input.item, ctx.menu)
            : null;
        const want = item && !Array.isArray(item) ? item.id : null;
        const byItem = new Map<string, number>();
        for (const r of rows) {
          if (want && r.menu_item_id !== want) continue;
          byItem.set(String(r.name), (byItem.get(String(r.name)) ?? 0) + num(r.qty));
        }
        return {
          metric_id: 'forecast.units',
          filters: { date: tomorrow, item: input.item ?? null, branch: input.branch ?? null },
          as_of,
          data: {
            date: tomorrow,
            model_shown: rows.some((r) => r.model_shown === true),
            items: [...byItem.entries()]
              .map(([name, q]) => ({ item: name, qty: Math.round(q * 10) / 10 }))
              .sort((x, y) => y.qty - x.qty),
          },
        };
      }
      case 'get_menu_matrix': {
        const { from, to } = await windowDates(ctx, window);
        const { data, error } = await ctx.sb.rpc('metric_menu_matrix', {
          p_org: ctx.orgId,
          p_branch: null,
          p_from: from,
          p_to: to,
        });
        if (error) return fail(error);
        return {
          metric_id: 'menu.engineering',
          filters: { window, from, to },
          as_of,
          data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
            item: r.name,
            class: r.class,
            qty: num(r.qty),
            margin_per_unit_poisha:
              r.cm_per_unit_poisha === null ? null : num(r.cm_per_unit_poisha),
            food_cost_bps: r.food_cost_bps === null ? null : num(r.food_cost_bps),
          })),
        };
      }
      case 'compare_branches': {
        const { from, to } = await windowDates(ctx, window);
        const { data, error } = await ctx.sb.rpc('metric_branch_league', {
          p_org: ctx.orgId,
          p_from: from,
          p_to: to,
        });
        if (error) return fail(error);
        const bname = (id: unknown) => ctx.branches.find((b) => b.id === id)?.name ?? null;
        const opt = (v: unknown) => (v === null || v === undefined ? null : num(v));
        return {
          metric_id: 'branches.league',
          filters: { window, from, to },
          as_of,
          data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
            branch: bname(r.branch_id),
            net_sales_poisha: num(r.net_poisha),
            net_per_day_poisha: opt(r.net_per_day_poisha),
            orders: num(r.orders),
            aov_poisha: opt(r.aov_poisha),
            delivery_share_bps: opt(r.delivery_share_bps),
            median_serve_seconds: opt(r.ticket_median_seconds),
            rating_avg: opt(r.rating_avg),
            first_return_30d_bps: opt(r.first_return_30d_bps),
            discount_bps: opt(r.discount_bps),
            food_cost_bps: opt(r.tfc_pct_bps),
            labour_bps: opt(r.labour_bps),
            waste_bps: opt(r.waste_bps),
            unexplained_usage_bps: opt(r.unexplained_bps),
            gap_to_best_branch_poisha: opt(r.gap_poisha),
          })),
        };
      }
      case 'get_benchmarks': {
        const { data, error } = await ctx.sb.rpc('metric_benchmarks', {
          p_org: ctx.orgId,
          p_now: ctx.nowIso,
        });
        if (error) return fail(error);
        return {
          metric_id: 'benchmarks.monthly',
          filters: {},
          as_of,
          data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
            metric: r.metric_id,
            own_value: r.own_value === null ? null : num(r.own_value),
            p25: r.p25 === null ? null : num(r.p25),
            p50: r.p50 === null ? null : num(r.p50),
            p75: r.p75 === null ? null : num(r.p75),
            peers: r.k === null ? null : num(r.k),
            industry_reference: r.is_reference === true,
            place: r.place,
            better: r.better,
          })),
        };
      }
      case 'get_customers_summary': {
        const { data, error } = await ctx.sb.rpc('metric_customer_summary', {
          p_org: ctx.orgId,
          p_branch: branch,
          p_now: ctx.nowIso,
        });
        if (error) return fail(error);
        const r = ((data ?? []) as Record<string, unknown>[])[0] ?? {};
        return {
          metric_id: 'customers.summary',
          filters: { branch: input.branch ?? null },
          as_of,
          data: {
            orders_30d: num(r.orders_30d),
            identified_share_bps:
              r.identified_share_bps == null ? null : num(r.identified_share_bps),
            first_timers: num(r.first_timers),
            first_return_30d_bps:
              r.first_return_30d_bps == null ? null : num(r.first_return_30d_bps),
            first_return_60d_bps:
              r.first_return_60d_bps == null ? null : num(r.first_return_60d_bps),
            segments: r.segments ?? {},
          },
        };
      }
      case 'get_reviews_summary': {
        const { to } = await windowDates(ctx, 'today');
        const from = new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const [ratings, themes] = await Promise.all([
          ctx.sb.rpc('metric_ratings', {
            p_org: ctx.orgId,
            p_branch: branch,
            p_from: from,
            p_to: to,
          }),
          ctx.sb
            .from('reviews')
            .select('themes')
            .eq('org_id', ctx.orgId)
            .gte('reviewed_at', `${from}T00:00:00+06:00`)
            .limit(500),
        ]);
        if (ratings.error) return fail(ratings.error);
        const counts = new Map<string, number>();
        for (const r of (themes.data ?? []) as { themes: string[] }[])
          for (const k of r.themes ?? []) counts.set(k, (counts.get(k) ?? 0) + 1);
        return {
          metric_id: 'reviews.summary',
          filters: { branch: input.branch ?? null, from, to },
          as_of,
          data: {
            ratings: ((ratings.data ?? []) as Record<string, unknown>[]).map((r) => ({
              source: r.source,
              reviews: num(r.n),
              avg_rating: num(r.avg_rating),
              net_bps: num(r.net_bps),
            })),
            review_themes: [...counts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([theme, count]) => ({ theme, count })),
          },
        };
      }
      case 'get_stock_loss': {
        let counts = ctx.sb
          .from('stock_counts')
          .select('counted_on')
          .eq('org_id', ctx.orgId)
          .eq('status', 'submitted');
        if (branch) counts = counts.eq('branch_id', branch);
        const { data: countDays } = await counts
          .order('counted_on', { ascending: false })
          .limit(40);
        const dates = [...new Set((countDays ?? []).map((c) => c.counted_on as string))];
        if (dates.length < 2)
          return { error: 'not_found', detail: { reason: 'two_counts_needed' } };
        const [{ data, error }, { data: settings }] = await Promise.all([
          ctx.sb.rpc('metric_stock_variance', {
            p_org: ctx.orgId,
            p_branch: branch,
            p_from: dates[1],
            p_to: dates[0],
          }),
          ctx.sb.from('org_settings').select('loss_line_bps').eq('org_id', ctx.orgId).maybeSingle(),
        ]);
        if (error) return fail(error);
        const rows = (data ?? []) as Record<string, unknown>[];
        const line = num(settings?.loss_line_bps ?? 100);
        // The metric lists the biggest money first; over-usage only (under-usage is never a gain).
        const over = rows.filter((r) => num(r.over_qty) > 0);
        const money = !over.some((r) => r.over_poisha === null);
        const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 20);
        const base = (r: Record<string, unknown>) => r.base as BaseUnit;
        return {
          metric_id: 'usage.over_qty',
          filters: { branch: input.branch ?? null, from: dates[1], to: dates[0] },
          as_of,
          data: {
            loss_line_bps: line,
            // stock.loss_value: the over-usage money added up, never netted (METRICS.md).
            loss_total_poisha: money ? over.reduce((s, r) => s + num(r.over_poisha), 0) : null,
            items_over_recipe: over.length,
            items_at_or_over_loss_line: over.filter(
              (r) => r.over_bps === null || num(r.over_bps) >= line,
            ).length,
            items_under_recipe: rows.filter((r) => num(r.over_qty) < 0).length,
            items: over.slice(0, limit).map((r) => ({
              branch: ctx.branches.find((b) => b.id === r.branch_id)?.name ?? null,
              ingredient: r.name,
              ingredient_bn: r.name_bn ?? null,
              used_more_than_recipes: qtyText(num(r.over_qty), base(r)),
              over_bps: r.over_bps === null ? null : num(r.over_bps),
              loss_poisha: r.over_poisha === null ? null : num(r.over_poisha),
              recipes_needed: qtyText(num(r.usage_theoretical_qty), base(r)),
              really_used: qtyText(num(r.usage_actual_qty), base(r)),
              of_which_written_down_as_waste: qtyText(
                num(r.waste_qty) - num(r.staff_food_qty),
                base(r),
              ),
              of_which_not_explained: qtyText(num(r.variance_qty), base(r)),
              staff_food_apart:
                num(r.staff_food_qty) > 0 ? qtyText(num(r.staff_food_qty), base(r)) : null,
            })),
          },
        };
      }
      case 'get_waste': {
        const { from, to } = await windowDates(ctx, window);
        const { data, error } = await ctx.sb.rpc('metric_waste_board', {
          p_org: ctx.orgId,
          p_branch: branch,
          p_from: from,
          p_to: to,
        });
        if (error) return fail(error);
        const rows = ((data ?? []) as Record<string, unknown>[]).slice();
        rows.sort(
          (a, b) => num(b.value_poisha) - num(a.value_poisha) || num(b.entries) - num(a.entries),
        );
        const money = !rows.some((r) => r.value_poisha === null);
        return {
          metric_id: 'waste.logged',
          filters: { window, branch: input.branch ?? null, from, to },
          as_of,
          data: {
            total_value_poisha: money ? rows.reduce((s, r) => s + num(r.value_poisha), 0) : null,
            entries: rows.reduce((s, r) => s + num(r.entries), 0),
            items: rows.slice(0, 10).map((r) => ({
              reason: r.reason_label,
              reason_bn: r.reason_label_bn ?? null,
              item: r.name,
              item_bn: r.name_bn ?? null,
              times: num(r.entries),
              amount:
                r.qty_base !== null && r.qty_base !== undefined
                  ? qtyText(num(r.qty_base), r.base as BaseUnit)
                  : `${num(r.qty_portions)} portions`,
              value_poisha: r.value_poisha === null ? null : num(r.value_poisha),
            })),
          },
        };
      }
      case 'get_purchases': {
        const { from, to } = await windowDates(ctx, window);
        let q = ctx.sb
          .from('purchases')
          .select('id')
          .eq('org_id', ctx.orgId)
          .eq('status', 'confirmed')
          .gte('purchased_on', from)
          .lte('purchased_on', to);
        if (branch) q = q.eq('branch_id', branch);
        const { data: purchases, error } = await q;
        if (error) return fail(error);
        const ids = (purchases ?? []).map((p) => p.id as string);
        if (ids.length === 0)
          return {
            metric_id: 'purchases.by_ingredient',
            filters: { window, branch: input.branch ?? null, from, to },
            as_of,
            data: { purchases: 0, total_spent_poisha: 0, items: [] },
          };
        const [{ data: lines, error: le }, { data: ings }] = await Promise.all([
          ctx.sb
            .from('purchase_lines')
            .select('purchase_id, ingredient_id, qty_base, line_total_poisha')
            .eq('org_id', ctx.orgId)
            .in('purchase_id', ids),
          ctx.sb.from('ingredients').select('id, name, name_bn, base').eq('org_id', ctx.orgId),
        ]);
        if (le) return fail(le);
        const byIng = new Map<string, { qty: number; spent: number; buys: Set<string> }>();
        for (const l of lines ?? []) {
          const k = l.ingredient_id as string;
          const e = byIng.get(k) ?? { qty: 0, spent: 0, buys: new Set<string>() };
          e.qty += num(l.qty_base);
          e.spent += num(l.line_total_poisha);
          e.buys.add(l.purchase_id as string);
          byIng.set(k, e);
        }
        const info = new Map((ings ?? []).map((i) => [i.id as string, i]));
        const items = [...byIng.entries()].sort((a, b) => b[1].spent - a[1].spent);
        return {
          metric_id: 'purchases.by_ingredient',
          filters: { window, branch: input.branch ?? null, from, to },
          as_of,
          data: {
            purchases: ids.length,
            total_spent_poisha: items.reduce((s, [, e]) => s + e.spent, 0),
            items: items.slice(0, 12).map(([id, e]) => ({
              ingredient: info.get(id)?.name ?? null,
              ingredient_bn: info.get(id)?.name_bn ?? null,
              bought: qtyText(e.qty, (info.get(id)?.base ?? 'g') as BaseUnit),
              spent_poisha: e.spent,
              times_bought: e.buys.size,
            })),
          },
        };
      }
      default:
        return { error: 'not_found', detail: { tool: name } };
    }
  } catch (e) {
    return fail(e as { code?: string });
  }
}
