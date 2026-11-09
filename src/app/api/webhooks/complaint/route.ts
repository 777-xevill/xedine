import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { normalizeBdPhone } from '@/lib/messaging/phone';
import { now } from '@/lib/time/clock';
import { COMPLAINT_TOKEN, COMPLAINT_TOPICS } from '@/modules/reviews/complaint-link';

/**
 * The public complaint form posts here (ADR 0043). The branch's link token is the only credential: SQL
 * matches it, limits how many a branch takes in an hour, and opens the case. Service role, one row.
 */
const Body = z.object({
  token: z.string().regex(COMPLAINT_TOKEN),
  topic: z.enum(COMPLAINT_TOPICS),
  text: z.string().trim().min(3).max(1000),
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
});

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  const back = (done: 0 | 1 | 2) =>
    NextResponse.redirect(
      new URL(`/c/${encodeURIComponent(field('token') || 'x')}?done=${done}`, request.url),
      303,
    );
  // A field people never see: only a bot fills it in, and it is told all went well.
  if (field('website')) return back(1);
  const parsed = Body.safeParse({
    token: field('token'),
    topic: field('topic'),
    text: field('text'),
    name: field('name'),
    phone: field('phone'),
  });
  if (!parsed.success) return back(0);
  const { name, phone } = parsed.data;
  const { data, error } = await createServiceRoleClient().rpc('submit_complaint', {
    p_token: parsed.data.token,
    p_topic: parsed.data.topic,
    p_text: parsed.data.text,
    p_name: name || null,
    // A number we cannot read is kept as typed: a person may still make sense of it.
    p_phone: phone ? (normalizeBdPhone(phone) ?? phone) : null,
    p_now: now().toISOString(),
  });
  if (error) {
    console.error('complaint submit', error.code);
    return back(0);
  }
  return back(data === 'ok' ? 1 : data === 'busy' ? 2 : 0);
}
