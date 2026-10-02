import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';

/**
 * LLM gateway v0 (ARCHITECTURE.md "AI layer", ADR 0016 §5) — the only way the app calls a model.
 * Every call: checks the org's daily cap, masks PII, sends a versioned system prompt as a cached block,
 * asks for schema-validated JSON, refuses truncated or refused answers, and logs tokens and cost.
 *
 * Pure: the transport (the Anthropic SDK in production, a mock in tests) and the usage store are injected.
 * Models never calculate figures shown as metrics (CLAUDE.md #1); callers use this for drafts only.
 */

export type ModelTier = 'assistant' | 'fast';

export interface PromptVersion {
  key: string;
  version: number;
  body: string;
}

export interface GatewayRequest<T> {
  orgId: string;
  feature: string;
  prompt: PromptVersion;
  tier: ModelTier;
  /** The user turn: text and/or images. Text parts are PII-masked before they leave. */
  content: Anthropic.ContentBlockParam[];
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export interface GatewayResult<T> {
  output: T;
  model: string;
  prompt: { key: string; version: number };
  usage: TokenUsage & { costUsdMicros: number };
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** What the transport needs: the request, already built. Returns the parsed output and usage. */
export interface TransportRequest<T> {
  model: string;
  maxTokens: number;
  system: string;
  content: Anthropic.ContentBlockParam[];
  schema: z.ZodType<T>;
}
export interface TransportResponse<T> {
  parsed: T | null;
  stopReason: string | null;
  usage: TokenUsage;
}
export type Transport = <T>(req: TransportRequest<T>) => Promise<TransportResponse<T>>;

/** A tool-use turn: the transport sends the conversation and returns the model's content blocks. */
export interface ChatTransportRequest {
  model: string;
  maxTokens: number;
  /** Versioned, cached prefix. */
  system: string;
  /** Volatile per-request context (today's date, owner rules) — after the cache breakpoint. */
  context: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
}
export interface ChatTransportResponse {
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
  usage: TokenUsage;
}
export type ChatTransport = (req: ChatTransportRequest) => Promise<ChatTransportResponse>;

/** Speech to text (ADR 0025): the audio as sent, and a hint of the words to expect. */
export type SpeechTransport = (req: {
  model: string;
  audio: Uint8Array;
  filename: string;
  prompt: string;
}) => Promise<string>;

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  durationMs: number;
}

export interface UsageStore {
  spentTodayUsdMicros(orgId: string, date: string): Promise<number>;
  /** Whether the org's plan includes AI (Phase 10 billing). Omitted = allowed (tests, evals). */
  planAllowsAi?(orgId: string): Promise<boolean>;
  record(row: {
    orgId: string;
    date: string;
    model: string;
    feature: string;
    usage: TokenUsage;
    costUsdMicros: number;
  }): Promise<void>;
}

export interface GatewayConfig {
  models: Record<ModelTier, string>;
  /** USD per million tokens, per model — which is exactly USD micros per token. */
  rates: Record<string, { input: number; output: number }>;
  dailyCapUsdMicros: number;
  /** Speech-to-text model and its list price per minute of audio, in USD micros. */
  speech?: { model: string; usdMicrosPerMinute: number };
  /** The business date usage is counted against (Asia/Dhaka; injected clock). */
  today: () => string;
}

export class AiError extends Error {
  constructor(
    readonly code:
      | 'cap_exceeded'
      | 'refused'
      | 'truncated'
      | 'invalid_output'
      | 'not_configured'
      | 'not_in_plan'
      /** The provider's per-minute limit was hit, even after its fallback and a short wait. */
      | 'rate_limited',
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

// +880 1XXXXXXXXX / 01XXXXXXXXX (Bangla or Latin digits) and e-mail addresses.
const PHONE = /(?:\+?(?:88|৮৮)\s?)?(?:0|০)(?:1|১)[3-9৩-৯][\d০-৯]{2}[\s-]?[\d০-৯]{6}/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** CLAUDE.md #8: phone numbers and e-mails never reach a model. */
export function maskPii(text: string): string {
  return text.replace(EMAIL, '[email]').replace(PHONE, '[phone]');
}

export function costUsdMicros(
  rates: GatewayConfig['rates'],
  model: string,
  usage: TokenUsage,
): number {
  const rate = rates[model];
  if (!rate) throw new AiError('not_configured', `no price configured for ${model}`);
  // Cache reads bill at 10% of input, cache writes at 125% (ARCHITECTURE.md "AI layer").
  return Math.ceil(
    usage.input * rate.input +
      usage.output * rate.output +
      usage.cacheRead * rate.input * 0.1 +
      usage.cacheWrite * rate.input * 1.25,
  );
}

export function createGateway(deps: {
  transport: Transport;
  chatTransport?: ChatTransport;
  speechTransport?: SpeechTransport;
  store: UsageStore;
  config: GatewayConfig;
}) {
  const { transport, store, config } = deps;
  const guard = async (orgId: string, today: string) => {
    if (store.planAllowsAi && !(await store.planAllowsAi(orgId))) {
      throw new AiError('not_in_plan', "this restaurant's plan does not include AI");
    }
    const spent = await store.spentTodayUsdMicros(orgId, today);
    if (spent >= config.dailyCapUsdMicros) {
      throw new AiError('cap_exceeded', 'the daily AI allowance for this restaurant is used up');
    }
  };
  return {
    /**
     * A manual tool-use loop: the model asks for tools, the caller's executeTool runs them (with the
     * caller's permissions), results go back, until the model answers or maxSteps runs out.
     * Every model call is cap-checked and costed.
     */
    async chat(req: {
      orgId: string;
      feature: string;
      prompt: PromptVersion;
      tier: ModelTier;
      context: string;
      messages: Anthropic.MessageParam[];
      tools: Anthropic.Tool[];
      executeTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
      maxSteps?: number;
      maxTokens?: number;
    }): Promise<{
      text: string;
      toolCalls: ToolCallRecord[];
      messages: Anthropic.MessageParam[];
      costUsdMicros: number;
    }> {
      if (!deps.chatTransport) throw new AiError('not_configured', 'no chat transport');
      const today = config.today();
      const model = config.models[req.tier];
      const messages: Anthropic.MessageParam[] = req.messages.map((m) =>
        m.role === 'user' && typeof m.content === 'string'
          ? { ...m, content: maskPii(m.content) }
          : m,
      );
      const toolCalls: ToolCallRecord[] = [];
      let cost = 0;
      for (let step = 0; step < (req.maxSteps ?? 6); step++) {
        await guard(req.orgId, today);
        const response = await deps.chatTransport({
          model,
          maxTokens: req.maxTokens ?? 4000,
          system: req.prompt.body,
          context: req.context,
          messages,
          tools: req.tools,
        });
        const callCost = costUsdMicros(config.rates, model, response.usage);
        cost += callCost;
        await store.record({
          orgId: req.orgId,
          date: today,
          model,
          feature: req.feature,
          usage: response.usage,
          costUsdMicros: callCost,
        });
        if (response.stopReason === 'refusal') throw new AiError('refused', 'the model declined');
        if (response.stopReason === 'max_tokens')
          throw new AiError('truncated', 'the answer was cut off');
        messages.push({ role: 'assistant', content: response.content });
        const uses = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        if (response.stopReason !== 'tool_use' || uses.length === 0) {
          const text = response.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join(' ')
            .trim();
          return { text, toolCalls, messages, costUsdMicros: cost };
        }
        // All results for one assistant turn go back in a single user message.
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of uses) {
          const started = performance.now();
          const input = (use.input ?? {}) as Record<string, unknown>;
          const result = await req.executeTool(use.name, input);
          toolCalls.push({
            name: use.name,
            input,
            result,
            durationMs: Math.round(performance.now() - started),
          });
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: JSON.stringify(result),
          });
        }
        messages.push({ role: 'user', content: results });
      }
      throw new AiError('truncated', 'too many tool calls');
    },

    /**
     * A voice note to text, cap-checked and costed by its length like every other call. The text is a
     * transcript for a person to check, never a figure (CLAUDE.md #1).
     */
    async transcribe(req: {
      orgId: string;
      feature: string;
      audio: Uint8Array;
      filename: string;
      seconds: number;
      prompt: string;
    }): Promise<string> {
      const speech = config.speech;
      if (!deps.speechTransport || !speech) {
        throw new AiError('not_configured', 'no speech-to-text transport');
      }
      const today = config.today();
      await guard(req.orgId, today);
      const text = await deps.speechTransport({
        model: speech.model,
        audio: req.audio,
        filename: req.filename,
        prompt: req.prompt,
      });
      await store.record({
        orgId: req.orgId,
        date: today,
        model: speech.model,
        feature: req.feature,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        costUsdMicros: Math.ceil((Math.max(1, req.seconds) * speech.usdMicrosPerMinute) / 60),
      });
      return text.trim();
    },

    async run<T>(req: GatewayRequest<T>): Promise<GatewayResult<T>> {
      const today = config.today();
      await guard(req.orgId, today);
      const model = config.models[req.tier];
      const content = req.content.map((block) =>
        block.type === 'text' ? { ...block, text: maskPii(block.text) } : block,
      );
      const response = await transport({
        model,
        maxTokens: req.maxTokens ?? 16000,
        system: req.prompt.body,
        content,
        schema: req.schema,
      });
      // A refused or cut-off answer still costs tokens: record it, then refuse to use it.
      const cost = costUsdMicros(config.rates, model, response.usage);
      await store.record({
        orgId: req.orgId,
        date: today,
        model,
        feature: req.feature,
        usage: response.usage,
        costUsdMicros: cost,
      });
      if (response.stopReason === 'refusal') throw new AiError('refused', 'the model declined');
      if (response.stopReason === 'max_tokens')
        throw new AiError('truncated', 'the answer was cut off');
      if (response.parsed === null)
        throw new AiError('invalid_output', 'the answer did not match the schema');
      const checked = req.schema.safeParse(response.parsed);
      if (!checked.success)
        throw new AiError('invalid_output', 'the answer did not match the schema');
      return {
        output: checked.data,
        model,
        prompt: { key: req.prompt.key, version: req.prompt.version },
        usage: { ...response.usage, costUsdMicros: cost },
      };
    },
  };
}
