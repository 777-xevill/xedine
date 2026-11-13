import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/db/supabase-server';
import { formatDhakaDay, type Locale } from '@/lib/i18n/format';
import { escapeHtml } from '@/modules/forecasting/bazar-share';
import { formatQuantity } from '@/modules/inventory/format';
import type { BaseUnit } from '@/modules/purchasing/lines';
import { getOrgContext } from '@/modules/tenancy/context';

/**
 * The bazar list as a clean one-page sheet that opens the print box ("Save as PDF" on any phone or
 * computer). It reads through the caller's own session, so it shows only what they may see.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = q.get('org') ?? '';
  const branchId = q.get('branch') ?? '';
  const date = q.get('date') ?? '';
  if (
    !/^[a-z0-9-]{3,40}$/.test(slug) ||
    !/^[0-9a-f-]{36}$/.test(branchId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  )
    return new Response('Bad request', { status: 400 });
  const ctx = await getOrgContext(slug);
  const branch = ctx.branches.find((b) => b.id === branchId);
  if (!branch) return new Response('Not found', { status: 404 });
  if (
    !ctx.roles.some((r) => ['owner', 'manager', 'kitchen', 'purchaser', 'accountant'].includes(r))
  )
    return new Response('Not found', { status: 404 });

  const supabase = await createClient();
  const { data: list } = await supabase
    .from('bazar_lists')
    .select('id')
    .eq('org_id', ctx.org.id)
    .eq('branch_id', branchId)
    .eq('for_date', date)
    .maybeSingle();
  if (!list) return new Response('Not found', { status: 404 });
  const { data } = await supabase
    .from('bazar_list_lines')
    .select(
      'suggested_qty_base, approved_qty_base, suppliers(name), ingredients(name, name_bn, base)',
    )
    .eq('bazar_list_id', list.id);
  type L = {
    suggested_qty_base: number;
    approved_qty_base: number | null;
    suppliers: { name: string } | null;
    ingredients: { name: string; name_bn: string | null; base: BaseUnit } | null;
  };
  const [t, tu, locale] = await Promise.all([
    getTranslations('plan'),
    getTranslations('units'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const rows = ((data ?? []) as unknown as L[])
    .map((l) => {
      const base = l.ingredients?.base ?? 'g';
      const name =
        loc === 'bn' && l.ingredients?.name_bn
          ? l.ingredients.name_bn
          : (l.ingredients?.name ?? '');
      return {
        name,
        supplier: l.suppliers?.name ?? t('noSupplier'),
        qty: formatQuantity(Number(l.approved_qty_base ?? l.suggested_qty_base), base, loc, (u) =>
          tu(u),
        ),
      };
    })
    .sort((a, b) => a.supplier.localeCompare(b.supplier) || a.name.localeCompare(b.name));

  const day = formatDhakaDay(new Date(`${date}T06:00:00Z`), loc);
  const body = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.name)}</td><td class="q">${escapeHtml(r.qty)}</td><td>${escapeHtml(r.supplier)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html lang="${loc}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(t('messageHeader', { date, branch: branch.name }))}</title><style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Bengali",sans-serif;margin:24px}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;opacity:.65;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:15px}th,td{text-align:start;padding:8px 6px;border-bottom:1px solid color-mix(in srgb,currentColor 25%,transparent)}
th{font-size:12px;opacity:.65}td.q{white-space:nowrap;font-weight:600}
button{margin:0 0 16px;padding:8px 14px;font-size:14px}@media print{button{display:none}body{margin:12px}}
</style></head><body><button onclick="window.print()">${escapeHtml(t('printSheet'))}</button>
<h1>${escapeHtml(t('bazarTitle', { date: day }))}</h1><p>${escapeHtml(ctx.org.name)} · ${escapeHtml(branch.name)}</p>
<table><thead><tr><th>${escapeHtml(t('ingredient'))}</th><th>${escapeHtml(t('suggested'))}</th><th>${escapeHtml(t('supplier'))}</th></tr></thead><tbody>${body}</tbody></table>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},400)})</script></body></html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}
