import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { aiConfigured, aiErrorKey } from '@/lib/llm-gateway';
import { now } from '@/lib/time/clock';
import { TABLE_TOKEN } from '@/modules/customers/table-qr';
import { readTablePage } from '@/modules/customers/table-page-view';
import { ALLERGENS } from '@/modules/menu/food-facts';
import { askMenuHelper, QUESTION_MAX } from '@/modules/menu/menu-helper';

/**
 * The table page's menu helper (ADR 0049). No account: the table's link token is the only credential,
 * as for joining. Spend is held by the gateway's daily cap per restaurant; on top of that one table may
 * ask a few questions a minute (per server instance — a soft limit, the cap is the hard one).
 */
const Body = z.object({
  token: z.string().regex(TABLE_TOKEN),
  question: z.string().trim().min(2).max(QUESTION_MAX),
  locale: z.enum(['bn', 'en']).default('en'),
  avoid: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length).default([]),
});

const WINDOW_MS = 10 * 60_000;
const PER_TABLE = 12;
const recent = new Map<string, number[]>();

function allowed(token: string): boolean {
  const t = now().getTime();
  const list = (recent.get(token) ?? []).filter((x) => t - x < WINDOW_MS);
  if (list.length >= PER_TABLE) {
    recent.set(token, list);
    return false;
  }
  list.push(t);
  recent.set(token, list);
  if (recent.size > 5000) recent.clear();
  return true;
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const { token, question, locale, avoid } = parsed.data;
  if (!aiConfigured()) return NextResponse.json({ error: 'off' }, { status: 503 });
  if (!allowed(token)) return NextResponse.json({ error: 'busy' }, { status: 429 });
  const page = await readTablePage(token);
  if (!page) return NextResponse.json({ error: 'gone' }, { status: 404 });
  try {
    const out = await askMenuHelper({
      orgId: page.org_id,
      restaurant: page.restaurant,
      locale,
      question,
      menu: page.menu,
      avoid,
    });
    return NextResponse.json({ answer: out.answer, dishes: out.dishes.map((d) => d.name) });
  } catch (e) {
    const key = aiErrorKey(e);
    return NextResponse.json(
      { error: key === 'aiCapExceeded' || key === 'aiNotInPlan' ? 'off' : 'failed' },
      { status: 503 },
    );
  }
}
