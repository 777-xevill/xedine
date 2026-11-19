import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { now } from '@/lib/time/clock';
import { businessDate } from '@/lib/time/business-date';
import {
  AiError,
  costUsdMicros,
  createGateway,
  maskPii,
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
import { groundingSources } from './grounding';

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
/** The OpenAI wire format: OpenAI itself, Groq, and Gemini's OpenAI-compatible endpoint (X7). */
type Wire = 'openai' | 'groq' | 'gemini';

function provider(): Provider | null {
  const chosen = process.env.AI_PROVIDER;
  if (chosen === 'openai' || chosen === 'groq' || chosen === 'anthropic') return chosen;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

/** Where an OpenAI-format provider lives and which key it uses. */
function wire(p: Wire): { baseUrl: string; key: string | undefined; name: string } {
  if (p === 'gemini')
    return {
      baseUrl:
        process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
      key: process.env.GEMINI_API_KEY,
      name: 'gemini',
    };
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

/**
 * X7, the strongest model (ADR 0067): its own provider and model, apart from the everyday assistant's.
 * X7_PROVIDER = openai | gemini | anthropic | groq. Default: OpenAI when OPENAI_API_KEY is set (the founder's
 * choice for X7), else Gemini when GEMINI_API_KEY is set. Live since 2026-11-19: groq (the founder's choice,
 * wrangler.jsonc), gpt-oss-120b thinking harder with more steps. X7_MODEL overrides the model.
 * With none, X7 is off and the composer offers only the everyday assistant.
 */
type X7Provider = 'openai' | 'gemini' | 'anthropic' | 'groq';
const X7_KEYS: Record<X7Provider, string> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
};
function x7Provider(): X7Provider | null {
  const chosen = process.env.X7_PROVIDER as X7Provider | undefined;
  if (chosen && chosen in X7_KEYS) return process.env[X7_KEYS[chosen]] ? chosen : null;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
}
// TODO(verify): the founder's free Gemini key on 2026-11-19: Pro models have no free quota; 3.5, 3.7 and 3.8
// Flash took about 60 s even to say "hi" (queued); 3.5 Flash-Lite answered a 45-tool question in ~5 s and
// 3.1 Flash-Lite in ~1.5 s. So X7 runs on 3.5 Flash-Lite for the test; set X7_MODEL=gemini-3.5-flash when it
// answers in time (or a paid key), or move X7 to OpenAI. Busy answers (429/503) go to the fallbacks in turn
// (X7_FALLBACK_MODELS, comma-separated).
const X7_DEFAULT_MODELS: Record<X7Provider, string> = {
  openai: 'gpt-5',
  gemini: 'gemini-3.5-flash-lite',
  anthropic: 'claude-sonnet-5',
  groq: 'openai/gpt-oss-120b',
};
const X7_DEFAULT_FALLBACKS: Partial<Record<X7Provider, string>> = {
  gemini: 'gemini-3.1-flash-lite',
};

export function x7Configured(): boolean {
  return x7Provider() !== null;
}

/**
 * Whether X7 may carry every tool on every call. Not on Groq: its free tier allows 8,000 tokens a minute per
 * model and the full set is ~9,000 (2026-11-19), so there X7 picks the tools the question needs, as the
 * everyday model does. X7_TOOLS=all (a paid Groq plan) or =some overrides.
 */
export function x7AllTools(): boolean {
  if (process.env.X7_TOOLS === 'all') return true;
  if (process.env.X7_TOOLS === 'some') return false;
  return x7Provider() !== 'groq';
}

/** The model X7 runs on, for the record (ai_actions.model, the message's content). */
export function x7Model(): string {
  const p = x7Provider();
  return process.env.X7_MODEL ?? (p ? X7_DEFAULT_MODELS[p] : '');
}

/** The provider's display name for X7, for Settings → Assistant. */
export function x7ProviderName(): string {
  const p = x7Provider();
  return p === 'gemini'
    ? 'Google Gemini'
    : p === 'anthropic'
      ? 'Anthropic'
      : p === 'groq'
        ? 'Groq'
        : 'OpenAI';
}

function x7Fallbacks(): string[] {
  const p = x7Provider();
  return (process.env.X7_FALLBACK_MODELS ?? (p ? (X7_DEFAULT_FALLBACKS[p] ?? '') : ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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
  // X7 on Gemini (ADR 0067). The founder's key is on the free tier, so Google charges nothing; the list
  // prices still count toward the daily allowance so a paid key never runs uncounted. TODO(verify) against
  // ai.google.dev/pricing: 3.5 Flash is priced as 3 Flash was ($0.50 / $3), the Lites as 3.1 Flash-Lite.
  'gemini-3.5-flash': { input: 0.5, output: 3 },
  'gemini-3.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-3.1-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-3.1-pro-preview': { input: 2, output: 12 },
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

/** The same daily allowance, for Settings → Usage's meter (metric_ai_usage takes it as an input). */
export function aiDailyCapUsdMicros(): number {
  return DAILY_CAP_USD_MICROS;
}

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
async function post(
  w: ReturnType<typeof wire>,
  body: Record<string, unknown>,
  timeoutMs = 90_000,
): Promise<Response> {
  try {
    return await fetch(`${w.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${w.key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Network failure or timeout: an AiError, so callers fall back (the assistant to its router).
    throw new AiError('invalid_output', 'the AI provider could not be reached');
  }
}

/**
 * Groq limits tokens per minute per model (8,000 on the founder's account, for the whole platform) and one
 * assistant step resends the conversation (about 3,000–6,000 tokens). On a 429 a text request is retried on
 * the other text models in turn, each with its own allowance (X7 on Groq, ADR 0067, takes several steps); a
 * request with a photo stays on the first (only Qwen reads photos). GROQ_FALLBACK_MODEL (comma-separated)
 * changes the list, an empty value turns it off.
 */
const GROQ_TEXT_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
const GROQ_FALLBACKS = (model: unknown): string[] =>
  process.env.GROQ_FALLBACK_MODEL !== undefined
    ? process.env.GROQ_FALLBACK_MODEL.split(',')
        .map((m) => m.trim())
        .filter((m) => m && m !== model)
    : GROQ_TEXT_MODELS.filter((m) => m !== model);
const GROQ_FALLBACK_MODEL = (model: unknown) => GROQ_FALLBACKS(model)[0];
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

/**
 * Groq's free tier lets the vision model write only 1,000 tokens a minute, and it refuses outright ("request
 * too large") any request whose max_completion_tokens is above that, so the cap is clamped to it. The model
 * thinks before answering and that thinking counts too: "low" keeps it to a few hundred tokens ("none"
 * returned empty menus in testing, 2026-11-19). Both can be raised by env on a paid tier.
 */
export function visionBudget(body: Record<string, unknown>): Record<string, unknown> {
  const cap = Number(process.env.GROQ_VISION_MAX_TOKENS ?? 1000);
  return {
    ...body,
    max_completion_tokens: Math.min(Number(body.max_completion_tokens) || cap, cap),
    reasoning_effort: process.env.GROQ_VISION_REASONING ?? 'low',
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

/** Which model a question's X7 calls are on: set by the first model that answers, then kept. */
interface Sticky {
  model?: string;
}

/**
 * X7 on Gemini: the chosen model, then each fallback, when Google answers busy (429, 500, 503) or not within
 * 45 s. Once one has answered, the rest of the question stays on it: a thought signature belongs to the model
 * that wrote it, and another model refuses it.
 */
async function geminiComplete(
  request: Record<string, unknown>,
  sticky: Sticky,
): Promise<OpenAiCompletion> {
  const w = wire('gemini');
  const chain = sticky.model
    ? [sticky.model]
    : [...new Set([String(request.model), ...x7Fallbacks()])];
  for (const model of chain) {
    let res: Response;
    try {
      res = await post(w, { ...request, model }, 45_000);
    } catch {
      console.error('gemini', model, 'timeout');
      continue;
    }
    if (res.ok) {
      const json = (await res.json()) as OpenAiCompletion;
      if (!json.choices?.[0])
        throw new AiError('invalid_output', 'the AI provider returned no answer');
      sticky.model = model;
      return json;
    }
    console.error('gemini', model, res.status);
    if (![429, 500, 503].includes(res.status))
      throw new AiError('invalid_output', `the AI provider returned ${res.status}`);
  }
  throw new AiError('rate_limited', 'X7 is busy; try again in a minute');
}

/** How long a call may wait for the provider's per-minute allowance to come back. */
interface Patience {
  rounds: number;
  maxWaitMs: number;
}
const EVERYDAY_PATIENCE: Patience = { rounds: 1, maxWaitMs: 15_000 };
/** X7 takes several steps and each resends the conversation: on Groq's free tier it waits rather than fail. */
const X7_PATIENCE: Patience = { rounds: 3, maxWaitMs: 45_000 };

async function openAiComplete(
  p: Wire,
  request: Record<string, unknown>,
  sticky: Sticky = {},
  patience: Patience = EVERYDAY_PATIENCE,
): Promise<OpenAiCompletion> {
  if (p === 'gemini') return geminiComplete(request, sticky);
  const w = wire(p);
  let body = request;
  // A photo on Groq goes to the model that can see it, whatever the tier asked for.
  if (p === 'groq' && hasImage(body) && body.model !== GROQ_VISION_MODEL())
    body = forModel(body, GROQ_VISION_MODEL());
  if (p === 'groq' && body.model === GROQ_VISION_MODEL()) body = visionBudget(body);
  const fallback = GROQ_FALLBACK_MODEL(body.model);
  /** The model, then (Groq, text) each other text model on a 429; and the soonest reset among the refusals. */
  const round = async (): Promise<{ res: Response; waitMs: number | null }> => {
    const first = await post(w, body);
    let waitMs = first.status === 429 ? retryAfterMs(first) : null;
    if (first.status === 429 && p === 'groq' && !hasImage(body)) {
      for (const other of GROQ_FALLBACKS(body.model)) {
        console.error(w.name, 429, 'retrying on', other);
        const next = await post(w, forModel(body, other));
        // Only a good answer replaces the first reply: another model's own error must not hide the limit.
        if (next.ok) return { res: next, waitMs: null };
        if (next.status !== 429) break;
        const soon = retryAfterMs(next);
        if (soon !== null && (waitMs === null || soon < waitMs)) waitMs = soon;
      }
    }
    return { res: first, waitMs };
  };
  let { res, waitMs } = await round();
  // Every allowance used up this minute: wait for the soonest reset when it is close, then try again
  // (the everyday assistant once within 15 s; X7 on Groq up to three times within 45 s, ADR 0067).
  for (let i = 0; res.status === 429 && i < patience.rounds; i++) {
    if (waitMs === null || waitMs > patience.maxWaitMs) break;
    await new Promise((resolve) => setTimeout(resolve, waitMs! + 250));
    ({ res, waitMs } = await round());
  }
  if (res.status === 429) {
    console.error(w.name, 429);
    throw new AiError('rate_limited', 'the AI provider is busy; try again in a minute');
  }
  // A 400 from Groq is usually the model writing a tool call it cannot parse (it differs per model and
  // per run): the other model gets one try before the question fails.
  if (
    res.status === 400 &&
    p === 'groq' &&
    fallback &&
    fallback !== body.model &&
    !hasImage(body)
  ) {
    console.error(w.name, 400, 'retrying on', fallback);
    const again = await post(w, forModel(body, fallback));
    if (again.ok) res = again;
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
/** X7 thinks harder than the everyday assistant (X7_REASONING: low | medium | high). */
const x7ReasoningEffort = () => process.env.X7_REASONING ?? 'medium';

const openAiTransport =
  (
    p: Wire,
    effort = reasoningEffort,
    sticky: Sticky = {},
    patience = EVERYDAY_PATIENCE,
  ): Transport =>
  async (req) => {
    const completion = await openAiComplete(
      p,
      {
        ...completionBody(req, effort()),
        messages: toOpenAiMessages([req.system], [{ role: 'user', content: req.content }]),
        response_format: responseFormat(req.schema),
      },
      sticky,
      patience,
    );
    const choice = completion.choices[0]!;
    return {
      parsed: parsedJson(choice) as never,
      stopReason: stopReason(choice),
      usage: usage(completion.usage),
    };
  };

const openAiChatTransport =
  (
    p: Wire,
    effort = reasoningEffort,
    sticky: Sticky = {},
    patience = EVERYDAY_PATIENCE,
  ): ChatTransport =>
  async (req) => {
    const completion = await openAiComplete(p, chatBody(req, effort()), sticky, patience);
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

/**
 * Google Search through Gemini (ADR 0067) for the assistant's web_search, when the founder turns it on
 * (X7_GOOGLE_SEARCH=on; the free tier has no quota for it). Like every call: the plan and the daily allowance
 * are checked, the question is PII-masked, and tokens plus the search fee are costed in ai_usage. Returns the
 * short answer with the pages it cites, or null when Google gave nothing.
 */
export async function groundedSearch(
  orgId: string,
  query: string,
): Promise<{ text: string; sources: { title: string; url: string }[] } | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.X7_SEARCH_MODEL ?? 'gemini-3.5-flash-lite';
  const today = businessDate(now());
  if (!(await supabaseUsageStore.planAllowsAi!(orgId)))
    throw new AiError('not_in_plan', "this restaurant's plan does not include AI");
  if ((await supabaseUsageStore.spentTodayUsdMicros(orgId, today)) >= DAILY_CAP_USD_MICROS)
    throw new AiError('cap_exceeded', 'the daily AI allowance for this restaurant is used up');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Search the web and answer in a few short sentences, giving figures exactly as the sources state them: ${maskPii(query)}`,
              },
            ],
          },
        ],
        tools: [{ google_search: {} }],
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    console.error('google search', res.status);
    return null;
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: unknown }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  };
  const u = json.usageMetadata ?? {};
  const tokens = {
    input: u.promptTokenCount ?? 0,
    output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    cacheRead: 0,
    cacheWrite: 0,
  };
  // TODO(verify): Google's price per grounded search; $0.035 counted until checked.
  const searchFee = Number(process.env.GOOGLE_SEARCH_USD_MICROS ?? 35_000);
  await supabaseUsageStore.record({
    orgId,
    date: today,
    model,
    feature: 'web_search',
    usage: tokens,
    costUsdMicros: costUsdMicros({ ...RATES, ...extraRates() }, model, tokens) + searchFee,
  });
  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) return null;
  return { text: text.slice(0, 3000), sources: groundingSources(candidate?.groundingMetadata) };
}

/**
 * The gateway on the everyday provider, or with `{ x7: true }` on X7's (ADR 0067). Both count toward the same
 * daily allowance and plan check; X7's weekly questions are counted by the assistant (`use_x7`).
 */
export function gateway(opts: { x7?: boolean } = {}) {
  if (opts.x7) {
    const x = x7Provider();
    if (!x) throw new AiError('not_configured', 'no X7 provider key is set');
    const model = x7Model();
    // One sticky model per gateway, so per question (the assistant makes a gateway per question).
    const sticky: Sticky = {};
    return createGateway({
      transport:
        x === 'anthropic'
          ? anthropicTransport
          : openAiTransport(x, x7ReasoningEffort, sticky, X7_PATIENCE),
      chatTransport:
        x === 'anthropic'
          ? anthropicChatTransport
          : openAiChatTransport(x, x7ReasoningEffort, sticky, X7_PATIENCE),
      store: supabaseUsageStore,
      config: {
        models: { assistant: model, fast: model },
        rates: { ...RATES, ...extraRates() },
        dailyCapUsdMicros: DAILY_CAP_USD_MICROS,
        today: () => businessDate(now()),
      },
    });
  }
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
