import 'server-only';
import { createHash } from 'node:crypto';
import type { createServiceRoleClient } from '@/lib/db/service-role';
import type { Locale } from '@/lib/i18n/format';
import { cutOut } from '../cutout';
import { imageAiConfigured, improveDishPhoto } from '../image-ai';
import { branchPricesByItem, posterPrice } from '../prices';

/**
 * Dish art for posters (ADR 0057), made by the social job and kept in social_dish_art: the cut-out of each
 * dish's menu photo (free, on the CPU) and, for a dish about to be posted, the AI studio plate (Cloudflare's
 * free quota) cut out the same way. Made once per photo; a new photo makes new art.
 *
 * Service-role code: every query names the org explicitly.
 */
type Supabase = ReturnType<typeof createServiceRoleClient>;

const MEDIA_BUCKET = 'social-media';
const PHOTO_BUCKET = 'menu-photos';
/** A studio plate that came out unusable is tried again a week later, not on every post. */
const STUDIO_RETRY_MS = 7 * 24 * 60 * 60_000;

export type PhotoCheck = 'ok' | 'not_food' | 'blurry';

export interface ArtRow {
  org_id: string;
  menu_item_id: string;
  source_path: string;
  cutout_path: string | null;
  cutout_usable: boolean;
  studio_path: string | null;
  studio_usable: boolean;
  studio_tried_at: string | null;
  photo_check: PhotoCheck | null;
  error: string | null;
  made_at: string | null;
}
const ART_COLUMNS =
  'org_id, menu_item_id, source_path, cutout_path, cutout_usable, studio_path, studio_usable, studio_tried_at, photo_check, error, made_at';
/** A cut-out that failed (the model crashed, out of memory) is tried again a day later. */
const CUTOUT_RETRY_MS = 24 * 60 * 60_000;

export interface Photo {
  bytes: Uint8Array;
  mime: string;
}

export async function downloadPhoto(sb: Supabase, path: string): Promise<Photo | null> {
  const { data: blob } = await sb.storage.from(PHOTO_BUCKET).download(path);
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/webp' };
}

async function downloadMedia(sb: Supabase, path: string): Promise<Uint8Array | null> {
  const { data: blob } = await sb.storage.from(MEDIA_BUCKET).download(path);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

async function upload(sb: Supabase, path: string, bytes: Uint8Array) {
  const { error } = await sb.storage
    .from(MEDIA_BUCKET)
    .upload(path, bytes, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
  if (error) throw error;
}

/** Art files are named after the photo they came from, so a new photo never reuses a stale cut-out. */
export function artPath(orgId: string, itemId: string, sourcePath: string, kind: 'cut' | 'studio') {
  const hash = createHash('sha256').update(sourcePath).digest('hex').slice(0, 12);
  return `${orgId}/art/${itemId}/${hash}-${kind}.webp`;
}

export async function artRows(
  sb: Supabase,
  orgId: string,
  itemIds: string[],
): Promise<Map<string, ArtRow>> {
  if (itemIds.length === 0) return new Map();
  const { data } = await sb
    .from('social_dish_art')
    .select(ART_COLUMNS)
    .eq('org_id', orgId)
    .in('menu_item_id', itemIds);
  return new Map(((data ?? []) as ArtRow[]).map((r) => [r.menu_item_id, r]));
}

/** Remove the art files of an older photo of this dish. */
async function clearOldArt(sb: Supabase, orgId: string, itemId: string, keep: string[]) {
  const folder = `${orgId}/art/${itemId}`;
  const { data } = await sb.storage.from(MEDIA_BUCKET).list(folder);
  const stale = (data ?? []).map((f) => `${folder}/${f.name}`).filter((p) => !keep.includes(p));
  if (stale.length) await sb.storage.from(MEDIA_BUCKET).remove(stale);
}

/**
 * The art for a dish's current photo, brought up to date and stored:
 *  1. a new photo starts a fresh row (the old photo's files are removed when the new cut-out is saved);
 *  2. `check` (the AI photo check) runs once per photo, when given; a photo that is not food stops here;
 *  3. the cut-out is made when `cut` is asked for and is missing (a failed one is retried a day later).
 * A failure of the cut-out model is recorded and the poster simply shows the photo.
 */
export async function prepareDish(
  sb: Supabase,
  orgId: string,
  item: { id: string; photo_path: string },
  photo: Photo,
  at: Date,
  o: { known?: ArtRow; check?: () => Promise<PhotoCheck>; cut?: boolean } = {},
): Promise<ArtRow> {
  const fresh = !o.known || o.known.source_path !== item.photo_path;
  let row: ArtRow = fresh
    ? {
        org_id: orgId,
        menu_item_id: item.id,
        source_path: item.photo_path,
        cutout_path: null,
        cutout_usable: false,
        studio_path: null,
        studio_usable: false,
        studio_tried_at: null,
        photo_check: null,
        error: null,
        made_at: null,
      }
    : o.known!;
  let dirty = fresh;
  const extra: { coverage?: number; edge?: number } = {};
  if (o.check && row.photo_check === null) {
    row = { ...row, photo_check: await o.check() };
    dirty = true;
  }
  const food = row.photo_check === null || row.photo_check === 'ok';
  const retry =
    !row.error || !row.made_at || at.getTime() - Date.parse(row.made_at) > CUTOUT_RETRY_MS;
  if ((o.cut ?? true) && food && !row.cutout_path && retry) {
    try {
      const cut = await cutOut(photo.bytes, photo.mime);
      const path = artPath(orgId, item.id, item.photo_path, 'cut');
      await upload(sb, path, cut.webp);
      await clearOldArt(sb, orgId, item.id, [path]);
      row = { ...row, cutout_path: path, cutout_usable: cut.usable, error: null };
      extra.coverage = cut.stats.coverage;
      extra.edge = cut.stats.edge;
    } catch (e) {
      row = { ...row, error: (e instanceof Error ? e.message : 'cutout_failed').slice(0, 300) };
    }
    row = { ...row, made_at: at.toISOString() };
    dirty = true;
  }
  if (dirty) {
    row = { ...row, made_at: row.made_at ?? at.toISOString() };
    const { error } = await sb.from('social_dish_art').upsert({ ...row, ...extra });
    if (error) throw error;
  }
  return row;
}

/**
 * The AI studio plate for the dish about to be posted, when Cloudflare is set up and this photo has no
 * usable one yet. The quota running out is not remembered as a try, so the next post tries again.
 */
export async function ensureStudio(
  sb: Supabase,
  row: ArtRow,
  args: { dish: string; reference: Uint8Array; seed: number; at: Date },
): Promise<ArtRow> {
  if (!imageAiConfigured() || row.studio_usable) return row;
  if (row.studio_tried_at && args.at.getTime() - Date.parse(row.studio_tried_at) < STUDIO_RETRY_MS)
    return row;
  let improved: Uint8Array | null;
  try {
    improved = await improveDishPhoto({
      reference: args.reference,
      dish: args.dish,
      seed: args.seed,
    });
  } catch {
    return row; // quota used up or Cloudflare unreachable: the cut-out of the real photo is still good
  }
  if (!improved) return row;
  const next: ArtRow = { ...row, studio_tried_at: args.at.toISOString() };
  try {
    const cut = await cutOut(improved, 'image/jpeg');
    if (cut.usable) {
      const path = artPath(row.org_id, row.menu_item_id, row.source_path, 'studio');
      await upload(sb, path, cut.webp);
      next.studio_path = path;
      next.studio_usable = true;
    }
  } catch {
    // an unusable studio plate just means the real photo's cut-out is used
  }
  await sb
    .from('social_dish_art')
    .update({
      studio_path: next.studio_path,
      studio_usable: next.studio_usable,
      studio_tried_at: next.studio_tried_at,
    })
    .eq('org_id', row.org_id)
    .eq('menu_item_id', row.menu_item_id);
  return next;
}

/** The best transparent picture of the dish: the studio plate, else the photo's cut-out, else none. */
export async function bestCut(sb: Supabase, row: ArtRow): Promise<Uint8Array | null> {
  if (row.studio_usable && row.studio_path) {
    const studio = await downloadMedia(sb, row.studio_path);
    if (studio) return studio;
  }
  if (row.cutout_usable && row.cutout_path) return downloadMedia(sb, row.cutout_path);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Prices on posters (the rule lives in prices.ts, shared with the Growth preview)
// ---------------------------------------------------------------------------------------------

export async function menuPrices(
  sb: Supabase,
  orgId: string,
  items: { id: string; base_price_poisha: number }[],
  locale: Locale,
  plusVat: string,
): Promise<Map<string, string | null>> {
  const ids = items.map((i) => i.id);
  const [{ data: branch }, { data: settings }] = await Promise.all([
    sb
      .from('branch_item_prices')
      .select('menu_item_id, price_poisha')
      .eq('org_id', orgId)
      .is('variant_id', null)
      .eq('is_available', true)
      .in('menu_item_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
    sb
      .from('org_settings')
      .select('price_includes_vat, currency')
      .eq('org_id', orgId)
      .maybeSingle(),
  ]);
  const byItem = branchPricesByItem(
    (branch ?? []) as { menu_item_id: string; price_poisha: number }[],
  );
  const included = (settings?.price_includes_vat as boolean | undefined) ?? true;
  return new Map(
    items.map((i) => [
      i.id,
      posterPrice(
        { basePoisha: Number(i.base_price_poisha), branchPoisha: byItem.get(i.id) ?? [] },
        locale,
        { included, plusVat, currency: (settings?.currency as string | undefined) ?? 'BDT' },
      ),
    ]),
  );
}
