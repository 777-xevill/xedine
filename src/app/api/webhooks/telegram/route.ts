import { after, NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { telegramApi, telegramSecretOk, type TelegramUpdate } from '@/lib/messaging/telegram';
import { handleTelegramUpdate } from '@/modules/purchasing/chat-bot';
import { handlePhoneSignIn, isPhoneSignInMessage } from '@/modules/tenancy/phone-sign-in-bot';

/**
 * Telegram bot webhook (ADR 0025). Telegram signs nothing, so it sends the secret given to setWebhook
 * in X-Telegram-Bot-Api-Secret-Token; anything without it is refused. Each update is handled once
 * (webhook_events), and after the response: reading a voice note takes longer than Telegram waits.
 * In development, `pnpm telegram:poll` fetches updates and posts them here with the same header.
 */
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (
    !token ||
    !telegramSecretOk(
      process.env.TELEGRAM_WEBHOOK_SECRET,
      request.headers.get('x-telegram-bot-api-secret-token'),
    )
  ) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (typeof update.update_id !== 'number') return NextResponse.json({ ok: true });

  // What the person wrote is theirs, not a log's: only the kind of update is kept.
  const sb = createServiceRoleClient();
  const { data: fresh } = await sb
    .from('webhook_events')
    .upsert(
      {
        provider: 'telegram',
        // Update ids count per bot; the bot's id (the token's public prefix) keeps a new bot's ids apart.
        event_id: `${token.split(':')[0]}:${update.update_id}`,
        payload: {
          kind: update.callback_query
            ? 'button'
            : update.message?.contact
              ? 'contact'
              : update.message?.voice
                ? 'voice'
                : 'message',
        },
      },
      { onConflict: 'provider,event_id', ignoreDuplicates: true },
    )
    .select('id');
  if ((fresh ?? []).length === 0) return NextResponse.json({ ok: true });

  after(async () => {
    try {
      const message = update.message;
      // Phone sign-in (ADR 0050) works for anyone, connected to a restaurant or not; private chats only.
      if (message?.chat.type === 'private' && isPhoneSignInMessage(message)) {
        await handlePhoneSignIn(
          message,
          telegramApi(token),
          sb,
          process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        );
      } else {
        await handleTelegramUpdate(update, telegramApi(token), sb);
      }
    } catch (e) {
      console.error('telegram update', e instanceof Error ? e.message.slice(0, 120) : 'error');
    }
  });
  return NextResponse.json({ ok: true });
}
