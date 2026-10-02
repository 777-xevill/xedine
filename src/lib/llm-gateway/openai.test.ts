import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGateway, type ChatTransport } from './core';
import {
  chatBody,
  parsedJson,
  responseFormat,
  stopReason,
  toContentBlocks,
  toOpenAiMessages,
  usage,
  type OpenAiChoice,
} from './openai';

const choice = (message: OpenAiChoice['message'], finish_reason: string | null = 'stop') => ({
  message,
  finish_reason,
});

describe('OpenAI provider mapping (ADR 0024)', () => {
  it('puts the versioned prompt first, then the context, then the turns', () => {
    const out = toOpenAiMessages(['PROMPT', 'CONTEXT', ''], [{ role: 'user', content: 'hi' }]);
    expect(out).toEqual([
      { role: 'system', content: 'PROMPT' },
      { role: 'system', content: 'CONTEXT' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('round-trips a tool call: assistant tool_use → tool_calls, tool_result → tool message', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'sales today?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'call_1', name: 'get_sales', input: { window: 'today' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"net_poisha":100}' }],
      },
    ];
    expect(toOpenAiMessages([], messages)).toEqual([
      { role: 'user', content: 'sales today?' },
      {
        role: 'assistant',
        content: 'Checking.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_sales', arguments: '{"window":"today"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"net_poisha":100}' },
    ]);
  });

  it('sends a base64 image as a data URL next to the text', () => {
    const [msg] = toOpenAiMessages(
      [],
      [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
            { type: 'text', text: 'Read this menu.' },
          ],
        },
      ],
    );
    expect(msg).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        { type: 'text', text: 'Read this menu.' },
      ],
    });
  });

  it('maps finish reasons to the stop reasons the gateway guards on', () => {
    expect(stopReason(choice({ content: 'x' }, 'stop'))).toBe('end_turn');
    expect(stopReason(choice({ content: 'x' }, 'length'))).toBe('max_tokens');
    expect(stopReason(choice({ content: null }, 'tool_calls'))).toBe('tool_use');
    expect(stopReason(choice({ content: null }, 'content_filter'))).toBe('refusal');
    expect(stopReason(choice({ content: null, refusal: 'no' }, 'stop'))).toBe('refusal');
  });

  it('prices cached prompt tokens separately (prompt_tokens includes them)', () => {
    expect(
      usage({
        prompt_tokens: 1000,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 800 },
      }),
    ).toEqual({ input: 200, output: 50, cacheRead: 800, cacheWrite: 0 });
  });

  it('turns tool calls into tool_use blocks and tolerates broken arguments', () => {
    const blocks = toContentBlocks(
      choice(
        {
          content: null,
          tool_calls: [
            { id: 'a', type: 'function', function: { name: 'x', arguments: '{"n":1}' } },
            { id: 'b', type: 'function', function: { name: 'y', arguments: '{oops' } },
          ],
        },
        'tool_calls',
      ),
    );
    expect(blocks).toMatchObject([
      { type: 'tool_use', id: 'a', name: 'x', input: { n: 1 } },
      { type: 'tool_use', id: 'b', name: 'y', input: {} },
    ]);
    expect(parsedJson(choice({ content: '{"a":1}' }))).toEqual({ a: 1 });
    expect(parsedJson(choice({ content: 'not json' }))).toBeNull();
  });

  it('builds a JSON-schema response format from Zod without the $schema key', () => {
    const f = responseFormat(z.object({ items: z.array(z.string()) }));
    expect(f.type).toBe('json_schema');
    expect(f.json_schema.schema).not.toHaveProperty('$schema');
    expect(f.json_schema.schema).toMatchObject({ type: 'object' });
  });

  it('gives reasoning models thinking headroom and the configured effort', () => {
    const base = { system: 's', context: 'c', messages: [], tools: [] };
    expect(chatBody({ ...base, model: 'gpt-5-mini', maxTokens: 4000 }, 'low')).toMatchObject({
      max_completion_tokens: 8000,
      reasoning_effort: 'low',
    });
    const plain = chatBody({ ...base, model: 'gpt-4.1', maxTokens: 4000 }, 'low');
    expect(plain).toMatchObject({ max_completion_tokens: 4000 });
    expect(plain).not.toHaveProperty('reasoning_effort');
    // Groq: gpt-oss reasons like OpenAI's models; Llama does not.
    expect(
      chatBody({ ...base, model: 'openai/gpt-oss-120b', maxTokens: 4000 }, 'low'),
    ).toMatchObject({
      max_completion_tokens: 8000,
      reasoning_effort: 'low',
    });
    expect(chatBody({ ...base, model: 'qwen/qwen3.8-27b', maxTokens: 4000 }, 'low')).toMatchObject({
      max_completion_tokens: 4000,
    });
  });

  it('drives the gateway tool loop end to end through the mapping', async () => {
    const replies: OpenAiChoice[] = [
      choice(
        {
          content: null,
          tool_calls: [
            { id: 't1', type: 'function', function: { name: 'sales', arguments: '{}' } },
          ],
        },
        'tool_calls',
      ),
      choice({ content: 'Net sales today: ৳1,200.' }, 'stop'),
    ];
    const sent: unknown[] = [];
    const chatTransport: ChatTransport = async (req) => {
      sent.push(chatBody(req, 'low'));
      const c = replies.shift()!;
      return {
        content: toContentBlocks(c),
        stopReason: stopReason(c),
        usage: usage({ prompt_tokens: 10, completion_tokens: 5 }),
      };
    };
    const gw = createGateway({
      transport: async () => {
        throw new Error('unused');
      },
      chatTransport,
      store: { spentTodayUsdMicros: async () => 0, record: async () => {} },
      config: {
        models: { assistant: 'gpt-5-mini', fast: 'gpt-5-nano' },
        rates: { 'gpt-5-mini': { input: 0.25, output: 2 } },
        dailyCapUsdMicros: 1_000_000,
        today: () => '2026-09-29',
      },
    });
    const result = await gw.chat({
      orgId: 'o',
      feature: 'assistant',
      prompt: { key: 'assistant', version: 3, body: 'PROMPT' },
      tier: 'assistant',
      context: 'CONTEXT',
      messages: [{ role: 'user', content: 'sales?' }],
      tools: [{ name: 'sales', input_schema: { type: 'object', properties: {} } }],
      executeTool: async () => ({ net_poisha: 120000 }),
    });
    expect(result.text).toBe('Net sales today: ৳1,200.');
    expect(result.toolCalls).toHaveLength(1);
    // The second request carried the tool result back as a `tool` message.
    const second = sent[1] as { messages: { role: string; content: string }[] };
    expect(second.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 't1',
      content: '{"net_poisha":120000}',
    });
  });
});
