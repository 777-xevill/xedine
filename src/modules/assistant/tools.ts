import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
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
  | { metric_id: string; filters: Record<string, unknown>; as_of: string; data: unknown }
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
      "Today's estimated profit, costs and break-even (owner and accountant only). COGS is an assumption until recipes exist; say so when you use it.",
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
];

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
          filters: { branch: input.branch ?? null, cogs_basis: 'assumed' },
          as_of,
          data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
            branch: r.branch_id
              ? (ctx.branches.find((b) => b.id === r.branch_id)?.name ?? null)
              : 'all',
            net_sales_poisha: num(r.net_poisha),
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
            'type, branch_id, period_start, period_end, impact_poisha, confidence, subject, status',
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
              null,
          })),
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
      default:
        return { error: 'not_found', detail: { tool: name } };
    }
  } catch (e) {
    return fail(e as { code?: string });
  }
}
