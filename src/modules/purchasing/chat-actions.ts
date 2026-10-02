'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Settings → Telegram (ADR 0025): the owner makes a one-time link for a purchaser and sends it to them
 * (WhatsApp, SMS — any way); tapping it opens the bot and connects that person's chat. Both RPCs are
 * owner-checked and audited in SQL.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const BOT = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export async function createChatLinkAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z
    .object({
      orgId: z.uuid(),
      orgSlug: z.string().regex(SLUG),
      target: z.string().regex(/^[0-9a-f-]{36}\|[0-9a-f-]{36}$/),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const bot = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
  if (!bot || !BOT.test(bot) || !process.env.TELEGRAM_BOT_TOKEN) {
    return { error: 'telegramNotSetUp' };
  }
  const [userId, branchId] = parsed.data.target.split('|') as [string, string];
  const supabase = await createClient();
  const { data: code, error } = await supabase.rpc('create_chat_link', {
    p_org: parsed.data.orgId,
    p_user: userId,
    p_branch: branchId,
    p_channel: 'telegram',
  });
  if (error || typeof code !== 'string') return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/settings/telegram`);
  return { ok: true, data: { link: `https://t.me/${bot}?start=${code}` } };
}

export async function revokeChatLinkAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({ linkId: z.uuid(), orgSlug: z.string().regex(SLUG) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('revoke_chat_link', { p_link: parsed.data.linkId });
  if (error) console.error('revoke chat link', error.code);
  revalidatePath(`/${parsed.data.orgSlug}/settings/telegram`);
}
