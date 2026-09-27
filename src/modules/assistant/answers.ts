import { formatBDT, formatNumber, type Locale } from '@/lib/i18n/format';
import type { Intent } from './router';
import type { ToolResult } from './tools';

/**
 * Deterministic answers (ARCHITECTURE.md: "deterministic fallback templates"). Every number comes from
 * a tool result and is only formatted here. Used when there is no AI key, and when a model's answer
 * fails the numeric check twice.
 */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

type Data = Extract<ToolResult, { data: unknown }>;
const isData = (r: ToolResult): r is Data => 'data' in r;

/** Which tool call answers an intent. */
export function toolForIntent(
  intent: Intent,
): { name: string; input: Record<string, unknown> } | null {
  switch (intent.kind) {
    case 'item_qty':
      return { name: 'get_item_sales', input: { item: intent.item.name, window: intent.window } };
    case 'sales':
      return {
        name: 'get_sales',
        input: { window: intent.window === 'last_2h' ? 'today' : intent.window },
      };
    case 'top_items':
      return {
        name: 'get_top_items',
        input: { window: intent.window, direction: 'top', limit: 5 },
      };
    default:
      return null;
  }
}

export function renderAnswer(
  intent: Intent,
  result: ToolResult | null,
  t: Translate,
  locale: Locale,
): string {
  const n = (v: number) => formatNumber(v, locale);
  const money = (p: number) => formatBDT(p, locale, { poisha: 'never' });
  const window = t(`windows.${intent.window}`);
  if (intent.kind === 'ambiguous_item')
    return t('whichItem', {
      items: intent.candidates
        .map((c) => (locale === 'bn' && c.name_bn ? c.name_bn : c.name))
        .join(' / '),
    });
  if (!result) return t('help');
  if (!isData(result)) {
    if (result.error === 'not_permitted') return t('notPermitted');
    if (result.error === 'not_found') return t('notFound');
    return t('noData');
  }
  switch (intent.kind) {
    case 'item_qty': {
      const d = result.data as { item_name: string; qty: number; net_poisha: number };
      const name = locale === 'bn' && intent.item.name_bn ? intent.item.name_bn : d.item_name;
      return d.qty === 0
        ? t('itemNone', { item: name, window })
        : t('itemQty', { item: name, window, qty: n(d.qty), net: money(d.net_poisha) });
    }
    case 'sales': {
      const rows = result.data as {
        branch: string | null;
        orders: number;
        net_sales_poisha: number;
        average_order_poisha: number | null;
      }[];
      const total = rows.find((r) => r.branch === 'all') ?? rows[0];
      if (!total || total.orders === 0) return t('salesNone', { window });
      const lines = [
        t('salesTotal', {
          window,
          net: money(total.net_sales_poisha),
          orders: n(total.orders),
          aov: total.average_order_poisha === null ? '—' : money(total.average_order_poisha),
        }),
      ];
      const branches = rows.filter((r) => r.branch !== 'all' && r.branch);
      if (branches.length > 1)
        for (const b of branches)
          lines.push(
            t('salesBranch', {
              branch: String(b.branch),
              net: money(b.net_sales_poisha),
              orders: n(b.orders),
            }),
          );
      return lines.join('\n');
    }
    case 'top_items': {
      const rows = result.data as { item: string; qty: number }[];
      if (rows.length === 0) return t('salesNone', { window });
      return [
        t('topItems', { window }),
        ...rows.map((r, i) => t('topLine', { rank: n(i + 1), item: r.item, qty: n(r.qty) })),
      ].join('\n');
    }
  }
}
