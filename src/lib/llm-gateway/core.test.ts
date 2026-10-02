import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AiError,
  costUsdMicros,
  createGateway,
  maskPii,
  type ChatTransport,
  type ChatTransportRequest,
  type Transport,
  type TransportRequest,
  type UsageStore,
} from './core';

const Schema = z.object({ answer: z.string() });
const prompt = { key: 'test', version: 3, body: 'You are a test.' };

function harness(
  opts: {
    spent?: number;
    planAllowsAi?: boolean;
    response?: Partial<Awaited<ReturnType<Transport>>>;
  } = {},
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
    ...(opts.planAllowsAi === undefined ? {} : { planAllowsAi: async () => opts.planAllowsAi! }),
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

  it('refuses to call the model when the plan does not include AI', async () => {
    const h = harness({ planAllowsAi: false });
    await expect(h.run()).rejects.toMatchObject({ code: 'not_in_plan' });
    expect(h.sent).toHaveLength(0);
    const ok = harness({ planAllowsAi: true });
    await expect(ok.run()).resolves.toBeTruthy();
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

describe('LLM gateway tool loop', () => {
  const usage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };
  function chatHarness(script: Awaited<ReturnType<ChatTransport>>[], spent = 0) {
    const calls: ChatTransportRequest[] = [];
    const recorded: unknown[] = [];
    const gw = createGateway({
      transport: (async () => {
        throw new Error('unused');
      }) as Transport,
      chatTransport: async (req) => {
        calls.push(structuredClone(req));
        return script.shift()!;
      },
      store: { spentTodayUsdMicros: async () => spent, record: async (r) => void recorded.push(r) },
      config: {
        models: { assistant: 'claude-sonnet-5', fast: 'claude-haiku-4-5' },
        rates: { 'claude-sonnet-5': { input: 2, output: 10 } },
        dailyCapUsdMicros: 1_000_000,
        today: () => '2026-09-21',
      },
    });
    return { gw, calls, recorded };
  }

  it('runs tools the model asks for, returns all results in one turn, and costs every call', async () => {
    const h = chatHarness([
      {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'get_item_sales',
            input: { item: 'kacchi', window: 'today' },
          },
          { type: 'tool_use', id: 't2', name: 'get_sales', input: { window: 'today' } },
        ] as never,
        stopReason: 'tool_use',
        usage,
      },
      {
        content: [{ type: 'text', text: '19 sold today.' }] as never,
        stopReason: 'end_turn',
        usage,
      },
    ]);
    const executed: string[] = [];
    const r = await h.gw.chat({
      orgId: 'org',
      feature: 'assistant',
      prompt: { key: 'assistant', version: 1, body: 'rules' },
      tier: 'assistant',
      context: 'Today is 2026-09-21. Call +8801712345678.',
      messages: [{ role: 'user', content: 'Kacchi today? my number is 01712345678' }],
      tools: [],
      executeTool: async (name) => {
        executed.push(name);
        return { qty: 19 };
      },
    });
    expect(r.text).toBe('19 sold today.');
    expect(executed).toEqual(['get_item_sales', 'get_sales']);
    expect(r.toolCalls.map((c) => c.name)).toEqual(['get_item_sales', 'get_sales']);
    expect(h.recorded).toHaveLength(2);
    expect(r.costUsdMicros).toBe(2 * (100 * 2 + 50 * 10));
    // The second call carries both tool results in one user message; the user's phone is masked.
    const second = h.calls[1]!.messages;
    expect(second[0]).toEqual({ role: 'user', content: 'Kacchi today? my number is [phone]' });
    const results = second[2]!.content as { type: string }[];
    expect(results.map((b) => b.type)).toEqual(['tool_result', 'tool_result']);
  });

  it('stops at the cap and after too many steps', async () => {
    const capped = chatHarness([], 1_000_000);
    await expect(
      capped.gw.chat({
        orgId: 'org',
        feature: 'assistant',
        prompt: { key: 'a', version: 1, body: '' },
        tier: 'assistant',
        context: '',
        messages: [{ role: 'user', content: 'x' }],
        tools: [],
        executeTool: async () => ({}),
      }),
    ).rejects.toMatchObject({ code: 'cap_exceeded' });
    const looping = chatHarness(
      Array.from({ length: 3 }, (_, i) => ({
        content: [{ type: 'tool_use', id: `t${i}`, name: 'get_sales', input: {} }] as never,
        stopReason: 'tool_use',
        usage,
      })),
    );
    await expect(
      looping.gw.chat({
        orgId: 'org',
        feature: 'assistant',
        prompt: { key: 'a', version: 1, body: '' },
        tier: 'assistant',
        context: '',
        messages: [{ role: 'user', content: 'x' }],
        tools: [],
        executeTool: async () => ({}),
        maxSteps: 3,
      }),
    ).rejects.toMatchObject({ code: 'truncated' });
  });
});

describe('speech to text', () => {
  function speechHarness(spent = 0) {
    const recorded: Parameters<UsageStore['record']>[0][] = [];
    const heard: { model: string; filename: string }[] = [];
    const gw = createGateway({
      transport: (async () => {
        throw new Error('unused');
      }) as Transport,
      speechTransport: async (req) => {
        heard.push({ model: req.model, filename: req.filename });
        return '  murgi 10 kg 1800  ';
      },
      store: { spentTodayUsdMicros: async () => spent, record: async (r) => void recorded.push(r) },
      config: {
        models: { assistant: 'a', fast: 'f' },
        rates: {},
        dailyCapUsdMicros: 1_000_000,
        speech: { model: 'gpt-4o-transcribe', usdMicrosPerMinute: 6_000 },
        today: () => '2026-10-01',
      },
    });
    const transcribe = (seconds: number) =>
      gw.transcribe({
        orgId: 'org',
        feature: 'purchase_voice',
        audio: new Uint8Array([1, 2, 3]),
        filename: 'voice.ogg',
        seconds,
        prompt: 'bazar',
      });
    return { transcribe, recorded, heard };
  }

  it('returns the transcript and costs the audio by its length', async () => {
    const h = speechHarness();
    expect(await h.transcribe(45)).toBe('murgi 10 kg 1800');
    expect(h.heard).toEqual([{ model: 'gpt-4o-transcribe', filename: 'voice.ogg' }]);
    // 45 s at $0.006 a minute = 4,500 micros.
    expect(h.recorded).toMatchObject([
      { orgId: 'org', date: '2026-10-01', feature: 'purchase_voice', costUsdMicros: 4_500 },
    ]);
  });

  it('is refused once the daily cap is spent, before any audio is sent', async () => {
    const h = speechHarness(1_000_000);
    await expect(h.transcribe(10)).rejects.toMatchObject({ code: 'cap_exceeded' });
    expect(h.heard).toEqual([]);
  });
});
