import 'server-only';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { publicEnv } from '@/lib/env';
import {
  generateVapidKeys,
  sendWebPush,
  type PushOutcome,
  type VapidKeys,
} from '@/lib/messaging/web-push';
import { now } from '@/lib/time/clock';
import { memberCardPath } from '../member-card';

/**
 * Offer notifications on the customer's own phone (ADR 0048), service role. A campaign the owner approved
 * is pushed to the phones of the customers it just queued (consent, holdout and frequency cap were already
 * decided by run_campaign). Every query names the org. Nothing here decides a number or writes an offer.
 */
type Supabase = ReturnType<typeof createServiceRoleClient>;

/** A Worker may make only so many outgoing requests per call, so one run notifies this many phones. */
export const PUSH_PER_RUN = 30;

let cached: VapidKeys | null = null;

/** The server's VAPID key pair; made and stored the first time it is needed. */
export async function vapidKeys(sb: Supabase = createServiceRoleClient()): Promise<VapidKeys> {
  if (cached) return cached;
  const read = (v: unknown): VapidKeys | null => {
    const r = v as { public_key?: string; private_jwk?: string } | null;
    return r?.public_key && r.private_jwk
      ? { publicKey: r.public_key, privateJwk: r.private_jwk }
      : null;
  };
  const got = await sb.rpc('web_push_keys_get');
  if (got.error) throw got.error;
  let keys = read(got.data);
  if (!keys) {
    const made = await generateVapidKeys();
    const put = await sb.rpc('web_push_keys_put', {
      p_public: made.publicKey,
      p_private_jwk: made.privateJwk,
    });
    if (put.error) throw put.error;
    keys = read(put.data);
  }
  if (!keys) throw new Error('web push keys missing');
  cached = keys;
  return keys;
}

/** What the table page hands to the browser's subscribe(); null when push cannot be set up right now. */
export async function vapidPublicKey(): Promise<string | null> {
  try {
    return (await vapidKeys()).publicKey;
  } catch (error) {
    console.error('web push keys', error instanceof Error ? error.message : 'failed');
    return null;
  }
}

/** Saves the phone for the member whose card token is given. Returns whether it was saved. */
export async function savePushSubscription(
  sb: Supabase,
  cardToken: string,
  sub: { endpoint: string; p256dh: string; auth: string },
): Promise<boolean> {
  const { data, error } = await sb.rpc('save_push_subscription', {
    p_card_token: cardToken,
    p_endpoint: sub.endpoint,
    p_p256dh: sub.p256dh,
    p_auth: sub.auth,
  });
  if (error) {
    console.error('save push', error.code);
    return false;
  }
  return (data as { status?: string } | null)?.status === 'saved';
}

/**
 * For a signed-in owner or manager whose run_campaign call just succeeded (SQL checked the role): the same
 * as pushCampaign with its own service client. A failure never undoes the run.
 */
export async function pushCampaignAfterRun(
  campaignId: string,
  at: Date,
): Promise<{ sent: number; failed: number }> {
  try {
    return await pushCampaign(createServiceRoleClient(), campaignId, at);
  } catch (error) {
    console.error('campaign push', error instanceof Error ? error.message : 'failed');
    return { sent: 0, failed: 0 };
  }
}

/**
 * Pushes the campaign's text to every phone of the customers that run (at = its p_now) queued. Returns how
 * many phones were reached. A phone the browser has dropped is switched off.
 */
export async function pushCampaign(
  sb: Supabase,
  campaignId: string,
  at: Date,
): Promise<{ sent: number; failed: number }> {
  const { data: c, error } = await sb
    .from('campaigns')
    .select('org_id, name, body_bn, body_en')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw error;
  if (!c) return { sent: 0, failed: 0 };
  const orgId = c.org_id as string;

  const [{ data: org }, { data: settings }, { data: sends }] = await Promise.all([
    sb.from('organizations').select('name').eq('id', orgId).maybeSingle(),
    sb.from('org_settings').select('default_locale').eq('org_id', orgId).maybeSingle(),
    sb
      .from('campaign_sends')
      .select('customer_id')
      .eq('org_id', orgId)
      .eq('campaign_id', campaignId)
      .eq('status', 'queued')
      .eq('is_holdout', false)
      .eq('created_at', at.toISOString()),
  ]);
  const customers = [...new Set((sends ?? []).map((s) => s.customer_id as string))];
  if (customers.length === 0) return { sent: 0, failed: 0 };

  const { data: cards } = await sb
    .from('member_cards')
    .select('customer_id, token')
    .eq('org_id', orgId)
    .in('customer_id', customers);
  const cardOf = new Map((cards ?? []).map((m) => [m.customer_id as string, m.token as string]));

  const en = settings?.default_locale === 'en';
  const body = ((en ? c.body_en : c.body_bn) ?? c.body_bn ?? c.body_en ?? '') as string;
  const title = (org?.name as string | undefined) ?? 'Xedine';
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  return pushToCustomers(
    sb,
    orgId,
    customers.map((customerId) => {
      const card = cardOf.get(customerId);
      return {
        customerId,
        title,
        body,
        url: card ? `${site}${memberCardPath(card)}` : site,
        tag: `campaign-${campaignId}`,
      };
    }),
  );
}

export interface CustomerNotice {
  customerId: string;
  title: string;
  body: string;
  /** Opened when the customer taps the notification; a link on this site. */
  url: string;
  /** Same tag = the newer notification replaces the older one on the phone. */
  tag: string;
}

/**
 * Rings every active phone of each customer with their notice (at most PUSH_PER_RUN phones, least recently
 * notified first). A phone the browser has dropped is switched off. The only way Xedine messages a customer
 * (ADR 0052).
 */
export async function pushToCustomers(
  sb: Supabase,
  orgId: string,
  notices: CustomerNotice[],
): Promise<{ sent: number; failed: number }> {
  if (notices.length === 0) return { sent: 0, failed: 0 };
  const noticeOf = new Map(notices.map((n) => [n.customerId, n]));
  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('id, customer_id, endpoint, p256dh, auth')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .in('customer_id', [...noticeOf.keys()])
    .order('last_sent_at', { ascending: true, nullsFirst: true })
    .limit(PUSH_PER_RUN);
  if (!subs || subs.length === 0) return { sent: 0, failed: 0 };
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const keys = await vapidKeys(sb);

  let sent = 0;
  let failed = 0;
  const gone: string[] = [];
  const delivered: string[] = [];
  // A few at a time: fast, and kind to the push services.
  for (let i = 0; i < subs.length; i += 5) {
    await Promise.all(
      subs.slice(i, i + 5).map(async (s) => {
        const n = noticeOf.get(s.customer_id as string)!;
        const message = JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.tag });
        let outcome: PushOutcome;
        try {
          outcome = await sendWebPush({
            target: {
              endpoint: s.endpoint as string,
              p256dh: s.p256dh as string,
              auth: s.auth as string,
            },
            message,
            keys,
            subject: site,
            nowMs: now().getTime(),
          });
        } catch {
          outcome = 'failed';
        }
        if (outcome === 'sent') {
          sent += 1;
          delivered.push(s.id as string);
        } else {
          failed += 1;
          if (outcome === 'gone') gone.push(s.id as string);
        }
      }),
    );
  }
  if (delivered.length > 0) {
    await sb
      .from('push_subscriptions')
      .update({ last_sent_at: now().toISOString() })
      .eq('org_id', orgId)
      .in('id', delivered);
  }
  if (gone.length > 0) {
    await sb
      .from('push_subscriptions')
      .update({ is_active: false })
      .eq('org_id', orgId)
      .in('id', gone);
  }
  return { sent, failed };
}
