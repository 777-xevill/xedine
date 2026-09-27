import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { toCsv } from '@/lib/export/csv';
import { poishaToTakaText } from '@/lib/money';

/**
 * CSV exports (ROADMAP Phase 10: data export, sales-VAT summary). Runs with the caller's own session, so
 * RLS and the metric functions' role checks decide what comes out — no service role here.
 *   vat    — owner/accountant: metric_vat_summary for the period (a working summary, not a Mushak return)
 *   orders — owner/accountant: every order in the period with its stored money decomposition
 */
const Query = z.object({
  org: z.uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const taka = (v: unknown) => poishaToTakaText(Number(v ?? 0));

export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const parsed = Query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success || (kind !== 'vat' && kind !== 'orders'))
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { org, from, to } = parsed.data;
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
  const { data: branches } = await supabase.from('branches').select('id, name').eq('org_id', org);
  const branchName = (id: unknown) => branches?.find((b) => b.id === id)?.name ?? '';

  let csv: string;
  if (kind === 'vat') {
    const { data, error } = await supabase.rpc('metric_vat_summary', {
      p_org: org,
      p_branch: null,
      p_from: from,
      p_to: to,
    });
    if (error) return NextResponse.json({ error: 'failed' }, { status: 403 });
    csv = toCsv(
      [
        'branch',
        'vat_rate_pct',
        'price_includes_vat',
        'orders',
        'net_taka',
        'vat_taka',
        'service_charge_taka',
        'total_taka',
      ],
      ((data ?? []) as Record<string, unknown>[]).map((r) => [
        branchName(r.branch_id),
        (Number(r.vat_rate_bps) / 100).toFixed(2),
        r.price_includes_vat ? 'yes' : 'no',
        r.orders,
        taka(r.net_poisha),
        taka(r.vat_poisha),
        taka(r.service_charge_poisha),
        taka(r.total_poisha),
      ]),
    );
  } else {
    const rows: Record<string, unknown>[] = [];
    // Paged: PostgREST caps a response, and a year of orders is far more than one page.
    for (let page = 0; page < 200; page++) {
      const { data, error } = await supabase
        .from('orders')
        .select(
          'id, branch_id, business_date, placed_at, order_status, payment_status, net_poisha, vat_poisha, service_charge_poisha, total_poisha, discount_net_poisha',
        )
        .eq('org_id', org)
        .gte('business_date', from)
        .lte('business_date', to)
        .order('placed_at')
        .range(page * 1000, page * 1000 + 999);
      if (error) return NextResponse.json({ error: 'failed' }, { status: 403 });
      rows.push(...((data ?? []) as Record<string, unknown>[]));
      if ((data ?? []).length < 1000) break;
    }
    csv = toCsv(
      [
        'order_id',
        'branch',
        'business_date',
        'placed_at',
        'status',
        'payment',
        'discount_taka',
        'net_taka',
        'vat_taka',
        'service_charge_taka',
        'total_taka',
      ],
      rows.map((r) => [
        r.id,
        branchName(r.branch_id),
        r.business_date,
        r.placed_at,
        r.order_status,
        r.payment_status,
        taka(r.discount_net_poisha),
        taka(r.net_poisha),
        taka(r.vat_poisha),
        taka(r.service_charge_poisha),
        taka(r.total_poisha),
      ]),
    );
  }
  return new NextResponse(`﻿${csv}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="xedine-${kind}-${from}-${to}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
