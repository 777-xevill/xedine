import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AiError, aiConfigured, gateway, type PromptVersion } from '@/lib/llm-gateway';
import { renderAnswer, toolForIntent, type Translate } from './answers';
import { answerLocale, detectLanguage, type QuestionLanguage } from './language';
import { forModel, forReader } from './for-model';
import { routeQuestion, type MenuRef } from './router';
import { runTool, TOOL_DEFS, type ToolContext, type ToolResult } from './tools';
import { validateNumbers } from './validator';

/**
 * The owner assistant (PRODUCT.md M10, ARCHITECTURE.md "AI layer"). Numbers only from tools: a model's
 * answer is checked by the numeric validator, retried once with the offending numbers named, and
 * otherwise replaced by the deterministic answer. With no AI key, the deterministic router answers.
 */
export const ASSISTANT_PROMPT: PromptVersion = {
  key: 'assistant',
  version: 4,
  body: [
    "You are Xedine, the owner's sharp profit advisor for a restaurant in Bangladesh. You know the restaurant",
    "only through your tools: sales, items, today's profit, money leaks from the till, stock on the shelf and",
    'how long it lasts, loss per ingredient, waste, purchases, food cost, forecast, menu, branches, customers',
    'and reviews. Call as many tools as the question needs before answering; for a broad question ("how are',
    'we doing", "what is wrong") look at several.',
    '',
    'Numbers: every number you write must appear in a tool result (or the question). Never add, subtract,',
    'divide, average, estimate or round figures yourself, and never invent one. Money in tool results is',
    'already in taka (*_taka): write it with ৳ exactly as given. Never mention poisha. *_pct fields are',
    'already percent. Quantities you should quote are ready-written text such as "9.55 kg" — copy them.',
    '',
    'Loss: for "loss", "লস", "kothay loss", "kon jinish", "where is money going", call get_stock_loss for the',
    'branch (which ingredients cost money, how much, and whether it was written-down waste or not explained),',
    "and get_findings (money leaks in the till: voids, discounts, cash). Use get_flash_pnl only for today's",
    'profit. Say where the loss is (the top items with their amounts), why (waste or not explained), and one',
    'or two practical things to check (portion size, a bad count, unrecorded waste or transfers, theft).',
    'Staff food is shown apart and is not a loss.',
    '',
    'If the tools return nothing, an error, two_counts_needed or not_permitted, say plainly what is missing',
    '(for example: count the shelf twice to see loss per item) or that this person cannot see it. Do not',
    'guess. If an item or branch is ambiguous, ask which one.',
    '',
    'Language: answer in the language of the question. Bangla or Banglish question → answer only in Bangla',
    'script (ingredient and dish names may stay as written); English question → English. Never mix.',
    'Style: short and plain for a phone chat bubble — one to five short sentences or a short list with "- ".',
    'No Markdown, headings, bold or tables. Respect the owner rules in the context.',
    'Estimated profit uses recipe costs where they exist; when food_cost_basis is assumed or mixed, say the',
    'food cost is partly an assumption. To explain one money leak, call explain_finding and describe the',
    'evidence in plain words, then the suggested actions.',
  ].join('\n'),
};

export interface AssistantAnswer {
  text: string;
  language: QuestionLanguage;
  source: 'llm' | 'router';
  numericCheck: 'ok' | 'retried' | 'fallback' | 'not_applicable';
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
  history?: Anthropic.MessageParam[];
  /** The 'assistant' message namespace in a locale (next-intl in the app, createTranslator in evals). */
  translate: (locale: 'bn' | 'en') => Promise<Translate>;
}): Promise<AssistantAnswer> {
  const language = detectLanguage(args.question);
  const locale = answerLocale(language);
  const t = await args.translate(locale);
  const ctx = await loadToolContext(args.sb, args.orgId, args.nowIso);

  if (aiConfigured()) {
    try {
      const context = [
        `Today's business date (Asia/Dhaka): ${args.businessDate}. Question language: ${language}.`,
        `Branches: ${ctx.branches.map((b) => b.name).join(', ') || 'none'}.`,
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
        tools: TOOL_DEFS,
        // The model sees taka and percent, never poisha or basis points (see for-model.ts); the
        // validator checks the answer against exactly what the model saw.
        executeTool: async (name: string, input: Record<string, unknown>) =>
          forModel(await runTool(name, input, ctx)),
      };
      const first = await gw.chat({
        ...base,
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
        first.toolCalls.map((c) => c.result),
        args.question,
      );
      if (check.ok)
        return {
          text: forReader(first.text, locale),
          language,
          source: 'llm',
          numericCheck: first.toolCalls.length ? 'ok' : 'not_applicable',
          toolCalls,
        };
      const second = await gw.chat({
        ...base,
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
        retryCalls.map((c) => c.result),
        args.question,
      );
      if (recheck.ok)
        return {
          text: forReader(second.text, locale),
          language,
          source: 'llm',
          numericCheck: 'retried',
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
    toolCalls: r.toolCalls,
  };
}
