import { findPages, reachable, type Access } from './app-guide';
import { TOOL_PAGES } from './tools';

/** A page the answer is about, offered under it as "Open Stock". `key` is also the `nav.*` label key. */
export interface PageLink {
  key: string;
  href: string;
}

const MOST = 3;

/**
 * Where an answer lives. Each tool belongs to a page (Stock for stock, Money leaks for findings…);
 * the guide's lookups add the pages they found. Only pages this person can open are offered, never
 * the one they are already on. Pure: the same calls always give the same links.
 */
export function pageLinks(
  calls: { name: string; input: Record<string, unknown> }[],
  access: Access,
  current?: string,
): PageLink[] {
  const open = reachable(access);
  const keys: string[] = [];
  for (const c of calls) {
    if (c.name === 'find_page') {
      const topic = typeof c.input.topic === 'string' ? c.input.topic : '';
      if (topic.trim()) for (const h of findPages(topic, access, 1)) keys.push(h.key);
    } else if (TOOL_PAGES[c.name]) keys.push(TOOL_PAGES[c.name]!);
  }
  const out: PageLink[] = [];
  for (const key of keys) {
    const link = open.get(key as never);
    if (!link || key === current || out.some((o) => o.key === key)) continue;
    out.push({ key, href: link.href });
    if (out.length === MOST) break;
  }
  return out;
}
