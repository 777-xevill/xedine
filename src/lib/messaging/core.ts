/**
 * Messaging gateway core (ARCHITECTURE.md "Messaging", ADR 0017): an outbox drained in order, with
 * retries and backoff, behind a transport interface. The WhatsApp Cloud API transport is one
 * implementation; the mock is used until Meta approves the business and its templates (ADR 0010).
 * Pure: store, transport and clock are injected.
 */
export interface OutboundMessage {
  id: string;
  orgId: string;
  toPhone: string;
  templateKey: string;
  language: 'bn' | 'en';
  body: string;
  attempts: number;
}

export interface SendResult {
  providerMessageId: string;
}

export interface MessagingTransport {
  name: string;
  /** A template message (opens a conversation) or, for replies inside the 24-hour window, plain text. */
  send(message: OutboundMessage): Promise<SendResult>;
}

export interface OutboxStore {
  due(nowIso: string, limit: number): Promise<OutboundMessage[]>;
  /** Claim a queued message for sending; false when another worker already took it. */
  claim(id: string): Promise<boolean>;
  sent(id: string, providerMessageId: string, nowIso: string): Promise<void>;
  retry(id: string, attempts: number, nextAttemptIso: string, error: string): Promise<void>;
  failed(id: string, attempts: number, error: string): Promise<void>;
}

export const MAX_ATTEMPTS = 5;

/** 1, 2, 4, 8 … minutes, capped at an hour. */
export function backoffMinutes(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1));
}

/** Phone numbers never go into logs or error columns (CLAUDE.md #8). */
export function maskPhone(text: string): string {
  return text.replace(/\+?\d[\d\s-]{7,}\d/g, (m) => `${m.slice(0, 4)}…${m.slice(-2)}`);
}

export async function drainOutbox(deps: {
  store: OutboxStore;
  transport: MessagingTransport;
  now: () => Date;
  limit?: number;
}): Promise<{ sent: number; retried: number; failed: number }> {
  const at = deps.now();
  const counts = { sent: 0, retried: 0, failed: 0 };
  for (const message of await deps.store.due(at.toISOString(), deps.limit ?? 50)) {
    if (!(await deps.store.claim(message.id))) continue;
    try {
      const result = await deps.transport.send(message);
      await deps.store.sent(message.id, result.providerMessageId, deps.now().toISOString());
      counts.sent++;
    } catch (e) {
      const attempts = message.attempts + 1;
      const error = maskPhone(e instanceof Error ? e.message : String(e)).slice(0, 500);
      if (attempts >= MAX_ATTEMPTS) {
        await deps.store.failed(message.id, attempts, error);
        counts.failed++;
      } else {
        const next = new Date(at.getTime() + backoffMinutes(attempts) * 60_000);
        await deps.store.retry(message.id, attempts, next.toISOString(), error);
        counts.retried++;
      }
    }
  }
  return counts;
}

/** Stands in for WhatsApp until Meta verification; records what would have been sent. */
export function mockTransport(sentLog: OutboundMessage[] = []): MessagingTransport {
  let n = 0;
  return {
    name: 'mock',
    async send(message) {
      sentLog.push(message);
      return { providerMessageId: `mock-${message.id}-${++n}` };
    },
  };
}

/**
 * WhatsApp Cloud API (Meta Graph). TODO(verify): the Graph API version and the approved template names
 * with Meta at go-live; both are configuration, not code.
 */
export function whatsappTransport(cfg: {
  token: string;
  phoneNumberId: string;
  graphVersion: string;
  templateName: (templateKey: string, language: 'bn' | 'en') => string | null;
  fetchImpl?: typeof fetch;
}): MessagingTransport {
  const f = cfg.fetchImpl ?? fetch;
  return {
    name: 'whatsapp',
    async send(message) {
      const template = cfg.templateName(message.templateKey, message.language);
      const payload = template
        ? {
            messaging_product: 'whatsapp',
            to: message.toPhone,
            type: 'template',
            template: {
              name: template,
              language: { code: message.language === 'bn' ? 'bn' : 'en' },
              components: [{ type: 'body', parameters: [{ type: 'text', text: message.body }] }],
            },
          }
        : {
            messaging_product: 'whatsapp',
            to: message.toPhone,
            type: 'text',
            text: { body: message.body },
          };
      const res = await f(
        `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        messages?: { id: string }[];
        error?: { message?: string };
      };
      if (!res.ok || !json.messages?.[0]?.id) {
        throw new Error(`whatsapp ${res.status}: ${json.error?.message ?? 'no message id'}`);
      }
      return { providerMessageId: json.messages[0].id };
    },
  };
}
