/**
 * Google Search grounding's sources, read from a Gemini generateContent answer's `groundingMetadata`
 * (ADR 0067): the web pages the answer leaned on, deduplicated, at most eight. Pure.
 */
export function groundingSources(meta: unknown): { title: string; url: string }[] {
  const chunks = (meta as { groundingChunks?: { web?: { uri?: string; title?: string } }[] } | null)
    ?.groundingChunks;
  const out: { title: string; url: string }[] = [];
  for (const c of chunks ?? []) {
    const url = c.web?.uri;
    if (!url || !/^https?:\/\//.test(url) || out.some((o) => o.url === url)) continue;
    out.push({ title: String(c.web?.title ?? url).slice(0, 200), url });
  }
  return out.slice(0, 8);
}
