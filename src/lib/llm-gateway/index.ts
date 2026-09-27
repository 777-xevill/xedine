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

export {
  AiError,
  maskPii,
  type GatewayResult,
  type PromptVersion,
  type ToolCallRecord,
} from './core';

/**
 * Production wiring. Models come from the environment, never code (ARCHITECTURE.md "AI layer"):
 * AI_MODEL_ASSISTANT (default claude-sonnet-5) and AI_MODEL_FAST (default claude-haiku-4-5). Confirm both
 * against GET /v1/models when the key is added. Rates are USD per million tokens (ADR 0008).
 */
const MODELS = {
  assistant: process.env.AI_MODEL_ASSISTANT ?? 'claude-sonnet-5',
  fast: process.env.AI_MODEL_FAST ?? 'claude-haiku-4-5',
};
const RATES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};
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
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

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
  if (!aiConfigured()) throw new AiError('not_configured', 'ANTHROPIC_API_KEY is not set');
  return createGateway({
    transport: anthropicTransport,
    chatTransport: anthropicChatTransport,
    store: supabaseUsageStore,
    config: {
      models: MODELS,
      rates: RATES,
      dailyCapUsdMicros: DAILY_CAP_USD_MICROS,
      today: () => businessDate(now()),
    },
  });
}
