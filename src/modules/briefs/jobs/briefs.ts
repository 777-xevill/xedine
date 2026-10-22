import 'server-only';
import { createTranslator } from 'next-intl';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { telegramApi } from '@/lib/messaging/telegram';
import { formatBDT, formatNumber, type Locale } from '@/lib/i18n/format';
import { aiConfigured, gateway, type PromptVersion } from '@/lib/llm-gateway';
import { addDays, businessDate } from '@/lib/time/business-date';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { validateNumbers } from '@/modules/assistant/validator';
import { queueMessage } from '@/modules/messaging/jobs/outbox';

/**
 * Briefs (ROADMAP Phase 4): the morning brief (yesterday, plus the week on the org's week start),
 * the evening close (today so far). Numbers come only from metric functions, called as the service role
 * for one explicit org; an optional one- or two-sentence narrative is kept only if every number in it
 * is one of those figures (the same validator as the assistant).
 */
type Supabase = ReturnType<typeof createServiceRoleClient>;
export type BriefKind = 'morning' | 'evening' | 'weekly';

export const BRIEF_PROMPT: PromptVersion = {
  key: 'brief_narrative',
  version: 1,
  body: [
    'You write one or two short sentences of plain commentary for a restaurant owner in Bangladesh,',
    'about figures you are given. Do not introduce any number that is not in the figures, and do not',
    'calculate differences, percentages or averages. Point at what deserves attention today.',
    'Write in the requested language (bn = Bangla script, en = English).',
  ].join('\n'),
};

const num = (v: unknown) => Number(v ?? 0);

async function rpc(sb: Supabase, fn: string, args: Record<string, unknown>) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as Record<string, unknown>[];
}

async function totalSales(sb: Supabase, orgId: string, from: string, to: string) {
  const rows = await rpc(sb, 'metric_sales', {
    p_org: orgId,
    p_branch: null,
    p_from: from,
    p_to: to,
  });
  const t = rows.find((r) => r.branch_id === null) ?? {};
  return { net_poisha: num(t.net_poisha), orders: num(t.orders_completed) };
}

async function topItem(sb: Supabase, orgId: string, from: string, to: string, nowIso: string) {
  const rows = await rpc(sb, 'metric_item_qty', {
    p_org: orgId,
    p_branch: null,
    p_window: 'custom',
    p_now: nowIso,
    p_from: from,
    p_to: to,
  });
  const top = rows[0];
  return top ? { name: String(top.name), qty: num(top.qty) } : null;
}

export async function composeBrief(args: {
  sb: Supabase;
  orgId: string;
  kind: BriefKind;
  at: Date;
  locale: Locale;
}): Promise<{ text: string; figures: Record<string, unknown> }> {
  const { sb, orgId, kind, at, locale } = args;
  const t = createTranslator({ locale, messages: locale === 'bn' ? bn : en, namespace: 'briefs' });
  const money = (p: number) => formatBDT(p, locale, { poisha: 'never' });
  const n = (v: number) => formatNumber(v, locale);
  const { data: settings } = await sb
    .from('org_settings')
    .select('default_cutoff_minutes')
    .eq('org_id', orgId)
    .maybeSingle();
  const today = businessDate(at, settings?.default_cutoff_minutes ?? 240);
  const nowIso = at.toISOString();
  const lines: string[] = [];
  const figures: Record<string, unknown> = { kind, today };

  if (kind === 'morning') {
    const y = addDays(today, -1);
    const [sales, lastWeek, top] = await Promise.all([
      totalSales(sb, orgId, y, y),
      totalSales(sb, orgId, addDays(y, -7), addDays(y, -7)),
      topItem(sb, orgId, y, y, nowIso),
    ]);
    Object.assign(figures, { yesterday: sales, same_day_last_week: lastWeek, top_item: top });
    lines.push(
      t('morningSales', {
        net: money(sales.net_poisha),
        orders: n(sales.orders),
        lastWeek: money(lastWeek.net_poisha),
      }),
    );
    if (top) lines.push(t('topItem', { item: top.name, qty: n(top.qty) }));
    const pnl = await rpc(sb, 'metric_flash_pnl', { p_org: orgId, p_branch: null, p_now: nowIso });
    const total = pnl.find((r) => r.branch_id === null);
    if (total && num(total.breakeven_sales_poisha) > 0) {
      figures.breakeven_sales_poisha = num(total.breakeven_sales_poisha);
      lines.push(t('breakeven', { amount: money(num(total.breakeven_sales_poisha)) }));
    }
    // Phase 5 nudges: branches that skipped yesterday's habits, and ingredients running low.
    const [habits, stock, { data: branches }] = await Promise.all([
      rpc(sb, 'metric_discipline', { p_org: orgId, p_branch: null, p_from: y, p_to: y }),
      rpc(sb, 'metric_stock_status', { p_org: orgId, p_branch: null, p_now: nowIso }),
      sb.from('branches').select('id, name').eq('org_id', orgId),
    ]);
    const nameOf = new Map((branches ?? []).map((b) => [b.id as string, b.name as string]));
    const slipped = habits.filter((h) => h.score !== null && num(h.score) < 100);
    if (slipped.length > 0) {
      figures.discipline = slipped.map((h) => ({
        branch: nameOf.get(h.branch_id as string),
        score: num(h.score),
      }));
      for (const h of slipped)
        lines.push(
          t('habits', { branch: nameOf.get(h.branch_id as string) ?? '', score: n(num(h.score)) }),
        );
    }
    const low = stock.filter((s) => s.band === 'red').length;
    if (low > 0) {
      figures.low_stock_ingredients = low;
      lines.push(t('lowStock', { count: low, n: n(low) }));
    }
  } else if (kind === 'evening') {
    const [sales, top] = await Promise.all([
      totalSales(sb, orgId, today, today),
      topItem(sb, orgId, today, today, nowIso),
    ]);
    Object.assign(figures, { today: sales, top_item: top });
    lines.push(t('eveningSales', { net: money(sales.net_poisha), orders: n(sales.orders) }));
    if (top) lines.push(t('topItem', { item: top.name, qty: n(top.qty) }));
    const pnl = await rpc(sb, 'metric_flash_pnl', { p_org: orgId, p_branch: null, p_now: nowIso });
    const total = pnl.find((r) => r.branch_id === null);
    if (total) {
      figures.estimated_profit_poisha = num(total.estimated_profit_poisha);
      lines.push(t('estimatedProfit', { amount: money(num(total.estimated_profit_poisha)) }));
    }
    // Phase 7: what tomorrow needs cooked, from the prep plan (all branches together).
    const prep = await rpc(sb, 'metric_prep_plan', {
      p_org: orgId,
      p_branch: null,
      p_date: addDays(today, 1),
      p_now: nowIso,
    }).catch(() => []);
    const portions = new Map<string, number>();
    for (const p of prep)
      portions.set(String(p.name), (portions.get(String(p.name)) ?? 0) + num(p.portions));
    const topPrep = [...portions.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
    if (topPrep.length > 0) {
      figures.prep_tomorrow = Object.fromEntries(topPrep.map(([k, v]) => [k, Math.ceil(v)]));
      lines.push(
        t('prepTomorrow', { items: topPrep.map(([k, v]) => `${k} ${n(Math.ceil(v))}`).join(', ') }),
      );
    }
  } else {
    const end = addDays(today, -1);
    const [week, previous] = await Promise.all([
      totalSales(sb, orgId, addDays(end, -6), end),
      totalSales(sb, orgId, addDays(end, -13), addDays(end, -7)),
    ]);
    Object.assign(figures, { last_7_days: week, previous_7_days: previous });
    lines.push(
      t('weeklySales', {
        net: money(week.net_poisha),
        orders: n(week.orders),
        previous: money(previous.net_poisha),
      }),
    );
  }

  // The leaks to look at (money: the owner's own brief).
  const { data: open } = await sb
    .from('findings')
    .select('type, impact_poisha')
    .eq('org_id', orgId)
    .eq('status', 'new')
    .order('impact_poisha', { ascending: false })
    .limit(3);
  if ((open ?? []).length > 0) {
    figures.findings = open;
    lines.push(
      t('leaks', { count: n((open ?? []).length), top: money(num(open![0]!.impact_poisha)) }),
    );
  }

  let text = lines.join('\n');
  if (aiConfigured()) {
    try {
      const r = await gateway().run({
        orgId,
        feature: 'brief',
        prompt: BRIEF_PROMPT,
        tier: 'fast',
        content: [
          { type: 'text', text: `Language: ${locale}\nFigures: ${JSON.stringify(figures)}` },
        ],
        schema: z.object({ narrative: z.string() }),
        maxTokens: 400,
      });
      if (validateNumbers(r.output.narrative, [figures]).ok)
        text = `${text}\n\n${r.output.narrative.trim()}`;
    } catch {
      // The deterministic brief stands on its own.
    }
  }
  return { text, figures };
}

/** The owner's opted-in WhatsApp number and language, or null. */
export async function ownerRecipient(sb: Supabase, orgId: string) {
  const { data } = await sb
    .from('org_profile')
    .select('owner_whatsapp, owner_whatsapp_opt_in_at, brief_language')
    .eq('org_id', orgId)
    .maybeSingle();
  if (!data?.owner_whatsapp || !data.owner_whatsapp_opt_in_at) return null;
  return { phone: data.owner_whatsapp as string, locale: (data.brief_language as Locale) ?? 'bn' };
}

/**
 * Telegram chats the owner has connected (Settings → Telegram). Telegram is free and needs no plan or
 * template approval, so a connected owner always gets the brief there.
 */
async function ownerTelegramChats(sb: Supabase, orgId: string): Promise<number[]> {
  const [{ data: links }, { data: owners }] = await Promise.all([
    sb
      .from('chat_links')
      .select('user_id, external_id')
      .eq('org_id', orgId)
      .eq('channel', 'telegram')
      .is('revoked_at', null)
      .not('external_id', 'is', null),
    sb
      .from('memberships')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('role', 'owner')
      .eq('status', 'active'),
  ]);
  const ownerIds = new Set((owners ?? []).map((o) => o.user_id as string));
  const chats = (links ?? [])
    .filter((l) => ownerIds.has(l.user_id as string))
    .map((l) => Number(l.external_id))
    .filter((id) => Number.isSafeInteger(id));
  return [...new Set(chats)];
}

async function briefLocale(sb: Supabase, orgId: string): Promise<Locale> {
  const { data } = await sb
    .from('org_profile')
    .select('brief_language')
    .eq('org_id', orgId)
    .maybeSingle();
  return (data?.brief_language as Locale | null) ?? 'bn';
}

/** Compose one org's brief and deliver it: Telegram now, WhatsApp through the outbox. */
export async function queueBrief(
  sb: Supabase,
  orgId: string,
  kind: BriefKind,
  at: Date,
): Promise<'queued' | 'no_recipient'> {
  const [to, chats] = await Promise.all([ownerRecipient(sb, orgId), ownerTelegramChats(sb, orgId)]);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const telegram = token && chats.length > 0 ? telegramApi(token) : null;
  if (!to && !telegram) return 'no_recipient';
  const locale = to?.locale ?? (await briefLocale(sb, orgId));
  const brief = await composeBrief({ sb, orgId, kind, at, locale });
  let delivered = false;
  if (telegram) {
    for (const chat of chats) {
      try {
        await telegram.sendMessage(chat, brief.text);
        delivered = true;
      } catch (e) {
        console.error('brief telegram', e instanceof Error ? e.message.slice(0, 120) : 'error');
      }
    }
  }
  if (to) {
    const { data: settings } = await sb
      .from('org_settings')
      .select('default_cutoff_minutes')
      .eq('org_id', orgId)
      .maybeSingle();
    await queueMessage(sb, {
      orgId,
      toPhone: to.phone,
      templateKey: `brief_${kind}`,
      language: to.locale,
      body: brief.text,
      idempotencyKey: `brief_${kind}:${businessDate(at, settings?.default_cutoff_minutes ?? 240)}`,
    });
    delivered = true;
  }
  return delivered ? 'queued' : 'no_recipient';
}
