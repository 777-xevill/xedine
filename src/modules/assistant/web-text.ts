/**
 * Pure helpers for the assistant's web tools (ADR 0067): which addresses may be read, and a web page as
 * plain text. No network here (web.ts fetches).
 */

/** Hosts the assistant never reads: this machine, private networks and bare IP addresses. */
const BLOCKED_HOST =
  /^(localhost|.*\.local|.*\.internal|.*\.localhost|0\.0\.0\.0|\[.*\]|\d{1,3}(\.\d{1,3}){3})$/i;

/** A public http(s) address on a normal port, or null. */
export function safeWebUrl(raw: unknown): URL | null {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOST.test(host) || !host.includes('.')) return null;
  return url;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Tags removed from search snippets ("<span class=searchmatch>biryani</span>" → "biryani"). */
export const stripTags = (s: string) =>
  decodeEntities(s.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();

/** A page's title and readable text: scripts, styles and menus left out, blocks on their own lines. */
export function htmlToText(html: string, maxChars = 6000): { title: string; text: string } {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').slice(0, 200);
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|noscript|svg|head|nav|footer|form|iframe|template)\b[\s\S]*?<\/\1>/gi,
      ' ',
    )
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]*>/g, ' ');
  const text = decodeEntities(body)
    .split('\n')
    .map((l) => l.replace(/[ \t\r\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return { title, text: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text };
}

/** The first http(s) address written in a question, for offering read_web_page. */
export function urlIn(question: string): string | null {
  return /https?:\/\/[^\s<>"']+/i.exec(question)?.[0] ?? null;
}

export interface WebSource {
  title: string;
  url: string;
}

/**
 * The links an answer leaned on, for the "From the web" line under it: a page the person linked always; a
 * search result only when the answer talks about it (a word of five letters or more from its title is in the
 * answer), so pages the search found but the answer did not use are not shown as its sources.
 */
export function webSourcesOf(results: unknown[], answer: string): WebSource[] {
  const said = answer.toLowerCase();
  const used = (title: string) =>
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .some((w) => w.length >= 5 && said.includes(w));
  const out: WebSource[] = [];
  for (const r of results) {
    const res = r as { source?: string; results?: WebSource[] } | null;
    for (const s of res?.results ?? [])
      if (s?.url && !out.some((o) => o.url === s.url) && (res?.source === 'page' || used(s.title)))
        out.push({ title: s.title, url: s.url });
  }
  return out.slice(0, 6);
}
