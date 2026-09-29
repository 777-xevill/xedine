import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AiError, aiConfigured, gateway, type PromptVersion } from '@/lib/llm-gateway';
import { renderAnswer, toolForIntent, type Translate } from './answers';
import { answerLocale, detectLanguage, type QuestionLanguage } from './language';
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
  version: 3,
  body: [
    'You are Xedine, the profit assistant for a restaurant owner in Bangladesh.',
    'Answer only from the tools. Every number you write must appear in a tool result: never add, subtract,',
    'average, estimate or round figures yourself, and never invent one. Money in tool results is in poisha',
    '(*_poisha: divide by 100 for taka); write taka with ৳. Percentages in *_bps are basis points (divide by 100).',
    'If the tools return nothing, an error, or not_permitted, say plainly that you do not have that data or',
    'that this person cannot see it. Do not guess. If an item is ambiguous, ask which one.',
    'Reply in the language of the question: Bangla script for Bangla or Banglish, English for English.',
    'Be brief: one to four short sentences, or a short list. Respect the owner rules given in the context.',
    'Write plain text for a chat bubble: no Markdown, no headings, no bold or tables; use "- " for a list.',
    'Estimated profit uses recipe costs where they exist; when food_cost_basis is assumed or mixed, say the food cost is partly an assumption.',
    'To explain a money leak, call explain_finding and describe the evidence in plain words, then the suggested actions.',
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
        executeTool: (name: string, input: Record<string, unknown>) => runTool(name, input, ctx),
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
          text: first.text,
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
          text: second.text,
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
        text: e.code === 'cap_exceeded' ? `${fallback.text}\n\n${t('capNote')}` : fallback.text,
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
