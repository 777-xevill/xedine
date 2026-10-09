import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AiError, aiConfigured, gateway, type PromptVersion } from '@/lib/llm-gateway';
import type { Access } from './app-guide';
import { renderAnswer, toolForIntent, type Translate } from './answers';
import { restaurantCard } from './card';
import { answerLocale, detectLanguage, type QuestionLanguage } from './language';
import { forModel, forReader } from './for-model';
import { pageLinks, type PageLink } from './links';
import { routeQuestion, type MenuRef } from './router';
import { selectTools } from './tool-select';
import { runTool, type ToolContext, type ToolResult } from './tools';
import { validateNumbers } from './validator';

/**
 * The owner assistant (PRODUCT.md M10, ARCHITECTURE.md "AI layer"). Numbers only from tools: a model's
 * answer is checked by the numeric validator, retried once with the offending numbers named, and
 * otherwise replaced by the deterministic answer. With no AI key, the deterministic router answers.
 */
export const ASSISTANT_PROMPT: PromptVersion = {
  key: 'assistant',
  version: 5,
  body: [
    'You are Xedine, the AI manager of this restaurant in Bangladesh. You work for the owner and know the',
    'business like a sharp operations manager: sales, menu, recipes, stock, loss, waste, purchases, money',
    'leaks, staff exceptions, customers, reviews, branches, licences and tax dates. You also know the app.',
    'You know the restaurant from the Restaurant card in the context; everything live or numeric comes from',
    'tools. You cannot change anything: you advise and say which page to do it on.',
    '',
    'How to work:',
    '- Broad questions ("what should I do", "how are we doing", "what is wrong"): call get_today_brief',
    '  first, then dig into the biggest thing with another tool if you have one (the cause, not just the',
    '  symptom). Use as many tools as the question needs.',
    '- End with what to do next: one to three concrete steps, most important first, each with the page to',
    '  do it on. Unsure of a page name or "where do I...": call find_page. A page that is switched off is',
    '  switched on by the owner in Settings → Features; if the role cannot open it, say so.',
    '- Missing data is an answer: say what is missing and where to add it (no recipes: food cost is only',
    '  assumed; one stock count: loss per item cannot be shown yet).',
    '- Staff exceptions are things to check, never accusations.',
    '- Name only pages that find_page or the card gave you; never invent a page, and never mention tool or',
    '  field names (like setup_steps_left): say it in plain words.',
    '- Loss ("loss", "লস", "kothay loss", "where is money going"): say where (top items with amounts), why',
    '  (written-down waste or not explained) and one or two things to check (portions, a bad count,',
    '  unrecorded waste, theft). Staff food is shown apart and is not a loss.',
    '',
    'Numbers: every number you write must appear in a tool result, the Restaurant card or the question.',
    'Never add, subtract, divide, average, estimate or round figures yourself, never invent one. Money in',
    'tool results is already in taka (*_taka): write it with ৳ as given, never mention poisha. *_pct is',
    'already percent. Quantities such as "9.55 kg" are ready to copy.',
    'If the tools return nothing, an error, two_counts_needed or not_permitted, say plainly what is missing',
    'or that this person cannot see it. Do not guess. If an item or branch is ambiguous, ask which one.',
    '',
    'Language: answer in the language of the question. Bangla or Banglish question → Bangla script only',
    '(dish and ingredient names may stay as written); English question → English. Never mix.',
    'Style: plain words for a phone chat bubble. A simple answer is one to five short sentences; a plan or',
    'broad review may be a short list with "- " (about eight lines at most). No Markdown, headings, bold or',
    'tables. Respect the owner rules in the context. When food_cost_basis is assumed or mixed, say the food',
    'cost is partly an assumption.',
  ].join('\n'),
};

export interface AssistantAnswer {
  text: string;
  language: QuestionLanguage;
  source: 'llm' | 'router';
  numericCheck: 'ok' | 'retried' | 'fallback' | 'not_applicable';
  /** Pages the answer is about ("Open Stock"); only ones this person can open. */
  links: PageLink[];
  toolCalls: {
    name: string;
    input: Record<string, unknown>;
    resultMeta: Record<string, unknown>;
    durationMs: number;
  }[];
}

function meta(r: unknown): Record<string, unknown> {
  const o = (r ?? {}) as Record<string, unknown>;
  return 'metric_id' in o
    ? { metric_id: o.metric_id, filters: o.filters, as_of: o.as_of }
    : { error: o.error ?? 'none' };
}

export async function loadToolContext(
  sb: SupabaseClient,
  orgId: string,
  nowIso: string,
  access?: Access,
): Promise<ToolContext> {
  const [{ data: menu }, { data: branches }] = await Promise.all([
    sb.from('menu_items').select('id, name, name_bn').eq('org_id', orgId).eq('is_active', true),
    sb.from('branches').select('id, name').eq('org_id', orgId).eq('is_active', true),
  ]);
  return {
    sb,
    orgId,
    nowIso,
    menu: (menu ?? []) as MenuRef[],
    branches: (branches ?? []) as { id: string; name: string }[],
    access,
  };
}

/** The deterministic path: route the question, run one tool, fill a template. */
export async function routerAnswer(
  ctx: ToolContext,
  question: string,
  t: Translate,
  locale: 'bn' | 'en',
) {
  const intent = routeQuestion(question, ctx.menu);
  if (!intent)
    return { text: t('help'), toolCalls: [] as AssistantAnswer['toolCalls'], answered: false };
  const call = toolForIntent(intent);
  const started = performance.now();
  const result: ToolResult | null = call ? await runTool(call.name, call.input, ctx) : null;
  return {
    text: renderAnswer(intent, result, t, locale),
    toolCalls: call
      ? [
          {
            name: call.name,
            input: call.input,
            resultMeta: meta(result),
            durationMs: Math.round(performance.now() - started),
          },
        ]
      : [],
    answered: true,
  };
}

export async function askAssistant(args: {
  sb: SupabaseClient;
  orgId: string;
  question: string;
  nowIso: string;
  businessDate: string;
  ownerRules: string[];
  /** Who is asking and which sections they have (the app guide and the restaurant card use it). */
  access?: Access;
  /** The page the person has open, as a `nav.*` key, with a note such as "last 7 days". */
  page?: { key: string; note?: string };
  history?: Anthropic.MessageParam[];
  /** The 'assistant' message namespace in a locale (next-intl in the app, createTranslator in evals). */
  translate: (locale: 'bn' | 'en') => Promise<Translate>;
}): Promise<AssistantAnswer> {
  const language = detectLanguage(args.question);
  const locale = answerLocale(language);
  const t = await args.translate(locale);
  const ctx = await loadToolContext(args.sb, args.orgId, args.nowIso, args.access);
  const linksFor = (calls: { name: string; input: Record<string, unknown> }[]) =>
    args.access ? pageLinks(calls, args.access, args.page?.key) : [];

  if (aiConfigured()) {
    try {
      const card = await restaurantCard(ctx, args.page);
      const context = [
        `Today's business date (Asia/Dhaka): ${args.businessDate}. Question language: ${language}.`,
        language === 'en'
          ? 'Write the whole answer in English only, no Bangla words.'
          : 'Write the whole answer in Bangla script only (dish and ingredient names may stay as written).',
        'Write for a restaurant owner: plain words, never tool field names or "=" signs.',
        `Restaurant card (facts about this business): ${JSON.stringify(card)}`,
        args.ownerRules.length > 0
          ? `Owner rules and goals:\n- ${args.ownerRules.join('\n- ')}`
          : 'No owner rules set.',
      ].join('\n');
      const gw = gateway();
      const base = {
        orgId: args.orgId,
        feature: 'assistant',
        prompt: ASSISTANT_PROMPT,
        tier: 'assistant' as const,
        context,
        tools: selectTools(args.question, args.page?.key),
        // The model sees taka and percent, never poisha or basis points (see for-model.ts); the
        // validator checks the answer against exactly what the model saw.
        executeTool: async (name: string, input: Record<string, unknown>) =>
          forModel(await runTool(name, input, ctx)),
      };
      const first = await gw.chat({
        ...base,
        maxSteps: 8,
        messages: [...(args.history ?? []), { role: 'user', content: args.question }],
      });
      const toolCalls = first.toolCalls.map((c) => ({
        name: c.name,
        input: c.input,
        resultMeta: meta(c.result),
        durationMs: c.durationMs,
      }));
      const check = validateNumbers(
        first.text,
        [...first.toolCalls.map((c) => c.result), card],
        args.question,
      );
      if (check.ok)
        return {
          text: forReader(first.text, locale),
          language,
          source: 'llm',
          numericCheck: first.toolCalls.length ? 'ok' : 'not_applicable',
          links: linksFor(toolCalls),
          toolCalls,
        };
      const second = await gw.chat({
        ...base,
        maxSteps: 8,
        messages: [
          ...first.messages,
          {
            role: 'user',
            content: `Your answer used numbers that are not in the tool results: ${check.unsupported.join(', ')}. Answer again using only numbers that appear in the tool results.`,
          },
        ],
      });
      const retryCalls = [...first.toolCalls, ...second.toolCalls];
      const recheck = validateNumbers(
        second.text,
        [...retryCalls.map((c) => c.result), card],
        args.question,
      );
      if (recheck.ok)
        return {
          text: forReader(second.text, locale),
          language,
          source: 'llm',
          numericCheck: 'retried',
          links: linksFor(retryCalls),
          toolCalls: retryCalls.map((c) => ({
            name: c.name,
            input: c.input,
            resultMeta: meta(c.result),
            durationMs: c.durationMs,
          })),
        };
      const fallback = await routerAnswer(ctx, args.question, t, locale);
      return {
        text: fallback.answered ? fallback.text : t('cannotVerify'),
        language,
        source: 'router',
        numericCheck: 'fallback',
        links: linksFor(fallback.toolCalls),
        toolCalls: [...toolCalls, ...fallback.toolCalls],
      };
    } catch (e) {
      if (!(e instanceof AiError)) throw e;
      // Cap reached, refusal or a cut-off answer: the deterministic path still answers what it can.
      const fallback = await routerAnswer(ctx, args.question, t, locale);
      return {
        text:
          e.code === 'cap_exceeded'
            ? `${fallback.text}\n\n${t('capNote')}`
            : e.code === 'rate_limited' && !fallback.answered
              ? t('busy')
              : fallback.text,
        language,
        source: 'router',
        numericCheck: 'fallback',
        links: linksFor(fallback.toolCalls),
        toolCalls: fallback.toolCalls,
      };
    }
  }
  const r = await routerAnswer(ctx, args.question, t, locale);
  return {
    text: r.text,
    language,
    source: 'router',
    numericCheck: 'not_applicable',
    links: linksFor(r.toolCalls),
    toolCalls: r.toolCalls,
  };
}
