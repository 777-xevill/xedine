import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTranslator } from 'next-intl';
import { formatDhakaDate, isLocale, type Locale } from '@/lib/i18n/format';
import { aiConfigured, aiErrorKey, gateway, speechConfigured } from '@/lib/llm-gateway';
import type { TelegramApi, TelegramUpdate } from '@/lib/messaging/telegram';
import { businessDate } from '@/lib/time/business-date';
import { now } from '@/lib/time/clock';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { parseBazarText } from './bazar-text';
import {
  DAYS_CALLBACK,
  draftButtons,
  draftSummary,
  PICK_CALLBACK,
  type ChatT,
} from './chat-format';
import { extractPurchase, PURCHASE_EXTRACT_PROMPT, type ExtractedPurchase } from './extraction';
import {
  applyPick,
  proposeNewItems,
  reviewLines,
  setListDays,
  withDays,
  type IngredientRef,
  type PurchaseUnit,
  type ReviewLine,
} from './lines';

/**
 * The bazar bot (ADR 0025). A purchaser's chat, linked once by the owner, sends the day's purchases as
 * text, a voice note or a photo of the chit; the bot saves a draft and answers with every line and a ✅
 * button. Only the tap records the purchase — through chat_confirm_purchase_draft, which acts as that
 * purchaser, so the web's role checks and audit apply unchanged (CLAUDE.md #4, #5).
 *
 * Service role throughout, but every query names its org, and every write goes through a chat_* RPC
 * that resolves the chat to its one linked person (CLAUDE.md #2). Nothing the person says is logged.
 */
/** The webhook's service-role client (only webhooks and jobs may create one). */
type Sb = SupabaseClient;

const CHANNEL = 'telegram';
const MAX_VOICE_SECONDS = 300;
const CALLBACK = /^(ok|no):([0-9a-f-]{36})$/;
// A hint for the speech model: the words a bazar list is made of.
const SPEECH_HINT =
  'বাজারের তালিকা: মুরগি ১০ কেজি ১৮০০ টাকা, পেঁয়াজ ৫ কেজি ৩০০ টাকা, ডিম ২ ডজন ৩৩০ টাকা, চাল, তেল, লিটার, হালি, পিস।';

interface Session {
  orgId: string;
  branchId: string;
  userId: string;
  locale: Locale;
}

function translators(locale: Locale): { t: ChatT; unit: (u: PurchaseUnit) => string } {
  const messages = locale === 'bn' ? bn : en;
  const t = createTranslator({ locale, messages, namespace: 'chatBot' });
  const units = createTranslator({ locale, messages, namespace: 'units' });
  return {
    t: (key, values) => t(key as never, values as never),
    unit: (u) => units(u as never),
  };
}

async function sessionFor(sb: Sb, chatId: string): Promise<Session | null> {
  const { data: link } = await sb
    .from('chat_links')
    .select('org_id, branch_id, user_id')
    .eq('channel', CHANNEL)
    .eq('external_id', chatId)
    .is('revoked_at', null)
    .maybeSingle();
  if (!link) return null;
  const { data: profile } = await sb
    .from('profiles')
    .select('locale')
    .eq('user_id', link.user_id as string)
    .maybeSingle();
  return {
    orgId: link.org_id as string,
    branchId: link.branch_id as string,
    userId: link.user_id as string,
    locale: isLocale(profile?.locale) ? profile.locale : 'bn',
  };
}

/** What each item was last bought for at this chat's branch (ADR 0029). */
async function usualDays(sb: Sb, externalId: string): Promise<Map<string, number>> {
  const { data } = await sb.rpc('chat_usual_days', {
    p_channel: CHANNEL,
    p_external_id: externalId,
  });
  return new Map(
    ((data ?? []) as { ingredient_id: string; for_days: number }[]).map((r) => [
      r.ingredient_id,
      r.for_days,
    ]),
  );
}

/**
 * Every item of the org with the spellings learnt for it (ADR 0028). Hidden items are included: a
 * purchaser buying one again should find it, and the purchase brings it back.
 */
async function ingredientRefs(sb: Sb, orgId: string): Promise<IngredientRef[]> {
  const [{ data: ingredients }, { data: aliases }] = await Promise.all([
    sb.from('ingredients').select('id, name, name_bn, base').eq('org_id', orgId),
    sb.from('ingredient_aliases').select('ingredient_id, alias').eq('org_id', orgId),
  ]);
  const byIngredient = new Map<string, string[]>();
  for (const a of aliases ?? []) {
    const list = byIngredient.get(a.ingredient_id as string) ?? [];
    list.push(a.alias as string);
    byIngredient.set(a.ingredient_id as string, list);
  }
  return ((ingredients ?? []) as IngredientRef[]).map((i) => ({
    ...i,
    aliases: byIngredient.get(i.id) ?? [],
  }));
}

/** The list as the bot shows it, with its buttons — the same after a pick as when first sent. */
async function renderDraft(
  sb: Sb,
  session: Session,
  draft: { id: string; createdAt: Date; heard?: string; lines: ReviewLine[] },
  refs: IngredientRef[],
) {
  const { t, unit } = translators(session.locale);
  const [{ data: branch }, { data: settings }] = await Promise.all([
    sb
      .from('branches')
      .select('name')
      .eq('org_id', session.orgId)
      .eq('id', session.branchId)
      .maybeSingle(),
    sb
      .from('org_settings')
      .select('default_cutoff_minutes')
      .eq('org_id', session.orgId)
      .maybeSingle(),
  ]);
  const ingredients = new Map(refs.map((i) => [i.id, i]));
  const day = businessDate(draft.createdAt, settings?.default_cutoff_minutes ?? 240);
  const summary = draftSummary({
    lines: draft.lines,
    ingredients,
    locale: session.locale,
    t,
    unit,
    branch: (branch?.name as string | undefined) ?? '',
    date: formatDhakaDate(new Date(`${day}T12:00:00+06:00`), session.locale),
  });
  const text = [draft.heard ? t('heard', { text: draft.heard.slice(0, 500) }) : '', summary.text]
    .filter(Boolean)
    .join('\n\n');
  const buttons = draftButtons({
    draftId: draft.id,
    lines: draft.lines,
    ingredients,
    locale: session.locale,
    t,
    complete: summary.complete,
  });
  return { text: text.slice(0, 4000), buttons };
}

/** Postgres error → the chat's words for it. Raw database text never reaches the person. */
function dbErrorKey(error: { code?: string; message?: string }): string {
  if (error.code === 'P0002') return 'notConnected';
  if (error.code === '42501') return 'notAllowed';
  if (error.message?.includes('already reviewed')) return 'alreadyDone';
  if (error.message?.includes('needs fixing')) return 'needsFix';
  return 'failed';
}

export async function handleTelegramUpdate(update: TelegramUpdate, api: TelegramApi, sb: Sb) {
  if (update.callback_query) return handleButton(sb, api, update.callback_query);
  const message = update.message;
  // Private chats only: a group would show one person's prices to everyone in it.
  if (!message || message.chat.type !== 'private') return;
  const chatId = message.chat.id;
  const externalId = String(chatId);
  const text = message.text?.trim() ?? '';

  if (text.startsWith('/start')) {
    const code = text.slice('/start'.length).trim();
    if (code) return redeem(sb, api, chatId, code);
  }
  const session = await sessionFor(sb, externalId);
  if (text === '/stop') {
    await sb.rpc('chat_unlink', { p_channel: CHANNEL, p_external_id: externalId });
    return api.sendMessage(chatId, translators(session?.locale ?? 'bn').t('stopped'));
  }
  if (!session) {
    return api.sendMessage(chatId, translators('bn').t('notConnected'));
  }
  const { t } = translators(session.locale);
  if (text.startsWith('/')) return api.sendMessage(chatId, t('help'));

  let extracted: ExtractedPurchase | undefined;
  // "3 din er bazar" on a line of its own: the days for every line that does not say its own.
  let listDays: number | undefined;
  // Set when a model read the list (not the typed-list parser), for the draft's provenance.
  let model: string | undefined;
  let source: 'import' | 'voice' | 'photo' = 'import';
  let heard: string | undefined;
  let rawText = text || message.caption?.trim() || '';
  try {
    const audio = message.voice ?? message.audio;
    const photo = message.photo?.at(-1);
    if (audio) {
      if (!speechConfigured()) return api.sendMessage(chatId, t('voiceOff'));
      if (audio.duration > MAX_VOICE_SECONDS) return api.sendMessage(chatId, t('tooLong'));
      await api.typing(chatId);
      const file = await api.download(audio.file_id);
      if (!file) return api.sendMessage(chatId, t('tooLong'));
      heard = await gateway().transcribe({
        orgId: session.orgId,
        feature: 'purchase_voice',
        audio: file.bytes,
        // Telegram voice notes are Ogg/Opus saved as .oga; the speech API knows the .ogg name.
        filename: file.path.endsWith('.oga')
          ? 'voice.ogg'
          : (file.path.split('/').pop() ?? 'audio'),
        seconds: audio.duration,
        prompt: SPEECH_HINT,
      });
      rawText = heard;
      source = 'voice';
    } else if (photo) {
      if (!aiConfigured()) return api.sendMessage(chatId, t('photoOff'));
      await api.typing(chatId);
      const file = await api.download(photo.file_id);
      if (!file) return api.sendMessage(chatId, t('tooLong'));
      ({ extracted, model } = await extractPurchase({
        orgId: session.orgId,
        text: message.caption,
        image: { mediaType: 'image/jpeg', base64: Buffer.from(file.bytes).toString('base64') },
      }));
      source = 'photo';
    }
    if (source !== 'photo') {
      if (!rawText) return api.sendMessage(chatId, t('help'));
      const typed = parseBazarText(rawText);
      if (typed.lines.length > 0 && typed.unread.length === 0) {
        extracted = { supplier: '', date: '', notes: '', lines: typed.lines };
        listDays = typed.days;
      } else if (aiConfigured()) {
        await api.typing(chatId);
        ({ extracted, model } = await extractPurchase({ orgId: session.orgId, text: rawText }));
      } else {
        const unread = typed.unread.length > 0 ? typed.unread : [rawText];
        return api.sendMessage(
          chatId,
          [
            heard ? t('heard', { text: heard.slice(0, 500) }) : '',
            t('cantRead', { lines: unread.join('\n') }),
          ]
            .filter(Boolean)
            .join('\n\n'),
        );
      }
    }
  } catch (e) {
    console.error('chat purchase read', e instanceof Error ? e.name : 'error');
    return api.sendMessage(chatId, t(`ai.${aiErrorKey(e)}`));
  }

  if (!extracted) return api.sendMessage(chatId, t('help'));
  const [refs, usual] = await Promise.all([
    ingredientRefs(sb, session.orgId),
    usualDays(sb, externalId),
  ]);
  const review = withDays(
    proposeNewItems(reviewLines(extracted.lines, refs), refs),
    listDays,
    usual,
  );
  if (review.length === 0) return api.sendMessage(chatId, t('nothingFound'));

  const { data: draftId, error } = await sb.rpc('chat_create_purchase_draft', {
    p_channel: CHANNEL,
    p_external_id: externalId,
    p_source: source,
    p_raw_text: rawText || null,
    p_extracted: {
      supplier: extracted.supplier,
      date: extracted.date,
      notes: extracted.notes,
      lines: review,
      channel: CHANNEL,
      ...(model
        ? {
            model,
            prompt: { key: PURCHASE_EXTRACT_PROMPT.key, version: PURCHASE_EXTRACT_PROMPT.version },
          }
        : {}),
    },
    p_confidence: confidenceOf(review),
  });
  if (error || typeof draftId !== 'string') {
    return api.sendMessage(chatId, t(error ? dbErrorKey(error) : 'failed'));
  }

  const shown = await renderDraft(
    sb,
    session,
    { id: draftId, createdAt: now(), heard, lines: review },
    refs,
  );
  await api.sendMessage(chatId, shown.text, shown.buttons);
}

const confidenceOf = (lines: ReviewLine[]) => ({
  flagged: lines.filter((l) => l.flags.length > 0).length,
  lines: lines.length,
});

async function redeem(sb: Sb, api: TelegramApi, chatId: number, code: string) {
  const { data, error } = await sb.rpc('chat_redeem_link', {
    p_channel: CHANNEL,
    p_external_id: String(chatId),
    p_code: code.slice(0, 100),
  });
  const row = (data as { org_id: string; branch_id: string }[] | null)?.[0];
  if (error || !row) return api.sendMessage(chatId, translators('bn').t('linkInvalid'));
  const session = await sessionFor(sb, String(chatId));
  const [{ data: org }, { data: branch }] = await Promise.all([
    sb.from('organizations').select('name').eq('id', row.org_id).maybeSingle(),
    sb
      .from('branches')
      .select('name')
      .eq('org_id', row.org_id)
      .eq('id', row.branch_id)
      .maybeSingle(),
  ]);
  const { t } = translators(session?.locale ?? 'bn');
  await api.sendMessage(
    chatId,
    [
      t('welcome', {
        org: (org?.name as string | undefined) ?? '',
        branch: (branch?.name as string | undefined) ?? '',
      }),
      t('help'),
    ].join('\n\n'),
  );
}

async function handleButton(
  sb: Sb,
  api: TelegramApi,
  cq: NonNullable<TelegramUpdate['callback_query']>,
) {
  const message = cq.message;
  const data = cq.data ?? '';
  const pick = PICK_CALLBACK.exec(data);
  if (pick && message && message.chat.type === 'private') {
    return handlePick(sb, api, cq.id, message, pick[1]!, Number(pick[2]), pick[3]!);
  }
  const days = DAYS_CALLBACK.exec(data);
  if (days && message && message.chat.type === 'private') {
    return handleDays(sb, api, cq.id, message, days[1]!, Number(days[2]));
  }
  const m = CALLBACK.exec(data);
  if (!message || !m || message.chat.type !== 'private') return api.answerCallback(cq.id);
  const chatId = message.chat.id;
  const session = await sessionFor(sb, String(chatId));
  const { t } = translators(session?.locale ?? 'bn');
  const confirm = m[1] === 'ok';
  const { error } = confirm
    ? await sb.rpc('chat_confirm_purchase_draft', {
        p_channel: CHANNEL,
        p_external_id: String(chatId),
        p_draft: m[2]!,
      })
    : await sb.rpc('chat_discard_purchase_draft', {
        p_channel: CHANNEL,
        p_external_id: String(chatId),
        p_draft: m[2]!,
      });
  const outcome = error ? t(dbErrorKey(error)) : t(confirm ? 'added' : 'cancelled');
  await api.answerCallback(cq.id, outcome.slice(0, 190));
  // Replace the buttons with the outcome, so the same list cannot be tapped twice.
  await api
    .editMessage(chatId, message.message_id, `${message.text ?? ''}\n\n${outcome}`.slice(0, 4000))
    .catch(() => undefined);
}

/** A tap on "N days" under a list: every line without its own written days takes N (ADR 0029). */
async function handleDays(
  sb: Sb,
  api: TelegramApi,
  callbackId: string,
  message: NonNullable<NonNullable<TelegramUpdate['callback_query']>['message']>,
  draftId: string,
  days: number,
) {
  const chatId = message.chat.id;
  const session = await sessionFor(sb, String(chatId));
  const { t } = translators(session?.locale ?? 'bn');
  if (!session) return api.answerCallback(callbackId, t('notConnected').slice(0, 190));
  const { data: draft } = await sb
    .from('purchase_drafts')
    .select('id, status, source, raw_text, extracted, created_at')
    .eq('org_id', session.orgId)
    .eq('created_by', session.userId)
    .eq('id', draftId)
    .maybeSingle();
  if (!draft) return api.answerCallback(callbackId, t('notAllowed').slice(0, 190));
  if (draft.status !== 'pending_review') {
    return api.answerCallback(callbackId, t('alreadyDone').slice(0, 190));
  }
  const lines = setListDays(
    (draft.extracted as { lines?: ReviewLine[] } | null)?.lines ?? [],
    days,
  );
  if (!lines) return api.answerCallback(callbackId);
  const { error } = await sb.rpc('chat_update_purchase_draft', {
    p_channel: CHANNEL,
    p_external_id: String(chatId),
    p_draft: draftId,
    p_lines: lines,
    p_confidence: confidenceOf(lines),
  });
  if (error) return api.answerCallback(callbackId, t(dbErrorKey(error)).slice(0, 190));
  await api.answerCallback(callbackId);
  const shown = await renderDraft(
    sb,
    session,
    {
      id: draftId,
      createdAt: new Date(draft.created_at as string),
      heard:
        draft.source === 'voice' ? ((draft.raw_text as string | null) ?? undefined) : undefined,
      lines,
    },
    await ingredientRefs(sb, session.orgId),
  );
  await api
    .editMessage(chatId, message.message_id, shown.text, shown.buttons)
    .catch(() => undefined);
}

/**
 * A tap on one of a line's item buttons (ADR 0028): the purchaser's choice is enough. The line takes
 * that item (or becomes a new one), the draft is saved, and the same message is redrawn with the
 * next buttons; ✅ appears once every line is complete. Nothing is recorded until ✅.
 */
async function handlePick(
  sb: Sb,
  api: TelegramApi,
  callbackId: string,
  message: NonNullable<NonNullable<TelegramUpdate['callback_query']>['message']>,
  draftId: string,
  lineIndex: number,
  choice: string,
) {
  const chatId = message.chat.id;
  const session = await sessionFor(sb, String(chatId));
  const { t } = translators(session?.locale ?? 'bn');
  if (!session) return api.answerCallback(callbackId, t('notConnected').slice(0, 190));
  const { data: draft } = await sb
    .from('purchase_drafts')
    .select('id, status, source, raw_text, extracted, created_at')
    .eq('org_id', session.orgId)
    .eq('created_by', session.userId)
    .eq('id', draftId)
    .maybeSingle();
  if (!draft) return api.answerCallback(callbackId, t('notAllowed').slice(0, 190));
  if (draft.status !== 'pending_review') {
    return api.answerCallback(callbackId, t('alreadyDone').slice(0, 190));
  }
  const picked = ((draft.extracted as { lines?: ReviewLine[] } | null)?.lines ?? []).slice();
  const refs = await ingredientRefs(sb, session.orgId);
  const line = picked[lineIndex];
  const next = line ? applyPick(line, choice === 'n' ? 'new' : Number(choice), refs) : null;
  if (!next) return api.answerCallback(callbackId, t('alreadyDone').slice(0, 190));
  picked[lineIndex] = next;
  // The item now known may have been bought before: its usual days fill the line if it has none.
  const lines = withDays(picked, undefined, await usualDays(sb, String(chatId)));
  const { error } = await sb.rpc('chat_update_purchase_draft', {
    p_channel: CHANNEL,
    p_external_id: String(chatId),
    p_draft: draftId,
    p_lines: lines,
    p_confidence: confidenceOf(lines),
  });
  if (error) return api.answerCallback(callbackId, t(dbErrorKey(error)).slice(0, 190));
  await api.answerCallback(callbackId);
  const shown = await renderDraft(
    sb,
    session,
    {
      id: draftId,
      createdAt: new Date(draft.created_at as string),
      heard:
        draft.source === 'voice' ? ((draft.raw_text as string | null) ?? undefined) : undefined,
      lines,
    },
    refs,
  );
  await api
    .editMessage(chatId, message.message_id, shown.text, shown.buttons)
    .catch(() => undefined);
}
