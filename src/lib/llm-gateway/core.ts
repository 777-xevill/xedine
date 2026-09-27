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

export interface UsageStore {
  spentTodayUsdMicros(orgId: string, date: string): Promise<number>;
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
  /** The business date usage is counted against (Asia/Dhaka; injected clock). */
  today: () => string;
}

export class AiError extends Error {
  constructor(
    readonly code: 'cap_exceeded' | 'refused' | 'truncated' | 'invalid_output' | 'not_configured',
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
  store: UsageStore;
  config: GatewayConfig;
}) {
  const { transport, store, config } = deps;
  return {
    async run<T>(req: GatewayRequest<T>): Promise<GatewayResult<T>> {
      const today = config.today();
      const spent = await store.spentTodayUsdMicros(req.orgId, today);
      if (spent >= config.dailyCapUsdMicros) {
        throw new AiError('cap_exceeded', 'the daily AI allowance for this restaurant is used up');
      }
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
