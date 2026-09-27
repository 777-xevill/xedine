import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AiError,
  costUsdMicros,
  createGateway,
  maskPii,
  type Transport,
  type TransportRequest,
  type UsageStore,
} from './core';

const Schema = z.object({ answer: z.string() });
const prompt = { key: 'test', version: 3, body: 'You are a test.' };

function harness(
  opts: { spent?: number; response?: Partial<Awaited<ReturnType<Transport>>> } = {},
) {
  const sent: TransportRequest<unknown>[] = [];
  const recorded: Parameters<UsageStore['record']>[0][] = [];
  const transport: Transport = async (req) => {
    sent.push(req as TransportRequest<unknown>);
    return {
      parsed: { answer: 'ok' },
      stopReason: 'end_turn',
      usage: { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 0 },
      ...opts.response,
    } as never;
  };
  const store: UsageStore = {
    spentTodayUsdMicros: async () => opts.spent ?? 0,
    record: async (row) => {
      recorded.push(row);
    },
  };
  const gw = createGateway({
    transport,
    store,
    config: {
      models: { assistant: 'claude-sonnet-5', fast: 'claude-haiku-4-5' },
      rates: {
        'claude-sonnet-5': { input: 2, output: 10 },
        'claude-haiku-4-5': { input: 1, output: 5 },
      },
      dailyCapUsdMicros: 1_000_000,
      today: () => '2026-09-21',
    },
  });
  const run = (text = 'Menu: Kacchi 420') =>
    gw.run({
      orgId: 'org',
      feature: 'recipe_draft',
      prompt,
      tier: 'assistant',
      content: [{ type: 'text', text }],
      schema: Schema,
    });
  return { run, sent, recorded };
}

describe('LLM gateway', () => {
  it('returns schema-checked output with its model, prompt version and cost, and logs usage', async () => {
    const h = harness();
    const r = await h.run();
    expect(r.output).toEqual({ answer: 'ok' });
    expect(r.model).toBe('claude-sonnet-5');
    expect(r.prompt).toEqual({ key: 'test', version: 3 });
    // 1000×2 + 200×10 + 5000×2×0.1 = 2000 + 2000 + 1000 micros.
    expect(r.usage.costUsdMicros).toBe(5000);
    expect(h.recorded).toEqual([
      {
        orgId: 'org',
        date: '2026-09-21',
        model: 'claude-sonnet-5',
        feature: 'recipe_draft',
        usage: { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 0 },
        costUsdMicros: 5000,
      },
    ]);
    expect(h.sent[0]!.system).toBe('You are a test.');
  });

  it('refuses to call the model once the daily cap is spent', async () => {
    const h = harness({ spent: 1_000_000 });
    await expect(h.run()).rejects.toMatchObject({ code: 'cap_exceeded' });
    expect(h.sent).toHaveLength(0);
  });

  it('masks phone numbers and e-mails before anything leaves', async () => {
    const h = harness();
    await h.run('Call Rahim on +8801712345678 or 01812-345678, rahim@example.com, ০১৭১২৩৪৫৬৭৮');
    const text = (h.sent[0]!.content[0] as { text: string }).text;
    expect(text).toBe('Call Rahim on [phone] or [phone], [email], [phone]');
  });

  it('records the cost of refused, truncated or malformed answers, then refuses to use them', async () => {
    for (const [response, code] of [
      [{ stopReason: 'refusal' }, 'refused'],
      [{ stopReason: 'max_tokens' }, 'truncated'],
      [{ parsed: null }, 'invalid_output'],
      [{ parsed: { answer: 42 } }, 'invalid_output'],
    ] as const) {
      const h = harness({ response: response as never });
      await expect(h.run()).rejects.toBeInstanceOf(AiError);
      await expect(harness({ response: response as never }).run()).rejects.toMatchObject({ code });
      expect(h.recorded).toHaveLength(1);
    }
  });

  it('prices cache writes at 125% of input and refuses unknown models', () => {
    const rates = { m: { input: 2, output: 10 } };
    expect(costUsdMicros(rates, 'm', { input: 0, output: 0, cacheRead: 0, cacheWrite: 1000 })).toBe(
      2500,
    );
    expect(() =>
      costUsdMicros(rates, 'other', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }),
    ).toThrow(AiError);
    expect(maskPii('no personal data')).toBe('no personal data');
  });
});
