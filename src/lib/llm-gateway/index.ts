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
  type SpeechTransport,
  type Transport,
  type UsageStore,
} from './core';
import {
  chatBody,
  completionBody,
  isReasoningModel,
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
 * - AI_PROVIDER = openai | groq | anthropic. Default: OpenAI when OPENAI_API_KEY is set, else Groq
 *   when GROQ_API_KEY is set, else Anthropic when ANTHROPIC_API_KEY is set. With none, AI is off and
 *   the deterministic router answers. Groq speaks the OpenAI wire format, so it reuses that code with
 *   its own address, key and models (and its Whisper for voice notes).
 * - AI_MODEL_ASSISTANT / AI_MODEL_FAST override the per-provider defaults below.
 * - AI_MODEL_RATES (JSON, USD per million tokens) adds prices for a model not listed here, e.g.
 *   {"gpt-5.1":{"input":1.25,"output":10}}. A model with no price is refused, so spend is never
 *   uncounted (ADR 0008).
 */
type Provider = 'openai' | 'groq' | 'anthropic';

function provider(): Provider | null {
  const chosen = process.env.AI_PROVIDER;
  if (chosen === 'openai' || chosen === 'groq' || chosen === 'anthropic') return chosen;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

/** Where an OpenAI-format provider lives and which key it uses. */
function wire(p: 'openai' | 'groq'): { baseUrl: string; key: string | undefined; name: string } {
  return p === 'groq'
    ? {
        baseUrl: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
        key: process.env.GROQ_API_KEY,
        name: 'groq',
      }
    : {
        baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
        key: process.env.OPENAI_API_KEY,
        name: 'openai',
      };
}

// TODO(verify): model ids and list prices against each provider's pricing page when the key is added.
// Groq (checked against the founder's account, 2026-10-02): gpt-oss-120b reasons best for the assistant;
// Qwen 3.8 27B is fast and the only one that reads photos, so any request with an image goes to it
// (GROQ_VISION_MODEL). Set AI_MODEL_* to change.
const DEFAULT_MODELS: Record<Provider, { assistant: string; fast: string }> = {
  openai: { assistant: 'gpt-5-mini', fast: 'gpt-5-nano' },
  groq: { assistant: 'openai/gpt-oss-120b', fast: 'qwen/qwen3.8-27b' },
  anthropic: { assistant: 'claude-sonnet-5', fast: 'claude-haiku-4-5' },
};
const RATES: Record<string, { input: number; output: number }> = {
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  // Groq list prices, USD per million tokens. TODO(verify) against console.groq.com/docs/models.
  // Qwen's price is a placeholder (the earlier Qwen3 32B list price) until checked.
  'qwen/qwen3.8-27b': { input: 0.29, output: 0.59 },
  'openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
  'openai/gpt-oss-20b': { input: 0.075, output: 0.3 },
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
  if (p === 'openai' || p === 'groq') return Boolean(wire(p).key);
  if (p === 'anthropic') return Boolean(process.env.ANTHROPIC_API_KEY);
  return false;
}

/** The provider's display name, for Settings → Assistant. */
export function aiProvider(): string {
  const p = provider();
  return p === 'anthropic' ? 'Anthropic' : p === 'groq' ? 'Groq' : 'OpenAI';
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

// --- OpenAI and Groq (Chat Completions over fetch: no SDK dependency) -------------------------------
async function post(w: ReturnType<typeof wire>, body: Record<string, unknown>): Promise<Response> {
  try {
    return await fetch(`${w.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${w.key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    // Network failure or timeout: an AiError, so callers fall back (the assistant to its router).
    throw new AiError('invalid_output', 'the AI provider could not be reached');
  }
}

/**
 * Groq limits tokens per minute per model (8,000 on the founder's account) and one assistant question
 * is two calls of about 2,800 tokens. On a 429 a text request is retried once on a second model, which
 * has its own allowance; a request with a photo stays on the first (the text models cannot read it).
 * GROQ_FALLBACK_MODEL changes it, an empty value turns it off.
 */
const GROQ_FALLBACK_MODEL = (model: unknown) =>
  process.env.GROQ_FALLBACK_MODEL ??
  (model === 'openai/gpt-oss-120b' ? 'qwen/qwen3.8-27b' : 'openai/gpt-oss-120b');
const GROQ_VISION_MODEL = () => process.env.GROQ_VISION_MODEL ?? 'qwen/qwen3.8-27b';
const hasImage = (body: Record<string, unknown>) =>
  JSON.stringify(body.messages).includes('"image_url"');

function forModel(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const was = String(body.model);
  const answerBudget = Number(body.max_completion_tokens) - (isReasoningModel(was) ? 4000 : 0);
  const { reasoning_effort: _dropped, ...rest } = body;
  void _dropped;
  return {
    ...rest,
    model,
    max_completion_tokens: answerBudget + (isReasoningModel(model) ? 4000 : 0),
    ...(isReasoningModel(model) ? { reasoning_effort: reasoningEffort() } : {}),
  };
}

/** How long a 429 says to wait (retry-after seconds, or Groq's token reset such as "41.3s" or "690ms"). */
function retryAfterMs(res: Response): number | null {
  const after = Number(res.headers.get('retry-after'));
  if (Number.isFinite(after) && after > 0) return after * 1000;
  const reset = res.headers.get('x-ratelimit-reset-tokens') ?? '';
  const m = /^(?:(\d+)m)?(?:([\d.]+)s)?(?:([\d.]+)ms)?$/.exec(reset);
  if (!m || reset === '') return null;
  return Number(m[1] ?? 0) * 60_000 + Number(m[2] ?? 0) * 1000 + Number(m[3] ?? 0);
}

async function openAiComplete(
  p: 'openai' | 'groq',
  request: Record<string, unknown>,
): Promise<OpenAiCompletion> {
  const w = wire(p);
  let body = request;
  // A photo on Groq goes to the model that can see it, whatever the tier asked for.
  if (p === 'groq' && hasImage(body) && body.model !== GROQ_VISION_MODEL())
    body = forModel(body, GROQ_VISION_MODEL());
  let res = await post(w, body);
  const fallback = GROQ_FALLBACK_MODEL(body.model);
  if (
    res.status === 429 &&
    p === 'groq' &&
    fallback &&
    fallback !== body.model &&
    !hasImage(body)
  ) {
    console.error(w.name, 429, 'retrying on', fallback);
    const second = await post(w, forModel(body, fallback));
    if (second.status !== 429) res = second;
  }
  if (res.status === 429) {
    // Both allowances used up this minute: wait for the reset when it is close, then try once more.
    const wait = retryAfterMs(res);
    if (wait !== null && wait <= 15_000) {
      await new Promise((resolve) => setTimeout(resolve, wait + 250));
      res = await post(w, body);
    }
    if (res.status === 429) {
      console.error(w.name, 429);
      throw new AiError('rate_limited', 'the AI provider is busy; try again in a minute');
    }
  }
  if (!res.ok) {
    // Never echo the provider's error body to users; the status is enough for the logs.
    console.error(w.name, res.status);
    throw new AiError('invalid_output', `the AI provider returned ${res.status}`);
  }
  const json = (await res.json()) as OpenAiCompletion;
  if (!json.choices?.[0]) throw new AiError('invalid_output', 'the AI provider returned no answer');
  return json;
}

const reasoningEffort = () => process.env.AI_REASONING_EFFORT ?? 'low';

const openAiTransport =
  (p: 'openai' | 'groq'): Transport =>
  async (req) => {
    const completion = await openAiComplete(p, {
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

const openAiChatTransport =
  (p: 'openai' | 'groq'): ChatTransport =>
  async (req) => {
    const completion = await openAiComplete(p, chatBody(req, reasoningEffort()));
    const choice = completion.choices[0]!;
    return {
      content: toContentBlocks(choice),
      stopReason: stopReason(choice),
      usage: usage(completion.usage),
    };
  };

// --- Speech to text (ADR 0025): the transcription endpoint of OpenAI or Groq (Whisper) ---------------
// Groq's when Groq answers text, or when it is the only key. STT_MODEL / STT_USD_MICROS_PER_MINUTE
// override. TODO(verify): prices, and Bangla accuracy on real bazar voice notes before choosing a
// dedicated speech provider (the ADR names the candidates).
function speechProvider(): 'openai' | 'groq' | null {
  const text = provider();
  if (text === 'groq' && process.env.GROQ_API_KEY) return 'groq';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GROQ_API_KEY) return 'groq';
  return null;
}
const SPEECH_DEFAULTS = {
  // whisper-large-v3 on Groq: $0.111 per hour of audio = 1,850 micros a minute.
  groq: { model: 'whisper-large-v3', usdMicrosPerMinute: 1_850 },
  openai: { model: 'gpt-4o-transcribe', usdMicrosPerMinute: 6_000 },
};
const speechDefaults = () => SPEECH_DEFAULTS[speechProvider() ?? 'openai'];
const SPEECH_MODEL = () => process.env.STT_MODEL ?? speechDefaults().model;
const SPEECH_USD_MICROS_PER_MINUTE = () =>
  Number(process.env.STT_USD_MICROS_PER_MINUTE ?? speechDefaults().usdMicrosPerMinute);

export function speechConfigured(): boolean {
  return speechProvider() !== null;
}

const openAiSpeechTransport: SpeechTransport = async (req) => {
  const w = wire(speechProvider() ?? 'openai');
  const form = new FormData();
  form.append('model', req.model);
  form.append('prompt', req.prompt);
  form.append('response_format', 'json');
  form.append('file', new Blob([req.audio as Uint8Array<ArrayBuffer>]), req.filename);
  let res: Response;
  try {
    res = await fetch(`${w.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${w.key}` },
      body: form,
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new AiError('invalid_output', 'the speech provider could not be reached');
  }
  if (!res.ok) {
    console.error(`${w.name} speech`, res.status);
    throw new AiError('invalid_output', `the speech provider returned ${res.status}`);
  }
  const json = (await res.json()) as { text?: string };
  if (typeof json.text !== 'string') throw new AiError('invalid_output', 'no transcript');
  return json.text;
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
    transport: p === 'anthropic' ? anthropicTransport : openAiTransport(p),
    chatTransport: p === 'anthropic' ? anthropicChatTransport : openAiChatTransport(p),
    ...(speechConfigured() ? { speechTransport: openAiSpeechTransport } : {}),
    store: supabaseUsageStore,
    config: {
      models: {
        assistant: process.env.AI_MODEL_ASSISTANT ?? defaults.assistant,
        fast: process.env.AI_MODEL_FAST ?? defaults.fast,
      },
      rates: { ...RATES, ...extraRates() },
      dailyCapUsdMicros: DAILY_CAP_USD_MICROS,
      speech: { model: SPEECH_MODEL(), usdMicrosPerMinute: SPEECH_USD_MICROS_PER_MINUTE() },
      today: () => businessDate(now()),
    },
  });
}
