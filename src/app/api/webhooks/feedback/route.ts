import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { now } from '@/lib/time/clock';

/**
 * The public post-meal feedback form posts here (ROADMAP Phase 8). The token is the only credential: SQL
 * matches its hash, refuses a used or 14-day-old link, and stores rating + comment. Service role, one row.
 */
const Body = z.object({
  token: z.string().regex(/^[0-9a-f]{36}$/),
  rating: z.coerce.number().int().min(0).max(10),
  comment: z.string().max(1000).optional(),
});

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const parsed = Body.safeParse({
    token: form.get('token'),
    rating: form.get('rating'),
    comment: form.get('comment') ?? undefined,
  });
  const token = typeof form.get('token') === 'string' ? String(form.get('token')) : '';
  const back = (ok: boolean) =>
    NextResponse.redirect(
      new URL(`/f/${encodeURIComponent(token || 'x')}?done=${ok ? 1 : 0}`, request.url),
      303,
    );
  if (!parsed.success) return back(false);
  const { data, error } = await createServiceRoleClient().rpc('submit_feedback', {
    p_token: parsed.data.token,
    p_rating: parsed.data.rating,
    p_comment: parsed.data.comment ?? '',
    p_now: now().toISOString(),
  });
  if (error) {
    console.error('feedback submit', error.code);
    return back(false);
  }
  return back(data === true);
}
