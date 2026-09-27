import { createHmac, timingSafeEqual } from 'node:crypto';
import { createTranslator } from 'next-intl';
import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { normalizeBdPhone } from '@/lib/messaging/phone';
import { businessDate } from '@/lib/time/business-date';
import { now } from '@/lib/time/clock';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { askAssistant } from '@/modules/assistant/agent';
import type { Translate } from '@/modules/assistant/answers';
import { queueMessage, runOutbox } from '@/modules/messaging/jobs/outbox';

/**
 * WhatsApp Cloud API webhook (ARCHITECTURE.md "Messaging", ADR 0017).
 *   GET  — Meta's subscription handshake (hub.verify_token).
 *   POST — signed with X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret). Delivery
 *          statuses update the outbox; a text from an owner's opted-in number is answered by the
 *          assistant with that owner's view of the data. Every event is logged once (webhook_events).
 * Service role throughout; every query names its org.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === token) {
    return new NextResponse(q.get('hub.challenge') ?? '', { status: 200 });
  }
  return new NextResponse('forbidden', { status: 403 });
}

function signatureOk(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const given = Buffer.from(header.slice('sha256='.length));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

interface WaValue {
  statuses?: { id: string; status: string; errors?: { title?: string }[] }[];
  messages?: { id: string; from: string; type: string; text?: { body?: string } }[];
}

const STATUS: Record<string, 'delivered' | 'read' | 'failed' | 'sent'> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!signatureOk(raw, request.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }
  let body: { entry?: { changes?: { value?: WaValue }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const sb = createServiceRoleClient();
  const values = (body.entry ?? []).flatMap((e) => (e.changes ?? []).map((c) => c.value ?? {}));

  for (const value of values) {
    for (const s of value.statuses ?? []) {
      const status = STATUS[s.status];
      if (!status) continue;
      const { data: fresh } = await sb
        .from('webhook_events')
        .upsert(
          { provider: 'whatsapp', event_id: `${s.id}:${s.status}`, payload: s },
          { onConflict: 'provider,event_id', ignoreDuplicates: true },
        )
        .select('id');
      if ((fresh ?? []).length === 0) continue;
      await sb
        .from('message_outbox')
        .update({
          status,
          error: status === 'failed' ? (s.errors?.[0]?.title ?? 'failed').slice(0, 200) : null,
        })
        .eq('provider_message_id', s.id);
    }

    for (const m of value.messages ?? []) {
      const phone = normalizeBdPhone(m.from);
      const question = m.type === 'text' ? m.text?.body?.trim() : undefined;
      // The inbound number is PII: stored masked; only the question text goes further.
      const { data: fresh } = await sb
        .from('webhook_events')
        .upsert(
          {
            provider: 'whatsapp',
            event_id: m.id,
            payload: { type: m.type, from_suffix: m.from.slice(-2) },
          },
          { onConflict: 'provider,event_id', ignoreDuplicates: true },
        )
        .select('id');
      if ((fresh ?? []).length === 0 || !phone || !question) continue;
      const { data: profile } = await sb
        .from('org_profile')
        .select('org_id, brief_language, owner_whatsapp_opt_in_at')
        .eq('owner_whatsapp', phone)
        .not('owner_whatsapp_opt_in_at', 'is', null)
        .limit(1)
        .maybeSingle();
      if (!profile) continue;
      const orgId = profile.org_id as string;
      const at = now();
      const { data: settings } = await sb
        .from('org_settings')
        .select('default_cutoff_minutes')
        .eq('org_id', orgId)
        .maybeSingle();
      const { data: rules } = await sb
        .from('org_context')
        .select('body')
        .eq('org_id', orgId)
        .eq('is_active', true);
      const answer = await askAssistant({
        sb: sb as never,
        orgId,
        question: question.slice(0, 1000),
        nowIso: at.toISOString(),
        businessDate: businessDate(at, settings?.default_cutoff_minutes ?? 240),
        ownerRules: (rules ?? []).map((r) => r.body as string),
        translate: async (locale) =>
          createTranslator({
            locale,
            messages: locale === 'bn' ? bn : en,
            namespace: 'assistant',
          }) as unknown as Translate,
      });
      await sb
        .from('webhook_events')
        .update({ org_id: orgId, status: 'processed', processed_at: at.toISOString() })
        .eq('provider', 'whatsapp')
        .eq('event_id', m.id);
      await queueMessage(sb, {
        orgId,
        toPhone: phone,
        templateKey: 'assistant_reply',
        language: answer.language === 'en' ? 'en' : 'bn',
        body: answer.text,
        idempotencyKey: `reply:${m.id}`,
      });
    }
  }
  // Replies go out now rather than at the next two-minute drain.
  await runOutbox().catch(() => undefined);
  return NextResponse.json({ ok: true });
}
