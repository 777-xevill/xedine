import 'server-only';
import { createServiceRoleClient } from '@/lib/db/service-role';
import {
  drainOutbox,
  whatsappTransport,
  mockTransport,
  type MessagingTransport,
  type OutboundMessage,
  type OutboxStore,
} from '@/lib/messaging/core';
import { now } from '@/lib/time/clock';

/**
 * The outbox worker (service role). The queue is cross-org by nature; every statement targets one row
 * by id, and each row carries its own org_id. Nothing is sent until a transport is configured:
 * WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID for Meta, or MESSAGING_TRANSPORT=mock for demos.
 */
type Supabase = ReturnType<typeof createServiceRoleClient>;

function supabaseOutbox(sb: Supabase): OutboxStore {
  return {
    async due(nowIso, limit) {
      const { data, error } = await sb
        .from('message_outbox')
        .select('id, org_id, to_phone, template_key, payload, attempts')
        .eq('status', 'queued')
        .lte('next_attempt_at', nowIso)
        .order('created_at')
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const payload = (r.payload ?? {}) as { body?: string; language?: string };
        return {
          id: r.id as string,
          orgId: r.org_id as string,
          toPhone: r.to_phone as string,
          templateKey: r.template_key as string,
          language: payload.language === 'en' ? 'en' : 'bn',
          body: String(payload.body ?? ''),
          attempts: Number(r.attempts),
        } satisfies OutboundMessage;
      });
    },
    async claim(id) {
      const { data } = await sb
        .from('message_outbox')
        .update({ status: 'sending' })
        .eq('id', id)
        .eq('status', 'queued')
        .select('id');
      return (data ?? []).length === 1;
    },
    async sent(id, providerMessageId, nowIso) {
      await sb
        .from('message_outbox')
        .update({
          status: 'sent',
          provider_message_id: providerMessageId,
          sent_at: nowIso,
          error: null,
        })
        .eq('id', id);
    },
    async retry(id, attempts, nextAttemptIso, error) {
      await sb
        .from('message_outbox')
        .update({ status: 'queued', attempts, next_attempt_at: nextAttemptIso, error })
        .eq('id', id);
    },
    async failed(id, attempts, error) {
      await sb.from('message_outbox').update({ status: 'failed', attempts, error }).eq('id', id);
    },
  };
}

async function transport(sb: Supabase): Promise<MessagingTransport | null> {
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    const { data } = await sb
      .from('message_templates')
      .select('key, language, provider_template_name');
    const names = new Map(
      (data ?? []).map((t) => [
        `${t.key}/${t.language}`,
        (t.provider_template_name as string | null) ?? null,
      ]),
    );
    return whatsappTransport({
      token: process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      // TODO(verify): the Graph API version with Meta at go-live.
      graphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? 'v21.0',
      templateName: (key, lang) => names.get(`${key}/${lang}`) ?? null,
    });
  }
  if (process.env.MESSAGING_TRANSPORT === 'mock') return mockTransport();
  return null;
}

export async function runOutbox(): Promise<
  { status: 'no_transport' } | { status: 'ok'; sent: number; retried: number; failed: number }
> {
  const sb = createServiceRoleClient();
  const t = await transport(sb);
  if (!t) return { status: 'no_transport' };
  return { status: 'ok', ...(await drainOutbox({ store: supabaseOutbox(sb), transport: t, now })) };
}

/** Queue one message; the idempotency key makes a job re-run a no-op (unique per org). */
export async function queueMessage(
  sb: Supabase,
  m: {
    orgId: string;
    toPhone: string;
    templateKey: string;
    language: 'bn' | 'en';
    body: string;
    idempotencyKey: string;
  },
): Promise<void> {
  // WhatsApp is a Growth/Chain feature (ADR 0008/0023): a plan without it queues nothing.
  const { data: allowed, error: planError } = await sb.rpc('org_whatsapp_allowed', {
    p_org: m.orgId,
    p_now: now().toISOString(),
  });
  if (planError) throw planError;
  if (allowed !== true) return;
  const { error } = await sb.from('message_outbox').upsert(
    {
      org_id: m.orgId,
      channel: 'whatsapp',
      to_phone: m.toPhone,
      template_key: m.templateKey,
      payload: { language: m.language, body: m.body },
      idempotency_key: m.idempotencyKey,
    },
    { onConflict: 'org_id,idempotency_key', ignoreDuplicates: true },
  );
  if (error) throw error;
}
