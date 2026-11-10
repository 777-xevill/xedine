import 'server-only';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { now } from '@/lib/time/clock';
import type { MenuDish } from './member-card-view';
import { TABLE_TOKEN } from './table-qr';

/**
 * The customer's table page (ADR 0045) has no account: the table's link token is the only credential.
 * table_page is callable by the service role only and returns the names, the member card rules, the
 * branch's Google review link and its menu, or null for an unknown link.
 */
export interface TablePageView {
  org_id: string;
  restaurant: string;
  branch: string;
  address: string;
  table: string;
  member_on: boolean;
  earn_points: number | null;
  earn_every_poisha: number | null;
  point_value_poisha: number | null;
  discount_bps: number | null;
  google_review_url: string | null;
  complaint_token: string;
  menu: MenuDish[];
}

export async function readTablePage(token: string): Promise<TablePageView | null> {
  if (!TABLE_TOKEN.test(token)) return null;
  const { data, error } = await createServiceRoleClient().rpc('table_page', {
    p_token: token,
    p_now: now().toISOString(),
  });
  if (error) {
    console.error('table page', error.code);
    return null;
  }
  return (data as TablePageView | null) ?? null;
}
