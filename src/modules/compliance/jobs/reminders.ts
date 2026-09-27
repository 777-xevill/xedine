import 'server-only';
import { createTranslator } from 'next-intl';
import type { createServiceRoleClient } from '@/lib/db/service-role';
import { formatNumber } from '@/lib/i18n/format';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { ownerRecipient } from '@/modules/briefs/jobs/briefs';
import { queueMessage } from '@/modules/messaging/jobs/outbox';

type Supabase = ReturnType<typeof createServiceRoleClient>;

/**
 * Compliance reminders (ROADMAP Phase 10): licences at each threshold (default 60/30/7 days, then once when
 * expired) and the VAT return 7 and 2 days before the org's due day. SQL decides what is due and gives each
 * reminder a stable key; the outbox's idempotency key makes the daily run send it once. Owner's opted-in
 * WhatsApp only — nothing is sent to anyone else.
 */
export async function sendComplianceReminders(
  sb: Supabase,
  orgId: string,
  at: Date,
): Promise<number> {
  const to = await ownerRecipient(sb, orgId);
  if (!to) return 0;
  const { data, error } = await sb.rpc('job_compliance_reminders', {
    p_org: orgId,
    p_now: at.toISOString(),
  });
  if (error) throw error;
  const t = createTranslator({
    locale: to.locale,
    messages: to.locale === 'bn' ? bn : en,
    namespace: 'compliance',
  });
  const rows = (data ?? []) as {
    reminder_key: string;
    kind: string;
    label: string;
    due_on: string;
    days_left: number;
  }[];
  for (const r of rows) {
    const days = formatNumber(Math.abs(Number(r.days_left)), to.locale);
    const body =
      r.kind === 'vat_return'
        ? t('reminderVat', { month: r.label, date: r.due_on, days })
        : Number(r.days_left) < 0
          ? t('reminderExpired', { licence: r.label, date: r.due_on })
          : t('reminderLicence', { licence: r.label, date: r.due_on, days });
    await queueMessage(sb, {
      orgId,
      toPhone: to.phone,
      templateKey: 'compliance_reminder',
      language: to.locale,
      body,
      idempotencyKey: `compliance:${r.reminder_key}`,
    });
  }
  return rows.length;
}
