import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTranslator } from 'next-intl';
import type { Locale } from '@/lib/i18n/format';
import type { InlineButton, TelegramApi } from '@/lib/messaging/telegram';
import { businessDate } from '@/lib/time/business-date';
import { now } from '@/lib/time/clock';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { parseFeatures } from '@/modules/tenancy/navigation';
import type { Role } from '@/modules/tenancy/context';
import { askAssistant } from './agent';
import type { Translate } from './answers';

/**
 * The owner's Telegram (free replacement for WhatsApp, ADR 0017/0025): a linked owner taps a topic or
 * types a question and gets the same assistant answer as on the web. Service role, but only for a chat
 * linked to an active owner of that org, and every query names the org (CLAUDE.md #2, ADR 0007: the
 * owner may see money, so nothing here shows more than the web assistant shows them).
 */
type Sb = SupabaseClient;

export const ASK_CALLBACK = /^ask:([a-z]+)$/;
export const TOPICS = ['sales', 'profit', 'stock', 'leaks', 'top', 'buy'] as const;
type Topic = (typeof TOPICS)[number];

function chatT(locale: Locale) {
  const t = createTranslator({
    locale,
    messages: locale === 'bn' ? bn : en,
    namespace: 'chatBot',
  });
  return (key: string, values?: Record<string, string | number>) =>
    t(key as never, values as never) as string;
}

export async function isActiveOwner(sb: Sb, orgId: string, userId: string): Promise<boolean> {
  const { data } = await sb
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('role', 'owner')
    .eq('status', 'active')
    .limit(1);
  return (data ?? []).length > 0;
}

/** The topic buttons: the big subjects an owner asks about, two to a row. */
export function topicButtons(locale: Locale): InlineButton[][] {
  const t = chatT(locale);
  const buttons = TOPICS.map((k) => ({ text: t(`topics.${k}.label`), callback_data: `ask:${k}` }));
  const rows: InlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

export async function sendOwnerMenu(api: TelegramApi, chatId: number, locale: Locale) {
  await api.sendMessage(chatId, chatT(locale)('ownerHelp'), topicButtons(locale));
}

export function topicQuestion(topic: string, locale: Locale): string | null {
  return (TOPICS as readonly string[]).includes(topic)
    ? chatT(locale)(`topics.${topic as Topic}.question`)
    : null;
}

export async function answerOwnerQuestion(args: {
  sb: Sb;
  api: TelegramApi;
  chatId: number;
  orgId: string;
  locale: Locale;
  question: string;
}) {
  const { sb, api, chatId, orgId, locale } = args;
  const t = chatT(locale);
  await api.typing(chatId);
  try {
    const at = now();
    const [{ data: org }, { data: settings }, { data: rules }] = await Promise.all([
      sb.from('organizations').select('slug').eq('id', orgId).maybeSingle(),
      sb.from('org_settings').select('*').eq('org_id', orgId).maybeSingle(),
      sb.from('org_context').select('body').eq('org_id', orgId).eq('is_active', true),
    ]);
    const answer = await askAssistant({
      sb,
      orgId,
      question: args.question.slice(0, 1000),
      nowIso: at.toISOString(),
      businessDate: businessDate(
        at,
        (settings as { default_cutoff_minutes?: number } | null)?.default_cutoff_minutes ?? 240,
      ),
      ownerRules: (rules ?? []).map((r) => r.body as string),
      access: {
        slug: (org?.slug as string | undefined) ?? '',
        roles: ['owner' as Role],
        enabled: parseFeatures((settings as { enabled_features?: unknown } | null)?.enabled_features),
      },
      translate: async (l) =>
        createTranslator({
          locale: l,
          messages: l === 'bn' ? bn : en,
          namespace: 'assistant',
        }) as unknown as Translate,
    });
    await api.sendMessage(chatId, answer.text.slice(0, 4000), topicButtons(locale));
  } catch (e) {
    console.error('owner question', e instanceof Error ? e.name : 'error');
    await api.sendMessage(chatId, t('failed'));
  }
}
