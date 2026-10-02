/**
 * Telegram bot plumbing (ADR 0025).
 *
 *   pnpm telegram:poll            Development: Telegram cannot reach 127.0.0.1, so this asks Telegram for
 *                                 new messages (long polling) and posts each one to the local webhook
 *                                 route with the secret header — the app handles them exactly as it
 *                                 would in production. Keep `pnpm dev` running alongside.
 *   pnpm telegram:webhook <url>   Production: tell Telegram to post to <url>/api/webhooks/telegram.
 *
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from .env.local.
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token || !secret) {
  console.error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env.local first.');
  process.exit(1);
}

async function call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description ?? res.status}`);
  return json.result;
}

const ALLOWED = ['message', 'callback_query'];

async function webhook(base: string | undefined) {
  if (!base?.startsWith('https://')) {
    console.error('Usage: pnpm telegram:webhook https://your-app.example');
    process.exit(1);
  }
  const url = `${base.replace(/\/$/, '')}/api/webhooks/telegram`;
  await call('setWebhook', { url, secret_token: secret, allowed_updates: ALLOWED });
  console.log(`Telegram now posts to ${url}`);
}

async function poll() {
  const target = process.env.TELEGRAM_POLL_TARGET ?? 'http://127.0.0.1:3000/api/webhooks/telegram';
  const me = await call<{ username: string }>('getMe');
  // Long polling and a webhook cannot both be on; this switches the bot to polling.
  await call('deleteWebhook');
  console.log(`@${me.username}: polling Telegram, forwarding to ${target}. Ctrl+C to stop.`);
  let offset = 0;
  for (;;) {
    let updates: { update_id: number }[] = [];
    try {
      updates = await call('getUpdates', { offset, timeout: 30, allowed_updates: ALLOWED });
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      try {
        const res = await fetch(target, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Bot-Api-Secret-Token': secret!,
          },
          body: JSON.stringify(update),
        });
        console.log(`update ${update.update_id} → ${res.status}`);
      } catch {
        console.error(`update ${update.update_id}: is \`pnpm dev\` running at ${target}?`);
      }
    }
  }
}

const [mode, arg] = process.argv.slice(2);
(mode === 'webhook' ? webhook(arg) : poll()).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
