import 'server-only';
import { FEATURE_KEYS } from '@/modules/tenancy/navigation';
import { PAGE_GUIDE } from './app-guide';
import { forModel } from './for-model';
import type { ToolContext } from './tools';

/**
 * The "restaurant card": what the assistant knows about this business before any tool runs, so it
 * never starts from nothing. Names, counts and settings only (no sales or money figures: those come
 * from the metric tools). Everything is read with the asker's own session, so a role that cannot read
 * a table simply gets a smaller card. The card is also a source for the numeric check, so a count
 * quoted from it is not rejected.
 */
const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

export async function restaurantCard(
  ctx: ToolContext,
  page?: { key: string; note?: string },
): Promise<Record<string, unknown>> {
  const head = { count: 'exact', head: true } as const;
  const [menu, hidden, categories, recipes, ingredients, suppliers, staff, settings, org] =
    await Promise.all([
      count(
        ctx.sb.from('menu_items').select('id', head).eq('org_id', ctx.orgId).eq('is_active', true),
      ),
      count(
        ctx.sb.from('menu_items').select('id', head).eq('org_id', ctx.orgId).eq('is_active', false),
      ),
      count(ctx.sb.from('menu_categories').select('id', head).eq('org_id', ctx.orgId)),
      count(
        ctx.sb.from('recipes').select('id', head).eq('org_id', ctx.orgId).eq('status', 'active'),
      ),
      count(
        ctx.sb.from('ingredients').select('id', head).eq('org_id', ctx.orgId).eq('is_active', true),
      ),
      count(
        ctx.sb.from('suppliers').select('id', head).eq('org_id', ctx.orgId).eq('is_active', true),
      ),
      count(ctx.sb.from('staff').select('id', head).eq('org_id', ctx.orgId).eq('is_active', true)),
      ctx.sb
        .from('org_settings')
        .select(
          'vat_rate_bps, service_charge_bps, price_includes_vat, default_cutoff_minutes, loss_line_bps',
        )
        .eq('org_id', ctx.orgId)
        .maybeSingle(),
      ctx.sb.from('organizations').select('name').eq('id', ctx.orgId).maybeSingle(),
    ]);
  const s = settings.data as {
    vat_rate_bps: number;
    service_charge_bps: number;
    price_includes_vat: boolean;
    default_cutoff_minutes: number;
    loss_line_bps: number;
  } | null;
  const enabled = ctx.access?.enabled ?? [];
  const cutoff = s?.default_cutoff_minutes ?? 240;
  const viewing = page ? PAGE_GUIDE[page.key as keyof typeof PAGE_GUIDE]?.name : undefined;
  return forModel({
    restaurant: (org.data as { name: string } | null)?.name ?? null,
    branches: ctx.branches.map((b) => b.name),
    asked_by_role: ctx.access?.roles.join(' + ') ?? null,
    page_open_now: viewing ? `${viewing}${page?.note ? ` (${page.note})` : ''}` : null,
    sections_switched_on: enabled,
    sections_switched_off: FEATURE_KEYS.filter((f) => !enabled.includes(f)),
    menu: {
      items: menu,
      hidden_items: hidden,
      categories,
      recipes,
      items_without_recipe: Math.max(0, menu - recipes),
    },
    ingredients,
    suppliers,
    staff_with_pins: staff,
    settings: s
      ? {
          vat_bps: s.vat_rate_bps,
          service_charge_bps: s.service_charge_bps,
          prices_include_vat: s.price_includes_vat,
          business_day_starts: `${String(Math.floor(cutoff / 60)).padStart(2, '0')}:${String(cutoff % 60).padStart(2, '0')}`,
          loss_line_bps: s.loss_line_bps,
        }
      : null,
  }) as Record<string, unknown>;
}
