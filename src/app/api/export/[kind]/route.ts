import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { buildXlsx, XLSX_TYPE } from '@/lib/export/xlsx';
import { now } from '@/lib/time/clock';
import {
  ordersSheets,
  vatSheets,
  type OrderRow,
  type VatRow,
} from '@/modules/compliance/export-files';

/**
 * Excel exports (ROADMAP Phase 10: data export, sales-VAT summary): a tidy .xlsx the owner can share as it is.
 * Runs with the caller's own session, so RLS and the metric functions' role checks decide what comes out —
 * no service role here.
 *   vat    — owner/accountant: metric_vat_summary for the period (a working summary, not a Mushak return)
 *   orders — owner/accountant: a summary by branch, then every order in the period with its money
 */
const Query = z.object({
  org: z.uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lang: z.enum(['en', 'bn']).default('en'),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const parsed = Query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success || (kind !== 'vat' && kind !== 'orders'))
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { org, from, to, lang } = parsed.data;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'sign in' }, { status: 401 });
  // The UI gate; RLS and the metric functions enforce the same rule underneath.
  const { data: roles } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', org)
    .eq('user_id', auth.user.id)
    .eq('status', 'active');
  if (!(roles ?? []).some((r) => r.role === 'owner' || r.role === 'accountant'))
    return NextResponse.json({ error: 'not allowed' }, { status: 403 });
  const [{ data: branches }, { data: orgRow }] = await Promise.all([
    supabase.from('branches').select('id, name').eq('org_id', org),
    supabase.from('organizations').select('name').eq('id', org).maybeSingle(),
  ]);
  const branchName = (id: unknown) => branches?.find((b) => b.id === id)?.name ?? '';
  const common = {
    lang,
    restaurant: orgRow?.name ?? '',
    from,
    to,
    preparedOn: now().toISOString().slice(0, 10),
    branchName,
  };

  let file: Uint8Array;
  if (kind === 'vat') {
    const { data, error } = await supabase.rpc('metric_vat_summary', {
      p_org: org,
      p_branch: null,
      p_from: from,
      p_to: to,
    });
    if (error) return NextResponse.json({ error: 'failed' }, { status: 403 });
    file = buildXlsx(vatSheets({ ...common, rows: (data ?? []) as VatRow[] }));
  } else {
    const rows: OrderRow[] = [];
    // Every order in the period, deliberately including cancelled/open ones — this is a raw export for
    // the accountant, not a sales report. metric_vat_summary is the one that restricts to 'completed'.
    // Paged: PostgREST caps a response, and a year of orders is far more than one page.
    for (let page = 0; page < 200; page++) {
      const { data, error } = await supabase
        .from('orders')
        .select(
          'branch_id, business_date, placed_at, order_number, order_status, payment_status, net_poisha, vat_poisha, service_charge_poisha, total_poisha, discount_net_poisha',
        )
        .eq('org_id', org)
        .gte('business_date', from)
        .lte('business_date', to)
        .order('placed_at')
        .range(page * 1000, page * 1000 + 999);
      if (error) return NextResponse.json({ error: 'failed' }, { status: 403 });
      rows.push(...((data ?? []) as OrderRow[]));
      if ((data ?? []).length < 1000) break;
    }
    file = buildXlsx(ordersSheets({ lang, branchName, rows }));
  }
  return new NextResponse(Buffer.from(file), {
    headers: {
      'content-type': XLSX_TYPE,
      'content-disposition': `attachment; filename="xedine-${kind === 'vat' ? 'sales-and-vat' : 'all-orders'}-${from}-to-${to}.xlsx"`,
      'cache-control': 'no-store',
    },
  });
}
