import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { groundedSearch } from '@/lib/llm-gateway';
import { htmlToText, safeWebUrl, stripTags, type WebSource } from './web-text';

export { webSourcesOf, type WebSource } from './web-text';

/**
 * The assistant's window on the world (ADR 0067), so it can answer what is not in the restaurant's records
 * the way ChatGPT does. Free and open sources first: Wikipedia's API (English and Bangla, no key), and any
 * public page the person links. Google Search through Gemini when the founder turns it on (X7_GOOGLE_SEARCH=on;
 * Google gives it no free quota, 2026-11-19). Web text is data for the model, never instructions.
 */

export type WebResult =
  | {
      source: 'wikipedia' | 'google' | 'page';
      query?: string;
      /** A ready answer with its sources (Google), or pages to read (Wikipedia, a link). */
      answer?: string;
      results: (WebSource & { text: string })[];
    }
  | { error: 'not_found' | 'failed' | 'blocked'; detail?: string };

export const WEB_TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'web_search',
    description:
      'Looks up facts that are not in this restaurant’s records: cooking and recipes, food safety, ingredients, nutrition, a place, a festival, history, laws in general, business ideas, anything people ask ChatGPT. Returns pages with their links to cite. Never use it for this restaurant’s own sales, costs or stock: those come from the other tools.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A short search, in English or Bangla.' },
        language: { type: 'string', enum: ['en', 'bn'] },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_web_page',
    description:
      'Reads a public web page (a link the person sent, or one from web_search) as text.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
];

const UA = 'XedineBot/1.0 (+https://xedine.org)';

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function wikipedia(query: string, lang: 'en' | 'bn') {
  const api = `https://${lang}.wikipedia.org/w/api.php`;
  const q = encodeURIComponent(query);
  const found = (await getJson(
    `${api}?action=query&list=search&srsearch=${q}&srlimit=3&srprop=snippet&format=json&utf8=1`,
  )) as { query?: { search?: { title: string; snippet: string }[] } };
  const hits = found.query?.search ?? [];
  if (hits.length === 0) return [];
  const titles = hits.map((h) => h.title);
  const ex = (await getJson(
    `${api}?action=query&prop=extracts&exintro=1&explaintext=1&exlimit=3&redirects=1&format=json&utf8=1&titles=${encodeURIComponent(titles.join('|'))}`,
  )) as { query?: { pages?: Record<string, { title: string; extract?: string }> } };
  const pages = Object.values(ex.query?.pages ?? {});
  return hits.map((h) => {
    const page = pages.find((p) => p.title === h.title);
    const body = (page?.extract ?? stripTags(h.snippet)).trim();
    return {
      title: h.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`,
      text: body.length > 1500 ? `${body.slice(0, 1500)}…` : body,
    };
  });
}

/** A web search for the model: Google (when on), else Wikipedia in the question's language and English. */
export async function webSearch(orgId: string, input: Record<string, unknown>): Promise<WebResult> {
  const query = String(input.query ?? '')
    .trim()
    .slice(0, 200);
  if (!query) return { error: 'not_found', detail: 'empty search' };
  const lang = input.language === 'bn' || /[ঀ-৿]/.test(query) ? 'bn' : 'en';
  if (process.env.X7_GOOGLE_SEARCH === 'on') {
    try {
      const g = await groundedSearch(orgId, query);
      if (g)
        return {
          source: 'google',
          query,
          answer: g.text,
          results: g.sources.map((s) => ({ ...s, text: '' })),
        };
    } catch (e) {
      console.error('google search', e instanceof Error ? e.message.slice(0, 80) : 'failed');
    }
  }
  try {
    const results = [
      ...(lang === 'bn' ? await wikipedia(query, 'bn') : []),
      ...(await wikipedia(query, 'en')),
    ].slice(0, 4);
    if (results.length === 0) return { error: 'not_found', detail: 'nothing found; say so' };
    return { source: 'wikipedia', query, results };
  } catch {
    return { error: 'failed', detail: 'the web could not be reached' };
  }
}

/** A public page as text (≤ 6,000 characters). */
export async function readWebPage(input: Record<string, unknown>): Promise<WebResult> {
  const url = safeWebUrl(input.url);
  if (!url) return { error: 'blocked', detail: 'only public http(s) addresses' };
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });
    if (!safeWebUrl(res.url || url.href)) return { error: 'blocked' };
    if (!res.ok) return { error: 'failed', detail: `the page answered ${res.status}` };
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/|json|xml/.test(type)) return { error: 'failed', detail: 'not a text page' };
    const raw = (await res.text()).slice(0, 1_500_000);
    const page = /html/.test(type)
      ? htmlToText(raw)
      : { title: url.hostname, text: raw.slice(0, 6000) };
    return {
      source: 'page',
      results: [{ title: page.title || url.hostname, url: res.url || url.href, text: page.text }],
    };
  } catch {
    return { error: 'failed', detail: 'the page could not be read' };
  }
}
