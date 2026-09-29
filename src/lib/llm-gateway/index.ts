import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { now } from '@/lib/time/clock';
import { businessDate } from '@/lib/time/business-date';
import {
  AiError,
  createGateway,
  type ChatTransport,
  type Transport,
  type UsageStore,
} from './core';
import {
  chatBody,
  completionBody,
  parsedJson,
  responseFormat,
  stopReason,
  toContentBlocks,
  toOpenAiMessages,
  usage,
  type OpenAiCompletion,
} from './openai';

export {
  AiError,
  maskPii,
  type GatewayResult,
  type PromptVersion,
  type ToolCallRecord,
} from './core';

/**
 * Production wiring. The provider and models come from the environment, never code
 * (ARCHITECTURE.md "AI layer", ADR 0024):
 *
 * - AI_PROVIDER = openai | anthropic. Default: OpenAI when OPENAI_API_KEY is set, else Anthropic
 *   when ANTHROPIC_API_KEY is set. With neither, AI is off and the deterministic router answers.
 * - AI_MODEL_ASSISTANT / AI_MODEL_FAST override the per-provider defaults below.
 * - AI_MODEL_RATES (JSON, USD per million tokens) adds prices for a model not listed here, e.g.
 *   {"gpt-5.1":{"input":1.25,"output":10}}. A model with no price is refused, so spend is never
 *   uncounted (ADR 0008).
 */
type Provider = 'openai' | 'anthropic';

function provider(): Provider | null {
  const chosen = process.env.AI_PROVIDER;
  if (chosen === 'openai' || chosen === 'anthropic') return chosen;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

// TODO(verify): model ids and list prices against each provider's pricing page when the key is added.
const DEFAULT_MODELS: Record<Provider, { assistant: string; fast: string }> = {
  openai: { assistant: 'gpt-5-mini', fast: 'gpt-5-nano' },
  anthropic: { assistant: 'claude-sonnet-5', fast: 'claude-haiku-4-5' },
};
const RATES: Record<string, { input: number; output: number }> = {
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

function extraRates(): Record<string, { input: number; output: number }> {
  try {
    return JSON.parse(process.env.AI_MODEL_RATES ?? '{}') as Record<
      string,
      { input: number; output: number }
    >;
  } catch {
    return {};
  }
}

/** Per org per day; default $1. Plans set their own caps in Phase 10. */
const DAILY_CAP_USD_MICROS = Number(process.env.AI_DAILY_CAP_USD_MICROS ?? 1_000_000);

/** The errors.* key for a failed AI call, shared by every action that drafts with AI. */
export function aiErrorKey(e: unknown): string {
  if (!(e instanceof AiError)) return 'aiFailed';
  if (e.code === 'not_configured') return 'aiNotConfigured';
  if (e.code === 'cap_exceeded') return 'aiCapExceeded';
  if (e.code === 'not_in_plan') return 'aiNotInPlan';
  return 'aiFailed';
}

export function aiConfigured(): boolean {
  const p = provider();
  if (p === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  if (p === 'anthropic') return Boolean(process.env.ANTHROPIC_API_KEY);
  return false;
}

/** The provider's display name, for Settings → Assistant. */
export function aiProvider(): string {
  return provider() === 'anthropic' ? 'Anthropic' : 'OpenAI';
}

// --- Anthropic ------------------------------------------------------------------------------------
const anthropicTransport: Transport = async (req) => {
  const client = new Anthropic();
  const message = await client.messages.parse({
    model: req.model,
    max_tokens: req.maxTokens,
    // The versioned prompt is the stable prefix: cached, and nothing volatile goes before it.
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: req.content }],
    output_config: { format: zodOutputFormat(req.schema) },
  });
  return {
    parsed: (message.parsed_output ?? null) as never,
    stopReason: message.stop_reason,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
};

const anthropicChatTransport: ChatTransport = async (req) => {
  const client = new Anthropic();
  const message = await client.messages.create({
    model: req.model,
    max_tokens: req.maxTokens,
    // Tools and the versioned prompt form the cached prefix; the day's context comes after the breakpoint.
    system: [
      { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: req.context },
    ],
    tools: req.tools,
    messages: req.messages,
  });
  return {
    content: message.content,
    stopReason: message.stop_reason,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
};

// --- OpenAI (Chat Completions over fetch: no SDK dependency) ---------------------------------------
async function openAiComplete(body: Record<string, unknown>): Promise<OpenAiCompletion> {
  const url = `${process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    // Network failure or timeout: an AiError, so callers fall back (the assistant to its router).
    throw new AiError('invalid_output', 'the AI provider could not be reached');
  }
  if (!res.ok) {
    // Never echo the provider's error body to users; the status is enough for the logs.
    console.error('openai', res.status);
    throw new AiError('invalid_output', `the AI provider returned ${res.status}`);
  }
  const json = (await res.json()) as OpenAiCompletion;
  if (!json.choices?.[0]) throw new AiError('invalid_output', 'the AI provider returned no answer');
  return json;
}

const reasoningEffort = () => process.env.AI_REASONING_EFFORT ?? 'low';

const openAiTransport: Transport = async (req) => {
  const completion = await openAiComplete({
    ...completionBody(req, reasoningEffort()),
    messages: toOpenAiMessages([req.system], [{ role: 'user', content: req.content }]),
    response_format: responseFormat(req.schema),
  });
  const choice = completion.choices[0]!;
  return {
    parsed: parsedJson(choice) as never,
    stopReason: stopReason(choice),
    usage: usage(completion.usage),
  };
};

const openAiChatTransport: ChatTransport = async (req) => {
  const completion = await openAiComplete(chatBody(req, reasoningEffort()));
  const choice = completion.choices[0]!;
  return {
    content: toContentBlocks(choice),
    stopReason: stopReason(choice),
    usage: usage(completion.usage),
  };
};

// ai_usage is written only by the gateway (service role), always for an explicit org (CLAUDE.md #2).
const supabaseUsageStore: UsageStore = {
  async planAllowsAi(orgId) {
    const { data, error } = await createServiceRoleClient().rpc('org_ai_allowed', {
      p_org: orgId,
      p_now: now().toISOString(),
    });
    if (error) throw error;
    return data === true;
  },
  async spentTodayUsdMicros(orgId, date) {
    const { data, error } = await createServiceRoleClient()
      .from('ai_usage')
      .select('cost_usd_micros')
      .eq('org_id', orgId)
      .eq('usage_date', date);
    if (error) throw error;
    return (data ?? []).reduce((s, r) => s + Number(r.cost_usd_micros), 0);
  },
  async record(row) {
    const { error } = await createServiceRoleClient().rpc('record_ai_usage', {
      p_org: row.orgId,
      p_date: row.date,
      p_model: row.model,
      p_feature: row.feature,
      p_input: row.usage.input,
      p_output: row.usage.output,
      p_cache_read: row.usage.cacheRead,
      p_cache_write: row.usage.cacheWrite,
      p_cost_usd_micros: row.costUsdMicros,
    });
    if (error) throw error;
  },
};

export function gateway() {
  const p = provider();
  if (!p || !aiConfigured()) throw new AiError('not_configured', 'no AI provider key is set');
  const defaults = DEFAULT_MODELS[p];
  return createGateway({
    transport: p === 'openai' ? openAiTransport : anthropicTransport,
    chatTransport: p === 'openai' ? openAiChatTransport : anthropicChatTransport,
    store: supabaseUsageStore,
    config: {
      models: {
        assistant: process.env.AI_MODEL_ASSISTANT ?? defaults.assistant,
        fast: process.env.AI_MODEL_FAST ?? defaults.fast,
      },
      rates: { ...RATES, ...extraRates() },
      dailyCapUsdMicros: DAILY_CAP_USD_MICROS,
      today: () => businessDate(now()),
    },
  });
}
