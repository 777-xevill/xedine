import { formatBDT, formatNumber, type Locale } from '@/lib/i18n/format';
import { splitQuantity, type BaseUnit } from '@/modules/purchasing/lines';
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
    case 'finding':
      return {
        name: 'explain_finding',
        input: intent.findingId ? { finding_id: intent.findingId } : { rank: intent.rank },
      };
    case 'stock_low':
      return { name: 'get_stock_status', input: { only_low: true } };
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
    case 'finding':
      return explainFinding(result.data as FindingData, t, locale);
    case 'stock_low': {
      const rows = result.data as {
        branch: string | null;
        ingredient: string;
        base: BaseUnit;
        stock_qty: number | null;
        days_of_cover: number | null;
        band: string;
      }[];
      if (rows.length === 0) return t('stockFine');
      return [
        t('stockLowTitle'),
        ...rows.slice(0, 10).map((r) =>
          t('stockLowLine', {
            branch: r.branch ?? '',
            ingredient: r.ingredient,
            qty: r.stock_qty === null ? '—' : qty(r.stock_qty, r.base, t, locale),
            days:
              r.days_of_cover === null
                ? '—'
                : formatNumber(r.days_of_cover, locale, { fractionDigits: 1 }),
          }),
        ),
      ].join('\n');
    }
  }
}

/** A base quantity as people say it: 2,500 g → 2.5 kg. */
function qty(q: number, base: BaseUnit, t: Translate, locale: Locale): string {
  const { value, unit } = splitQuantity(q, base);
  const rounded = Math.round(value * 10) / 10;
  return `${formatNumber(rounded, locale, { fractionDigits: Number.isInteger(rounded) ? 0 : 1 })} ${t(`units.${unit}`)}`;
}

interface FindingData {
  type: string;
  branch: string | null;
  from: string;
  to: string;
  impact_poisha: number;
  subject: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

/** The deterministic explanation of one finding: every number is a field of the finding itself. */
export function explainFinding(f: FindingData, t: Translate, locale: Locale): string {
  const money = (p: number) => formatBDT(p, locale, { poisha: 'never' });
  const e = f.evidence;
  const base = (e.base as BaseUnit | undefined) ?? 'g';
  const q = (v: unknown) => qty(Number(v ?? 0), base, t, locale);
  const pct = (bps: unknown) =>
    `${formatNumber(Number(bps ?? 0) / 100, locale, { fractionDigits: 1 })}%`;
  const common = {
    branch: f.branch ?? '',
    from: f.from,
    to: f.to,
    impact: money(f.impact_poisha),
    ingredient: String(f.subject.ingredient_name ?? ''),
  };
  switch (f.type) {
    case 'usage.unexplained': {
      const suspects = (e.suspects as { name: string; share_bps: number }[] | undefined) ?? [];
      const lines = [
        t('explain.usage', {
          ...common,
          theoretical: q(e.used_theoretical_qty),
          actual: q(e.used_actual_qty),
          waste: q(e.waste_qty),
          unexplained: q(e.variance_qty),
          rate: pct(e.rate_bps),
          baseline: pct(e.baseline_bps),
        }),
      ];
      if (suspects.length > 0)
        lines.push(
          t('explain.suspects', {
            dishes: suspects.map((s) => `${s.name} (${pct(s.share_bps)})`).join(', '),
          }),
        );
      if (Number(e.pos_exceptions ?? 0) > 0)
        lines.push(t('explain.posExceptions', { count: Number(e.pos_exceptions) }));
      lines.push(t('explain.usageActions'));
      return lines.join('\n');
    }
    case 'transfer.suspected':
      return t('explain.transfer', {
        ...common,
        toBranch: String(f.subject.to_branch_name ?? ''),
        over: q(e.from_variance_qty),
        under: q(-Number(e.to_variance_qty ?? 0)),
        qty: q(e.estimated_qty),
      });
    case 'price.drift':
      return t('explain.price', {
        ...common,
        days: Number(e.lines_flagged ?? 0),
        overpay: pct(e.overpay_bps),
      });
    case 'transfer.unconfirmed':
      return t('explain.unconfirmed', {
        ...common,
        fromBranch: String(f.subject.from_branch_name ?? ''),
        date: String(e.sent_on ?? f.from),
      });
    default:
      return t('explain.generic', {
        ...common,
        type: t(`findingTypes.${f.type.replace('.', '_')}`),
      });
  }
}
