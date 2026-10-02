import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ChatTransportRequest, TokenUsage, TransportRequest } from './core';

/**
 * OpenAI provider for the gateway (ADR 0024). The gateway's own message shape is the Anthropic one
 * (it came first, ADR 0016); these pure functions translate it to and from OpenAI Chat Completions,
 * so every guard in core.ts — daily cap, PII masking, schema check, refusal/truncation handling,
 * cost logging — and the assistant's numeric validator apply unchanged whichever provider answers.
 * No network here: the fetch lives in index.ts (server-only).
 */

// --- The slice of the Chat Completions wire format we use -----------------------------------------
export type OpenAiContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export type OpenAiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAiContentPart[] }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OpenAiTool {
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export interface OpenAiChoice {
  finish_reason: string | null;
  message: {
    content: string | null;
    refusal?: string | null;
    tool_calls?: {
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }[];
  };
}

export interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

export interface OpenAiCompletion {
  choices: OpenAiChoice[];
  usage?: OpenAiUsage;
}

// --- Requests -------------------------------------------------------------------------------------
function userParts(blocks: Anthropic.ContentBlockParam[]): OpenAiContentPart[] {
  const parts: OpenAiContentPart[] = [];
  for (const b of blocks) {
    if (b.type === 'text') parts.push({ type: 'text', text: b.text });
    else if (b.type === 'image' && b.source.type === 'base64')
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
      });
  }
  return parts;
}

function toolResultText(content: Anthropic.ToolResultBlockParam['content']): string {
  if (typeof content === 'string') return content;
  return (content ?? [])
    .map((c) => (c.type === 'text' ? c.text : ''))
    .filter(Boolean)
    .join('\n');
}

/** The gateway's conversation → OpenAI messages. Tool results become `tool` messages. */
export function toOpenAiMessages(
  system: string[],
  messages: Anthropic.MessageParam[],
): OpenAiMessage[] {
  const out: OpenAiMessage[] = system
    .filter((s) => s.trim() !== '')
    .map((content) => ({ role: 'system' as const, content }));
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push(
        m.role === 'user'
          ? { role: 'user', content: m.content }
          : { role: 'assistant', content: m.content },
      );
      continue;
    }
    if (m.role === 'assistant') {
      const text = m.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim();
      const calls = m.content
        .filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          type: 'function' as const,
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
      continue;
    }
    // A user turn: tool results first (they answer the previous assistant turn), then any content.
    for (const b of m.content)
      if (b.type === 'tool_result')
        out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: toolResultText(b.content) });
    const parts = userParts(m.content);
    if (parts.length > 0)
      out.push({
        role: 'user',
        content: parts.every((p) => p.type === 'text')
          ? parts.map((p) => (p as { text: string }).text).join('\n')
          : parts,
      });
  }
  return out;
}

export function toOpenAiTools(tools: Anthropic.Tool[]): OpenAiTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

/** A Zod schema as the JSON Schema OpenAI's structured output takes (root must be an object). */
export function responseFormat(schema: z.ZodType): {
  type: 'json_schema';
  json_schema: { name: string; schema: Record<string, unknown>; strict: false };
} {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  // Not strict: strict mode rejects optional fields; the gateway re-validates with Zod anyway.
  return { type: 'json_schema', json_schema: { name: 'output', schema: json, strict: false } };
}

/** Reasoning models spend completion tokens thinking; give them headroom beyond the answer budget. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d|openai\/gpt-oss)/.test(model);
}

export function completionBody(
  req: Pick<TransportRequest<unknown>, 'model' | 'maxTokens'>,
  reasoningEffort: string | undefined,
): Record<string, unknown> {
  const reasoning = isReasoningModel(req.model);
  return {
    model: req.model,
    max_completion_tokens: reasoning ? req.maxTokens + 4000 : req.maxTokens,
    ...(reasoning && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  };
}

export function chatBody(req: ChatTransportRequest, reasoningEffort: string | undefined) {
  return {
    ...completionBody(req, reasoningEffort),
    // The versioned prompt first and the volatile context after it, so OpenAI's automatic prefix
    // cache can reuse the stable part (the same split as the Anthropic cache breakpoint).
    messages: toOpenAiMessages([req.system, req.context], req.messages),
    tools: toOpenAiTools(req.tools),
  };
}

// --- Responses ------------------------------------------------------------------------------------
/** OpenAI finish reasons → the gateway's (Anthropic) stop reasons, which core.ts acts on. */
export function stopReason(choice: OpenAiChoice): string | null {
  if (choice.message.refusal) return 'refusal';
  switch (choice.finish_reason) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    case 'stop':
      return 'end_turn';
    default:
      return choice.finish_reason;
  }
}

export function usage(u: OpenAiUsage | undefined): TokenUsage {
  const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    // prompt_tokens includes the cached ones; the gateway prices cached reads separately.
    input: Math.max(0, (u?.prompt_tokens ?? 0) - cached),
    output: u?.completion_tokens ?? 0,
    cacheRead: cached,
    cacheWrite: 0,
  };
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

/** An OpenAI reply as the gateway's content blocks: text, then tool calls. */
export function toContentBlocks(choice: OpenAiChoice): Anthropic.ContentBlock[] {
  const blocks: Anthropic.ContentBlock[] = [];
  if (choice.message.content)
    blocks.push({ type: 'text', text: choice.message.content, citations: null });
  for (const call of choice.message.tool_calls ?? []) {
    if (call.type !== 'function') continue;
    blocks.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input: parseArguments(call.function.arguments),
      caller: { type: 'direct' },
    });
  }
  return blocks;
}

/** A structured-output reply's JSON, or null when there is none or it does not parse. */
export function parsedJson(choice: OpenAiChoice): unknown {
  const text = choice.message.content;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
