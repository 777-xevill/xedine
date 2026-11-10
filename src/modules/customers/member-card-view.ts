import 'server-only';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { CARD_TOKEN } from './member-card';

/**
 * The customer's own card page (ADR 0042) has no account: the link token is the only credential.
 * member_card_view is callable by the service role only and returns one card (masked phone, no costs,
 * nothing about other customers), or null for an unknown link or a card the restaurant switched off.
 */
export interface MemberCardView {
  restaurant: string;
  name: string | null;
  phone: string;
  member_since: string;
  points: number;
  points_worth_poisha: number;
  point_value_poisha: number;
  min_redeem_points: number;
  earn_points: number;
  earn_every_poisha: number;
  discount_bps: number | null;
  orders: {
    placed_at: string;
    business_date: string;
    branch: string;
    total_poisha: number;
    points: number;
    items: { name: string; quantity: number }[];
  }[];
  history: { kind: 'earn' | 'redeem' | 'adjust'; points: number; created_at: string }[];
  branches: { name: string; address: string | null; area: string | null }[];
  menu: MenuDish[];
}

/** One dish on a customer's menu (card page and table page). */
export interface MenuDish {
  name: string;
  name_bn: string | null;
  description: string | null;
  price_poisha: number;
  photo_path: string | null;
  cat: string;
  cat_bn: string | null;
}

export async function readMemberCard(token: string): Promise<MemberCardView | null> {
  if (!CARD_TOKEN.test(token)) return null;
  const { data, error } = await createServiceRoleClient().rpc('member_card_view', {
    p_token: token,
  });
  if (error) {
    console.error('member card view', error.code);
    return null;
  }
  return (data as MemberCardView | null) ?? null;
}

/** Public URL of a dish photo in the public menu-photos bucket (ADR 0031). */
export function dishPhotoUrl(path: string): string {
  return createServiceRoleClient().storage.from('menu-photos').getPublicUrl(path).data.publicUrl;
}
