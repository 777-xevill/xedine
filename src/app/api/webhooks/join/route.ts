import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { now } from '@/lib/time/clock';
import { memberCardPath } from '@/modules/customers/member-card';
import { cardCookieName, TABLE_TOKEN } from '@/modules/customers/table-qr';

/**
 * "Become a member" on the table page posts here (ADR 0045). The table's link token is the only credential:
 * SQL matches it, refuses a number the restaurant already knows (anyone can type any number), limits joins
 * per branch an hour, and makes the customer and the card. A new member goes straight to their card, and
 * the card is remembered on this phone so the next table scan shows it.
 */
const Body = z.object({
  token: z.string().regex(TABLE_TOKEN),
  phone: z.string().trim().min(6).max(30),
  name: z.string().trim().max(120).optional(),
  offers: z.literal('on').optional(),
});

const Result = z.object({
  status: z.enum(['new', 'known', 'off', 'gone', 'busy', 'invalid']),
  token: z.string().optional(),
  org_id: z.uuid().optional(),
});

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  const tableToken = field('token') ?? '';
  const back = (join: string) =>
    NextResponse.redirect(
      new URL(`/t/${encodeURIComponent(tableToken || 'x')}?join=${join}#join`, request.url),
      303,
    );
  // A field people never see: only a bot fills it in.
  if (field('website')) return back('invalid');
  const parsed = Body.safeParse({
    token: tableToken,
    phone: field('phone'),
    name: field('name') || undefined,
    offers: field('offers'),
  });
  if (!parsed.success) return back('invalid');
  const { data, error } = await createServiceRoleClient().rpc('join_member_at_table', {
    p_token: parsed.data.token,
    p_phone: parsed.data.phone,
    p_name: parsed.data.name ?? null,
    p_offers: parsed.data.offers === 'on',
    p_now: now().toISOString(),
  });
  if (error) {
    console.error('table join', error.code);
    return back('failed');
  }
  const result = Result.safeParse(data);
  if (!result.success) return back('failed');
  const { status, token, org_id } = result.data;
  if (status !== 'new' || !token || !org_id) return back(status);

  const response = NextResponse.redirect(
    new URL(`${memberCardPath(token)}?welcome=1`, request.url),
    303,
  );
  response.cookies.set(cardCookieName(org_id), token, {
    path: '/t',
    maxAge: ONE_YEAR,
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
  });
  return response;
}
